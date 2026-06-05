import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tryGenerateLinkedinOutreachForThemeItem } from "@/lib/linkedin-outreach/try-generate-outreach-for-theme-item";
import { linkedInMatchedPostPassesProspectSubstanceGate } from "@/lib/linkedin-outreach/evaluate-linkedin-comment-for-prospect";
import { resolveContextTextsForThemeRows } from "@/lib/response-generator/theme-context-text";
import { LINKEDIN_DB_PLATFORM_IN, isLinkedInPlatform } from "@/lib/utils/platform";
import { getRollingWindowStart, type ReportRangeUnit } from "@/lib/report-window";
import { buildRowFromSource } from "./build-row";
import { DEFAULT_MAX_ROWS } from "./constants";
import { getLinkedInAuthorFromExtraJson } from "./extra-json";
import { tryFetchLinkedInPublicProfileData } from "./fetch-linkedin-public-profile";
import { normalizePublicProfileUrl } from "./normalize-url";
import {
  firstLastFromInSlugPath,
  parseCompanyFromHeadline,
  singleLineText,
  splitDisplayNameToParts,
} from "./row-text";
import type { BuildCandidate, LinkedInProspectCsvRow } from "./types";
import type { ProspectClassification, ProspectOutreachBucket } from "@/lib/prospect-intelligence/types";
import {
  ensureProspectIntelligenceSettings,
  syncProspectCandidateForThemeRow,
  fetchActiveRoutingRules,
  loadCompetitorPatternsForProject,
} from "@/lib/prospect-intelligence/pipeline";
import { gatherEvidenceFromPostRow, mergePublicProfileScrapeEvidence } from "@/lib/prospect-intelligence/gather-evidence";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import { evaluateRoutingRules } from "@/lib/prospect-intelligence/rule-engine";

export type CollectLinkedInParams = {
  projectId: string;
  rangeAmount: number;
  rangeUnit: ReportRangeUnit;
  minRelevancePercent: number;
  now?: Date;
};

export type CollectLinkedInProspectsResult = {
  rows: LinkedInProspectCsvRow[];
  droppedInvalid: number;
  droppedDedup: number;
  droppedCap: number;
  /** Thread comments that were purely supportive without substantive tie to OP (not exported). */
  droppedSupportiveOnlyComment: number;
  /** Excluded by prospect routing rules (unless LINKEDIN_EXPORT_INCLUDE_EXCLUDED=1). */
  droppedExcluded: number;
  windowStart: Date;
  minRelevancePercent: number;
  rangeAmount: number;
  rangeUnit: ReportRangeUnit;
};

function readMaxRows(): number {
  const raw = process.env.LINKEDIN_PROSPECTS_CSV_MAX_ROWS;
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_ROWS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ROWS;
}

const LOG = "[linkedin-prospects-csv:collect]";

/**
 * Gathers LinkedIn `ThemesAnalysis` rows (normal themes and "Conversation W/O Theme"),
 * applies UI relevance %, rolling date window, generates private outreach email, optional profile fetch.
 */
