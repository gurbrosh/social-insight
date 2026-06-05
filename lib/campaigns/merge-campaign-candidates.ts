import type { CampaignCandidate, CampaignCandidateSourceType, CampaignMergeStats } from "./types";

function unionSourceTypes(
  a: readonly CampaignCandidateSourceType[],
  b: readonly CampaignCandidateSourceType[]
): CampaignCandidateSourceType[] {
  const set = new Set<CampaignCandidateSourceType>([...a, ...b]);
  return [...set];
}

function appendSourceNote(existing: string | undefined, note: string): string {
  if (!existing?.trim()) return note;
  if (existing.includes(note)) return existing;
  return `${existing}; ${note}`;
}

/** Merge company-search fields from incoming into existing when both refer to same person. */
function mergeCandidateFields(existing: CampaignCandidate, incoming: CampaignCandidate): CampaignCandidate {
  const source_types = unionSourceTypes(existing.source_types, incoming.source_types);
  const source_count = existing.source_count + incoming.source_count;

  const merged: CampaignCandidate = {
    ...existing,
    source_types,
    source_count,
    first_source_type: existing.first_source_type,
    source_notes: appendSourceNote(
      existing.source_notes,
      incoming.source_types.includes("cold_company_search")
        ? "also:company_search"
        : "also:post_based"
    ),
  };

  if (incoming.source_types.includes("cold_company_search")) {
    if (incoming.source_company_url && !merged.source_company_url) {
      merged.source_company_url = incoming.source_company_url;
    }
    if (incoming.source_role_group && !merged.source_role_group) {
      merged.source_role_group = incoming.source_role_group;
    }
    if (incoming.source_job_title_query && !merged.source_job_title_query) {
      merged.source_job_title_query = incoming.source_job_title_query;
    }
    if (incoming.current_title && !merged.current_title) {
      merged.current_title = incoming.current_title;
      merged.employment_source = incoming.employment_source;
    }
    if (incoming.current_company && !merged.current_company) {
      merged.current_company = incoming.current_company;
    }
    if (incoming.location && !merged.location) {
      merged.location = incoming.location;
    }
    if (incoming.headline && !merged.headline) {
      merged.headline = incoming.headline;
    }
  }

  if (incoming.source_types.includes("post_based_candidate")) {
    if (incoming.relevance_score != null) {
      const prev = merged.relevance_score ?? -1;
      if (incoming.relevance_score > prev) {
        merged.relevance_score = incoming.relevance_score;
        merged.theme_name = incoming.theme_name;
        merged.post_url = incoming.post_url;
        merged.total_reactions = incoming.total_reactions;
        merged.themes_analysis_id = incoming.themes_analysis_id;
        merged.post_id = incoming.post_id;
        merged.platform = incoming.platform;
      }
    }
  }

  return merged;
}

export type MergeCampaignCandidatesResult = {
  candidates: CampaignCandidate[];
  stats: CampaignMergeStats;
};

/**
 * Dedupe by linkedin_url_normalized. Source type does not affect ranking order (stable input order wins).
 */
export function mergeCampaignCandidates(
  postBased: CampaignCandidate[],
  companySearch: CampaignCandidate[]
): MergeCampaignCandidatesResult {
  const byUrl = new Map<string, CampaignCandidate>();
  let duplicatesRemoved = 0;

  const ingest = (row: CampaignCandidate) => {
    const key = row.linkedin_url_normalized;
    const prev = byUrl.get(key);
    if (!prev) {
      byUrl.set(key, row);
      return;
    }
    duplicatesRemoved += 1;
    byUrl.set(key, mergeCandidateFields(prev, row));
  };

  for (const row of postBased) ingest(row);
  for (const row of companySearch) ingest(row);

  const candidates = [...byUrl.values()];

  return {
    candidates,
    stats: {
      postBasedCount: postBased.length,
      companySearchCount: companySearch.length,
      duplicatesRemoved,
      totalLoaded: candidates.length,
    },
  };
}
