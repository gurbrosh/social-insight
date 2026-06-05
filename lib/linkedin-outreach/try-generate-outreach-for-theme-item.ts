import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getLinkedInAuthorFromExtraJson,
  linkedinOriginalPosterRawDisplayFromPostExtra,
} from "@/lib/linkedin-prospects-csv/extra-json";
import { isLinkedInPlatform } from "@/lib/utils/platform";
import {
  firstLastFromInSlugPath,
  givenNameAfterLeadingHonorifics,
  isHonorificNamePrefixOnly,
  splitDisplayNameToParts,
  titleAndCompanyFromHeadline,
} from "@/lib/linkedin-prospects-csv/row-text";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import {
  buildLinkedinCommentSubjectTopic,
  DEFAULT_LINKEDIN_OUTREACH_SIGNOFF,
  generateLinkedinOutreachEmail,
  myProductSummaryParagraph,
  parseReferenceUrlsList,
} from "@/lib/linkedin-outreach/generate-outreach-email";
import { resolveThreadRootPostDbId } from "@/lib/linkedin-outreach/resolve-thread-root-post-id";
import type { ProspectClassification, ProspectOutreachBucket } from "@/lib/prospect-intelligence/types";
import {
  fetchOutreachTemplateDefinitions,
} from "@/lib/prospect-intelligence/pipeline";
import { resolveOutreachTemplateForClassification } from "@/lib/prospect-intelligence/template-resolve";
import { renderOutreachTemplate } from "@/lib/prospect-intelligence/draft-render";

export type ProjectProductForOutreach = {
  my_product_name: string | null;
  my_product_focus_text: string | null;
  my_product_reference_urls: Prisma.JsonValue;
  my_product_summary_json: Prisma.JsonValue | null;
};

