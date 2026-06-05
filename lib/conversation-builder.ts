/**
 * Conversation thread builder - shared logic for identifying conversation threads
 * from posts. Used by both analysis (identifyConversationThreads) and
 * materialization (Conversation table). Platform-specific matching: Reddit/X/LinkedIn/YouTube
 * (threadRefId), Facebook (story_fbid), Hacker News (Firebase story id vs synthetic root postId),
 * Discord (reply forest per channel + scrape scope: job_id or ingested_run_id or legacy bucket).
 */

import { prisma } from "@/lib/prisma";
import { extractYouTubeVideoIdFromUrl } from "@/lib/data-transformer";
import type { Prisma } from "@prisma/client";

export type PostForThread = {
  id: number;
  postId: string;
  platform: string;
  authorId?: string | null;
  authorName?: string | null;
  content?: string | null;
  createdAt: Date;
  url?: string | null;
  threadRefId?: string | null;
  channelId?: string | null;
  metricsLikes?: number | null;
  metricsComments?: number | null;
  metricsShares?: number | null;
  language?: string | null;
  /** Scrape job id when ingested from a job; used with ingested_run_id to partition Discord graphs. */
  job_id?: string | null;
  ingested_run_id?: string | null;
};

export interface ConversationThread {
  rootPost: PostForThread;
  replies: PostForThread[];
  participants: Set<string>;
  totalEngagement: number;
}

export interface BuildThreadsBounds {
  minPostIdExclusive?: number;
  maxPostIdInclusive?: number;
}

const isFacebookPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "facebook";

const isHackerNewsPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "hackernews";

/**
 * HN story analysis stores synthetic roots as `${storyId}--idea-N`, `${storyId}--summary`, etc.
 * Firebase comments use threadRefId = story item id (numeric string) for top-level replies.
 */
export function extractHnStoryIdFromSyntheticRootPostId(
  postId: string | null | undefined
): string | null {
  if (postId == null) return null;
  const s = String(postId).trim();
  const m = /^(\d+)(?:--|$)/.exec(s);
  if (m?.[1]) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

function pickCanonicalHnRoot(group: PostForThread[]): PostForThread {
  if (group.length <= 1) return group[0];
  const summary = group.find((g) => String(g.postId).includes("--summary"));
  if (summary) return summary;
  const withIdeaNum = group.map((g) => {
    const m = String(g.postId).match(/--idea-(\d+)$/);
    return { p: g, n: m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER };
  });
  withIdeaNum.sort((a, b) => a.n - b.n || a.p.id - b.p.id);
  return withIdeaNum[0].p;
}

function dedupeHackerNewsRoots(roots: PostForThread[]): PostForThread[] {
  const nonHn: PostForThread[] = [];
  const hn: PostForThread[] = [];
  for (const r of roots) {
    if (isHackerNewsPlatform(r.platform)) hn.push(r);
    else nonHn.push(r);
  }
  if (hn.length === 0) return roots;

  const byStory = new Map<string, PostForThread[]>();
  const orphans: PostForThread[] = [];
  for (const r of hn) {
    const sid = extractHnStoryIdFromSyntheticRootPostId(r.postId);
    if (!sid) {
      orphans.push(r);
      continue;
    }
    if (!byStory.has(sid)) byStory.set(sid, []);
    byStory.get(sid)!.push(r);
  }
  const canonical: PostForThread[] = [];
  for (const [, group] of byStory) {
    canonical.push(pickCanonicalHnRoot(group));
  }
  return [...nonHn, ...canonical, ...orphans];
}

function normalizeLinkedInId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.includes(":activity:")) {
    return id.split(":activity:")[1] || id;
  }
  if (id.includes(":ugcPost:")) {
    return id.split(":ugcPost:")[1] || id;
  }
  return id;
}

function addParticipant(set: Set<string>, id?: string | null, name?: string | null): void {
  const key = (id ?? name)?.toString()?.trim();
  if (key) set.add(key);
}

const isDiscordPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "discord";

