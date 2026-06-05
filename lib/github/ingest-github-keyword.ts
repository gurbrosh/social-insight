import { enrichRepoMetadataForFullNames, type GithubEnrichPostContext } from "./enrich-repo";
import {
  filterGithubRowsAgainstSeenRepos,
  recordGithubRepoIdsFromRawRows,
} from "./ingest-run-dedupe";
import { collectCodeSignals } from "./search-code";
import { collectRepositorySignals } from "./search-repositories";
import { upsertGithubSignals } from "./upsert-github-signals";

const INSERT_CHUNK = 100;

export type GithubIngestMode = "repo" | "code" | "activity";

export type IngestGithubKeywordArgs = {
  keyword: string;
  mode: GithubIngestMode;
  cursor: string;
  enrichRepos?: boolean;
  codeLookbackDays?: number;
  /** 1–10 per GitHub Search API. Omit for default (10). */
  maxSearchPages?: number;
  /**
   * GitHub repository ids (numeric as string) already returned earlier in this task run.
   * Rows for those repos are skipped before upsert; raw results are still recorded so we do not
   * drop multiple code hits from the same repo within one keyword.
   */
  seenGithubRepoIdsInRun?: Set<string>;
  /**
   * When enrichment runs, also upsert `Post` rows (platform `github`) for this project.
   * Omit for CLI/env ingestion without a project scope.
   */
  postContext?: GithubEnrichPostContext;
};

/**
 * Ingest one keyword variant for a given mode; returns new cursor value to persist (per canonical+mode).
 */
export async function ingestGithubKeyword(
  args: IngestGithubKeywordArgs
): Promise<{ newCursor: string }> {
  const { keyword, mode, cursor } = args;
  const maxPagesLabel = args.maxSearchPages != null ? String(args.maxSearchPages) : "default(10)";

  if (mode === "activity") {
    return { newCursor: cursor };
  }

  console.log(
    `[github-ingest] start mode=${mode} keyword=${JSON.stringify(keyword)} maxSearchPages=${maxPagesLabel} enrichRepos=${args.enrichRepos === true}`
  );

  if (mode === "repo") {
    const { rows: rawRows, maxUpdatedIso } = await collectRepositorySignals(keyword, cursor, {
      maxPages: args.maxSearchPages,
    });
    const rows = filterGithubRowsAgainstSeenRepos(rawRows, args.seenGithubRepoIdsInRun);
    recordGithubRepoIdsFromRawRows(rawRows, args.seenGithubRepoIdsInRun);
    await upsertGithubSignals(rows, INSERT_CHUNK);
    console.log(
      `[github-ingest] repo search upserted ${rows.length} row(s) for keyword=${JSON.stringify(keyword)} (after dedupe)`
    );
    if (args.enrichRepos && rows.length > 0) {
      console.log(
        `[github-ingest] starting enrichment for ${rows.length} repo row(s) keyword=${JSON.stringify(keyword)}`
      );
      await enrichRepoMetadataForFullNames(
        rows.map((r) => r.repo_full_name),
        args.postContext
      );
      console.log(`[github-ingest] enrichment finished keyword=${JSON.stringify(keyword)}`);
    }
    return { newCursor: maxUpdatedIso };
  }

  const lookback =
    args.codeLookbackDays ?? (parseInt(process.env.GH_CODE_LOOKBACK_DAYS || "7", 10) || 7);

  const { rows: rawRows, completedAtIso } = await collectCodeSignals(keyword, lookback, {
    maxPages: args.maxSearchPages,
  });
  const rows = filterGithubRowsAgainstSeenRepos(rawRows, args.seenGithubRepoIdsInRun);
  recordGithubRepoIdsFromRawRows(rawRows, args.seenGithubRepoIdsInRun);
  await upsertGithubSignals(rows, INSERT_CHUNK);
  console.log(
    `[github-ingest] code search upserted ${rows.length} row(s) keyword=${JSON.stringify(keyword)} lookbackDays=${lookback}`
  );

  return { newCursor: completedAtIso };
}
