import type { Prisma } from "@prisma/client";
import type { AlgoliaHit } from "./types";

const SOURCE = "hackernews";

function hnItemUrl(id: string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

/** Algolia hit type for ingest filtering (stories vs comments). */
export function getAlgoliaHitItemType(hit: AlgoliaHit): "story" | "comment" {
  return hit._tags?.includes("comment") ? "comment" : "story";
}

function toStr(n: number | undefined | null): string | null {
  if (n === undefined || n === null) return null;
  return String(n);
}

/**
 * Map Algolia search_by_date hit → SourceMention create row (keyword = query string used for this ingest).
 */
export function normalizeAlgoliaHit(
  hit: AlgoliaHit,
  keyword: string
): Prisma.SourceMentionCreateManyInput {
  const itemType = getAlgoliaHitItemType(hit);
  const objectId = String(hit.objectID);

  let title: string | null = hit.title ?? null;
  let body: string | null = null;
  let url: string | null = hit.url ?? null;
  let storyId: string | null = null;
  let parentId: string | null = toStr(hit.parent_id);

  if (itemType === "comment") {
    title = hit.story_title ?? null;
    body = hit.comment_text ?? null;
    storyId = hit.story_id != null ? String(hit.story_id) : null;
    const u = url?.trim();
    url = u || hit.story_url?.trim() || hnItemUrl(objectId);
  } else {
    body = hit.story_text ?? null;
    storyId = hit.story_id != null ? String(hit.story_id) : objectId;
    parentId = null;
    url = url?.trim() ? url : hnItemUrl(objectId);
  }

  const publishedAt =
    hit.created_at != null
      ? new Date(hit.created_at)
      : hit.created_at_i != null
        ? new Date(hit.created_at_i * 1000)
        : null;

  const storyScore = itemType === "story" ? (hit.points ?? null) : null;
  const storyDescendants = itemType === "story" ? (hit.num_comments ?? null) : null;

  return {
    source: SOURCE,
    keyword,
    source_item_id: objectId,
    item_type: itemType,
    author: hit.author ?? null,
    title,
    body,
    url,
    published_at: publishedAt,
    published_at_unix: hit.created_at_i ?? null,
    story_id: storyId,
    parent_id: parentId,
    story_title: hit.story_title ?? null,
    story_url: hit.story_url ?? null,
    story_score: storyScore,
    story_descendants: storyDescendants,
    raw_payload: hit as unknown as Prisma.InputJsonValue,
  };
}
