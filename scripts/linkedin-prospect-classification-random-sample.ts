import "dotenv/config";

/**
 * Random distinct-author LinkedIn prospect sample + Open-to-Work guarantee.
 *
 * - Draws `--limit` unique profile URLs with seeded shuffle (no duplicates in the random batch).
 * - Modes: `deterministic` (guardrails only) | `full` (hybrid + gated LLM) | `both` (two CSVs for comparison).
 * - Env: PROSPECT_CLASSIFIER_MODE=deterministic|full
 * - If `--ensure-open-to-work` (default on): scans the rest of the pool for OTW profiles not in the batch.
 *
 * Usage:
 *   npx tsx scripts/linkedin-prospect-classification-random-sample.ts [--mode deterministic|full|both] [--project-id <id>] [--limit 320] [--seed 42] [--out <path.csv>] [--no-ensure-open-to-work] [--deterministic-only] [--force-llm] [--llm-concurrency 6]
 *   [--enrich-employment] [--enrichment-concurrency 25] [--force-employment-refresh] [--skip-headline-employment]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getLinkedInAuthorFromExtraJson,
  linkedinOriginalPosterRawDisplayFromPostExtra,
} from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { gatherEvidenceFromPostRow, mergePublicProfileScrapeEvidence } from "@/lib/prospect-intelligence/gather-evidence";
import { mergeProfileExperienceRoles } from "@/lib/prospect-intelligence/load-profile-employment";
import { parseAnalysisMethodFromMetadata } from "@/lib/prospect-intelligence/validate-profile-experience";
import { tryFetchLinkedInPublicProfileData } from "@/lib/linkedin-prospects-csv/fetch-linkedin-public-profile";
import { classifyProspect } from "@/lib/prospect-intelligence/classify-prospect";
import {
  parseProspectClassifierMode,
  type ProspectClassifierMode,
} from "@/lib/prospect-intelligence/prospect-classifier-mode";
import { seedRng, shuffleInPlace } from "@/lib/prospect-intelligence/random-sample-seeded";
import {
  ensureProspectIntelligenceSettings,
  loadCompetitorPatternsForProject,
} from "@/lib/prospect-intelligence/pipeline";
import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import {
  auditProfileExperiencePipeline,
  formatPipelineStatusReport,
} from "@/lib/prospect-intelligence/profile-experience-pipeline";
import {
  enrichProfileUrls,
  parseEnrichmentMetadata,
} from "@/lib/prospect-intelligence/enrich-linkedin-profile-employment";
import {
  countValidatedExperienceRoles,
  normalizeEnrichmentStatusDisplay,
} from "@/lib/prospect-intelligence/enrichment-status";
import { formatEmploymentRolesForCsv } from "@/lib/prospect-intelligence/sanitize-employment-placeholders";

type RunMode = ProspectClassifierMode | "both";

function parseArgs(argv: string[]) {
  let projectId: string | undefined;
  let limit = 300;
  let seed = 42;
  let out = resolve(process.cwd(), "tmp", "linkedin-prospect-classification-random-sample.csv");
  let ensureOpenToWork = true;
  let deterministicOnly = false;
  let forceLlm = false;
  let llmConcurrency = 6;
  let mode: RunMode | undefined;
  let enrichEmployment = false;
  let enrichmentConcurrency = 25;
  let forceEmploymentRefresh = false;
  let skipHeadlineEmployment = false;
  let enrichmentTryPublicHtml = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id" && argv[i + 1]) {
      projectId = argv[++i]?.trim();
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Math.min(50_000, parseInt(argv[++i] ?? "300", 10) || 300));
    } else if (a === "--seed" && argv[i + 1]) {
      seed = parseInt(argv[++i] ?? "42", 10) || 42;
    } else if (a === "--out" && argv[i + 1]) {
      out = resolve(process.cwd(), argv[++i] ?? out);
    } else if (a === "--mode" && argv[i + 1]) {
      const raw = (argv[++i] ?? "").trim().toLowerCase();
      if (raw === "both") mode = "both";
      else {
        const parsed = parseProspectClassifierMode(raw);
        if (parsed) mode = parsed;
      }
    } else if (a === "--ensure-open-to-work") {
      ensureOpenToWork = true;
    } else if (a === "--no-ensure-open-to-work") {
      ensureOpenToWork = false;
    } else if (a === "--deterministic-only") {
      deterministicOnly = true;
    } else if (a === "--force-llm") {
      forceLlm = true;
    } else if (a === "--llm-concurrency" && argv[i + 1]) {
      llmConcurrency = Math.max(1, Math.min(20, parseInt(argv[++i] ?? "6", 10) || 6));
    } else if (a === "--enrich-employment") {
      enrichEmployment = true;
    } else if (
      (a === "--enrichment-concurrency" || a === "--enrichment-batch-size") &&
      argv[i + 1]
    ) {
      enrichmentConcurrency = Math.max(1, Math.min(50, parseInt(argv[++i] ?? "25", 10) || 25));
    } else if (a === "--force-employment-refresh") {
      forceEmploymentRefresh = true;
    } else if (a === "--skip-headline-employment") {
      skipHeadlineEmployment = true;
    } else if (a === "--no-enrichment-public-html") {
      enrichmentTryPublicHtml = false;
    }
  }
  if (deterministicOnly) mode = "deterministic";
  if (!mode) {
    const fromEnv = parseProspectClassifierMode(process.env.PROSPECT_CLASSIFIER_MODE);
    mode = fromEnv ?? "full";
  }
  return {
    projectId,
    limit,
    seed,
    out,
    ensureOpenToWork,
    mode,
    forceLlm,
    llmConcurrency,
    enrichEmployment,
    enrichmentConcurrency,
    forceEmploymentRefresh,
    skipHeadlineEmployment,
    enrichmentTryPublicHtml,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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
  return grouped[0]?.project_id ?? null;
}

type PostPick = {
  id: number;
  authorName: string | null;
  content: string | null;
  url: string | null;
  extraJson: Prisma.JsonValue | null;
};

function enrichmentProvenanceForRow(
  validationMetadata: string | null | undefined,
  enrichedInRun: boolean
): {
  employment_enrichment_attempted: "yes" | "no";
  employment_enrichment_source: "cached_db" | "in_run" | "none";
  employment_enrichment_status: string;
  employment_enriched_before_classification: "yes" | "no";
} {
  if (enrichedInRun) {
    return {
      employment_enrichment_attempted: "yes",
      employment_enrichment_source: "in_run",
      employment_enrichment_status: "enriched_in_run",
      employment_enriched_before_classification: "yes",
    };
  }
  const parsed = parseEnrichmentMetadata(validationMetadata);
  const analysisMethod = parseAnalysisMethodFromMetadata(validationMetadata);
  const { rawCount, validCount } = countValidatedExperienceRoles(parsed.experienceItems, {
    analysisMethod,
  });
  if (parsed.enrichmentStatus || rawCount > 0) {
    const semanticStatus = normalizeEnrichmentStatusDisplay(parsed.enrichmentStatus, {
      rawExperienceCount: rawCount,
      validExperienceCount: validCount,
      analysisMethod,
    });
    return {
      employment_enrichment_attempted: "yes",
      employment_enrichment_source: "cached_db",
      employment_enrichment_status: semanticStatus,
      employment_enriched_before_classification: validCount > 0 ? "yes" : "no",
    };
  }
  return {
    employment_enrichment_attempted: "no",
    employment_enrichment_source: "none",
    employment_enrichment_status: "none",
    employment_enriched_before_classification: "no",
  };
}

function classificationToRow(
  inclusion: "random_sample" | "open_to_work_guarantee",
  classifierMode: string,
  postId: string,
  profileUrl: string,
  display: string,
  headlineText: string,
  postSnippet: string,
  classification: ProspectClassification,
  enrichmentProvenance: ReturnType<typeof enrichmentProvenanceForRow>
) {
  const validPe =
    classification.validProfileExperienceInputCount ??
    classification.profileExperienceInputCount ??
    0;
  const otw = classification.openToWorkDetection;
  return {
    sample_inclusion: inclusion,
    classifier_mode: classifierMode,
    profile_url: profileUrl,
    post_id: postId,
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
    raw_profile_experience_input_count: String(classification.rawProfileExperienceInputCount ?? 0),
    valid_profile_experience_input_count: String(validPe),
    rejected_profile_experience_input_count: String(
      classification.rejectedProfileExperienceInputCount ?? 0
    ),
    profile_experience_input_count: String(validPe),
    profile_experience_data_available: validPe > 0 ? "yes" : "no",
    profile_experience_data_available_valid:
      classification.profileExperienceDataAvailableValid ?? (validPe > 0 ? "yes" : "no"),
    profile_experience_acquisition_status:
      classification.profileExperienceAcquisitionStatus ??
      enrichmentProvenance.employment_enrichment_status,
    current_title_source: classification.currentTitleSource ?? "",
    current_company_source: classification.currentCompanySource ?? "",
    current_company_confidence: String(classification.currentCompanyConfidence ?? 0),
    experience_item_source: classification.primaryExperienceItemSource ?? "",
    evidence_excerpt: (classification.experienceEvidenceExcerpt ?? "")
      .replace(/\r?\n/g, " ")
      .slice(0, 400),
    profile_experience_rejection_reason: (classification.profileExperienceRejectionReason ?? "")
      .replace(/\r?\n/g, " ")
      .slice(0, 500),
    employment_enrichment_attempted: enrichmentProvenance.employment_enrichment_attempted,
    employment_enrichment_source: enrichmentProvenance.employment_enrichment_source,
    employment_enrichment_status: enrichmentProvenance.employment_enrichment_status,
    employment_enriched_before_classification:
      enrichmentProvenance.employment_enriched_before_classification,
    employment_source: classification.employmentSource ?? "unknown",
    employment_confidence: String(classification.employmentConfidence),
    employment_reason: (classification.employmentReason ?? "").replace(/\r?\n/g, " ").trim(),
    current_roles: formatEmploymentRolesForCsv(classification.currentRoles ?? []),
    past_roles: formatEmploymentRolesForCsv(classification.pastRoles ?? []),
    last_title: classification.lastTitle ?? classification.pastTitle ?? "",
    last_company: classification.lastCompany ?? "",
    headline_employment_candidate_title:
      classification.headlineEmploymentCandidateTitle ?? "",
    headline_employment_candidate_company:
      classification.headlineEmploymentCandidateCompany ?? "",
    classification_confidence: String(classification.confidence),
    classification_needs_review: classification.classificationNeedsReview ? "yes" : "no",
    employment_needs_review: classification.employmentNeedsReview ? "yes" : "no",
    outreach_needs_review: classification.outreachNeedsReview ? "yes" : "no",
    needs_review: classification.needsReview ? "yes" : "no",
    safe_professional_reference: (classification.safeProfessionalReference ?? "")
      .replace(/\r?\n/g, " ")
      .trim(),
    professional_summary: (classification.professionalSummary ?? "").replace(/\r?\n/g, " ").trim(),
    classification_reason: classification.reason.replace(/\r?\n/g, " ").trim(),
  };
}

function rowToCsvLine(r: ReturnType<typeof classificationToRow>): string {
  return [
    escCsv(r.sample_inclusion),
    escCsv(r.classifier_mode),
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
    escCsv(r.raw_profile_experience_input_count),
    escCsv(r.valid_profile_experience_input_count),
    escCsv(r.rejected_profile_experience_input_count),
    escCsv(r.profile_experience_input_count),
    escCsv(r.profile_experience_data_available),
    escCsv(r.profile_experience_data_available_valid),
    escCsv(r.profile_experience_acquisition_status),
    escCsv(r.current_title_source),
    escCsv(r.current_company_source),
    escCsv(r.current_company_confidence),
    escCsv(r.experience_item_source),
    escCsv(r.evidence_excerpt),
    escCsv(r.profile_experience_rejection_reason),
    escCsv(r.employment_enrichment_attempted),
    escCsv(r.employment_enrichment_source),
    escCsv(r.employment_enrichment_status),
    escCsv(r.employment_enriched_before_classification),
    escCsv(r.employment_source),
    escCsv(r.employment_confidence),
    escCsv(r.employment_reason),
    escCsv(r.current_roles),
    escCsv(r.past_roles),
    escCsv(r.last_title),
    escCsv(r.last_company),
    escCsv(r.headline_employment_candidate_title),
    escCsv(r.headline_employment_candidate_company),
    escCsv(r.classification_confidence),
    escCsv(r.classification_needs_review),
    escCsv(r.employment_needs_review),
    escCsv(r.outreach_needs_review),
    escCsv(r.needs_review),
    escCsv(r.safe_professional_reference),
    escCsv(r.professional_summary),
    escCsv(r.classification_reason),
  ].join(",");
}

function outPathsForMode(baseOut: string, runMode: RunMode): { deterministic: string; full?: string } {
  if (runMode === "both") {
    const base = baseOut.replace(/\.csv$/i, "");
    return {
      deterministic: `${base}.deterministic.csv`,
      full: `${base}.full.csv`,
    };
  }
  return { deterministic: baseOut };
}

async function main() {
  const {
    projectId: argProject,
    limit,
    seed,
    out,
    ensureOpenToWork,
    mode: runMode,
    forceLlm,
    llmConcurrency,
    enrichEmployment,
    enrichmentConcurrency,
    forceEmploymentRefresh,
    skipHeadlineEmployment,
    enrichmentTryPublicHtml,
  } = parseArgs(process.argv);

  if (skipHeadlineEmployment) {
    process.env.PROSPECT_SKIP_HEADLINE_EMPLOYMENT = "1";
  }

  if (runMode !== "deterministic" && !process.env.OPENAI_API_KEY?.trim()) {
    console.error(
      "OPENAI_API_KEY is required for --mode full or both. Use --mode deterministic for rules-only baseline."
    );
    process.exit(1);
  }
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

  const posts = await prisma.post.findMany({
    where: {
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      project_id: projectId,
    },
    select: {
      id: true,
      authorName: true,
      content: true,
      url: true,
      extraJson: true,
    },
  });

  const rnd = seedRng(seed);
  const shuffled = [...posts];
  shuffleInPlace(shuffled, rnd);

  const byProfile = new Map<string, PostPick>();
  for (const post of shuffled) {
    const { profileUrl } = getLinkedInAuthorFromExtraJson(post.extraJson);
    const normalized = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (!normalized) continue;
    if (!byProfile.has(normalized)) byProfile.set(normalized, post);
  }

  const allUrls = Array.from(byProfile.keys());
  shuffleInPlace(allUrls, rnd);

  const sampleUrls = allUrls.slice(0, limit);
  const sampleSet = new Set(sampleUrls);

  const headlineByUrl = new Map<string, string>();
  for (const url of sampleUrls) {
    const post = byProfile.get(url);
    if (!post) continue;
    const h = getLinkedInAuthorFromExtraJson(post.extraJson).headline?.trim();
    if (h) headlineByUrl.set(url, h);
  }

  const enrichedBeforeClassify = new Set<string>();
  if (enrichEmployment) {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      console.error("--enrich-employment requires OPENAI_API_KEY.");
      process.exit(1);
    }
    console.log(
      `\nEnriching employment for ${sampleUrls.length} sample profile(s) (concurrency=${enrichmentConcurrency}, forceRefresh=${forceEmploymentRefresh})...`
    );
    const summary = await enrichProfileUrls(prisma, sampleUrls, {
      forceRefresh: forceEmploymentRefresh,
      tryPublicHtml: enrichmentTryPublicHtml,
      concurrency: enrichmentConcurrency,
      headlineByUrl,
      onProgress: (done, total) => {
        process.stdout.write(`\r  enrichment progress ${done}/${total}`);
      },
    });
    process.stdout.write("\n");
    for (const r of summary.results) {
      if (
        r.status === "success" ||
        r.status === "already_enriched" ||
        r.status === "headline_fallback"
      ) {
        enrichedBeforeClassify.add(r.profileUrl);
      }
    }
    console.log(
      `  enrichment done: ok=${summary.enrichedSuccessfully} headline_fb=${summary.headlineFallback} already=${summary.alreadyEnriched} blocked=${summary.blocked} no_data=${summary.noData} api_errors=${summary.apiErrors}`
    );
  }

  const personEmploymentRows = await prisma.personEmployment.findMany({
    where: { linkedin_url: { in: sampleUrls } },
    select: {
      linkedin_url: true,
      current_title: true,
      current_company: true,
      validation_metadata: true,
    },
  });
  const personEmploymentByUrl = new Map(
    personEmploymentRows.map((r) => [r.linkedin_url, r])
  );
  const tryPublicProfile = process.env.LINKEDIN_CLASSIFY_TRY_PUBLIC_PROFILE === "1";

  async function classifyOne(
    classifierMode: ProspectClassifierMode,
    profileUrl: string,
    post: PostPick,
    inclusion: "random_sample" | "open_to_work_guarantee",
    wasEnrichedBeforeClassify: boolean
  ) {
    const display =
      (post.authorName ?? "").trim() ||
      linkedinOriginalPosterRawDisplayFromPostExtra(post.extraJson);

    const pe = personEmploymentByUrl.get(profileUrl);
    const headlineForPe = getLinkedInAuthorFromExtraJson(post.extraJson).headline?.trim() ?? "";

    const profileExperienceRoles = mergeProfileExperienceRoles({
      fromExtraJson: post.extraJson,
      validationMetadata: pe?.validation_metadata,
      currentTitle: pe?.current_title,
      currentCompany: pe?.current_company,
      headline: headlineForPe,
    });

    const profileExperienceAnalysisMethod = parseAnalysisMethodFromMetadata(
      pe?.validation_metadata
    );

    let evidence = gatherEvidenceFromPostRow({
      extraJson: post.extraJson,
      authorName: display || post.authorName,
      content: post.content,
      url: post.url,
      platform: "linkedin",
      themePostContent: null,
      postUrlFromTheme: null,
      profileExperienceRoles: profileExperienceRoles.length ? profileExperienceRoles : undefined,
      profileExperienceAnalysisMethod,
    });

    if (tryPublicProfile) {
      const scraped = await tryFetchLinkedInPublicProfileData(profileUrl);
      evidence = mergePublicProfileScrapeEvidence(evidence, scraped);
    }

    const classifyOpts = {
      linkedinUrl: profileUrl,
      name: display || null,
      competitorPatterns,
    };

    const { classification, classifierModeLabel } = await classifyProspect(evidence, {
      ...classifyOpts,
      mode: classifierMode,
      forceLlm: classifierMode === "full" ? forceLlm : false,
    });

    const headlineFromEx =
      getLinkedInAuthorFromExtraJson(post.extraJson).headline?.trim() ||
      evidence.find((e) => e.source === "linkedin_author_headline")?.rawText ||
      "";

    const postSnippet = (post.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

    const enrichmentProvenance = enrichmentProvenanceForRow(
      pe?.validation_metadata,
      wasEnrichedBeforeClassify
    );

    return classificationToRow(
      inclusion,
      classifierModeLabel,
      String(post.id),
      profileUrl,
      display,
      headlineFromEx,
      postSnippet,
      classification,
      enrichmentProvenance
    );
  }

  async function runClassificationBatch(
    classifierMode: ProspectClassifierMode,
    outPath: string
  ): Promise<void> {
    const concurrency = classifierMode === "full" ? llmConcurrency : 1;
    console.log(
      `\nClassifying ${sampleUrls.length} profiles (mode=${classifierMode}, concurrency=${concurrency}) → ${outPath}`
    );

    const rows: ReturnType<typeof classificationToRow>[] = await mapWithConcurrency(
      sampleUrls,
      concurrency,
      async (url) => {
        const p = byProfile.get(url);
        if (!p) throw new Error(`Missing post for ${url}`);
        return classifyOne(
          classifierMode,
          url,
          p,
          "random_sample",
          enrichedBeforeClassify.has(url)
        );
      }
    );

    let guaranteeAdded = 0;
    if (ensureOpenToWork) {
      const guaranteeCandidates = allUrls.filter((url) => !sampleSet.has(url));
      const guaranteeRows = await mapWithConcurrency(
        guaranteeCandidates,
        concurrency,
        async (url) => {
          const p = byProfile.get(url);
          if (!p) return null;
          return classifyOne(
            classifierMode,
            url,
            p,
            "open_to_work_guarantee",
            enrichedBeforeClassify.has(url)
          );
        }
      );
      for (const row of guaranteeRows) {
        if (!row) continue;
        const st = row.open_to_work_status;
        if (st && st !== "not_observed") {
          rows.push(row);
          guaranteeAdded += 1;
        }
      }
    }

    const header = [
    "sample_inclusion",
    "classifier_mode",
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
    "raw_profile_experience_input_count",
    "valid_profile_experience_input_count",
    "rejected_profile_experience_input_count",
    "profile_experience_input_count",
    "profile_experience_data_available",
    "profile_experience_data_available_valid",
    "profile_experience_acquisition_status",
    "current_title_source",
    "current_company_source",
    "current_company_confidence",
    "experience_item_source",
    "evidence_excerpt",
    "profile_experience_rejection_reason",
    "employment_enrichment_attempted",
    "employment_enrichment_source",
    "employment_enrichment_status",
    "employment_enriched_before_classification",
    "employment_source",
    "employment_confidence",
    "employment_reason",
    "current_roles",
    "past_roles",
    "last_title",
    "last_company",
    "headline_employment_candidate_title",
    "headline_employment_candidate_company",
    "classification_confidence",
    "classification_needs_review",
    "employment_needs_review",
    "outreach_needs_review",
    "needs_review",
    "safe_professional_reference",
    "professional_summary",
    "classification_reason",
  ];

    const lines = [header.join(","), ...rows.map(rowToCsvLine)];
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, lines.join("\n"), "utf8");

    const inRandom = rows.filter((r) => r.sample_inclusion === "random_sample").length;
    const otwInFile = rows.filter(
      (r) => r.open_to_work_status && r.open_to_work_status !== "not_observed"
    ).length;

    console.log(`Wrote ${rows.length} rows to ${outPath}`);
    console.log(
      `  random_sample rows: ${inRandom} (requested ${limit}) | pool size: ${allUrls.length} | seed: ${seed}`
    );
    console.log(
      `  open_to_work rows in file: ${otwInFile} | appended via guarantee: ${guaranteeAdded}`
    );
    console.log(`  Project: ${projectId} | mode: ${classifierMode} (unrouted)`);

    const pipelineStatus = await auditProfileExperiencePipeline(prisma, { postSampleSize: 500 });
    const withRoles = rows.filter((r) => parseInt(r.profile_experience_input_count, 10) > 0).length;
    console.log("\n" + formatPipelineStatusReport(pipelineStatus));
    console.log(`  This export: ${withRoles}/${rows.length} rows with profile_experience_input_count > 0`);
  }

  const paths = outPathsForMode(out, runMode);
  if (runMode === "both") {
    await runClassificationBatch("deterministic", paths.deterministic);
    await runClassificationBatch("full", paths.full!);
    console.log("\nCompare eval (deterministic harness, no OpenAI):");
    console.log(`  npm run classify:evaluate -- ${paths.deterministic} --soft`);
    console.log(`  npm run classify:evaluate -- ${paths.full!} --soft`);
  } else {
    await runClassificationBatch(runMode, paths.deterministic);
  }

  if (allUrls.length < limit) {
    console.warn(
      `\nOnly ${allUrls.length} distinct profile URLs in project; random sample is smaller than --limit ${limit}.`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
