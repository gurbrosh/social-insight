/**
 * Run: npx tsx lib/prospect-intelligence/random-sample-open-to-work.test.ts
 *
 * Simulates a 300-profile random draw from a pool of 301 distinct URLs; the extra profile has a
 * visible Open-to-Work headline. Asserts the merged export (random batch + guarantee) always
 * includes that OTW row and writes a small CSV under os.tmpdir() for inspection.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProspectDeterministic } from "./classify";
import { gatherProspectEvidence } from "./gather-evidence";
import { appendMissingOpenToWorkFromPool, seedRng, shuffleInPlace } from "./random-sample-seeded";

type PoolRow = {
  profile_url: string;
  open_to_work_status: string;
  headline: string;
};

function classifyUrl(profileUrl: string, headline: string, post = "Thread comment.") {
  const ev = gatherProspectEvidence({
    headline,
    authorDisplayName: "Synthetic Tester",
    postContent: post,
    postUrl: "https://www.linkedin.com/posts/example-123",
    platform: "linkedin",
  });
  const c = classifyProspectDeterministic(ev, { linkedinUrl: profileUrl });
  return {
    profile_url: profileUrl,
    open_to_work_status: c.openToWorkDetection?.status ?? "",
    headline,
  };
}

function escCsv(v: string): string {
  const s = v.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function run() {
  const otwUrl = "https://www.linkedin.com/in/synthetic-open-to-work-profile-z9";
  const pool: PoolRow[] = [];
  for (let i = 0; i < 300; i++) {
    pool.push(
      classifyUrl(
        `https://www.linkedin.com/in/synthetic-random-${i}-a1b2c3`,
        `Platform Engineer ${i} at Example Corp`
      )
    );
  }
  pool.push(classifyUrl(otwUrl, "#OpenToWork | Software Engineer"));

  assert.equal(new Set(pool.map((p) => p.profile_url)).size, pool.length, "pool profile_urls are unique");

  const rnd = seedRng(20260515);
  const order = [...pool];
  shuffleInPlace(order, rnd);

  const randomDraw = order.slice(0, 300);
  assert.equal(new Set(randomDraw.map((r) => r.profile_url)).size, 300, "random batch has 300 unique URLs");

  const merged = appendMissingOpenToWorkFromPool(randomDraw, pool);
  const otwRows = merged.filter((r) => r.open_to_work_status && r.open_to_work_status !== "not_observed");
  assert.ok(otwRows.length >= 1, "at least one open-to-work row must appear after guarantee merge");
  assert.ok(
    merged.some((r) => r.profile_url === otwUrl && r.open_to_work_status === "text_signal_detected"),
    "synthetic OTW profile must be present with text_signal_detected (headline hashtag = text, not public badge)"
  );

  const uniqueOut = new Set(merged.map((m) => m.profile_url));
  assert.equal(uniqueOut.size, merged.length, "output rows must not duplicate profile_url");

  const outDir = join(tmpdir(), "social-insight-prospect-tests");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "random-300-open-to-work-sample.csv");
  const lines = [
    ["profile_url", "headline", "open_to_work_status"].join(","),
    ...merged.map((r) => [escCsv(r.profile_url), escCsv(r.headline), escCsv(r.open_to_work_status)].join(",")),
  ];
  await writeFile(outPath, lines.join("\n"), "utf8");

  console.log(`random-sample-open-to-work tests: ok (wrote ${merged.length} rows to ${outPath})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
