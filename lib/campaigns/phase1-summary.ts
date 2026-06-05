import type { CampaignCandidatePreviewRow } from "./types";

export type Phase1SummaryCounts = {
  total: number;
  phase1Disqualified: number;
  continuingToLaterEnrichment: number;
  unknownContinuing: number;
  postBasedCount: number;
  companySearchCount: number;
  bothSourcesCount: number;
};

export function computePhase1SummaryCounts(
  rows: CampaignCandidatePreviewRow[]
): Phase1SummaryCounts {
  let phase1Disqualified = 0;
  let continuingToLaterEnrichment = 0;
  let unknownContinuing = 0;

  let postBasedCount = 0;
  let companySearchCount = 0;
  let bothSourcesCount = 0;

  for (const r of rows) {
    const hasPost = r.source_types.includes("post_based_candidate");
    const hasCompany = r.source_types.includes("cold_company_search");
    if (hasPost) postBasedCount += 1;
    if (hasCompany) companySearchCount += 1;
    if (hasPost && hasCompany) bothSourcesCount += 1;

    if (r.phase1_decision === "disqualify_phase1") {
      phase1Disqualified += 1;
    } else if (r.phase1_decision === "continue_to_enrichment") {
      continuingToLaterEnrichment += 1;
      if (r.phase1_disqualified_reason === "unknown_role_category") {
        unknownContinuing += 1;
      }
    }
  }

  return {
    total: rows.length,
    phase1Disqualified,
    continuingToLaterEnrichment,
    unknownContinuing,
    postBasedCount,
    companySearchCount,
    bothSourcesCount,
  };
}
