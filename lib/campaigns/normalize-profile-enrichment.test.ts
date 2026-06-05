/**
 * Run: npx tsx lib/campaigns/normalize-profile-enrichment.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeApifyProfileEnrichmentItem } from "./normalize-profile-enrichment";

const FIXTURE = resolve(
  process.cwd(),
  "fixtures/apify/linkedin-profile-scraper/output.sample.json"
);

function run() {
  const items = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>[];
  const item = items[0]!;
  const normalized = normalizeApifyProfileEnrichmentItem(item);
  assert.ok(normalized);
  assert.equal(normalized!.enriched_employment_source, "profile_experience_current");
  assert.equal(normalized!.enriched_current_title, "Senior Software Engineer");
  assert.equal(normalized!.email, "alex.example@example-domain.test");

  const headlineOnly = normalizeApifyProfileEnrichmentItem({
    linkedinUrl: "https://www.linkedin.com/in/headline-only/",
    headline: "Director of Security at Example Corp",
    experiences: [],
  });
  assert.equal(headlineOnly!.enriched_employment_source, "headline_fallback");

  const currentPositions = normalizeApifyProfileEnrichmentItem({
    linkedinUrl: "https://www.linkedin.com/in/current-positions/",
    currentPositions: [{ title: "CISO", companyName: "Example Corp", isCurrent: true }],
  });
  assert.equal(currentPositions!.enriched_employment_source, "current_positions");

  const multi = normalizeApifyProfileEnrichmentItem({
    linkedinUrl: "https://www.linkedin.com/in/multi-current/",
    experiences: [
      { title: "Advisor", companyName: "A", endDate: null, isCurrent: true },
      { title: "CISO", companyName: "B", endDate: null, isCurrent: true },
    ],
  });
  assert.equal(multi!.current_experience_count, 2);
  assert.ok(multi!.enriched_employment_confidence <= 0.65);

  assert.equal(normalizeApifyProfileEnrichmentItem({}), null);
  assert.doesNotThrow(() => normalizeApifyProfileEnrichmentItem({ linkedinUrl: "x", experiences: [null] }));

  console.log("normalize-profile-enrichment.test.ts: ok");
}

run();