/**
 * Partition key: same channel + same ingest scope so unrelated scrapes do not merge into one graph.
 * Prefer job_id, then orchestration run id, then a legacy bucket for older rows.
 */
function discordPartitionScopeKey(p: PostForThread): string {
  const job = p.job_id?.trim();
  if (job) return job;
  const run = p.ingested_run_id?.trim();
  if (run) return run;
  return "__legacy__";
}

/**
 * Walk parent pointers within a partition; missing parent or cycle → canonical root (min postId in cycle).
 */
export function findDiscordPartitionRoot(
  p: PostForThread,
  postById: Map<string, PostForThread>
): PostForThread {
  let cur: PostForThread | undefined = p;
  const path: PostForThread[] = [];
  const indexInPath = new Map<string, number>();
  while (cur) {
    const id = String(cur.postId);
    if (indexInPath.has(id)) {
      const cycleStart = indexInPath.get(id)!;
      const cycle = path.slice(cycleStart);
      return cycle.reduce((a, b) => (String(a.postId) < String(b.postId) ? a : b));
    }
    indexInPath.set(id, path.length);
    path.push(cur);
    const ref = cur.threadRefId?.trim();
    if (!ref || !postById.has(ref)) return cur;
    cur = postById.get(ref);
  }
  return p;
}

function discordDescendantsInBfsOrder(
  root: PostForThread,
  members: PostForThread[]
): PostForThread[] {
  const result: PostForThread[] = [];
  const visited = new Set<string>([String(root.postId)]);
  const queue: string[] = [String(root.postId)];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    const children = members
      .filter((p) => p.threadRefId?.trim() === pid && !visited.has(String(p.postId)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const c of children) {
      visited.add(String(c.postId));
      result.push(c);
      queue.push(String(c.postId));
    }
  }
  return result;
}

function buildDiscordForestInPartition(partitionPosts: PostForThread[]): ConversationThread[] {
  if (partitionPosts.length === 0) return [];
  const postById = new Map<string, PostForThread>(partitionPosts.map((p) => [String(p.postId), p]));
  const groups = new Map<string, PostForThread[]>();
  for (const p of partitionPosts) {
    const root = findDiscordPartitionRoot(p, postById);
    const rk = String(root.postId);
    if (!groups.has(rk)) groups.set(rk, []);
    groups.get(rk)!.push(p);
  }

  const threads: ConversationThread[] = [];
  for (const [rootKey, group] of groups) {
    const root = postById.get(rootKey)!;
    const replies = discordDescendantsInBfsOrder(root, group);
    const participants = new Set<string>();
    group.forEach((p) => addParticipant(participants, p.authorId, p.authorName));
    const totalEngagement = group.reduce(
      (sum, p) => sum + (p.metricsLikes || 0) + (p.metricsComments || 0) + (p.metricsShares || 0),
      0
    );
    threads.push({
      rootPost: root,
      replies,
      participants,
      totalEngagement,
    });
  }
  return threads;
}

/**
 * One ConversationThread per reply tree in this Discord post set (partitioned by channel + scrape scope).
 */
export function buildDiscordReplyForestThreads(
  discordPosts: PostForThread[]
): ConversationThread[] {
  if (discordPosts.length === 0) return [];
  const byPartition = new Map<string, PostForThread[]>();
  for (const p of discordPosts) {
    const channel = p.channelId?.trim() || "__no_channel__";
    const scope = discordPartitionScopeKey(p);
    const key = `${channel}\0${scope}`;
    if (!byPartition.has(key)) byPartition.set(key, []);
    byPartition.get(key)!.push(p);
  }
  const out: ConversationThread[] = [];
  for (const [, partitionPosts] of byPartition) {
    out.push(...buildDiscordForestInPartition(partitionPosts));
  }
  return out;
}

/**
 * Build conversation threads for a project using existing platform logic.
 * Same logic as identifyConversationThreads - shared source of truth.
 *
 * Bounds are strict: do **not** extend `maxPostIdInclusive` to the latest post in the project.
 * Doing so previously loaded nearly every row and caused multi‑GB heap OOM on large projects.
 */
