import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import type { CampaignCandidate, PostBasedCampaignCandidate } from "./types";

/** Convert post-based collector output to unified CampaignCandidate. */
export function postBasedToCampaignCandidate(row: PostBasedCampaignCandidate): CampaignCandidate {
  const normalized =
    normalizePublicProfileUrl(row.linkedin_url) ?? row.linkedin_url.trim().toLowerCase();

  return {
    linkedin_url: row.linkedin_url,
    linkedin_url_normalized: normalized,
    first_name: row.first_name,
    last_name: row.last_name,
    display_name: row.display_name,
    headline: row.headline,
    current_title: null,
    current_company: null,
    location: null,
    employment_source: "unknown",
    source_types: ["post_based_candidate"],
    first_source_type: "post_based_candidate",
    source_count: 1,
    source_company_url: null,
    source_role_group: null,
    source_job_title_query: null,
    raw_source: "themes_analysis",
    relevance_score: row.relevance_score,
    theme_name: row.theme_name,
    post_url: row.post_url,
    total_reactions: row.total_reactions,
    themes_analysis_id: row.themes_analysis_id,
    post_id: row.post_id,
    platform: row.platform,
  };
}

export function postBasedListToCampaignCandidates(
  rows: PostBasedCampaignCandidate[]
): CampaignCandidate[] {
  return rows.map(postBasedToCampaignCandidate);
}
