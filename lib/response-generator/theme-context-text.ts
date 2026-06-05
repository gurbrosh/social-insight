import { prisma } from "@/lib/prisma";

function readEnvInt(key: string, defaultVal: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw?.trim()) return defaultVal;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.min(max, Math.max(min, n));
}

/** Cap for LLM context (characters). Override with THEME_CONTEXT_MAX_CHARS. */
const MAX_CONTEXT_CHARS = readEnvInt("THEME_CONTEXT_MAX_CHARS", 28_000, 2_000, 200_000);

/** Max posts included per conversation thread (anchor window). THEME_CONTEXT_MAX_POSTS_PER_THREAD */
const MAX_POSTS_PER_THREAD = readEnvInt("THEME_CONTEXT_MAX_POSTS_PER_THREAD", 120, 8, 500);

/**
 * Posts included on each side of each anchor (theme row) within the thread.
 * THEME_CONTEXT_THREAD_ANCHOR_RADIUS
 */
const THREAD_ANCHOR_RADIUS = readEnvInt("THEME_CONTEXT_THREAD_ANCHOR_RADIUS", 35, 0, 200);

/** Chunk size for fetching post bodies by id (avoids huge IN clauses). */
const FETCH_IDS_CHUNK = 500;

/** Conversation ids queried per prisma call for thread metadata. */
const CONV_META_CHUNK = 40;

type ThemeRowRef = {
  id: string;
  post_id: number;
  post_content: string | null;
};

type PostSlice = {
  id: number;
  content: string | null;
  authorName: string | null;
  conversation_id: string | null;
  createdAt: Date;
};

/**
 * Indices to keep for thread context around theme-row anchors (chronological order).
 */
function selectThreadIndices(
  threadLen: number,
  anchorIndices: number[],
  radius: number,
  maxPosts: number
): Set<number> {
  if (threadLen <= 0) return new Set();

  const anchors = [...new Set(anchorIndices)]
    .filter((i) => i >= 0 && i < threadLen)
    .sort((a, b) => a - b);

  if (anchors.length === 0) {
    const num = Math.min(threadLen, maxPosts);
    return new Set(Array.from({ length: num }, (_, i) => i));
  }

  let lo = Math.max(0, Math.min(...anchors) - radius);
  let hi = Math.min(threadLen - 1, Math.max(...anchors) + radius);

  if (hi - lo + 1 > maxPosts) {
    const median = anchors[Math.floor(anchors.length / 2)]!;
    const half = Math.floor(maxPosts / 2);
    lo = Math.max(0, median - half);
    hi = Math.min(threadLen - 1, lo + maxPosts - 1);
    if (hi - lo + 1 < maxPosts) {
      lo = Math.max(0, hi - (maxPosts - 1));
    }
  }

  const indices = new Set<number>();
  for (let i = lo; i <= hi; i++) indices.add(i);
  for (const a of anchors) indices.add(a);

  if (indices.size <= maxPosts) return indices;

  const sorted = [...indices].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const half = Math.floor(maxPosts / 2);
  lo = Math.max(0, med - half);
  hi = Math.min(threadLen - 1, lo + maxPosts - 1);
  if (hi - lo + 1 < maxPosts) lo = Math.max(0, hi - (maxPosts - 1));
  const out = new Set<number>();
  for (let i = lo; i <= hi; i++) out.add(i);
  return out;
}

async function fetchPostsByIdsChunked(projectId: string, ids: number[]): Promise<PostSlice[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const out: PostSlice[] = [];
  for (let i = 0; i < unique.length; i += FETCH_IDS_CHUNK) {
    const slice = unique.slice(i, i + FETCH_IDS_CHUNK);
    const chunk = await prisma.post.findMany({
      where: { project_id: projectId, id: { in: slice } },
      select: {
        id: true,
        content: true,
        authorName: true,
        conversation_id: true,
        createdAt: true,
      },
    });
    out.push(...chunk);
  }
  return out;
}

function chunkConversationIds(convIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < convIds.length; i += CONV_META_CHUNK) {
    chunks.push(convIds.slice(i, i + CONV_META_CHUNK));
  }
  return chunks;
}

/**
 * Build the text the response generator should judge: materialized conversation when
 * available (bounded excerpt around theme-row anchors), otherwise the single post body,
 * otherwise the theme row excerpt.
 *
 * Loads threads in two phases (metadata → bounded body fetch) so huge channels are not kept
 * in memory at full size.
 */