export async function buildConversationThreads(
  projectId: string,
  bounds?: BuildThreadsBounds
): Promise<ConversationThread[]> {
  const maxPostIdInclusive = bounds?.maxPostIdInclusive;

  const postSelect = {
    id: true,
    postId: true,
    platform: true,
    authorId: true,
    authorName: true,
    content: true,
    createdAt: true,
    url: true,
    threadRefId: true,
    channelId: true,
    metricsLikes: true,
    metricsComments: true,
    metricsShares: true,
    language: true,
    job_id: true,
    ingested_run_id: true,
  } satisfies Prisma.PostSelect;

  const posts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      content: { not: null },
      id: {
        gt: bounds?.minPostIdExclusive ?? 0,
        ...(maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
      },
    },
    select: postSelect,
    orderBy: { createdAt: "asc" },
  });

  return buildThreadsFromPosts(
    projectId,
    posts as PostForThread[],
    bounds?.minPostIdExclusive ?? 0
  );
}

const THREAD_CLOSURE_POST_SELECT = {
  id: true,
  postId: true,
  platform: true,
  authorId: true,
  authorName: true,
  content: true,
  createdAt: true,
  url: true,
  threadRefId: true,
  channelId: true,
  metricsLikes: true,
  metricsComments: true,
  metricsShares: true,
  language: true,
  job_id: true,
  ingested_run_id: true,
} satisfies Prisma.PostSelect;

/** Prisma + SQLite: `IN (...)` size is capped (P2029); `not: null` filters block server-side query splitting. */
const THREAD_CLOSURE_SEED_ID_CHUNK = 250;

/**
 * Load threads for specific DB post ids only (plus graph expansion via postId/threadRefId).
 * Used by task-based theme runs so we never scan `min(id)…max(id)` (sparse ids + huge projects caused heap OOM).
 */
async function loadPostsForThreadClosure(
  projectId: string,
  seedIds: number[]
): Promise<PostForThread[]> {
  const unique = [...new Set(seedIds)].filter((id) => Number.isFinite(id) && id > 0);
  if (unique.length === 0) return [];

  const collected = new Map<number, PostForThread>();
  const addRows = (rows: PostForThread[]) => {
    for (const r of rows) {
      if (!collected.has(r.id)) collected.set(r.id, r);
    }
  };

  for (let i = 0; i < unique.length; i += THREAD_CLOSURE_SEED_ID_CHUNK) {
    const chunk = unique.slice(i, i + THREAD_CLOSURE_SEED_ID_CHUNK);
    const rows = await prisma.post.findMany({
      where: {
        project_id: projectId,
        id: { in: chunk },
        content: { not: null },
      },
      select: THREAD_CLOSURE_POST_SELECT,
    });
    addRows(rows as PostForThread[]);
  }
  if (collected.size === 0) return [];

  const MAX_TOTAL = 8_000;
  const MAX_ROUNDS = 16;
  const KEY_CHUNK = 100;

  for (let round = 0; round < MAX_ROUNDS && collected.size < MAX_TOTAL; round++) {
    const keys = new Set<string>();
    for (const p of collected.values()) {
      const pid = p.postId?.trim();
      if (pid) keys.add(pid);
      const ref = p.threadRefId?.trim();
      if (ref) keys.add(ref);
    }
    if (keys.size === 0) break;

    const keyArr = [...keys];
    const knownBefore = collected.size;
    for (let i = 0; i < keyArr.length; i += KEY_CHUNK) {
      const chunk = keyArr.slice(i, i + KEY_CHUNK);
      const rows = await prisma.post.findMany({
        where: {
          project_id: projectId,
          content: { not: null },
          OR: [{ postId: { in: chunk } }, { threadRefId: { in: chunk } }],
        },
        select: THREAD_CLOSURE_POST_SELECT,
        take: Math.min(6000, MAX_TOTAL - collected.size + 50),
      });
      addRows(rows as PostForThread[]);
      if (collected.size >= MAX_TOTAL) break;
    }
    if (collected.size === knownBefore) break;
  }

  if (collected.size >= MAX_TOTAL) {
    console.warn(
      `[conversation-builder] Thread closure for project=${projectId} hit cap=${MAX_TOTAL} posts; theme/thread context may be truncated.`
    );
  }

  return Array.from(collected.values());
}

