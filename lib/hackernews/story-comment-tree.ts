/**
 * Fetch HN comment threads for a story via Firebase, rank by structural engagement
 * (subtree size; Firebase does not expose per-comment scores).
 */

import { fetchItem } from "./firebase-item";
import type { HnFirebaseItem } from "./types";
import { stripHtmlToPlainText } from "@/lib/blog-news-analysis-service";

/** Max comment items to fetch per story (rate-limit / budget). */
export const HN_COMMENT_FETCH_BUDGET = 280;
/** Max top-level threads to pass to the summarizer. */
export const HN_TOP_THREADS_FOR_SUMMARY = 8;
/** Max characters of quoted thread text per top-level thread. */
export const HN_MAX_CHARS_PER_THREAD = 4000;

export type RankedCommentThread = {
  rootCommentId: number;
  /** Total nodes in subtree under this top-level comment (including the root). */
  subtreeNodes: number;
  /** Human-readable engagement explanation for the LLM. */
  engagementNote: string;
  /** Flattened excerpt of the thread for summarization. */
  excerpt: string;
};

function countsAsStructuralNode(item: HnFirebaseItem | null): item is NonNullable<HnFirebaseItem> {
  if (!item || item.type !== "comment") return false;
  if (item.deleted || item.dead) return false;
  return true;
}

function isUsableComment(item: HnFirebaseItem | null): item is NonNullable<HnFirebaseItem> {
  if (!countsAsStructuralNode(item)) return false;
  const t = (item.text && stripHtmlToPlainText(item.text)) || "";
  return t.trim().length >= 12;
}

/**
 * BFS-load comment items under a story up to HN_COMMENT_FETCH_BUDGET.
 * Returns map id -> item and the story's top-level kid ids (for ranking).
 */
export async function loadStoryCommentItems(storyId: string): Promise<{
  story: NonNullable<HnFirebaseItem>;
  topLevelKidIds: number[];
  byId: Map<number, HnFirebaseItem>;
} | null> {
  const story = await fetchItem(storyId);
  if (!story || story.type !== "story") {
    return null;
  }
  const topLevelKidIds = Array.isArray(story.kids)
    ? story.kids.filter((n) => typeof n === "number")
    : [];
  const byId = new Map<number, HnFirebaseItem>();

  const queue: number[] = [...topLevelKidIds];
  while (queue.length > 0 && byId.size < HN_COMMENT_FETCH_BUDGET) {
    const id = queue.shift();
    if (id === undefined || byId.has(id)) continue;
    const item = await fetchItem(String(id));
    if (!item || item.id === undefined) continue;
    const nid = Number(item.id);
    if (!Number.isFinite(nid)) continue;
    byId.set(nid, item);
    if (item.type === "comment" && Array.isArray(item.kids)) {
      for (const k of item.kids) {
        if (typeof k === "number" && byId.size < HN_COMMENT_FETCH_BUDGET) {
          queue.push(k);
        }
      }
    }
  }

  return { story, topLevelKidIds, byId };
}

function subtreeSize(rootId: number, byId: Map<number, HnFirebaseItem>): number {
  const visited = new Set<number>();
  const stack = [rootId];
  let count = 0;
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const item = byId.get(id);
    if (!item || !countsAsStructuralNode(item)) continue;
    count++;
    const kids = item.kids;
    if (Array.isArray(kids)) {
      for (const k of kids) {
        if (typeof k === "number" && byId.has(k)) stack.push(k);
      }
    }
  }
  return count;
}

function collectThreadExcerpt(
  rootId: number,
  byId: Map<number, HnFirebaseItem>,
  maxChars: number
): string {
  const lines: string[] = [];
  let total = 0;
  const walk = (id: number, depth: number) => {
    if (total >= maxChars) return;
    const item = byId.get(id);
    if (!item || !isUsableComment(item)) return;
    const author = item.by || "user";
    const text = stripHtmlToPlainText(item.text || "").trim();
    const pad = "  ".repeat(Math.min(depth, 8));
    const line = `${pad}${author}: ${text}`;
    if (total + line.length + 1 <= maxChars) {
      lines.push(line);
      total += line.length + 1;
    } else {
      return;
    }
    const kids = item.kids;
    if (Array.isArray(kids)) {
      for (const k of kids) {
        if (typeof k === "number") walk(k, depth + 1);
        if (total >= maxChars) return;
      }
    }
  };
  walk(rootId, 0);
  return lines.join("\n");
}

/**
 * Rank top-level comment threads by subtree size (number of substantive comments in the loaded map).
 */
export function rankTopLevelThreads(
  topLevelKidIds: number[],
  byId: Map<number, HnFirebaseItem>
): Array<{ rootId: number; size: number }> {
  const scored = topLevelKidIds
    .filter((id) => typeof id === "number")
    .map((rootId) => ({
      rootId,
      size: subtreeSize(rootId, byId),
    }))
    .filter((x) => x.size > 0)
    .sort((a, b) => b.size - a.size || a.rootId - b.rootId);
  return scored;
}

/**
 * Build ranked thread excerpts for the comments summarization LLM.
 */
export function buildRankedThreadsForSummary(
  topLevelKidIds: number[],
  byId: Map<number, HnFirebaseItem>,
  maxThreads = HN_TOP_THREADS_FOR_SUMMARY,
  maxCharsPerThread = HN_MAX_CHARS_PER_THREAD
): RankedCommentThread[] {
  const ranked = rankTopLevelThreads(topLevelKidIds, byId).slice(0, maxThreads);
  const out: RankedCommentThread[] = [];
  let position = 0;
  for (const { rootId, size } of ranked) {
    position++;
    const excerpt = collectThreadExcerpt(rootId, byId, maxCharsPerThread);
    if (!excerpt.trim()) continue;
    const engagementNote =
      size >= 2
        ? `Thread ${position}: ${size} substantive comments in this subtree under the story (within the fetched sample). Larger subtrees usually indicate more discussion branching.`
        : `Thread ${position}: ${size} substantive top-level comment (short thread).`;
    out.push({
      rootCommentId: rootId,
      subtreeNodes: size,
      engagementNote,
      excerpt,
    });
  }
  return out;
}

/**
 * Load story comments and return ranked threads for summarization (or empty if no comments loaded).
 */
export async function fetchRankedCommentThreadsForStory(storyId: string): Promise<{
  story: NonNullable<HnFirebaseItem> | null;
  threads: RankedCommentThread[];
  meta: { topLevelCount: number; fetchedCount: number };
  /** Comment items loaded for this story (same budget as ranking); use to materialize Post rows per comment. */
  commentItemsById: Map<number, HnFirebaseItem>;
}> {
  const loaded = await loadStoryCommentItems(storyId);
  if (!loaded) {
    return {
      story: null,
      threads: [],
      meta: { topLevelCount: 0, fetchedCount: 0 },
      commentItemsById: new Map(),
    };
  }
  const { story, topLevelKidIds, byId } = loaded;
  const threads = buildRankedThreadsForSummary(topLevelKidIds, byId);
  return {
    story,
    threads,
    meta: {
      topLevelCount: topLevelKidIds.length,
      fetchedCount: byId.size,
    },
    commentItemsById: byId,
  };
}
