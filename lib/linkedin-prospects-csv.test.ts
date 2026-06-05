/**
 * Run: npx tsx lib/linkedin-prospects-csv.test.ts
 */
import assert from "node:assert/strict";
import { normalizePublicProfileUrl } from "./linkedin-prospects-csv/normalize-url";
import { deriveMergedSubjectFromBody } from "./linkedin-prospects-csv/row-text";
import { tryParseUtcDateParam } from "./linkedin-prospects-csv/utc-day";
import { getRollingWindowStart } from "./report-window";

function run() {
  assert.equal(
    normalizePublicProfileUrl("https://www.linkedin.com/in/jordan-chen-a1b2/"),
    "https://www.linkedin.com/in/jordan-chen-a1b2"
  );
  assert.equal(
    normalizePublicProfileUrl(
      "https://www.linkedin.com/in/JordanChen?trk=public_profile_browsemap"
    ),
    "https://www.linkedin.com/in/JordanChen"
  );
  assert.equal(
    normalizePublicProfileUrl("https://LinkedIn.com/in/jordanchen/"),
    "https://www.linkedin.com/in/jordanchen"
  );
  assert.equal(normalizePublicProfileUrl("https://www.linkedin.com/sales/lead/ABC123"), null);
  assert.equal(normalizePublicProfileUrl("not a url"), null);

  assert.equal(deriveMergedSubjectFromBody("Line one\n\nLine two")?.includes("Line one"), true);
  assert.equal(deriveMergedSubjectFromBody(""), null);

  assert.ok(tryParseUtcDateParam(null));
  assert.equal(tryParseUtcDateParam("2020-02-30"), null);
  assert.deepEqual(tryParseUtcDateParam("2020-01-15"), { year: 2020, month: 1, day: 15 });

  const fixed = new Date("2020-01-15T12:00:00.000Z");
  const w7 = getRollingWindowStart(7, "days", fixed);
  assert.ok(w7 < fixed);
  assert.equal(Math.round((fixed.getTime() - w7.getTime()) / 86400000), 7);

  console.log("linkedin-prospects-csv tests: ok");
}

run();
