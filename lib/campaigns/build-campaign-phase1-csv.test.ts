/**
 * Run: npx tsx lib/campaigns/build-campaign-phase1-csv.test.ts
 */
import assert from "node:assert/strict";
import {
  buildCampaignPhase1CsvContent,
  CAMPAIGN_PHASE1_CSV_HEADERS,
  exclusionIdsToLabels,
} from "./build-campaign-phase1-csv";
import type { CampaignCandidatePreviewRow } from "./types";

function sampleRow(over: Partial<CampaignCandidatePreviewRow> = {}): CampaignCandidatePreviewRow {
  return {
    linkedin_url: "https://www.linkedin.com/in/example-user/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-user",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    headline: "Chief Executive Officer",
    current_title: "Chief Executive Officer",
    current_company: "Example Corp",
    location: "Example City",
    employment_source: "current_positions",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: "https://www.linkedin.com/company/example-corp/",
    source_role_group: "security_leaders",
    source_job_title_query: "Security Engineer",
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    phase1_decision: "disqualify_phase1",
    matched_exclusion_criteria: ["c_level"],
    role_categories: "executive_leader",
    function_tags: "",
    profile_flags: "",
    classification_confidence: 0.85,
    classification_needs_review: false,
    open_to_work_detection: "unknown",
    open_to_work_source: "unavailable",
    open_to_work_status_detail: "not_observed",
    non_excluded_signals: "",
    dominant_exclusion: "c_level",
    exclusion_reason: "Matched C-level exclusion",
    why_continued_reason: "",
    ...over,
  };
}

function run() {
  const csv = buildCampaignPhase1CsvContent([sampleRow()], {
    exclusionLabels: exclusionIdsToLabels(["c_level"]),
  });
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);

  const header = lines[0]!.split(",");
  assert.deepEqual(header, [...CAMPAIGN_PHASE1_CSV_HEADERS]);
  assert.ok(!lines[0]!.startsWith("#"), "CSV must not use comment header rows");

  const row = lines[1]!;
  assert.ok(row.includes("cold_company_search"));
  assert.ok(row.includes("security_leaders"));
  assert.ok(row.includes("disqualify_phase1"));
  assert.ok(row.includes("EXCLUDED"));
  assert.ok(row.includes("C-level") || row.includes("c_level"));

  const noLabels = buildCampaignPhase1CsvContent([sampleRow()]);
  assert.ok(noLabels.includes(",none,"));

  console.log("build-campaign-phase1-csv.test.ts: ok");
}

run();
