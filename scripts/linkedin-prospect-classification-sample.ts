/**
 * Build a CSV "test sheet" of distinct LinkedIn authors from Post rows and run the
 * deterministic classifier only (neutral labels — no routing / rule engine in this export).
 *
 * Usage:
 *   npx tsx scripts/linkedin-prospect-classification-sample.ts [--project-id <id>] [--limit 20] [--out <path.csv>]
 *
 * If --project-id is omitted, picks the project with the most LinkedIn posts (prints which one).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import {
  getLinkedInAuthorFromExtraJson,
  linkedinOriginalPosterRawDisplayFromPostExtra,
} from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { gatherEvidenceFromPostRow } from "@/lib/prospect-intelligence/gather-evidence";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import {
  ensureProspectIntelligenceSettings,
  loadCompetitorPatternsForProject,
} from "@/lib/prospect-intelligence/pipeline";

function parseArgs(argv: string[]) {
  let projectId: string | undefined;
  let limit = 20;
  let out = resolve(process.cwd(), "tmp", "linkedin-prospect-classification-sample.csv");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id" && argv[i + 1]) {
      projectId = argv[++i]?.trim();
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Math.min(200, parseInt(argv[++i] ?? "20", 10) || 20));
    } else if (a === "--out" && argv[i + 1]) {
      out = resolve(process.cwd(), argv[++i] ?? out);
    }
  }
  return { projectId, limit, out };
}

function escCsv(v: string): string {
  const s = v.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function pickProjectWithMostLinkedInPosts(): Promise<string | null> {
  const grouped = await prisma.post.groupBy({
    by: ["project_id"],
    where: {
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      project_id: { not: null },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  const id = grouped[0]?.project_id ?? null;
  return id;
}

type SampleRow = {
  profile_url: string;
  post_id: string;
  display_name: string;
  headline: string;
  post_snippet: string;
  role_categories: string;
  profile_flags: string;
  open_to_work_status: string;
  open_to_work_confidence: string;
  open_to_work_evidence: string;
  open_to_work_evidence_supporting: string;
  open_to_work_evidence_source: string;
  seniority: string;
  function_tags: string;
  company_type: string;
  employment_relationship: string;
  company_size_signal: string;
  market_segment_terms: string;
  current_title: string;
  current_company: string;
  past_title: string;
  past_company: string;
  education_institution: string;
  education_area: string;
  affiliations: string;
  employment_confidence: string;
  classification_confidence: string;
  needs_review: string;
  safe_professional_reference: string;
  professional_summary: string;
  classification_reason: string;
};

async function main() {
  const { projectId: argProject, limit, out } = parseArgs(process.argv);
  let projectId = argProject?.trim() || null;
  if (!projectId) {
    projectId = await pickProjectWithMostLinkedInPosts();
    if (!projectId) {
      console.error("No LinkedIn posts with project_id found in the database.");
      process.exit(1);
    }
    console.log(`No --project-id: using project with most LinkedIn posts: ${projectId}\n`);
  }

  await ensureProspectIntelligenceSettings(projectId);
  const competitorPatterns = await loadCompetitorPatternsForProject(projectId);

  const seen = new Set<string>();
  const samples: SampleRow[] = [];
  let skip = 0;
  const batch = 150;

  while (samples.length < limit && skip < 8000) {
    const posts = await prisma.post.findMany({
      where: {
        platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
        project_id: projectId,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: batch,
      select: {
        id: true,
        authorName: true,
        content: true,
        url: true,
        extraJson: true,
      },
    });
    if (posts.length === 0) break;

    for (const post of posts) {
      const { profileUrl, headline } = getLinkedInAuthorFromExtraJson(post.extraJson);
      const normalized = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const display =
        (post.authorName ?? "").trim() ||
        linkedinOriginalPosterRawDisplayFromPostExtra(post.extraJson);

      const evidence = gatherEvidenceFromPostRow({
        extraJson: post.extraJson,
        authorName: display || post.authorName,
        content: post.content,
        url: post.url,
        platform: "linkedin",
        themePostContent: null,
        postUrlFromTheme: null,
      });

      const classification = classifyProspectDeterministic(evidence, {
        linkedinUrl: normalized,
        name: display || null,
        competitorPatterns,
      });

      const headlineText =
        headline?.trim() ||
        evidence.find((e) => e.source === "linkedin_author_headline")?.rawText ||
        "";

      const postSnippet = (post.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

      const otw = classification.openToWorkDetection;
      samples.push({
        profile_url: normalized,
        post_id: String(post.id),
        display_name: display,
        headline: headlineText.slice(0, 500),
        post_snippet: postSnippet,
        role_categories: classification.roleCategories.join(";"),
        profile_flags: classification.profileFlags.join(";"),
        open_to_work_status: otw?.status ?? "",
        open_to_work_confidence: otw != null ? String(otw.confidence) : "",
        open_to_work_evidence: (otw?.evidence ?? "").replace(/\r?\n/g, " ").slice(0, 500),
        open_to_work_evidence_supporting: (otw?.evidenceSupporting ?? "")
          .replace(/\r?\n/g, " ")
          .slice(0, 500),
        open_to_work_evidence_source: otw?.evidenceSource ?? "",
        seniority: classification.seniority,
        function_tags: classification.functionTags.join(";"),
        company_type: classification.companyType ?? "unknown",
        employment_relationship: classification.employmentRelationship ?? "unknown",
        company_size_signal: classification.companySizeSignal,
        market_segment_terms: (classification.marketSegmentTerms ?? []).join(";"),
        current_title: classification.currentTitle ?? "",
        current_company: classification.currentCompany ?? "",
        past_title: classification.pastTitle ?? "",
        past_company: classification.pastCompany ?? "",
        education_institution: classification.educationInstitution ?? "",
        education_area: classification.educationArea ?? "",
        affiliations: (classification.affiliations ?? []).join(";"),
        employment_confidence: String(classification.employmentConfidence),
        classification_confidence: String(classification.confidence),
        needs_review: classification.needsReview ? "yes" : "no",
        safe_professional_reference: (classification.safeProfessionalReference ?? "")
          .replace(/\r?\n/g, " ")
          .trim(),
        professional_summary: (classification.professionalSummary ?? "")
          .replace(/\r?\n/g, " ")
          .trim(),
        classification_reason: classification.reason.replace(/\r?\n/g, " ").trim(),
      });

      if (samples.length >= limit) break;
    }
    skip += batch;
  }

  const header = [
    "profile_url",
    "post_id",
    "display_name",
    "headline",
    "post_snippet",
    "role_categories",
    "profile_flags",
    "open_to_work_status",
    "open_to_work_confidence",
    "open_to_work_evidence",
    "open_to_work_evidence_supporting",
    "open_to_work_evidence_source",
    "seniority",
    "function_tags",
    "company_type",
    "employment_relationship",
    "company_size_signal",
    "market_segment_terms",
    "current_title",
    "current_company",
    "past_title",
    "past_company",
    "education_institution",
    "education_area",
    "affiliations",
    "employment_confidence",
    "classification_confidence",
    "needs_review",
    "safe_professional_reference",
    "professional_summary",
    "classification_reason",
  ];

  const lines = [
    header.join(","),
    ...samples.map((r) =>
      [
        escCsv(r.profile_url),
        escCsv(r.post_id),
        escCsv(r.display_name),
        escCsv(r.headline),
        escCsv(r.post_snippet),
        escCsv(r.role_categories),
        escCsv(r.profile_flags),
        escCsv(r.open_to_work_status),
        escCsv(r.open_to_work_confidence),
        escCsv(r.open_to_work_evidence),
        escCsv(r.open_to_work_evidence_supporting),
        escCsv(r.open_to_work_evidence_source),
        escCsv(r.seniority),
        escCsv(r.function_tags),
        escCsv(r.company_type),
        escCsv(r.employment_relationship),
        escCsv(r.company_size_signal),
        escCsv(r.market_segment_terms),
        escCsv(r.current_title),
        escCsv(r.current_company),
        escCsv(r.past_title),
        escCsv(r.past_company),
        escCsv(r.education_institution),
        escCsv(r.education_area),
        escCsv(r.affiliations),
        escCsv(r.employment_confidence),
        escCsv(r.classification_confidence),
        escCsv(r.needs_review),
        escCsv(r.safe_professional_reference),
        escCsv(r.professional_summary),
        escCsv(r.classification_reason),
      ].join(",")
    ),
  ];

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join("\n"), "utf8");

  console.log(`Wrote ${samples.length} rows (requested ${limit}) to ${out}`);
  console.log(
    `Project: ${projectId} | Competitor patterns: ${competitorPatterns.length} | Classifier: labels only (unrouted)\n`
  );

  const GENERIC_SUMMARY_SUBSTR =
    "Professional profile with multiple headline signals; summary inferred from roles and function focus.";
  let onlyUnknownRoles = 0;
  let genericSummaryCount = 0;
  let unknownOnlyNeedsReviewNo = 0;
  let unknownWithTitleCompany = 0;

  for (const r of samples) {
    const cats = r.role_categories.split(";").filter(Boolean);
    if (cats.length === 1 && cats[0] === "unknown") onlyUnknownRoles++;
    if (r.professional_summary.includes(GENERIC_SUMMARY_SUBSTR)) genericSummaryCount++;
    if (cats.length === 1 && cats[0] === "unknown" && r.needs_review === "no")
      unknownOnlyNeedsReviewNo++;
    if (cats.includes("unknown") && r.current_title.trim() && r.current_company.trim()) {
      unknownWithTitleCompany++;
    }
  }

  console.log("--- Classification sample metrics ---");
  console.log(`role_categories is only "unknown": ${onlyUnknownRoles}`);
  console.log(`generic professional_summary fallback: ${genericSummaryCount}`);
  console.log(`unknown-only role_categories and needs_review=no: ${unknownOnlyNeedsReviewNo}`);
  console.log(`role_categories includes unknown with title+company: ${unknownWithTitleCompany}\n`);

  for (let i = 0; i < samples.length; i++) {
    const r = samples[i]!;
    console.log(
      `${i + 1}. ${r.display_name || "(no name)"} | roles: ${r.role_categories || "—"} | ` +
        `flags: ${r.profile_flags || "—"}`
    );
    const headShow = r.headline.slice(0, 120);
    console.log(`   headline: ${headShow}${r.headline.length > 120 ? "…" : ""}`);
    console.log(
      `   title/company: "${r.current_title}" / "${r.current_company}" | emp conf: ${r.employment_confidence} | class conf: ${r.classification_confidence} | review: ${r.needs_review}`
    );
    if (r.education_institution || r.education_area) {
      console.log(`   education: ${r.education_area || "—"} @ ${r.education_institution || "—"}`);
    }
    const refShow = r.safe_professional_reference.slice(0, 140);
    console.log(
      `   safe ref: ${refShow}${r.safe_professional_reference.length > 140 ? "…" : ""}\n`
    );
  }

  if (samples.length < limit) {
    console.warn(
      `Only found ${samples.length} distinct LinkedIn profile URLs with parseable /in/ links in this project.`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
