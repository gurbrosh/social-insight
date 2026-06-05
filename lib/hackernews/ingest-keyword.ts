import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createManySkippingDuplicatesSqlite } from "@/lib/prisma-create-many-sqlite";
import { iterateSearchByDate } from "./algolia-client";
import { fetchItem } from "./firebase-item";
import { getAlgoliaHitItemType, normalizeAlgoliaHit } from "./normalize-hit";
import { syncCommentThemesForStories } from "./story-comment-themes-sync";

const INSERT_CHUNK = 100;

async function enrichCommentStoryContext(rows: Prisma.SourceMentionCreateManyInput[]) {
  const storyCache = new Map<string, Awaited<ReturnType<typeof fetchItem>>>();

  for (const row of rows) {
    if (row.item_type !== "comment" || !row.story_id) continue;

    const sid = row.story_id;
    if (!storyCache.has(sid)) {
      storyCache.set(sid, await fetchItem(sid));
    }
    const item = storyCache.get(sid);
    if (!item || item.type !== "story") continue;

    await prisma.sourceMention.updateMany({
      where: {
        source: "hackernews",
        keyword: row.keyword,
        source_item_id: row.source_item_id,
        deleted_at: null,
      },
      data: {
        story_title: item.title ?? null,
        story_url: item.url ?? null,
        story_score: item.score ?? null,
        story_descendants: item.descendants ?? null,
      },
    });
  }
}

export type IngestKeywordOptions = {
  keyword: string;
  createdAfterUnix: number;
  /** When true, fetch parent story via Firebase for comment rows (fills score, descendants, title, url). */
  enrich?: boolean;
  /**
   * When false, skip inserting Algolia comment hits (stories only).
   * Comment discussion is still captured via Firebase + `HnStoryCommentTheme` when theme sync runs.
   * Default true (legacy behavior).
   */
  storeCommentHits?: boolean;
  /**
   * Cap comment-theme sync after this ingest. Omit for all distinct HN stories in the batch.
   * Set to 0 to skip theme sync entirely.
   */
  maxCommentThemeSyncStories?: number;
  /** Stop Algolia paging / downstream work when aborted (admin test cancel). */
  signal?: AbortSignal;
};

/**
 * Story IDs for downstream HN analysis must match `SourceMention.story_id` (and exports that
 * GROUP BY / DISTINCT that column). For Algolia story hits, `story_id` is `hit.story_id ?? objectID`
 * while `source_item_id` is always `objectID`; when those differ, using only `source_item_id`
 * skipped analysis for rows that exports still count under `story_id`.
 */
function distinctStoryIdsFromRows(rows: Prisma.SourceMentionCreateManyInput[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.item_type === "story") {
      const sid = row.story_id?.trim();
      ids.push(sid && sid.length > 0 ? sid : String(row.source_item_id));
    } else if (row.item_type === "comment" && row.story_id) {
      ids.push(row.story_id);
    }
  }
  return [...new Set(ids)];
}

/**
 * Ingest all Algolia hits for one search keyword newer than `createdAfterUnix`.
 * Dedupes via DB unique (source, source_item_id, keyword).
 */
export async function ingestKeyword(
  opts: IngestKeywordOptions
): Promise<{ newestTimestamp: number; distinctStoryIds: string[] }> {
  const enrich = opts.enrich ?? false;
  const storeCommentHits = opts.storeCommentHits !== false;
  const maxCommentThemeSyncStories = opts.maxCommentThemeSyncStories;
  let newestTimestamp = opts.createdAfterUnix;
  const rows: Prisma.SourceMentionCreateManyInput[] = [];

  for await (const page of iterateSearchByDate({
    keyword: opts.keyword,
    createdAfterUnix: opts.createdAfterUnix,
    signal: opts.signal,
  })) {
    for (const hit of page.hits) {
      if (!storeCommentHits && getAlgoliaHitItemType(hit) === "comment") {
        const t = hit.created_at_i ?? opts.createdAfterUnix;
        if (t > newestTimestamp) newestTimestamp = t;
        continue;
      }
      rows.push(normalizeAlgoliaHit(hit, opts.keyword));
      const t = hit.created_at_i ?? opts.createdAfterUnix;
      if (t > newestTimestamp) newestTimestamp = t;
    }
  }

  await createManySkippingDuplicatesSqlite(prisma.sourceMention, rows, INSERT_CHUNK);

  if (enrich && rows.length > 0) {
    await enrichCommentStoryContext(rows);
  }

  const distinctStoryIds = distinctStoryIdsFromRows(rows);

  if (maxCommentThemeSyncStories !== 0 && rows.length > 0) {
    await syncCommentThemesForStories(distinctStoryIds, maxCommentThemeSyncStories, opts.signal);
  }

  return { newestTimestamp, distinctStoryIds };
}
