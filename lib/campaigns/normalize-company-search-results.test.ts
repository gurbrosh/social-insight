/**
 * Run: npx tsx lib/campaigns/normalize-company-search-results.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeApifyCompanyEmployeeItem,
  normalizeApifyCompanyEmployeeResults,
} from "./normalize-company-search-results";

function run() {
  const fixturePath = resolve(
    process.cwd(),
    "fixtures/apify/linkedin-company-employees/output.sample.json"
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>[];

  const row = normalizeApifyCompanyEmployeeItem(fixture[0]!);
  assert.ok(row);
  assert.equal(row!.employment_source, "current_positions");
  assert.equal(row!.current_title, "Senior Software Engineer");
  assert.equal(row!.current_company, "Example Corp");
  assert.equal(row!.source_types[0], "cold_company_search");

  const headlineOnly = normalizeApifyCompanyEmployeeItem({
    linkedinUrl: "https://www.linkedin.com/in/headline-only/",
    firstName: "Sam",
    lastName: "Test",
    summary: "Product Manager at Example Co",
  });
  assert.ok(headlineOnly);
  assert.equal(headlineOnly!.employment_source, "headline_fallback");

  const missing = normalizeApifyCompanyEmployeeItem({ name: "No URL" });
  assert.equal(missing, null);

  const batch = normalizeApifyCompanyEmployeeResults(fixture);
  assert.equal(batch.candidates.length, 1);

  console.log("normalize-company-search-results.test.ts: ok");
}

run();
