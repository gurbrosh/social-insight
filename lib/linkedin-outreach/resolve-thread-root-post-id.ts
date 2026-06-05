import { prisma } from "@/lib/prisma";

const isFacebookPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "facebook";

function normalizeLinkedInPostIdSegment(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.includes(":activity:")) return id.split(":activity:")[1] || id;
  if (id.includes(":ugcPost:")) return id.split(":ugcPost:")[1] || id;
  return id;
}

async function traverseThreadRefToRootDbId(
  postId: number,
  threadRefId: string | null | undefined,
  platform: string,
  projectId: string
): Promise<number> {
  if (!threadRefId) {
    return postId;
  }

  const currentPost = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      url: true,
      platform: true,
    },
  });

  if (!currentPost) {
    return postId;
  }

  const plat = currentPost.platform || platform;

  if (isFacebookPlatform(plat) && threadRefId) {
    const rootPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        platform: plat,
        threadRefId: null,
        url: { not: null },
      },
      select: {
        id: true,
        postId: true,
        url: true,
      },
      take: 1000,
    });

    for (const rootPost of rootPosts) {
      if (rootPost.url) {
        const queryMatch = rootPost.url.match(/[?&]story_fbid=([^&]+)/);
        if (queryMatch?.[1] === threadRefId) return rootPost.id;
        const pathMatch = rootPost.url.match(/\/(?:posts|reel|permalink\.php)\/(pfbid[a-zA-Z0-9]+)/);
        if (pathMatch?.[1] === threadRefId) return rootPost.id;
        if (rootPost.url.includes(threadRefId)) return rootPost.id;
      }
    }
  }

  let currentRefId: string | null | undefined = threadRefId;
  const visited = new Set<string>();
  let depth = 0;
  const MAX_DEPTH = 50;

  while (currentRefId && depth < MAX_DEPTH) {
    if (visited.has(currentRefId)) break;
    visited.add(currentRefId);

    const normalizedRefId = normalizeLinkedInPostIdSegment(currentRefId);

    const parentPost: {
      id: number;
      postId: string;
      threadRefId: string | null;
    } | null = await prisma.post.findFirst({
      where: {
        project_id: projectId,
        platform: plat,
        OR: [
          { postId: currentRefId },
          ...(normalizedRefId && normalizedRefId !== currentRefId
            ? [{ postId: normalizedRefId }]
            : []),
        ],
      },
      select: {
        id: true,
        postId: true,
        threadRefId: true,
      },
    });

    if (!parentPost) break;
    if (!parentPost.threadRefId) return parentPost.id;

    currentRefId = parentPost.threadRefId;
    depth++;
  }

  return postId;
}

export async function resolveThreadRootPostDbId(
  projectId: string,
  sourcePostDbId: number
): Promise<number> {
  const post = await prisma.post.findFirst({
    where: { project_id: projectId, id: sourcePostDbId },
    select: {
      id: true,
      conversation_id: true,
      threadRefId: true,
      platform: true,
    },
  });

  if (!post) return sourcePostDbId;

  if (post.conversation_id?.trim()) {
    const conv = await prisma.conversation.findFirst({
      where: { project_id: projectId, id: post.conversation_id.trim(), deleted_at: null },
      select: { root_post_id: true },
    });
    if (conv?.root_post_id != null) {
      return conv.root_post_id;
    }
  }

  return traverseThreadRefToRootDbId(
    post.id,
    post.threadRefId,
    post.platform ?? "linkedin",
    projectId
  );
}
