import { getCampaignExclusionCriterion } from "./campaign-criteria-mapping";
import type { CampaignCandidatePreviewRow, CampaignExclusionCriterionId } from "./types";

/** Phase 2 dev/validation export — superset of campaign Phase 1 CSV columns. */
export const PHASE2_VALIDATION_CSV_HEADERS = [
  "scenario_id",
  "linkedin_url",
  "linkedin_url_normalized",
  "first_name",
  "last_name",
  "display_name",
  "headline",
  "current_title",
  "current_company",
  "location",
  "employment_source",
  "raw_source",
  "source_types",
  "first_source_type",
  "source_count",
  "source_notes",
  "source_company_url",
  "source_role_group",
  "source_job_title_query",
  "apify_open_to_work_present",
  "relevance_score",
  "theme_name",
  "post_url",
  "total_reactions",
  "exclusions_applied",
  "status",
  "phase1_decision",
  "phase1_disqualified_reason",
  "role_categories",
  "function_tags",
  "profile_flags",
  "excluded_role_flags",
  "open_to_work_detection",
  "open_to_work_source",
  "open_to_work_status_detail",
  "classification_confidence",
  "employment_confidence",
  "classification_needs_review",
  "matched_exclusion_criteria",
  "non_excluded_signals",
  "dominant_exclusion",
  "exclusion_reason",
  "why_continued_reason",
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

export type Phase2ValidationJobTitleMeta = {
  roleGroupsSelected: readonly string[];
  jobTitlesBeforeCap: number;
  allJobTitlesBeforeCap: readonly string[];
  jobTitlesSentToApify: readonly string[];
  droppedJobTitlesCount: number;
  warning: string;
};

export function buildPhase2ValidationCsvPreamble(meta: Phase2ValidationJobTitleMeta): string {
  const lines = [
    `# ${meta.warning}`,
    `# role_groups_selected=${meta.roleGroupsSelected.join(";")}`,
    `# job_titles_before_cap_count=${meta.jobTitlesBeforeCap}`,
    `# job_titles_sent_to_apify_count=${meta.jobTitlesSentToApify.length}`,
    `# dropped_job_titles_count=${meta.droppedJobTitlesCount}`,
    `# job_titles_sent_to_apify=${meta.jobTitlesSentToApify.join(";")}`,
    `# job_titles_before_cap=${meta.allJobTitlesBeforeCap.join(";")}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function buildPhase2ValidationCsvContent(args: {
  scenarioId: string;
  rows: CampaignCandidatePreviewRow[];
  selectedExclusionIds?: readonly CampaignExclusionCriterionId[];
  jobTitleMeta?: Phase2ValidationJobTitleMeta;
}): string {
  const labels = args.selectedExclusionIds?.length
    ? exclusionIdsToLabels(args.selectedExclusionIds)
    : [];
  const exclusionsApplied = labels.length ? labels.join("; ") : "none";

  const lines = [PHASE2_VALIDATION_CSV_HEADERS.join(",")];

  for (const r of args.rows) {
    const excluded = r.phase1_decision === "disqualify_phase1";
    lines.push(
      [
        args.scenarioId,
        r.linkedin_url,
        r.linkedin_url_normalized,
        r.first_name,
        r.last_name,
        r.display_name ?? "",
        r.headline ?? "",
        r.current_title ?? "",
        r.current_company ?? "",
        r.location ?? "",
        r.employment_source,
        r.raw_source ?? "",
        r.source_types.join(";"),
        r.first_source_type,
        String(r.source_count),
        r.source_notes ?? "",
        r.source_company_url ?? "",
        r.source_role_group ?? "",
        r.source_job_title_query ?? "",
        r.apify_open_to_work_present ? "yes" : "no",
        r.relevance_score != null ? String(r.relevance_score) : "",
        r.theme_name ?? "",
        r.post_url ?? "",
        r.total_reactions != null ? String(r.total_reactions) : "",
        exclusionsApplied,
        excluded ? "EXCLUDED" : "",
        r.phase1_decision ?? "",
        r.phase1_disqualified_reason ?? "",
        r.role_categories ?? "",
        r.function_tags ?? "",
        r.profile_flags ?? "",
        r.classification?.excludedRoleFlags.join(";") ?? "",
        r.open_to_work_detection ?? "unknown",
        r.open_to_work_source ?? "unavailable",
        r.open_to_work_status_detail ?? "",
        r.classification_confidence != null ? String(r.classification_confidence) : "",
        r.employment_confidence != null ? String(r.employment_confidence) : "",
        r.classification_needs_review ? "yes" : r.phase1_decision ? "no" : "",
        (r.matched_exclusion_criteria ?? []).join(";"),
        r.non_excluded_signals ?? "",
        r.dominant_exclusion ?? "",
        r.exclusion_reason ?? "",
        r.why_continued_reason ?? "",
      ]
        .map((c) => escapeCsvCell(String(c)))
        .join(",")
    );
  }

  const body = `${lines.join("\n")}\n`;
  if (args.jobTitleMeta) {
    return buildPhase2ValidationCsvPreamble(args.jobTitleMeta) + body;
  }
  return body;
}
