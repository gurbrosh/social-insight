/**
 * Run: npx tsx lib/campaigns/build-enriched-campaign-csv.test.ts
 */
import assert from "node:assert/strict";
import {
  buildEnrichedCampaignCsvContent,
  CAMPAIGN_ENRICHED_CSV_HEADERS,
} from "./build-enriched-campaign-csv";
import type { CampaignEnrichedCandidateRow } from "./types";

function sampleRow(): CampaignEnrichedCandidateRow {
  return {
    linkedin_url: "https://www.linkedin.com/in/example-user-1/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-user-1",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    name: "Alex Example",
    headline: "Engineer",
    current_title: null,
    current_company: null,
    location: null,
    employment_source: "unknown",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: null,
    source_role_group: null,
    source_job_title_query: null,
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    phase1_decision: "continue_to_enrichment",
    phase1_role_categories: "unknown",
    phase1_function_tags: "",
    phase1_profile_flags: "",
    enrichment_status: "success",
    enrichment_actor: "full_linkedin_profile",
    enrichment_source: "apify_profile_scraper",
    enriched_employment_source: "profile_experience_current",
    enriched_employment_confidence: 0.9,
    experience_count: 1,
    current_experience_count: 1,
    enriched_current_title: "Senior Software Engineer",
    enriched_current_company: "Example Corp",
    enriched_role_categories: "software_engineer",
    enriched_classification_confidence: 0.8,
    post_enrichment_would_disqualify: false,
    open_to_work_detection: "unknown",
    open_to_work_source: "unavailable",
  };
}

function run() {
  const csv = buildEnrichedCampaignCsvContent([sampleRow()]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], CAMPAIGN_ENRICHED_CSV_HEADERS.join(","));
  assert.ok(!lines[0]!.startsWith("#"));
  assert.ok(csv.includes("phase1_role_categories"));
  assert.ok(csv.includes("enriched_current_title"));
  assert.ok(csv.includes("post_enrichment_would_disqualify"));
  assert.ok(csv.includes("https://www.linkedin.com/in/example-user-1/"));

  console.log("build-enriched-campaign-csv.test.ts: ok");
}

run();
