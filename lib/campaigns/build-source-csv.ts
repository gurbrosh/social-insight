import type { CampaignCandidatePreviewRow } from "./types";

export const CAMPAIGN_SOURCE_CSV_HEADERS = [
  "linkedin_url",
  "first_name",
  "last_name",
  "display_name",
  "headline",
  "source_types",
  "relevance_score",
  "theme_name",
  "post_url",
  "total_reactions",
  "phase1_decision",
  "phase1_disqualified_reason",
  "matched_exclusion_criteria",
  "role_categories",
  "classification_confidence",
  "employment_confidence",
] as const;

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildCampaignSourceCsvContent(rows: CampaignCandidatePreviewRow[]): string {
  const lines = [CAMPAIGN_SOURCE_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.linkedin_url,
        r.first_name,
        r.last_name,
        r.display_name ?? "",
        r.headline ?? "",
        r.source_types.join(";"),
        r.relevance_score != null ? String(r.relevance_score) : "",
        r.theme_name ?? "",
        r.post_url ?? "",
        r.total_reactions != null ? String(r.total_reactions) : "",
        r.phase1_decision ?? "",
        r.phase1_disqualified_reason ?? "",
        (r.matched_exclusion_criteria ?? []).join(";"),
        r.role_categories ?? "",
        r.classification_confidence != null ? String(r.classification_confidence) : "",
        r.employment_confidence != null ? String(r.employment_confidence) : "",
      ]
        .map((c) => escapeCsvCell(String(c)))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
