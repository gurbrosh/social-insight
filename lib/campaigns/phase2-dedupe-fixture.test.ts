/**
 * Run: npx tsx lib/campaigns/phase2-dedupe-fixture.test.ts
 */
import assert from "node:assert/strict";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { mergeCampaignCandidates } from "./merge-campaign-candidates";
import {
  buildPhase2DedupeFixtureInput,
  PHASE2_DEDUPE_FIXTURE_URL_SHARED,
} from "./phase2-dedupe-fixture";

function run() {
  const { postBased, companySearch, inputRowCount } = buildPhase2DedupeFixtureInput();
  assert.equal(inputRowCount, 4);

  const merged = mergeCampaignCandidates(postBased, companySearch);
  assert.equal(merged.stats.postBasedCount, 2);
  assert.equal(merged.stats.companySearchCount, 2);
  assert.equal(merged.stats.duplicatesRemoved, 1);
  assert.equal(merged.stats.totalLoaded, 3);
  assert.equal(merged.candidates.length, 3);

  const sharedNorm =
    normalizePublicProfileUrl(PHASE2_DEDUPE_FIXTURE_URL_SHARED) ??
    PHASE2_DEDUPE_FIXTURE_URL_SHARED.replace(/\/$/, "");
  const dup = merged.candidates.find((c) => c.linkedin_url_normalized === sharedNorm);
  assert.ok(dup);
  assert.deepEqual(dup!.source_types.sort(), ["cold_company_search", "post_based_candidate"].sort());
  assert.equal(dup!.source_count, 2);
  assert.equal(dup!.first_source_type, "post_based_candidate");
  assert.equal(dup!.relevance_score, 88);
  assert.equal(dup!.current_title, "Security Engineer");
  assert.equal(dup!.theme_name, "Example Theme");
  assert.equal(dup!.source_company_url, "https://www.linkedin.com/company/example-corp/");
  assert.ok(dup!.source_notes?.includes("also:company_search"));

  console.log("phase2-dedupe-fixture.test.ts: ok");
}

run();
