import { getCampaignExclusionCriterion } from "./campaign-criteria-mapping";
import type { CampaignCandidatePreviewRow, CampaignExclusionCriterionId } from "./types";

export const CAMPAIGN_PHASE1_CSV_HEADERS = [
  "linkedin_url",
  "first_name",
  "last_name",
  "display_name",
  "exclusions_applied",
  "status",
  "phase1_decision",
  "source_types",
  "first_source_type",
  "source_count",
  "source_company_url",
  "source_role_group",
  "source_job_title_query",
  "employment_source",
  "current_title",
  "current_company",
  "headline",
  "location",
  "role_categories",
  "function_tags",
  "profile_flags",
  "open_to_work_detection",
  "open_to_work_source",
  "open_to_work_status_detail",
  "classification_confidence",
  "classification_needs_review",
  "matched_exclusion_criteria",
  "non_excluded_signals",
  "dominant_exclusion",
  "exclusion_reason",
  "why_continued_reason",
  "relevance_score",
  "theme_name",
  "post_url",
  "total_reactions",
] as const;

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildCampaignPhase1CsvContent(
  rows: CampaignCandidatePreviewRow[],
  options?: { exclusionLabels?: string[] }
): string {
  const exclusionsApplied =
    options?.exclusionLabels?.length ? options.exclusionLabels.join("; ") : "none";

  const lines = [CAMPAIGN_PHASE1_CSV_HEADERS.join(",")];

  for (const r of rows) {
    const excluded = r.phase1_decision === "disqualify_phase1";
    lines.push(
      [
        r.linkedin_url,
        r.first_name,
        r.last_name,
        r.display_name ?? "",
        exclusionsApplied,
        excluded ? "EXCLUDED" : "",
        r.phase1_decision ?? "",
        r.source_types.join(";"),
        r.first_source_type,
        String(r.source_count),
        r.source_company_url ?? "",
        r.source_role_group ?? "",
        r.source_job_title_query ?? "",
        r.employment_source,
        r.current_title ?? "",
        r.current_company ?? "",
        r.headline ?? "",
        r.location ?? "",
        r.role_categories ?? "",
        r.function_tags ?? "",
        r.profile_flags ?? "",
        r.open_to_work_detection ?? "unknown",
        r.open_to_work_source ?? "unavailable",
        r.open_to_work_status_detail ?? "",
        r.classification_confidence != null ? String(r.classification_confidence) : "",
        r.classification_needs_review ? "yes" : r.phase1_decision ? "no" : "",
        (r.matched_exclusion_criteria ?? []).join(";"),
        r.non_excluded_signals ?? "",
        r.dominant_exclusion ?? "",
        r.exclusion_reason ?? "",
        r.why_continued_reason ?? "",
        r.relevance_score != null ? String(r.relevance_score) : "",
        r.theme_name ?? "",
        r.post_url ?? "",
        r.total_reactions != null ? String(r.total_reactions) : "",
      ]
        .map((c) => escapeCsvCell(String(c)))
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

export function exclusionIdsToLabels(ids: readonly CampaignExclusionCriterionId[]): string[] {
  return ids
    .map((id) => getCampaignExclusionCriterion(id)?.label ?? id)
    .filter(Boolean);
}
