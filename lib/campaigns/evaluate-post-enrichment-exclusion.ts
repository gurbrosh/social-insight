import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import { evaluatePhase1Exclusion } from "./phase1-exclusion";
import type { CampaignExclusionCriterionId } from "./types";

export type PostEnrichmentExclusionResult = {
  matchedExclusionCriteria: CampaignExclusionCriterionId[];
  wouldDisqualify: boolean;
  reason: string | null;
};

/**
 * Inspect whether enriched data would trigger selected exclusions.
 * Does not change the original Phase 1 decision — inspection only.
 */
export function evaluatePostEnrichmentExclusion(args: {
  classification: ProspectClassification;
  selectedExclusionIds: readonly CampaignExclusionCriterionId[];
  enrichmentOpenToWorkDetection?: "detected" | "not_detected" | "unknown";
  enrichmentOpenToWorkSource?:
    | "profile_enrichment"
    | "inferred_text_weak"
    | "unavailable"
    | "company_search"
    | "post_based";
}): PostEnrichmentExclusionResult {
  const phase1Eval = evaluatePhase1Exclusion({
    classification: args.classification,
    selectedExclusionIds: args.selectedExclusionIds,
  });

  const matched = new Set(phase1Eval.matchedExclusionCriteria);
  let wouldDisqualify = phase1Eval.decision === "disqualify_phase1";
  let reason: string | null = wouldDisqualify
    ? phase1Eval.exclusionReason ?? phase1Eval.reason
    : null;

  if (
    args.selectedExclusionIds.includes("open_to_work") &&
    args.enrichmentOpenToWorkDetection === "detected" &&
    args.enrichmentOpenToWorkSource === "profile_enrichment"
  ) {
    matched.add("open_to_work");
    wouldDisqualify = true;
    reason =
      "Enrichment detected Open to Work (explicit profile signal) with Open to Work exclusion selected";
  }

  return {
    matchedExclusionCriteria: [...matched],
    wouldDisqualify,
    reason,
  };
}
