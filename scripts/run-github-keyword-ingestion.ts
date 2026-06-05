import "dotenv/config";

import {
  loadGithubRunOptionsFromEnv,
  runGithubIngestion,
} from "../lib/github/run-github-ingestion";

async function main() {
  const options = loadGithubRunOptionsFromEnv();
  if (options.canonicalKeywords.length === 0) {
    console.log(
      "[gh-ingest] No keywords configured. Set GH_INGEST_KEYWORDS (comma-separated), e.g. GH_INGEST_KEYWORDS=security,agents"
    );
    process.exit(0);
  }

  if (!process.env.GITHUB_TOKEN?.trim()) {
    console.error("[gh-ingest] GITHUB_TOKEN is required.");
    process.exit(1);
  }

  console.log(
    `[gh-ingest] Starting: keywords=${options.canonicalKeywords.join(",")} modes=${options.modes.join(",")} enrich=${options.enrichRepos} codeLookbackDays=${options.codeLookbackDays}`
  );

  const summary = await runGithubIngestion(options);

  for (const r of summary.results) {
    console.log(
      `[gh-ingest] canonical=${JSON.stringify(r.canonical)} mode=${r.mode} variants=${JSON.stringify(r.variants)} floor=${r.floor || "(empty)"} newCursor=${r.newCursor}`
    );
  }

  console.log("[gh-ingest] Done.");
}

main().catch((e) => {
  console.error("[gh-ingest] Fatal:", e);
  process.exit(1);
});
