import type { CampaignCandidatePreviewRow, CampaignPhase1Snapshot } from "./types";

export function capturePhase1Snapshot(
  row: CampaignCandidatePreviewRow
): CampaignPhase1Snapshot {
  return {
    phase1_decision: row.phase1_decision,
    phase1_status:
      row.phase1_decision === "disqualify_phase1"
        ? "EXCLUDED"
        : row.phase1_decision === "continue_to_enrichment"
          ? "CONTINUING"
          : "",
    phase1_role_categories: row.role_categories,
    phase1_function_tags: row.function_tags,
    phase1_profile_flags: row.profile_flags,
    phase1_matched_exclusion_criteria: (row.matched_exclusion_criteria ?? []).join(";"),
    phase1_non_excluded_signals: row.non_excluded_signals,
    phase1_dominant_exclusion: row.dominant_exclusion,
    phase1_exclusion_reason: row.exclusion_reason,
    phase1_why_continued_reason: row.why_continued_reason,
    phase1_classification_confidence: row.classification_confidence,
    phase1_classification_needs_review: row.classification_needs_review,
    phase1_open_to_work_detection: row.open_to_work_detection,
    phase1_open_to_work_source: row.open_to_work_source,
  };
}
