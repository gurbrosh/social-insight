import "dotenv/config";

import { loadRunOptionsFromEnv, runHnIngestion } from "../lib/hackernews/run-hn-ingestion";

async function main() {
  const options = loadRunOptionsFromEnv();
  if (options.canonicalKeywords.length === 0) {
    console.log(
      "[hn-ingest] No keywords configured. Set HN_INGEST_KEYWORDS (comma-separated), e.g. HN_INGEST_KEYWORDS=security,agents"
    );
    process.exit(0);
  }

  console.log(
    `[hn-ingest] Starting: keywords=${options.canonicalKeywords.join(",")} enrich=${options.enrich}`
  );

  const summary = await runHnIngestion(options);

  for (const r of summary.results) {
    console.log(
      `[hn-ingest] canonical=${JSON.stringify(r.canonical)} variants=${JSON.stringify(r.variants)} floor=${r.floor} maxNewest=${r.maxNewestTimestamp}`
    );
  }

  console.log("[hn-ingest] Done.");
}

main().catch((e) => {
  console.error("[hn-ingest] Fatal:", e);
  process.exit(1);
});