export async function resolveContextTextsForThemeRows(
  projectId: string,
  rows: ThemeRowRef[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const rowPostIds = [...new Set(rows.map((r) => r.post_id))];

  const anchorPosts = await prisma.post.findMany({
    where: { project_id: projectId, id: { in: rowPostIds } },
    select: {
      id: true,
      content: true,
      authorName: true,
      conversation_id: true,
      createdAt: true,
    },
  });
  const postById = new Map<number, PostSlice>(anchorPosts.map((p) => [p.id, p]));

  const convIds = [
    ...new Set(anchorPosts.map((p) => p.conversation_id).filter((c): c is string => Boolean(c))),
  ];

  const metaListsByConversationId = new Map<
    string,
    Array<{ id: number; conversation_id: string | null; createdAt: Date }>
  >();

  for (const slice of chunkConversationIds(convIds)) {
    if (slice.length === 0) continue;
    const threadMeta = await prisma.post.findMany({
      where: { project_id: projectId, conversation_id: { in: slice } },
      select: {
        id: true,
        conversation_id: true,
        createdAt: true,
      },
    });
    for (const row of threadMeta) {
      if (!row.conversation_id) continue;
      const list = metaListsByConversationId.get(row.conversation_id) ?? [];
      list.push(row);
      metaListsByConversationId.set(row.conversation_id, list);
    }
  }

  for (const [, list] of metaListsByConversationId) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const indexOfPostIdPerConv = new Map<string, Map<number, number>>();
  for (const [cid, metaList] of metaListsByConversationId) {
    const m = new Map<number, number>();
    metaList.forEach((entry, idx) => m.set(entry.id, idx));
    indexOfPostIdPerConv.set(cid, m);
  }

  const anchorsByConv = new Map<string, Set<number>>();
  for (const row of rows) {
    const p = postById.get(row.post_id);
    const cid = p?.conversation_id;
    if (!cid) continue;
    const s = anchorsByConv.get(cid) ?? new Set<number>();
    s.add(row.post_id);
    anchorsByConv.set(cid, s);
  }

  const totalThreadLenByConv = new Map<string, number>();
  const keepIndicesByConv = new Map<string, Set<number>>();
  const selectedIdsUnion = new Set<number>();

  for (const cid of convIds) {
    const metaList = metaListsByConversationId.get(cid) ?? [];
    const n = metaList.length;
    totalThreadLenByConv.set(cid, n);
    if (n < 2) continue;

    const idxMap = indexOfPostIdPerConv.get(cid);
    const anchors = anchorsByConv.get(cid);
    const anchorIndices =
      anchors && idxMap
        ? [...anchors].map((pid) => idxMap.get(pid)).filter((i): i is number => typeof i === "number")
        : [];

    const keepIx = selectThreadIndices(n, anchorIndices, THREAD_ANCHOR_RADIUS, MAX_POSTS_PER_THREAD);
    keepIndicesByConv.set(cid, keepIx);
    for (const ix of keepIx) {
      const id = metaList[ix]?.id;
      if (id != null) selectedIdsUnion.add(id);
    }
  }

  const missingBodyIds = [...selectedIdsUnion].filter((id) => !postById.has(id));
  const fetched =
    missingBodyIds.length > 0 ? await fetchPostsByIdsChunked(projectId, missingBodyIds) : [];
  for (const p of fetched) postById.set(p.id, p);

  const formattedThreadByConv = new Map<string, PostSlice[]>();
  for (const [cid, keepIx] of keepIndicesByConv) {
    const metaList = metaListsByConversationId.get(cid) ?? [];
    const ordered: PostSlice[] = [];
    for (let i = 0; i < metaList.length; i++) {
      if (!keepIx.has(i)) continue;
      const id = metaList[i]!.id;
      const p = postById.get(id);
      if (p) ordered.push(p);
    }
    if (ordered.length >= 2) {
      formattedThreadByConv.set(cid, ordered);
    }
  }

  for (const row of rows) {
    const post = postById.get(row.post_id);
    const fallback = (row.post_content || "").trim() || "(no content)";

    if (!post) {
      out.set(row.id, truncate(fallback));
      continue;
    }

    const singleBody = (post.content || "").trim();
    if (post.conversation_id) {
      const thr = formattedThreadByConv.get(post.conversation_id);
      if (thr && thr.length >= 2) {
        const total = totalThreadLenByConv.get(post.conversation_id);
        const excerptNote =
          typeof total === "number" && total > thr.length
            ? `[Thread excerpt: ${thr.length} of ${total} messages shown (includes context around referenced posts)]\n\n`
            : "";
        out.set(row.id, truncate(excerptNote + formatThread(thr)));
        continue;
      }
    }

    if (singleBody) {
      const author = post.authorName?.trim();
      const one = author ? `${author}: ${singleBody}` : singleBody;
      out.set(row.id, truncate(one));
      continue;
    }

    out.set(row.id, truncate(fallback));
  }

  return out;
}

function formatThread(
  posts: Array<{ content: string | null; authorName: string | null; createdAt: Date }>
): string {
  const lines: string[] = ["Conversation thread (chronological):"];
  posts.forEach((p, i) => {
    const author = p.authorName?.trim() || "Unknown";
    const body = (p.content || "").trim() || "(empty)";
    lines.push(`${i + 1}. ${author}: ${body}`);
  });
  return lines.join("\n");
}

function truncate(s: string): string {
  if (s.length <= MAX_CONTEXT_CHARS) return s;
  return `${s.slice(0, MAX_CONTEXT_CHARS)}\n\n[…truncated for length]`;
}
