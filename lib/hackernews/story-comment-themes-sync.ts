/**
 * After keyword ingest, persist one row per HN story with main comment-thread themes
 * (Firebase sample + same LLM as project HnStoryAnalysis comments_summary).
 */

import type { Prisma } from "@prisma/client";
import { summarizeHnCommentThreadsWithLLM } from "@/lib/hn-story-analysis-prompts";
import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import { throwIfAborted } from "@/lib/custom-tasks/task-test-abort";
import { fetchRankedCommentThreadsForStory } from "./story-comment-tree";

const DEFAULT_SYNC_CONCURRENCY = 10;
const MAX_SYNC_CONCURRENCY = 50;

/** Run async work on `items` with at most `concurrency` in flight (order of results matches `items`). */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export type SyncCommentThemesOptions = {
  /** Parallel stories (Firebase + LLM each). Default 10; capped at 50. Overrides env when set. */
  concurrency?: number;
};

/**
 * @param maxStories - If omitted, sync every distinct id. If 0, no-op. If positive, cap after dedupe.
 */
export async function syncCommentThemesForStories(
  storyIds: string[],
  maxStories?: number,
  signal?: AbortSignal,
  options?: SyncCommentThemesOptions
): Promise<void> {
  if (storyIds.length === 0) return;
  if (maxStories === 0) return;
  const deduped = [...new Set(storyIds)];
  const limited = maxStories === undefined ? deduped : deduped.slice(0, Math.max(0, maxStories));

  const envRaw = process.env.HN_COMMENT_THEME_SYNC_CONCURRENCY?.trim();
  const fromEnv = envRaw && envRaw !== "" ? Number.parseInt(envRaw, 10) : undefined;
  const concurrency = Math.max(
    1,
    Math.min(
      options?.concurrency ??
        (fromEnv != null && !Number.isNaN(fromEnv) ? fromEnv : DEFAULT_SYNC_CONCURRENCY),
      MAX_SYNC_CONCURRENCY
    )
  );

  await mapWithConcurrency(limited, concurrency, async (id) => {
    throwIfAborted(signal);
    try {
      await syncCommentThemesForOneStory(id);
    } catch (e) {
      console.warn(`[HN] comment themes sync failed story=${id}`, e);
    }
  });
}

async function syncCommentThemesForOneStory(storyId: string): Promise<void> {
  const { story, threads, meta } = await fetchRankedCommentThreadsForStory(storyId);
  if (!story) {
    return;
  }

  const title = story.title ?? null;
  const storyUrl = story.url?.trim() || `https://news.ycombinator.com/item?id=${storyId}`;
  const storyPostedAt = typeof story.time === "number" ? new Date(story.time * 1000) : null;

  let summary: string | null = null;
  if (threads.length > 0) {
    summary = await summarizeHnCommentThreadsWithLLM({ storyTitle: title, threads });
  }

  const metaJson: Prisma.InputJsonValue = {
    topLevelCount: meta.topLevelCount,
    fetchedCount: meta.fetchedCount,
    threadCount: threads.length,
  };

  await prisma.hnStoryCommentTheme.upsert({
    where: { hn_story_id: storyId },
    create: {
      id: generateId(),
      hn_story_id: storyId,
      story_url: storyUrl,
      story_title: title,
      story_posted_at: storyPostedAt,
      comment_themes_summary: summary,
      meta: metaJson,
    },
    update: {
      story_url: storyUrl,
      story_title: title,
      story_posted_at: storyPostedAt,
      comment_themes_summary: summary,
      meta: metaJson,
    },
  });
}