/**
 * Build conversation threads for a bounded set of post ids (task-based analysis).
 * Avoids id-range scans that load most of a large project into memory.
 */
export async function buildConversationThreadsForPostIds(
  projectId: string,
  postIds: number[]
): Promise<ConversationThread[]> {
  const posts = await loadPostsForThreadClosure(projectId, postIds);
  if (posts.length === 0) return [];
  return buildThreadsFromPosts(projectId, posts, 1);
}

/**
 * Build threads from a pre-loaded post array. Used by materializer when posts are already loaded.
 */
export async function buildThreadsFromPosts(
  projectId: string,
  posts: PostForThread[],
  minId: number = 0
): Promise<ConversationThread[]> {
  const nonDiscordPosts = posts.filter((p) => !isDiscordPlatform(p.platform));
  const discordPosts = posts.filter((p) => isDiscordPlatform(p.platform));

  let rootPosts = nonDiscordPosts.filter((p) => !p.threadRefId);
  const replies = nonDiscordPosts.filter((p) => p.threadRefId);

  if (minId > 0 && replies.length > 0) {
    const missingPairs: Array<{ platform: string; postId: string }> = [];
    const seen = new Set<string>();
    for (const r of replies) {
      if (!r.threadRefId) continue;
      const refTrimmed = String(r.threadRefId).trim();
      const platformLower = (r.platform || "").toLowerCase();
      const normalizedRef =
        platformLower === "youtube"
          ? extractYouTubeVideoIdFromUrl(refTrimmed) || refTrimmed
          : refTrimmed;
      const key = `${platformLower}|${normalizedRef}`;
      if (seen.has(key)) continue;
      const hasRoot = rootPosts.some((root) => {
        if ((root.platform || "").toLowerCase() !== platformLower) return false;
        const rootId = String(root.postId).trim();
        if (normalizedRef === rootId) return true;
        if (platformLower === "youtube") {
          const rootVideoId = extractYouTubeVideoIdFromUrl(rootId) || rootId;
          return normalizedRef === rootVideoId;
        }
        if (platformLower === "hackernews") {
          const sid = extractHnStoryIdFromSyntheticRootPostId(rootId);
          if (sid && normalizedRef === sid) return true;
        }
        return false;
      });
      if (!hasRoot) {
        seen.add(key);
        missingPairs.push({ platform: r.platform || "unknown", postId: normalizedRef });
      }
    }
    if (missingPairs.length > 0) {
      const orConditions: Prisma.PostWhereInput[] = missingPairs.flatMap(({ platform, postId }) => {
        const plat = (platform || "").toLowerCase();
        if (plat === "youtube" && postId && postId.length >= 11) {
          return [
            { platform: "youtube", postId },
            { platform: "youtube", postId: { contains: postId } },
          ];
        }
        return [{ platform, postId }];
      });
      const fetched = await prisma.post.findMany({
        where: {
          project_id: projectId,
          content: { not: null },
          threadRefId: null,
          OR: orConditions,
        },
        select: {
          id: true,
          postId: true,
          platform: true,
          authorId: true,
          authorName: true,
          content: true,
          createdAt: true,
          url: true,
          threadRefId: true,
          channelId: true,
          metricsLikes: true,
          metricsComments: true,
          metricsShares: true,
          language: true,
          job_id: true,
          ingested_run_id: true,
        },
      });
      if (fetched.length > 0) {
        const seenMap = new Map<string, (typeof fetched)[0]>();
        for (const p of rootPosts) {
          const key =
            (p.platform || "").toLowerCase() === "youtube"
              ? `youtube|${extractYouTubeVideoIdFromUrl(String(p.postId)) || p.postId}`
              : `${(p.platform || "").toLowerCase()}|${p.postId}`;
          seenMap.set(key, p as (typeof fetched)[0]);
        }
        for (const p of fetched) {
          const key =
            (p.platform || "").toLowerCase() === "youtube"
              ? `youtube|${extractYouTubeVideoIdFromUrl(String(p.postId)) || p.postId}`
              : `${(p.platform || "").toLowerCase()}|${p.postId}`;
          if (!seenMap.has(key)) seenMap.set(key, p);
        }
        rootPosts = Array.from(seenMap.values()) as PostForThread[];
      }
    }
  }

  rootPosts = dedupeHackerNewsRoots(rootPosts);

  const postMap = new Map(nonDiscordPosts.map((p) => [String(p.postId), p]));
  const cyclicPostIds = new Set<string>();
  const threads: ConversationThread[] = [];

  for (const root of rootPosts) {
    let rootStoryFbid: string | null = null;
    if (isFacebookPlatform(root.platform) && root.url) {
      const queryMatch = root.url.match(/[?&]story_fbid=([^&]+)/);
      if (queryMatch && queryMatch[1]) {
        rootStoryFbid = queryMatch[1];
      } else {
        const pathMatch = root.url.match(/\/(?:posts|reel|permalink\.php)\/(pfbid[a-zA-Z0-9]+)/);
        if (pathMatch && pathMatch[1]) rootStoryFbid = pathMatch[1];
      }
    }
    const normalizedRootPostId = normalizeLinkedInId(root.postId);
    const hnStoryId = isHackerNewsPlatform(root.platform)
      ? extractHnStoryIdFromSyntheticRootPostId(root.postId)
      : null;

    const threadReplies = replies.filter((reply) => {
      if (!reply.threadRefId) return false;
      if (reply.postId && cyclicPostIds.has(reply.postId)) return false;

      if (reply.threadRefId === root.postId) return true;
      const rootPlatformLower = root.platform.toLowerCase();
      if (rootPlatformLower === "youtube" && root.postId != null && reply.threadRefId != null) {
        const rootVideoId =
          extractYouTubeVideoIdFromUrl(String(root.postId)) || String(root.postId).trim();
        const ref = String(reply.threadRefId).trim();
        const refVideoId = extractYouTubeVideoIdFromUrl(ref) || ref;
        if (refVideoId === rootVideoId || ref === rootVideoId) return true;
      }
      if (
        (rootPlatformLower === "x" || rootPlatformLower === "twitter") &&
        reply.threadRefId != null &&
        root.postId != null &&
        String(reply.threadRefId) === String(root.postId)
      ) {
        return true;
      }
      if (root.platform.toLowerCase() === "linkedin") {
        const normalizedReplyThreadRefId = normalizeLinkedInId(reply.threadRefId);
        if (
          normalizedReplyThreadRefId &&
          normalizedRootPostId &&
          normalizedReplyThreadRefId === normalizedRootPostId
        ) {
          return true;
        }
      }
      if (
        rootPlatformLower === "hackernews" &&
        hnStoryId &&
        String(reply.threadRefId) === hnStoryId
      ) {
        return true;
      }
      if (
        isFacebookPlatform(root.platform) &&
        rootStoryFbid &&
        reply.threadRefId === rootStoryFbid
      ) {
        return true;
      }
      if (
        isFacebookPlatform(root.platform) &&
        root.url &&
        reply.threadRefId &&
        root.url.includes(reply.threadRefId)
      ) {
        return true;
      }

      const replyThreadRefKey = String(reply.threadRefId);
      let parent = postMap.get(replyThreadRefKey);
      const visited = new Set<string>();
      let depth = 0;

      while (parent && parent.threadRefId) {
        if (visited.has(parent.postId)) {
          cyclicPostIds.add(parent.postId);
          if (reply.postId) cyclicPostIds.add(reply.postId);
          break;
        }
        visited.add(parent.postId);
        depth += 1;
        if (depth > 1000) {
          if (parent.postId) cyclicPostIds.add(parent.postId);
          if (reply.postId) cyclicPostIds.add(reply.postId);
          break;
        }
        if (parent.threadRefId === root.postId) return true;
        if (
          rootPlatformLower === "hackernews" &&
          hnStoryId &&
          parent.threadRefId != null &&
          String(parent.threadRefId) === hnStoryId
        ) {
          return true;
        }
        if (
          (rootPlatformLower === "x" || rootPlatformLower === "twitter") &&
          parent.threadRefId != null &&
          root.postId != null &&
          String(parent.threadRefId) === String(root.postId)
        ) {
          return true;
        }
        if (rootPlatformLower === "youtube" && root.postId != null && parent.threadRefId != null) {
          const rootVideoId =
            extractYouTubeVideoIdFromUrl(String(root.postId)) || String(root.postId).trim();
          const ref = String(parent.threadRefId).trim();
          const refVideoId = extractYouTubeVideoIdFromUrl(ref) || ref;
          if (refVideoId === rootVideoId || ref === rootVideoId) return true;
        }
        if (root.platform.toLowerCase() === "linkedin") {
          const normalizedParentThreadRefId = normalizeLinkedInId(parent.threadRefId);
          if (
            normalizedParentThreadRefId &&
            normalizedRootPostId &&
            normalizedParentThreadRefId === normalizedRootPostId
          ) {
            return true;
          }
        }
        if (
          isFacebookPlatform(root.platform) &&
          rootStoryFbid &&
          parent.threadRefId === rootStoryFbid
        ) {
          return true;
        }
        if (
          isFacebookPlatform(root.platform) &&
          root.url &&
          parent.threadRefId &&
          root.url.includes(parent.threadRefId)
        ) {
          return true;
        }
        parent = postMap.get(String(parent.threadRefId));
      }
      return false;
    });

    const participants = new Set<string>();
    addParticipant(participants, root.authorId, root.authorName);
    threadReplies.forEach((r) => {
      const beforeSize = participants.size;
      addParticipant(participants, r.authorId, r.authorName);
      if (
        participants.size === beforeSize &&
        isFacebookPlatform(root.platform) &&
        r.authorId == null &&
        r.authorName == null
      ) {
        participants.add(`fb-reply-${r.id}`);
      }
    });
    if (isFacebookPlatform(root.platform) && participants.size < 2 && threadReplies.length >= 2) {
      participants.add(`fb-root-${root.postId || root.id}`);
      participants.add(`fb-engagement-${threadReplies[0].id}`);
    }

    const totalEngagement =
      (root.metricsLikes || 0) +
      (root.metricsComments || 0) +
      (root.metricsShares || 0) +
      threadReplies.reduce(
        (sum, r) => sum + (r.metricsLikes || 0) + (r.metricsComments || 0) + (r.metricsShares || 0),
        0
      );

    threads.push({
      rootPost: root,
      replies: threadReplies,
      participants,
      totalEngagement,
    });
  }

  threads.push(...buildDiscordReplyForestThreads(discordPosts));

  return threads;
}