function jsonishToString(v: Prisma.JsonValue | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function sanitizePossessiveNameToken(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || /^https?:\/\//i.test(t) || t.includes("@")) return "";
  return t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim().slice(0, 72);
}

/**
 * One short token/name for `... on [Name]'s post` from scraped root-post author metadata (never fabricated).
 */
function deriveOriginalPosterNameForPossessive(
  preferredDisplayLine: string,
  profileUrl: string | null | undefined
): string | undefined {
  let line = preferredDisplayLine.replace(/\s+/g, " ").trim();
  if (line.includes(",")) {
    line = line.split(",")[0]?.trim() ?? line;
  }
  const firstParsed = sanitizePossessiveNameToken(
    line ? splitDisplayNameToParts(line).first_name.trim() : ""
  );
  const fallbackFirstWord = sanitizePossessiveNameToken(line.split(/\s+/)[0] ?? "");
  let token = firstParsed.length >= 2 ? firstParsed : fallbackFirstWord;
  if (token.length >= 2 && isHonorificNamePrefixOnly(token)) {
    token = "";
  }

  const nu = normalizePublicProfileUrl(profileUrl ?? "");
  if (token.length < 2 && nu) {
    token = sanitizePossessiveNameToken(firstLastFromInSlugPath(nu).first_name.trim());
  }
  return token.length >= 2 ? token : undefined;
}

/** DB context to branch root post vs threaded comment outreach (requires `matchedPostId`). */
export type OutreachDbContext = {
  projectId: string;
  matchedPostId: number;
};

/**
 * Produces `email_subject` + `email_body` for LinkedIn + My product; otherwise `null` (not an error).
 * Used by the theme response pipeline and the LinkedIn CSV export backfill.
 */
export async function tryGenerateLinkedinOutreachForThemeItem(
  projectProduct: ProjectProductForOutreach | null,
  outreachDbContext: OutreachDbContext | null,
  fullText: string,
  row: {
    theme_name: string;
    post_url: string | null;
    author_name: string | null;
    platform: string;
  },
  postAuthor:
    | { url: string | null; authorName: string | null; extraJson: Prisma.JsonValue | null }
    | undefined,
  objective: { name: string; description: string | null; id: string },
  logPrefix: string,
  /** When set, overrides name/company/role used in the model (e.g. after a public profile fetch). */
  fieldHints?: { authorFirstName?: string; company?: string; authorRole?: string } | null,
  prospectIntel?: {
    projectId: string;
    classification: ProspectClassification;
    bucket: ProspectOutreachBucket;
    suppressTitleCompany: boolean;
  } | null
): Promise<{ email_subject: string; email_body: string } | null> {
  const hasProductText =
    Boolean(projectProduct?.my_product_name?.trim()) ||
    Boolean(projectProduct?.my_product_focus_text?.trim());
  if (!isLinkedInPlatform(row.platform) || !projectProduct || !hasProductText) {
    return null;
  }
  try {
    const p = postAuthor;
    const { profileUrl, headline } = getLinkedInAuthorFromExtraJson(p?.extraJson);
    let { company, title: roleFromHead } = titleAndCompanyFromHeadline(headline);
    let { first_name } = splitDisplayNameToParts(row.author_name ?? p?.authorName ?? null);
    if (!first_name.trim() && profileUrl) {
      const nu = normalizePublicProfileUrl(String(profileUrl));
      if (nu) first_name = firstLastFromInSlugPath(nu).first_name;
    }
    if (fieldHints?.authorFirstName?.trim()) {
      first_name = givenNameAfterLeadingHonorifics(fieldHints.authorFirstName.trim());
    }
    if (fieldHints?.company?.trim()) company = fieldHints.company.trim();
    if (fieldHints?.authorRole?.trim()) roleFromHead = fieldHints.authorRole.trim();
    const productNameForMail =
      (projectProduct.my_product_name || "").trim() ||
      (projectProduct.my_product_focus_text || "")
        .trim()
        .split(/[.!?\n]/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) ||
      "Product";

    let outreachKind: "root_post" | "thread_comment" = "root_post";
    let originalPosterNameForPossessive: string | undefined;
    let commentThreadTopicForSubject: string | undefined;

    if (outreachDbContext) {
      const matched = await prisma.post.findFirst({
        where: {
          project_id: outreachDbContext.projectId,
          id: outreachDbContext.matchedPostId,
        },
        select: { threadRefId: true },
      });

      const isComment = Boolean(matched?.threadRefId?.trim());
      if (isComment) {
        outreachKind = "thread_comment";
        const rootId = await resolveThreadRootPostDbId(
          outreachDbContext.projectId,
          outreachDbContext.matchedPostId
        );
        const root = await prisma.post.findUnique({
          where: { id: rootId },
          select: { authorName: true, content: true, extraJson: true },
        });
        const { profileUrl: rootProfileUrlForName } = getLinkedInAuthorFromExtraJson(
          root?.extraJson ?? null
        );
        const displayLine =
          (root?.authorName ?? "").trim() ||
          linkedinOriginalPosterRawDisplayFromPostExtra(root?.extraJson ?? null);

        originalPosterNameForPossessive = deriveOriginalPosterNameForPossessive(
          displayLine,
          rootProfileUrlForName
        );
        commentThreadTopicForSubject = buildLinkedinCommentSubjectTopic(
          root?.content ?? null,
          row.theme_name
        );
      }
    }

    if (prospectIntel && outreachKind === "root_post") {
      try {
        const templates = await fetchOutreachTemplateDefinitions(prospectIntel.projectId);
        const tpl = resolveOutreachTemplateForClassification({
          templates,
          bucket: prospectIntel.bucket,
          classification: prospectIntel.classification,
          hasSourcePostText: fullText.trim().length >= 40,
          preferChannel: "email",
        });
        if (tpl) {
          const sourcePostTopic = buildLinkedinCommentSubjectTopic(fullText, row.theme_name);
          const sourcePostUrl = row.post_url || p?.url || "";
          const productAngle =
            (projectProduct.my_product_focus_text || "").trim().split(/[.\n]/)[0]?.trim() ||
            (projectProduct.my_product_name || "").trim() ||
            "our product";
          const rendered = renderOutreachTemplate(tpl, {
            classification: prospectIntel.classification,
            firstName: givenNameAfterLeadingHonorifics(first_name.trim()),
            sourcePostTopic,
            sourcePostUrl,
            productAngle,
            detectedPain: "",
            suppressTitleCompany: prospectIntel.suppressTitleCompany,
          });
          if (rendered.body.trim()) {
            const subj =
              rendered.subject.trim() ||
              `Your LinkedIn post about ${sourcePostTopic.replace(/\s+/g, " ").slice(0, 72)}`;
            return { email_subject: subj, email_body: rendered.body };
          }
        }
      } catch (e) {
        console.warn(`${logPrefix} template_outreach_fallback`, e);
      }
    }

    const out = await generateLinkedinOutreachEmail({
      outreachKind,
      originalPosterNameForPossessive,
      commentThreadTopicForSubject,
      postOrThreadExcerpt: fullText,
      postUrl: row.post_url || p?.url || null,
      authorFirstName: first_name.trim(),
      company,
      authorRole: roleFromHead,
      themeLabel: row.theme_name,
      productName: productNameForMail,
      productFocus: (projectProduct.my_product_focus_text || "").trim(),
      productSummaryOneParagraph:
        myProductSummaryParagraph(jsonishToString(projectProduct.my_product_summary_json)) ||
        (projectProduct.my_product_focus_text || "").trim() ||
        productNameForMail,
      productUrls: parseReferenceUrlsList(
        jsonishToString(projectProduct.my_product_reference_urls) ?? undefined
      ),
      objectiveName: objective.name,
      objectiveDescription: objective.description || objective.name,
      signoffLine: DEFAULT_LINKEDIN_OUTREACH_SIGNOFF,
    });
    return { email_subject: out.email_subject, email_body: out.email_body };
  } catch (e) {
    console.warn(
      `${logPrefix} linkedin_outreach_fail objective=${objective.id} theme=${row.theme_name}:`,
      e
    );
    return null;
  }
}
