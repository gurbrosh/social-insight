/**
 * Campaign Phase 1 conservative exclusion — decision policy (stable; avoid broad retuning).
 *
 * Three rules (in order of intent):
 *  1. Unknown always continues — unknown-only or empty meaningful roles → continue_to_enrichment.
 *  2. Mixed meaningful signals continue — at least one meaningful role category is not covered by
 *     selected exclusions (see roleCategoryCoveredByPhase1SelectedExclusions in campaign-criteria-mapping).
 *  3. Single/dominant excluded profiles disqualify — matched exclusion(s), confidence/review gates pass,
 *     and every meaningful role category is covered by the selected exclusion umbrella → disqualify_phase1.
 *
 * Additional continue gates (not the three rules above): no exclusions selected, needs review,
 * confidence below threshold, no matcher hit, executive protected from status-only matches.
 */
import type { ProspectClassification, RoleCategory } from "@/lib/prospect-intelligence/types";
import {
  getCampaignExclusionCriterion,
  matchCampaignExclusionCriteria,
  pickDominantMatchedCampaignExclusion,
  roleCategoryCoveredByPhase1SelectedExclusions,
} from "./campaign-criteria-mapping";
import { isLikelyExecutiveClassification } from "./exclusion-title-patterns";
import type { CampaignExclusionCriterionId, Phase1Decision } from "./types";

const MEANINGFUL_ROLE_CATEGORIES = new Set<RoleCategory>([
  "unknown",
  "job_seeker",
  "student",
  "intern_or_student",
]);

const STATUS_ONLY_EXCLUSIONS = new Set<CampaignExclusionCriterionId>([
  "open_to_work",
  "not_working",
]);

/** Confidence at or above this threshold is considered reliable enough to disqualify. */
const DISQUALIFY_CONFIDENCE_THRESHOLD = 0.60;

/**
 * Role categories that represent a clear professional signal (not unknown / pure job-seeker label).
 */
export function meaningfulRoleCategories(classification: ProspectClassification): RoleCategory[] {
  return classification.roleCategories.filter((r) => !MEANINGFUL_ROLE_CATEGORIES.has(r));
}

export function hasUnknownRoleCategory(classification: ProspectClassification): boolean {
  const meaningful = meaningfulRoleCategories(classification);
  if (meaningful.length === 0 && classification.roleCategories.includes("unknown")) {
    return true;
  }
  if (
    classification.roleCategories.length === 1 &&
    classification.roleCategories[0] === "unknown"
  ) {
    return true;
  }
  return false;
}

/**
 * True when this role category is semantically covered by selected exclusions (Phase 1 umbrella).
 */
export function isRoleCategoryExcludedBySelection(
  role: RoleCategory,
  classification: ProspectClassification,
  selectedIds: readonly CampaignExclusionCriterionId[]
): boolean {
  if (role === "unknown") return false;
  return roleCategoryCoveredByPhase1SelectedExclusions(role, classification, selectedIds);
}

/**
 * Non-excluded professional signal: a meaningful role category not covered by any selected exclusion's semantic umbrella.
 */
export function hasNonExcludedProfessionalRoleSignal(
  classification: ProspectClassification,
  selectedIds: readonly CampaignExclusionCriterionId[]
): boolean {
  for (const role of meaningfulRoleCategories(classification)) {
    if (!isRoleCategoryExcludedBySelection(role, classification, selectedIds)) {
      return true;
    }
  }
  return false;
}

export function collectNonExcludedSignals(
  classification: ProspectClassification,
  selectedIds: readonly CampaignExclusionCriterionId[]
): string[] {
  const signals: string[] = [];
  for (const role of meaningfulRoleCategories(classification)) {
    if (!isRoleCategoryExcludedBySelection(role, classification, selectedIds)) {
      signals.push(`role:${role}`);
    }
  }
  // Seniority alone does not count as a protective signal (only meaningful role categories do).
  return signals;
}

export function pickDominantExclusion(
  matched: readonly CampaignExclusionCriterionId[]
): CampaignExclusionCriterionId | null {
  return pickDominantMatchedCampaignExclusion(matched);
}

function humanizeReason(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    unknown_role_category: "Unknown role always continues",
    classification_needs_review: "Classification needs review",
    below_confidence_threshold: "Below exclusion confidence threshold",
    mixed_excluded_and_non_excluded_signals:
      "Mixed excluded and non-excluded role signals",
    no_exclusions_selected: "No exclusions selected",
    no_exclusion_match: "No matched exclusion criteria",
    likely_executive: "Executive profile — only status-only exclusions matched",
  };
  if (map[code]) return map[code];
  if (code.startsWith("phase1_exclusion:")) {
    const ids = code.slice("phase1_exclusion:".length).split(",");
    const labels = ids
      .map((id) => getCampaignExclusionCriterion(id as CampaignExclusionCriterionId)?.label ?? id)
      .join("; ");
    return `Disqualified by: ${labels}`;
  }
  return code;
}

export type Phase1ExclusionInput = {
  classification: ProspectClassification;
  selectedExclusionIds: readonly CampaignExclusionCriterionId[];
};

export type Phase1ExclusionResult = {
  decision: Phase1Decision;
  reason: string | null;
  matchedExclusionCriteria: CampaignExclusionCriterionId[];
  nonExcludedSignals: string[];
  dominantExclusion: CampaignExclusionCriterionId | null;
  exclusionReason: string | null;
  whyContinuedReason: string | null;
};

