/**
 * Verify Phase 1 fields for one campaign candidate (company-search path).
 *
 * Usage:
 *   npx tsx scripts/verify-campaign-candidate-phase1.ts --url "https://www.linkedin.com/in/..." [--project-id ULID]
 *
 * Optional JSON fields from your Apify row (if you saved one):
 *   --headline "..." --title "..." --company "..."
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { classifyCampaignCandidateReadOnly } from "@/lib/campaigns/classify-readonly";
import { evaluatePhase1Exclusion } from "@/lib/campaigns/phase1-exclusion";
import {
  apifyCompanyItemHasOpenToWorkSignal,
  deriveCampaignOpenToWorkFields,
} from "@/lib/campaigns/open-to-work-export";
import { loadPersonEmploymentByLinkedInUrl } from "@/lib/prospect-intelligence/load-profile-employment";
import type { CampaignCandidate } from "@/lib/campaigns/types";

function parseArgs(argv: string[]) {
  let url = "";
  let projectId = process.env.CAMPAIGN_VERIFY_PROJECT_ID ?? "01KMNPT8ZRGZKV9NFXVMQD2CDH";
  let headline: string | null = null;
  let current_title: string | null = null;
  let current_company: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--url" && argv[i + 1]) url = argv[++i]!;
    else if (a === "--project-id" && argv[i + 1]) projectId = argv[++i]!;
    else if (a === "--headline" && argv[i + 1]) headline = argv[++i]!;
    else if (a === "--title" && argv[i + 1]) current_title = argv[++i]!;
    else if (a === "--company" && argv[i + 1]) current_company = argv[++i]!;
  }
  return { url, projectId, headline, current_title, current_company };
}

function buildCompanySearchCandidate(args: {
  url: string;
  headline: string | null;
  current_title: string | null;
  current_company: string | null;
}): CampaignCandidate {
  const linkedin_url = args.url.trim();
  return {
    linkedin_url,
    linkedin_url_normalized: linkedin_url.replace(/\/$/, ""),
    first_name: "Unknown",
    last_name: "",
    display_name: null,
    headline: args.headline,
    current_title: args.current_title,
    current_company: args.current_company,
    location: null,
    employment_source:
      args.current_title || args.current_company ? "current_positions" : args.headline ? "headline_fallback" : "unknown",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: null,
    source_role_group: null,
    source_job_title_query: null,
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
  };
}

async function main() {
  const { url, projectId, headline, current_title, current_company } = parseArgs(process.argv);
  if (!url) {
    console.error("Usage: npx tsx scripts/verify-campaign-candidate-phase1.ts --url <linkedin_url> [--headline ...] [--title ...] [--company ...]");
    process.exit(1);
  }

  const syntheticApifyItem: Record<string, unknown> = {
    linkedinUrl: url,
    headline: headline ?? undefined,
    summary: headline ?? undefined,
    currentPositions:
      current_title || current_company
        ? [{ title: current_title, companyName: current_company }]
        : [],
  };

  const apifyOtw = apifyCompanyItemHasOpenToWorkSignal(syntheticApifyItem);
  const candidate = buildCompanySearchCandidate({ url, headline, current_title, current_company });

  const pe = await loadPersonEmploymentByLinkedInUrl(prisma, url);
  const hadCachedEmployment = Boolean(pe?.experienceRoles.length);

  const classification = await classifyCampaignCandidateReadOnly(projectId, candidate, {
    skipPublicProfileFetch: true,
  });

  const phase1 = evaluatePhase1Exclusion({
    classification,
    selectedExclusionIds: ["open_to_work"],
  });

  const otwExport = deriveCampaignOpenToWorkFields({
    candidate,
    classification,
    hadCachedEmployment,
    apifyHadOpenToWork: apifyOtw,
  });

  const report = {
    verification_questions: {
      apify_payload_included_otw_signal: apifyOtw,
      normalization_preserves_otw: false,
      normalization_note:
        "normalize-company-search-results.ts does not map Open to Work fields from Apify; only headline/title/company/location.",
      classify_received_open_to_work_input: {
        openToWorkDetection: classification.openToWorkDetection ?? null,
        profile_flags: classification.profileFlags,
        excluded_role_flags: classification.excludedRoleFlags,
        role_categories: classification.roleCategories,
      },
      phase1_matched_open_to_work: phase1.matchedExclusionCriteria.includes("open_to_work"),
    },
    row: {
      linkedin_url: candidate.linkedin_url,
      source_types: candidate.source_types,
      headline: candidate.headline,
      current_title: candidate.current_title,
      current_company: candidate.current_company,
      role_categories: classification.roleCategories.join(";"),
      function_tags: classification.functionTags.join(";"),
      profile_flags: classification.profileFlags.join(";"),
      open_to_work_detection: otwExport.open_to_work_detection,
      open_to_work_source: otwExport.open_to_work_source,
      open_to_work_status_detail: otwExport.open_to_work_status_detail,
      matched_exclusion_criteria: phase1.matchedExclusionCriteria,
      phase1_decision: phase1.decision,
      exclusion_reason: phase1.exclusionReason,
      why_continued_reason: phase1.whyContinuedReason,
      classification_confidence: classification.confidence,
      classification_needs_review: classification.classificationNeedsReview,
    },
    inputs_used: {
      projectId,
      hadCachedEmployment,
      syntheticApifyItem,
      note: "Pass --headline/--title/--company from your Phase 2 CSV or Apify export to match your run.",
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
