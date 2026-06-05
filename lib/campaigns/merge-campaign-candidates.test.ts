/**
 * Run: npx tsx lib/campaigns/merge-campaign-candidates.test.ts
 */
import assert from "node:assert/strict";
import { mergeCampaignCandidates } from "./merge-campaign-candidates";
import { postBasedToCampaignCandidate } from "./post-based-to-campaign-candidate";
import type { CampaignCandidate, PostBasedCampaignCandidate } from "./types";

function companyCandidate(over: Partial<CampaignCandidate>): CampaignCandidate {
  return {
    linkedin_url: "https://www.linkedin.com/in/example-user/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-user",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    headline: "Security Engineer",
    current_title: "Security Engineer",
    current_company: "Example Corp",
    location: "Example City",
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

function run() {
  const postRow: PostBasedCampaignCandidate = {
    linkedin_url: "https://www.linkedin.com/in/example-user/",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    headline: "Commenter",
    candidate_source_type: "post_based_candidate",
    relevance_score: 85,
    theme_name: "Theme A",
    post_url: "https://linkedin.com/post/1",
    total_reactions: 10,
    themes_analysis_id: "ta1",
    post_id: 1,
    platform: "linkedin",
  };

  const post = postBasedToCampaignCandidate(postRow);
  const company = companyCandidate({});

  const merged = mergeCampaignCandidates([post], [company]);
  assert.equal(merged.stats.duplicatesRemoved, 1);
  assert.equal(merged.stats.totalLoaded, 1);
  assert.equal(merged.candidates.length, 1);

  const row = merged.candidates[0]!;
  assert.deepEqual(row.source_types.sort(), ["cold_company_search", "post_based_candidate"].sort());
  assert.equal(row.source_count, 2);
  assert.equal(row.first_source_type, "post_based_candidate");
  assert.equal(row.relevance_score, 85);
  assert.equal(row.current_title, "Security Engineer");

  console.log("merge-campaign-candidates.test.ts: ok");
}

run();
