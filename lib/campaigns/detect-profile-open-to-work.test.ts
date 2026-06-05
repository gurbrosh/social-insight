/**
 * Run: npx tsx lib/campaigns/detect-profile-open-to-work.test.ts
 */
import assert from "node:assert/strict";
import { detectProfileOpenToWork } from "./detect-profile-open-to-work";

function run() {
  const explicit = detectProfileOpenToWork({ openToWork: true });
  assert.equal(explicit.open_to_work_detection, "detected");
  assert.equal(explicit.open_to_work_source, "profile_enrichment");

  const notOtw = detectProfileOpenToWork({ isJobSeeker: false, openToWork: false });
  assert.equal(notOtw.open_to_work_detection, "not_detected");

  const unknown = detectProfileOpenToWork({ headline: "Engineer at Example Corp" });
  assert.equal(unknown.open_to_work_detection, "unknown");
  assert.equal(unknown.open_to_work_source, "unavailable");

  const weak = detectProfileOpenToWork({ headline: "Open to work — Security Engineer" });
  assert.equal(weak.open_to_work_detection, "detected");
  assert.equal(weak.open_to_work_source, "inferred_text_weak");

  console.log("detect-profile-open-to-work.test.ts: ok");
}

run();
