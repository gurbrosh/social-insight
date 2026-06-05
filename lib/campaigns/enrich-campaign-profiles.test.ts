/**
 * Run: npx tsx lib/campaigns/enrich-campaign-profiles.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enrichCampaignProfiles } from "./enrich-campaign-profiles";
import type { CampaignCandidatePreviewRow } from "./types";

const FIXTURE = resolve(
  process.cwd(),
  "fixtures/apify/linkedin-profile-scraper/output.sample.json"
);

function baseCandidate(over: Partial<CampaignCandidatePreviewRow>): CampaignCandidatePreviewRow {
  return {
    linkedin_url: "https://www.linkedin.com/in/example-user-1/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-user-1",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    headline: null,
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
    role_categories: "unknown",
    ...over,
  };
}

async function run() {
  const fixtureItems = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>[];

  const continuing = baseCandidate({});
  const disqualified = baseCandidate({
    linkedin_url: "https://www.linkedin.com/in/disqualified/",
    linkedin_url_normalized: "https://www.linkedin.com/in/disqualified",
    phase1_decision: "disqualify_phase1",
  });

  const result = await enrichCampaignProfiles({
    projectId: "01TESTPROJECT000000000000",
    candidates: [continuing, disqualified],
    selectedExclusionIds: [],
    fetchItems: async () => fixtureItems,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stats.skippedPhase1Disqualified, 1);
  assert.equal(result.enrichedCandidates.length, 1);
  assert.equal(result.enrichedCandidates[0]!.enrichment_status, "success");
  assert.equal(result.enrichedCandidates[0]!.phase1_decision, "continue_to_enrichment");
  assert.ok(result.enrichedCandidates[0]!.enriched_role_categories);

  const failResult = await enrichCampaignProfiles({
    projectId: "01TESTPROJECT000000000000",
    candidates: [
      baseCandidate({
        linkedin_url: "https://www.linkedin.com/in/missing-profile/",
        linkedin_url_normalized: "https://www.linkedin.com/in/missing-profile",
      }),
    ],
    selectedExclusionIds: [],
    fetchItems: async () => [],
  });
  assert.equal(failResult.ok, true);
  if (failResult.ok) {
    assert.equal(failResult.enrichedCandidates[0]!.enrichment_status, "not_found");
    assert.equal(failResult.enrichedCandidates[0]!.phase1_role_categories, "unknown");
  }

  const otwFixture = [
    {
      linkedinUrl: "https://www.linkedin.com/in/otw-user/",
      openToWork: true,
      headline: "Engineer",
      experiences: [{ title: "Engineer", companyName: "Co", isCurrent: true }],
    },
  ];
  const otwResult = await enrichCampaignProfiles({
    projectId: "01TESTPROJECT000000000000",
    candidates: [
      baseCandidate({
        linkedin_url: "https://www.linkedin.com/in/otw-user/",
        linkedin_url_normalized: "https://www.linkedin.com/in/otw-user",
      }),
    ],
    selectedExclusionIds: ["open_to_work"],
    fetchItems: async () => otwFixture,
  });
  assert.equal(otwResult.ok, true);
  if (otwResult.ok) {
    assert.equal(otwResult.enrichedCandidates[0]!.open_to_work_detection, "detected");
    assert.equal(otwResult.enrichedCandidates[0]!.phase1_decision, "continue_to_enrichment");
    assert.equal(otwResult.enrichedCandidates[0]!.post_enrichment_would_disqualify, true);
  }

  console.log("enrich-campaign-profiles.test.ts: ok");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
