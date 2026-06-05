import { prisma } from "@/lib/prisma";
import { envTruthy, expandVariants, loadKeywordVariants, parseCanonicalKeywords } from "./config";
import { ingestKeyword } from "./ingest-keyword";

export type RunHnIngestionOptions = {
  /** Canonical keywords (e.g. from HN_INGEST_KEYWORDS). */
  canonicalKeywords: string[];
  variantsMap: Record<string, string[]>;
  enrich: boolean;
  /** When false, keyword ingest stores story hits only (not Algolia comment hits). Default true. */
  storeCommentHits?: boolean;
  /** Cap Firebase+LLM comment-theme sync per variant batch; omit = all stories in batch; 0 = off. */
  maxCommentThemeSyncStories?: number;
};

export type RunHnIngestionSummary = {
  canonicalKeywords: string[];
  results: {
    canonical: string;
    variants: string[];
    maxNewestTimestamp: number;
    floor: number;
  }[];
};

/**
 * For each canonical keyword: load cursor, run all variant queries with the same floor,
 * persist max timestamp across variants on the canonical cursor row.
 */
export async function runHnIngestion(
  options: RunHnIngestionOptions
): Promise<RunHnIngestionSummary> {
  const results: RunHnIngestionSummary["results"] = [];

  for (const canonical of options.canonicalKeywords) {
    const variants = expandVariants(canonical, options.variantsMap);
    const cursor = await prisma.hnKeywordIngestCursor.findFirst({
      where: { keyword: canonical, deleted_at: null },
    });
    const floor = cursor?.last_success_unix ?? 0;
    let maxNewestTimestamp = floor;

    for (const variant of variants) {
      const { newestTimestamp } = await ingestKeyword({
        keyword: variant,
        createdAfterUnix: floor,
        enrich: options.enrich,
        storeCommentHits: options.storeCommentHits,
        maxCommentThemeSyncStories: options.maxCommentThemeSyncStories,
      });
      if (newestTimestamp > maxNewestTimestamp) {
        maxNewestTimestamp = newestTimestamp;
      }
    }

    await prisma.hnKeywordIngestCursor.upsert({
      where: { keyword: canonical },
      create: {
        keyword: canonical,
        last_success_unix: maxNewestTimestamp,
      },
      update: {
        last_success_unix: maxNewestTimestamp,
        deleted_at: null,
      },
    });

    results.push({
      canonical,
      variants,
      maxNewestTimestamp,
      floor,
    });
  }

  return {
    canonicalKeywords: options.canonicalKeywords,
    results,
  };
}

function envFalsy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no";
}

/**
 * Load options from process.env (HN_INGEST_KEYWORDS, HN_KEYWORD_VARIANTS_JSON, HN_ENRICH_STORIES,
 * HN_INGEST_ALGOLIA_COMMENTS, HN_COMMENT_THEME_SYNC_MAX).
 */
export function loadRunOptionsFromEnv(): RunHnIngestionOptions {
  const canonicalKeywords = parseCanonicalKeywords(process.env.HN_INGEST_KEYWORDS);
  const variantsMap = loadKeywordVariants(process.env.HN_KEYWORD_VARIANTS_JSON);
  const enrich = envTruthy(process.env.HN_ENRICH_STORIES);
  const storeCommentHits = !envFalsy("HN_INGEST_ALGOLIA_COMMENTS");
  const rawMax = process.env.HN_COMMENT_THEME_SYNC_MAX?.trim();
  const maxCommentThemeSyncStories =
    rawMax === undefined || rawMax === ""
      ? undefined
      : Math.max(0, Number.parseInt(rawMax, 10) || 0);
  return {
    canonicalKeywords,
    variantsMap,
    enrich,
    storeCommentHits,
    maxCommentThemeSyncStories,
  };
}
