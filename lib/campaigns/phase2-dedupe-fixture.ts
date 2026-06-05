import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { postBasedToCampaignCandidate } from "./post-based-to-campaign-candidate";
import type { CampaignCandidate, PostBasedCampaignCandidate } from "./types";

function normalized(url: string): string {
  return normalizePublicProfileUrl(url) ?? url.replace(/\/$/, "");
}

/** Shared profile URL for deterministic merge/dedupe validation. */
export const PHASE2_DEDUPE_FIXTURE_URL_SHARED =
  "https://www.linkedin.com/in/phase2-dedupe-shared/";

export const PHASE2_DEDUPE_FIXTURE_URL_POST_ONLY =
  "https://www.linkedin.com/in/phase2-dedupe-post-only/";

export const PHASE2_DEDUPE_FIXTURE_URL_COMPANY_ONLY =
  "https://www.linkedin.com/in/phase2-dedupe-company-only/";

function companyRow(over: Partial<CampaignCandidate>): CampaignCandidate {
  const url = over.linkedin_url ?? PHASE2_DEDUPE_FIXTURE_URL_SHARED;
  return {
    linkedin_url: url,
    linkedin_url_normalized: normalized(url),
    first_name: "Shared",
    last_name: "Dup",
    display_name: "Shared Dup",
    headline: "Security Engineer at Example Corp",
    current_title: "Security Engineer",
    current_company: "Example Corp",
    location: "Remote",
    employment_source: "current_positions",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: "https://www.linkedin.com/company/example-corp/",
    source_role_group: "security_practitioners",
    source_job_title_query: "Security Engineer",
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    ...over,
  };
}

function postRow(over: Partial<PostBasedCampaignCandidate>): PostBasedCampaignCandidate {
  return {
    linkedin_url: PHASE2_DEDUPE_FIXTURE_URL_SHARED,
    first_name: "Shared",
    last_name: "Dup",
    display_name: "Shared Dup",
    headline: "Commented on theme post",
    candidate_source_type: "post_based_candidate",
    relevance_score: 88,
    theme_name: "Example Theme",
    post_url: "https://www.linkedin.com/feed/update/fixture-post-1/",
    total_reactions: 12,
    themes_analysis_id: "01FIXTURETHEMESANALYSIS01",
    post_id: 900001,
    platform: "linkedin",
    ...over,
  };
}

export type Phase2DedupeFixtureInput = {
  postBased: CampaignCandidate[];
  companySearch: CampaignCandidate[];
  inputRowCount: number;
};

/** Four input rows → expect 3 merged candidates after URL dedupe. */
export function buildPhase2DedupeFixtureInput(): Phase2DedupeFixtureInput {
  const postShared = postBasedToCampaignCandidate(postRow({}));
  const postOnly = postBasedToCampaignCandidate(
    postRow({
      linkedin_url: PHASE2_DEDUPE_FIXTURE_URL_POST_ONLY,
      first_name: "Post",
      last_name: "Only",
      display_name: "Post Only",
      relevance_score: 75,
      theme_name: "Theme B",
      post_url: "https://www.linkedin.com/feed/update/fixture-post-2/",
      themes_analysis_id: "01FIXTURETHEMESANALYSIS02",
      post_id: 900002,
    })
  );

  const companyShared = companyRow({});
  const companyOnly = companyRow({
    linkedin_url: PHASE2_DEDUPE_FIXTURE_URL_COMPANY_ONLY,
    first_name: "Company",
    last_name: "Only",
    display_name: "Company Only",
    current_title: "CISO",
    source_role_group: "security_leaders",
    source_job_title_query: "CISO",
  });

  return {
    postBased: [postShared, postOnly],
    companySearch: [companyShared, companyOnly],
    inputRowCount: 4,
  };
}
