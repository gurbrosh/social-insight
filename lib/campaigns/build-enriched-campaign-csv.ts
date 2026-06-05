import { getCampaignExclusionCriterion } from "./campaign-criteria-mapping";
import type { CampaignEnrichedCandidateRow, CampaignExclusionCriterionId } from "./types";

export const CAMPAIGN_ENRICHED_CSV_HEADERS = [
  "linkedin_url",
  "linkedin_url_normalized",
  "name",
  "headline",
  "current_title",
  "current_company",
  "employment_source",
  "source_types",
  "first_source_type",
  "source_count",
  "source_company_url",
  "source_role_group",
  "source_job_title_query",
  "phase1_decision",
  "phase1_status",
  "phase1_role_categories",
  "phase1_function_tags",
  "phase1_profile_flags",
  "phase1_matched_exclusion_criteria",
  "phase1_non_excluded_signals",
  "phase1_dominant_exclusion",
  "phase1_exclusion_reason",
  "phase1_why_continued_reason",
  "phase1_classification_confidence",
  "phase1_classification_needs_review",
  "exclusions_applied",
  "enrichment_status",
  "enrichment_error",
  "enriched_at",
  "enriched_current_title",
  "enriched_current_company",
  "enriched_current_company_linkedin_url",
  "enriched_employment_source",
  "enriched_employment_confidence",
  "enriched_current_roles",
  "experience_count",
  "current_experience_count",
  "past_companies",
  "past_titles",
  "about",
  "skills",
  "email",
  "mobile",
  "contact_source",
  "open_to_work_detection",
  "open_to_work_source",
  "open_to_work_raw_value",
  "enriched_role_categories",
  "enriched_function_tags",
  "enriched_profile_flags",
  "enriched_classification_confidence",
  "enriched_classification_needs_review",
  "post_enrichment_exclusion_matches",
  "post_enrichment_would_disqualify",
  "post_enrichment_reason",
] as const;

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function exclusionIdsToLabels(ids: readonly CampaignExclusionCriterionId[]): string[] {
  return ids
    .map((id) => getCampaignExclusionCriterion(id)?.label ?? id)
    .filter(Boolean);
}

export function buildEnrichedCampaignCsvContent(
  rows: CampaignEnrichedCandidateRow[],
  options?: { exclusionLabels?: string[] }
): string {
  const exclusionsApplied =
    options?.exclusionLabels?.length ? options.exclusionLabels.join("; ") : "none";

  const lines = [CAMPAIGN_ENRICHED_CSV_HEADERS.join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.linkedin_url,
        r.linkedin_url_normalized,
        r.name,
        r.headline ?? "",
        r.current_title ?? "",
        r.current_company ?? "",
        r.employment_source,
        r.source_types.join(";"),
        r.first_source_type,
        String(r.source_count),
        r.source_company_url ?? "",
        r.source_role_group ?? "",
        r.source_job_title_query ?? "",
        r.phase1_decision ?? "",
        r.phase1_status ?? "",
        r.phase1_role_categories ?? r.role_categories ?? "",
        r.phase1_function_tags ?? r.function_tags ?? "",
        r.phase1_profile_flags ?? r.profile_flags ?? "",
        r.phase1_matched_exclusion_criteria ??
          (r.matched_exclusion_criteria ?? []).join(";"),
        r.phase1_non_excluded_signals ?? r.non_excluded_signals ?? "",
        r.phase1_dominant_exclusion ?? r.dominant_exclusion ?? "",
        r.phase1_exclusion_reason ?? r.exclusion_reason ?? "",
        r.phase1_why_continued_reason ?? r.why_continued_reason ?? "",
        r.phase1_classification_confidence != null
          ? String(r.phase1_classification_confidence)
          : r.classification_confidence != null
            ? String(r.classification_confidence)
            : "",
        r.phase1_classification_needs_review ? "yes" : r.classification_needs_review ? "no" : "",
        exclusionsApplied,
        r.enrichment_status,
        r.enrichment_error ?? "",
        r.enriched_at ?? "",
        r.enriched_current_title ?? "",
        r.enriched_current_company ?? "",
        r.enriched_current_company_linkedin_url ?? "",
        r.enriched_employment_source,
        String(r.enriched_employment_confidence ?? 0),
        r.enriched_current_roles ?? "",
        String(r.experience_count ?? 0),
        String(r.current_experience_count ?? 0),
        r.past_companies ?? "",
        r.past_titles ?? "",
        r.about ?? "",
        r.skills ?? "",
        r.email ?? "",
        r.mobile ?? "",
        r.contact_source ?? "",
        r.open_to_work_detection ?? "unknown",
        r.open_to_work_source ?? "unavailable",
        r.open_to_work_raw_value ?? "",
        r.enriched_role_categories ?? "",
        r.enriched_function_tags ?? "",
        r.enriched_profile_flags ?? "",
        r.enriched_classification_confidence != null
          ? String(r.enriched_classification_confidence)
          : "",
        r.enriched_classification_needs_review ? "yes" : "no",
        r.post_enrichment_exclusion_matches ?? "",
        r.post_enrichment_would_disqualify ? "yes" : "no",
        r.post_enrichment_reason ?? "",
      ]
        .map((c) => escapeCsvCell(String(c)))
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}
