import { prisma } from "@/lib/prisma";

/**
 * All post ids in the same materialized conversation as `postId`, or `[postId]` if standalone / missing.
 */
async function getPostIdsForThreadScope(projectId: string, postId: number): Promise<number[]> {
  const post = await prisma.post.findFirst({
    where: { id: postId, project_id: projectId },
    select: { id: true, conversation_id: true },
  });
  if (!post) return [postId];
  if (!post.conversation_id) return [postId];
  const siblings = await prisma.post.findMany({
    where: {
      project_id: projectId,
      conversation_id: post.conversation_id,
    },
    select: { id: true },
  });
  return siblings.map((p) => p.id);
}

/**
 * Set read state on theme analysis rows:
 * 1) With `fallbackMatchId`: all rows for the same source post (any theme) in the same conversation
 *    thread (root + replies), so one checkbox/read marks every theme match for that URL/post.
 * 2) When `readUrlKey` is also set: any other rows that already store that normalized key (e.g. edge
 *    cases with duplicate post rows) stay in sync.
 * 3) Without `fallbackMatchId` but with `readUrlKey`: rows already storing that key (legacy callers).
 */
export async function applyThemesReadCascade(
  projectId: string,
  params: {
    read: boolean;
    readUrlKey: string | null;
    fallbackMatchId?: string;
  }
): Promise<void> {
  const { read, readUrlKey, fallbackMatchId } = params;

  if (fallbackMatchId) {
    const row = await prisma.themesAnalysis.findFirst({
      where: { id: fallbackMatchId, project_id: projectId, deleted_at: null },
    });
    if (row) {
      const postIds = await getPostIdsForThreadScope(projectId, row.post_id);
      await prisma.themesAnalysis.updateMany({
        where: {
          project_id: projectId,
          post_id: { in: postIds },
          deleted_at: null,
        },
        data: {
          is_read: read,
          ...(readUrlKey && readUrlKey.length > 0 ? { read_url_key: readUrlKey } : {}),
        },
      });
      if (readUrlKey && readUrlKey.length > 0) {
        await prisma.themesAnalysis.updateMany({
          where: {
            project_id: projectId,
            deleted_at: null,
            read_url_key: readUrlKey,
          },
          data: { is_read: read },
        });
      }
    }
  } else if (readUrlKey && readUrlKey.length > 0) {
    await prisma.themesAnalysis.updateMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        read_url_key: readUrlKey,
      },
      data: { is_read: read },
    });
  }
}