function buildResult(
  decision: Phase1Decision,
  reason: string | null,
  matched: CampaignExclusionCriterionId[],
  classification: ProspectClassification,
  selectedExclusionIds: readonly CampaignExclusionCriterionId[]
): Phase1ExclusionResult {
  const nonExcludedSignals = collectNonExcludedSignals(classification, selectedExclusionIds);
  const dominantExclusion = pickDominantExclusion(matched);
  const exclusionReason =
    decision === "disqualify_phase1"
      ? humanizeReason(reason) ?? (dominantExclusion ? getCampaignExclusionCriterion(dominantExclusion)?.label ?? null : null)
      : null;
  const whyContinuedReason =
    decision === "continue_to_enrichment" ? humanizeReason(reason) : null;

  return {
    decision,
    reason,
    matchedExclusionCriteria: matched,
    nonExcludedSignals,
    dominantExclusion,
    exclusionReason,
    whyContinuedReason,
  };
}

/**
 * Apply Phase 1 policy. See module header for the three canonical rules.
 */
export function evaluatePhase1Exclusion(input: Phase1ExclusionInput): Phase1ExclusionResult {
  const { classification, selectedExclusionIds } = input;
  const matched = matchCampaignExclusionCriteria(classification, selectedExclusionIds);

  // 1. No exclusions selected — baseline
  if (selectedExclusionIds.length === 0) {
    return buildResult("continue_to_enrichment", "no_exclusions_selected", [], classification, selectedExclusionIds);
  }

  // Rule 1: Unknown always continues.
  if (hasUnknownRoleCategory(classification)) {
    return buildResult("continue_to_enrichment", "unknown_role_category", matched, classification, selectedExclusionIds);
  }

  // 3. Needs review — always continue
  if (classification.classificationNeedsReview || classification.needsReview) {
    return buildResult("continue_to_enrichment", "classification_needs_review", matched, classification, selectedExclusionIds);
  }

  // 4. Below confidence threshold — continue
  if (classification.confidence < DISQUALIFY_CONFIDENCE_THRESHOLD) {
    return buildResult("continue_to_enrichment", "below_confidence_threshold", matched, classification, selectedExclusionIds);
  }

  // 5. No matched exclusion criteria — continue
  if (matched.length === 0) {
    return buildResult("continue_to_enrichment", "no_exclusion_match", [], classification, selectedExclusionIds);
  }

  // 6. Executive profile protected from status-only exclusions (e.g. plain CEO + "not_working" selected)
  if (
    isLikelyExecutiveClassification(classification) &&
    matched.every((id) => STATUS_ONLY_EXCLUSIONS.has(id))
  ) {
    return buildResult("continue_to_enrichment", "likely_executive", matched, classification, selectedExclusionIds);
  }

  // Rule 2: Mixed meaningful signals continue (non-excluded professional role remains).
  if (hasNonExcludedProfessionalRoleSignal(classification, selectedExclusionIds)) {
    return buildResult("continue_to_enrichment", "mixed_excluded_and_non_excluded_signals", matched, classification, selectedExclusionIds);
  }

  // Rule 3: Single/dominant excluded profile — all meaningful roles covered by selected exclusions.
  return buildResult(
    "disqualify_phase1",
    `phase1_exclusion:${matched.join(",")}`,
    matched,
    classification,
    selectedExclusionIds
  );
}

export type Phase1DebugCsvRow = {
  linkedin_url: string;
  title: string;
  exclusions_applied: string;
  status: string;
  phase1_decision: Phase1Decision;
  role_categories: string;
  function_tags: string;
  profile_flags: string;
  excluded_role_flags: string;
  open_to_work_status: string;
  seniority: string;
  classification_confidence: string;
  classification_needs_review: string;
  matched_exclusion_criteria: string;
  non_excluded_signals: string;
  dominant_exclusion: string;
  exclusion_reason: string;
  why_continued_reason: string;
};

export function buildPhase1DebugCsvRow(args: {
  linkedin_url: string;
  title: string;
  exclusionsApplied: string;
  classification: ProspectClassification;
  phase1: Phase1ExclusionResult;
}): Phase1DebugCsvRow {
  const { linkedin_url, title, exclusionsApplied, classification, phase1 } = args;
  const excluded = phase1.decision === "disqualify_phase1";
  return {
    linkedin_url,
    title,
    exclusions_applied: exclusionsApplied,
    status: excluded ? "EXCLUDED" : "",
    phase1_decision: phase1.decision,
    role_categories: classification.roleCategories.join(";"),
    function_tags: classification.functionTags.join(";"),
    profile_flags: classification.profileFlags.join(";"),
    excluded_role_flags: classification.excludedRoleFlags.join(";"),
    open_to_work_status: classification.openToWorkDetection?.status ?? "",
    seniority: classification.seniority,
    classification_confidence: String(classification.confidence),
    classification_needs_review: classification.classificationNeedsReview ? "yes" : "no",
    matched_exclusion_criteria: phase1.matchedExclusionCriteria.join(";"),
    non_excluded_signals: phase1.nonExcludedSignals.join(";"),
    dominant_exclusion: phase1.dominantExclusion ?? "",
    exclusion_reason: phase1.exclusionReason ?? "",
    why_continued_reason: phase1.whyContinuedReason ?? "",
  };
}

export const PHASE1_DEBUG_CSV_HEADERS: (keyof Phase1DebugCsvRow)[] = [
  "linkedin_url",
  "title",
  "exclusions_applied",
  "status",
  "phase1_decision",
  "role_categories",
  "function_tags",
  "profile_flags",
  "excluded_role_flags",
  "open_to_work_status",
  "seniority",
  "classification_confidence",
  "classification_needs_review",
  "matched_exclusion_criteria",
  "non_excluded_signals",
  "dominant_exclusion",
  "exclusion_reason",
  "why_continued_reason",
];