export async function collectLinkedInProspectRowsForExport(
  params: CollectLinkedInParams
): Promise<CollectLinkedInProspectsResult> {
  const { projectId, rangeAmount, rangeUnit, minRelevancePercent, now = new Date() } = params;

  const windowStart = getRollingWindowStart(rangeAmount, rangeUnit, now);
  const maxRows = readMaxRows();
  const minP = Math.min(100, Math.max(0, minRelevancePercent));

  const projectProduct = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: {
      my_product_name: true,
      my_product_focus_text: true,
      my_product_reference_urls: true,
      my_product_summary_json: true,
    },
  });
  const hasMyProduct =
    Boolean(projectProduct?.my_product_name?.trim()) ||
    Boolean(projectProduct?.my_product_focus_text?.trim());
  if (!hasMyProduct || !projectProduct) {
    return {
      rows: [],
      droppedInvalid: 0,
      droppedDedup: 0,
      droppedCap: 0,
      droppedSupportiveOnlyComment: 0,
      droppedExcluded: 0,
      windowStart,
      minRelevancePercent: minP,
      rangeAmount,
      rangeUnit,
    };
  }

  const defaultObjective = await prisma.responseObjective.findFirst({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { created_at: "asc" },
  });
  if (!defaultObjective) {
    return {
      rows: [],
      droppedInvalid: 0,
      droppedDedup: 0,
      droppedCap: 0,
      droppedSupportiveOnlyComment: 0,
      droppedExcluded: 0,
      windowStart,
      minRelevancePercent: minP,
      rangeAmount,
      rangeUnit,
    };
  }

  const inWindow: Prisma.Enumerable<Prisma.ThemesAnalysisWhereInput> = [
    { posted_at: { gte: windowStart } },
    { AND: [{ posted_at: null }, { created_at: { gte: windowStart } }] },
  ];
  const relevanceOr: Prisma.Enumerable<Prisma.ThemesAnalysisWhereInput> | null =
    minP > 0
      ? [{ relevance_score: null }, { relevance_score: { gte: minP } }]
      : null;

  const themeRows = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      AND: [
        { OR: inWindow },
        ...(relevanceOr ? [{ OR: relevanceOr }] : []),
      ],
    },
    orderBy: [{ posted_at: "desc" }, { created_at: "desc" }],
    take: 5_000,
    include: {
      themeItemResponses: {
        where: { deleted_at: null },
        orderBy: { relevance_score: "desc" },
        include: {
          responseObjective: { select: { id: true, name: true, description: true, deleted_at: true } },
        },
      },
    },
  });

  if (themeRows.length === 0) {
    return {
      rows: [],
      droppedInvalid: 0,
      droppedDedup: 0,
      droppedCap: 0,
      droppedSupportiveOnlyComment: 0,
      droppedExcluded: 0,
      windowStart,
      minRelevancePercent: minP,
      rangeAmount,
      rangeUnit,
    };
  }

  await ensureProspectIntelligenceSettings(projectId);

  const fullTextByThemeId = await resolveContextTextsForThemeRows(
    projectId,
    themeRows.map((r) => ({
      id: r.id,
      post_id: r.post_id,
      post_content: r.post_content,
    }))
  );

  const postIds = [...new Set(themeRows.map((r) => r.post_id))];
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true,
      extraJson: true,
      authorName: true,
      url: true,
      threadRefId: true,
      content: true,
    },
  });
  const postById = new Map(posts.map((p) => [p.id, p]));

  let droppedInvalid = 0;
  let droppedSupportiveOnlyComment = 0;
  let droppedExcluded = 0;
  const byUrl = new Map<string, BuildCandidate>();
  let validRowCount = 0;

  for (const ta of themeRows) {
    if (!isLinkedInPlatform(ta.platform)) continue;

    const post = postById.get(ta.post_id);
    const { profileUrl, headline: ingestHeadline } = getLinkedInAuthorFromExtraJson(post?.extraJson);
    if (!profileUrl || !String(profileUrl).trim()) {
      droppedInvalid += 1;
      continue;
    }
    const canonical = normalizePublicProfileUrl(String(profileUrl));
    if (canonical == null) {
      droppedInvalid += 1;
      continue;
    }

    let items = ta.themeItemResponses;
    if (minP > 0 && items.length > 0) {
      const filtered = items.filter((i) => i.relevance_score >= minP / 100);
      if (filtered.length > 0) {
        items = filtered;
      } else {
        continue;
      }
    }
    const bestItem = items[0] ?? null;
    const ro = bestItem?.responseObjective;
    const obj = ro && !ro.deleted_at
      ? { id: ro.id, name: ro.name, description: ro.description }
      : {
          id: defaultObjective.id,
          name: defaultObjective.name,
          description: defaultObjective.description,
        };

    const fullText =
      fullTextByThemeId.get(ta.id) ?? ((ta.post_content || "").trim() || "(no content)");

    const postAuthor = post
      ? {
          url: post.url,
          authorName: post.authorName,
          extraJson: post.extraJson,
        }
      : undefined;

    const passesProspectSubstance =
      await linkedInMatchedPostPassesProspectSubstanceGate({
        projectId,
        matchedPostDbId: ta.post_id,
        threadRefId: post?.threadRefId,
        matchedPostContent: post?.content,
        themePostContentFallback: ta.post_content,
      });
    if (!passesProspectSubstance) {
      droppedSupportiveOnlyComment += 1;
      console.log(
        `${LOG} skip_supportive_only_comment themeAnalysisId=${ta.id} post_db_id=${ta.post_id}`
      );
      continue;
    }

    const scraped = await tryFetchLinkedInPublicProfileData(canonical);
    const ingestCompany = parseCompanyFromHeadline(ingestHeadline);
    const displayName = (
      ta.author_name && ta.author_name.trim()
        ? ta.author_name
        : post?.authorName && String(post.authorName).trim()
          ? String(post.authorName)
          : null
    ) as string | null;
    let { first_name, last_name } = splitDisplayNameToParts(displayName);
    if (!first_name.trim() && !last_name.trim()) {
      const fromSlug = firstLastFromInSlugPath(canonical);
      first_name = fromSlug.first_name;
      last_name = fromSlug.last_name;
    }
    if (scraped) {
      if (scraped.first_name.trim()) first_name = scraped.first_name.trim();
      if (scraped.last_name.trim()) last_name = scraped.last_name.trim();
    }
    const companyMerged = (scraped?.company || ingestCompany).trim();
    const authorRole = (scraped?.title || singleLineText(ingestHeadline) || "").trim();

    let classification: ProspectClassification;
    let routingBucket: ProspectOutreachBucket = "linkedin";
    let suppressTitleCompany = false;
    try {
      const syn = await syncProspectCandidateForThemeRow({
        projectId,
        themesAnalysisId: ta.id,
        postId: ta.post_id,
        themeItemResponseId: bestItem?.id ?? null,
        platform: ta.platform,
        themeRelevancePercent: ta.relevance_score ?? null,
        authorName: ta.author_name,
        headlineFallback: ingestHeadline,
        publicProfileScrape: scraped,
      });
      classification = syn.classification;
      routingBucket = syn.ruleTrace.bucket ?? "manual_review";
      suppressTitleCompany = syn.ruleTrace.suppressTitleCompanyPersonalization;
    } catch (err) {
      console.warn(`${LOG} prospect_sync_fallback`, err);
      const ev = mergePublicProfileScrapeEvidence(
        gatherEvidenceFromPostRow({
          extraJson: post?.extraJson ?? null,
          authorName: post?.authorName ?? ta.author_name,
          content: post?.content ?? null,
          url: post?.url ?? null,
          platform: ta.platform,
          themePostContent: ta.post_content,
          postUrlFromTheme: ta.post_url,
        }),
        scraped
      );
      const comps = await loadCompetitorPatternsForProject(projectId);
      classification = classifyProspectDeterministic(ev, {
        linkedinUrl: canonical,
        name: displayName ?? undefined,
        competitorPatterns: comps,
      });
      const rules = await fetchActiveRoutingRules(projectId);
      const rt = evaluateRoutingRules(rules, {
        classification,
        platform: ta.platform,
        themeRelevancePercent: ta.relevance_score ?? null,
        headlineText: ingestHeadline ?? "",
        competitorMatched:
          classification.roleCategories.includes("competitor") ||
          classification.excludedRoleFlags.includes("competitor"),
      });
      routingBucket = rt.bucket ?? "manual_review";
      suppressTitleCompany = rt.suppressTitleCompanyPersonalization;
    }

    const includeExcluded = process.env.LINKEDIN_EXPORT_INCLUDE_EXCLUDED === "1";
    if (routingBucket === "excluded" && !includeExcluded) {
      droppedExcluded += 1;
      continue;
    }

    const empHintGate = 0.6;
    const hintCompany =
      classification.employmentConfidence >= empHintGate && classification.currentCompany?.trim()
        ? classification.currentCompany.trim()
        : companyMerged || undefined;
    const hintRole =
      classification.employmentConfidence >= empHintGate && classification.currentTitle?.trim()
        ? classification.currentTitle.trim()
        : authorRole || classification.safeProfessionalReference || undefined;

    const o = await tryGenerateLinkedinOutreachForThemeItem(
      projectProduct,
      { projectId, matchedPostId: ta.post_id },
      fullText,
      {
        theme_name: ta.theme_name,
        post_url: ta.post_url,
        author_name: ta.author_name,
        platform: ta.platform,
      },
      postAuthor,
      obj,
      LOG,
      {
        authorFirstName: first_name,
        company: hintCompany,
        authorRole: hintRole,
      },
      {
        projectId,
        classification,
        bucket: routingBucket,
        suppressTitleCompany,
      }
    );
    if (!o) {
      droppedInvalid += 1;
      continue;
    }

    const row = buildRowFromSource({
      outreach_email_subject: o.email_subject,
      outreach_email_body: o.email_body,
      author_display_name: displayName,
      post_extraJson: post?.extraJson ?? null,
      prospect_fields: { first_name, last_name },
      prospect_intel: {
        safeProfessionalReference: classification.safeProfessionalReference,
        routingBucket,
        classificationConfidence: classification.confidence,
        employmentConfidence: classification.employmentConfidence,
        currentTitle: classification.currentTitle ?? null,
        currentCompany: classification.currentCompany ?? null,
      },
    });
    if (row == null) {
      droppedInvalid += 1;
      continue;
    }

    validRowCount += 1;
    const key = row.public_profile_url;
    const total_reactions = ta.total_reactions ?? 0;
    const rel = bestItem?.relevance_score ?? 0.8;
    const candidate: BuildCandidate = {
      total_reactions,
      relevance_score: rel,
      theme_item_response_id: bestItem?.id ?? ta.id,
      row,
    };
    const prev = byUrl.get(key);
    if (!prev) {
      byUrl.set(key, candidate);
      continue;
    }
    const sameEngagement = prev.total_reactions === total_reactions;
    const relImproved = rel > prev.relevance_score;
    const relTie = rel === prev.relevance_score;
    const preferThis =
      total_reactions > prev.total_reactions ||
      (sameEngagement && relImproved) ||
      (sameEngagement && relTie && (bestItem?.id ?? ta.id) < prev.theme_item_response_id);
    if (preferThis) {
      byUrl.set(key, candidate);
    }
  }

  const droppedDedup = Math.max(0, validRowCount - byUrl.size);

  const list = Array.from(byUrl.values());
  list.sort((a, b) => {
    if (b.total_reactions !== a.total_reactions) return b.total_reactions - a.total_reactions;
    if (a.row.public_profile_url !== b.row.public_profile_url) {
      return a.row.public_profile_url < b.row.public_profile_url ? -1 : 1;
    }
    return 0;
  });

  const droppedCap = list.length > maxRows ? list.length - maxRows : 0;
  const rows = list.slice(0, maxRows).map((c) => c.row);

  return {
    rows,
    droppedInvalid,
    droppedDedup,
    droppedCap,
    droppedSupportiveOnlyComment,
    droppedExcluded,
    windowStart,
    minRelevancePercent: minP,
    rangeAmount,
    rangeUnit,
  };
}