/**
 * Fetch a single conversation thread from the Conversation table (materialized).
 * Returns null if no conversation exists for that root.
 */
export async function getConversationThreadFromDb(
  projectId: string,
  rootPostId: number
): Promise<ConversationThread | null> {
  const conv = await prisma.conversation.findFirst({
    where: {
      project_id: projectId,
      root_post_id: rootPostId,
      deleted_at: null,
    },
    include: {
      nodes: {
        where: { deleted_at: null },
        orderBy: { order_index: "asc" },
        include: { post: true },
      },
      rootPost: true,
    },
  });
  if (!conv) return null;

  const nodePosts = conv.nodes.map((n) => n.post) as PostForThread[];
  const rootPost = nodePosts[0] ?? (conv.rootPost as PostForThread);
  const replies = nodePosts.slice(1);
  const allPosts = [rootPost, ...replies];
  const participants = new Set<string>();
  allPosts.forEach((p) => {
    const key = (p.authorId ?? p.authorName)?.toString()?.trim();
    if (key) participants.add(key);
  });
  const totalEngagement = allPosts.reduce(
    (sum, p) => sum + (p.metricsLikes || 0) + (p.metricsComments || 0) + (p.metricsShares || 0),
    0
  );
  return {
    rootPost,
    replies,
    participants,
    totalEngagement,
  };
}
