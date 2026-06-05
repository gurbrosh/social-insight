/**
 * Materialize conversation threads into Conversation and ConversationNode tables.
 * Called at orchestration completion. Uses buildConversationThreads (same logic as analysis).
 * Discord: multiple roots per channel are allowed (one Conversation per reply-tree root).
 */

import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import {
  heapUsedMb,
  isAnalysisHandoffMetricsEnabled,
  logAnalysisHandoff,
} from "@/lib/analysis-handoff-metrics";
import {
  buildConversationThreads,
  buildConversationThreadsForPostIds,
  extractHnStoryIdFromSyntheticRootPostId,
  type ConversationThread,
} from "@/lib/conversation-builder";
import type { PostConversationRole } from "@prisma/client";

export interface MaterializeResult {
  conversationsCreated: number;
  nodesCreated: number;
  postsUpdated: number;
}

/** Optional scoping — default rebuilds conversations for every post in the project (expensive). */
export type MaterializeConversationsOptions = {
  /** Only traverse thread closures from posts ingested in these orchestration runs (recommended after scrapes). */
  seedRunIds?: string[];
};

async function loadPostDbIdsForIngestRuns(projectId: string, runIds: string[]): Promise<number[]> {
  const uniq = [...new Set(runIds.map((r) => r.trim()).filter(Boolean))];
  if (uniq.length === 0) return [];
  const rows = await prisma.post.findMany({
    where: {
      project_id: projectId,
      ingested_run_id: { in: uniq },
      content: { not: null },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Reply with post id, postId, threadRefId for tree building. */
type ReplyForTree = {
  id: number;
  postId: string;
  threadRefId?: string | null;
  createdAt: Date;
};

/**
 * Order posts in BFS order (root, then direct children, then grandchildren, ...)
 * so parents are always before children for node creation.
 */
function orderPostsByBfs(
  root: { id: number; postId: string },
  replies: ReplyForTree[],
  platform?: string
): Array<{ postId: number; parentPostId: number | null; depth: number; orderIndex: number }> {
  const result: Array<{ postId: number; parentPostId: number | null; depth: number }> = [];
  const queue: Array<{
    post: { id: number; postId: string };
    parentPostId: number | null;
    depth: number;
  }> = [{ post: root, parentPostId: null, depth: 0 }];
  const processed = new Set<string>([root.postId]);
  const hnStoryId =
    (platform || "").toLowerCase() === "hackernews"
      ? extractHnStoryIdFromSyntheticRootPostId(root.postId)
      : null;

  while (queue.length > 0) {
    const { post, parentPostId, depth } = queue.shift()!;
    result.push({ postId: post.id, parentPostId, depth });
    const children = replies.filter((r) => {
      if (processed.has(r.postId)) return false;
      if (r.threadRefId === post.postId) return true;
      if (hnStoryId && post.postId === root.postId && String(r.threadRefId) === hnStoryId) {
        return true;
      }
      return false;
    });
    children.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const child of children) {
      processed.add(child.postId);
      queue.push({ post: child, parentPostId: post.id, depth: depth + 1 });
    }
  }

  return result.map((n, i) => ({ ...n, orderIndex: i }));
}

/**
 * Materialize conversations for a project. Call at orchestration completion or full backfills.
 *
 * Pass `seedRunIds` after scrapes — otherwise builds threads from **every** Post row (heavy on SQLite / large DBs).
 */
export async function materializeConversationsForProject(
  projectId: string,
  options?: MaterializeConversationsOptions
): Promise<MaterializeResult> {
  const seedRunIds = [...new Set((options?.seedRunIds ?? []).map((r) => r.trim()).filter(Boolean))];

  const materializeT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  const heap0 = isAnalysisHandoffMetricsEnabled() ? heapUsedMb() : 0;

  const buildT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  let threads: ConversationThread[];
  /** True only when threads came from ingest-run seeds (narrow closure). Omit full standalone scan in that mode. */
  let usedRunScopedThreadBuild = false;

  if (seedRunIds.length > 0) {
    const seedIds = await loadPostDbIdsForIngestRuns(projectId, seedRunIds);
    console.log(
      `[ConversationMaterializer] project=${projectId} ingest run seed(s)=${seedRunIds.join(",")}; ` +
        `matching posts=${seedIds.length}`
    );
    if (seedIds.length === 0) {
      console.warn(
        `[ConversationMaterializer] project=${projectId} no posts matched ingested_run_id — full-project build`
      );
      threads = await buildConversationThreads(projectId);
    } else {
      threads = await buildConversationThreadsForPostIds(projectId, seedIds);
      usedRunScopedThreadBuild = true;
    }
  } else {
    console.log(`[ConversationMaterializer] project=${projectId} full-project thread build`);
    threads = await buildConversationThreads(projectId);
  }

  console.log(`[ConversationMaterializer] project=${projectId} threads=${threads.length} (persisting)`);

  const buildThreadsMs = isAnalysisHandoffMetricsEnabled() ? Date.now() - buildT0 : 0;

  let conversationsCreated = 0;
  let nodesCreated = 0;
  const postUpdates: Array<{
    id: number;
    role: PostConversationRole;
    conversationId: string | null;
  }> = [];

  const threadLoopT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  /** Yield periodically so the Next.js server can serve API routes during large projects. */
  const THREAD_YIELD_EVERY = 4;
  for (let ti = 0; ti < threads.length; ti++) {
    const thread = threads[ti];
    if (thread.replies.length === 0) {
      postUpdates.push({
        id: thread.rootPost.id,
        role: "STANDALONE",
        conversationId: null,
      });
      continue;
    }

    // findFirst + create/update: SQLite can reject Prisma upsert ON CONFLICT when the DB unique
    // index does not match what the client emits (same pattern as ConversationNode below).
    const existingConv = await prisma.conversation.findFirst({
      where: {
        project_id: projectId,
        root_post_id: thread.rootPost.id,
        deleted_at: null,
      },
    });
    const conv = existingConv
      ? await prisma.conversation.update({
          where: { id: existingConv.id },
          data: { updated_at: new Date() },
        })
      : await prisma.conversation.create({
          data: {
            id: generateId(),
            project_id: projectId,
            root_post_id: thread.rootPost.id,
            platform: thread.rootPost.platform,
          },
        });
    const conversationId = conv.id;
    conversationsCreated++;

    // Use findFirst + create/update to avoid Prisma compound unique upsert (conversation_id_post_id)
    const existingRoot = await prisma.conversationNode.findFirst({
      where: {
        conversation_id: conversationId,
        post_id: thread.rootPost.id,
        deleted_at: null,
      },
    });
    const rootNodeId = existingRoot
      ? (
          await prisma.conversationNode.update({
            where: { id: existingRoot.id },
            data: { updated_at: new Date() },
          })
        ).id
      : (
          await prisma.conversationNode.create({
            data: {
              id: generateId(),
              conversation_id: conversationId,
              post_id: thread.rootPost.id,
              parent_node_id: null,
              order_index: 0,
              depth: 0,
            },
          })
        ).id;
    nodesCreated++;

    const postIdToNodeId = new Map<number, string>();
    postIdToNodeId.set(thread.rootPost.id, rootNodeId);

    const nodes = orderPostsByBfs(thread.rootPost, thread.replies, thread.rootPost.platform);
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      const parentNodeId = n.parentPostId ? (postIdToNodeId.get(n.parentPostId) ?? null) : null;
      const nodeId = generateId();

      const existingNode = await prisma.conversationNode.findFirst({
        where: {
          conversation_id: conversationId,
          post_id: n.postId,
          deleted_at: null,
        },
      });
      const actualNodeId = existingNode ? existingNode.id : nodeId;
      postIdToNodeId.set(n.postId, actualNodeId);

      if (existingNode) {
        await prisma.conversationNode.update({
          where: { id: existingNode.id },
          data: {
            parent_node_id: parentNodeId,
            order_index: n.orderIndex,
            depth: n.depth,
            updated_at: new Date(),
          },
        });
      } else {
        await prisma.conversationNode.create({
          data: {
            id: nodeId,
            conversation_id: conversationId,
            post_id: n.postId,
            parent_node_id: parentNodeId,
            order_index: n.orderIndex,
            depth: n.depth,
          },
        });
      }
      nodesCreated++;
    }

    postUpdates.push({
      id: thread.rootPost.id,
      role: "ROOT",
      conversationId,
    });
    thread.replies.forEach((r) => {
      postUpdates.push({
        id: r.id,
        role: "RESPONSE",
        conversationId,
      });
    });
    if (ti > 0 && ti % THREAD_YIELD_EVERY === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const threadLoopMs = isAnalysisHandoffMetricsEnabled() ? Date.now() - threadLoopT0 : 0;

  const middleT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  const rootsWithReplies = new Set(
    threads.filter((t) => t.replies.length > 0).map((t) => t.rootPost.id)
  );
  const replyIds = new Set(threads.flatMap((t) => t.replies.map((r) => r.id)));

  const alreadyQueuedForUpdate = new Set(postUpdates.map((u) => u.id));

  if (!usedRunScopedThreadBuild) {
    const allProjectPostIds = await prisma.post.findMany({
      where: { project_id: projectId, content: { not: null } },
      select: { id: true },
    });
    for (const p of allProjectPostIds) {
      if (alreadyQueuedForUpdate.has(p.id)) continue;
      if (rootsWithReplies.has(p.id) || replyIds.has(p.id)) continue;
      postUpdates.push({ id: p.id, role: "STANDALONE", conversationId: null });
    }
  }

  const uniqueUpdates = Array.from(new Map(postUpdates.map((u) => [u.id, u])).values());
  const middleMs = isAnalysisHandoffMetricsEnabled() ? Date.now() - middleT0 : 0;

  /** Smaller transactions + yields so SQLite write lock and the event loop do not stall the server. */
  const POST_UPDATE_CHUNK = 80;
  let postsUpdatedCount = 0;
  let postUpdateChunks = 0;
  let maxPostUpdateChunkMs = 0;
  const postTxT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  for (let i = 0; i < uniqueUpdates.length; i += POST_UPDATE_CHUNK) {
    const chunk = uniqueUpdates.slice(i, i + POST_UPDATE_CHUNK);
    const chunkT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.post.update({
          where: { id: u.id },
          data: {
            post_conversation_role: u.role,
            ...(u.conversationId
              ? { conversation: { connect: { id: u.conversationId } } }
              : { conversation: { disconnect: true } }),
          },
        })
      )
    );
    if (isAnalysisHandoffMetricsEnabled()) {
      maxPostUpdateChunkMs = Math.max(maxPostUpdateChunkMs, Date.now() - chunkT0);
      postUpdateChunks++;
    }
    postsUpdatedCount += chunk.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const postTxLoopMs = isAnalysisHandoffMetricsEnabled() ? Date.now() - postTxT0 : 0;

  if (isAnalysisHandoffMetricsEnabled()) {
    logAnalysisHandoff("materializeConversations", {
      projectId,
      threadCount: threads.length,
      buildThreadsMs,
      threadLoopMs,
      standaloneAndDedupeMs: middleMs,
      postTxLoopMs,
      conversationsCreated,
      nodesCreated,
      uniquePostUpdates: uniqueUpdates.length,
      postUpdateChunks,
      maxPostUpdateChunkMs,
      totalMs: Date.now() - materializeT0,
      heapDeltaMb: Math.round((heapUsedMb() - heap0) * 10) / 10,
    });
  }

  console.log(
    `[ConversationMaterializer] project=${projectId} conversations=${conversationsCreated} nodes=${nodesCreated} postsUpdated=${postsUpdatedCount}`
  );
  return {
    conversationsCreated,
    nodesCreated,
    postsUpdated: postsUpdatedCount,
  };
}
