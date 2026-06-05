/**
 * After theme analysis, some posts in a run may match no ProjectTheme but still warrant a reply.
 * Creates ThemesAnalysis rows under a synthetic project theme "Conversation W/O Theme" when
 * response-objective relevance passes (same gate as the response pipeline).
 */

import { prisma } from "@/lib/prisma";
import { evaluateRelevance } from "@/lib/response-generator/relevance-service";
import { RESPONSE_RELEVANCE_THRESHOLD } from "@/lib/response-generator/relevance-threshold";
import { resolveSourceReplyForThemeRow } from "@/lib/response-generator/source-reply-resolve";
import { resolveContextTextsForThemeRows } from "@/lib/response-generator/theme-context-text";
import { normalizeThemeReadUrl } from "@/lib/theme-read-url";
import { sanitizeTextForDbStorage } from "@/lib/sanitize-text-for-db-storage";
import { generateId } from "@/lib/utils/ulid";

const LOG_PREFIX = "[conversation-without-theme]";

/** Display + ProjectTheme.theme_name for synthetic rows (exact label). */
export const CONVERSATION_WO_THEME_NAME = "Conversation W/O Theme";

const BATCH = 40;

/** Load post bodies only per batch — avoids holding every run post's content in heap at once. */
type PostRunStub = {
  id: number;
  platform: string;
  url: string | null;
  authorName: string | null;
  authorId: string | null;
  channelId: string | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  createdAt: Date;
  sentiment: string | null;
  language: string | null;
  conversation_id: string | null;
  content: string | null;
};

function normalizeSentimentForRow(s: string | null | undefined): string | null {
  if (!s) return null;
  const u = s.toString().toUpperCase();
  if (["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"].includes(u)) return u;
  return null;
}

async function getOrCreateConversationWithoutThemeProjectTheme(projectId: string): Promise<string> {
  const existing = await prisma.projectTheme.findFirst({
    where: {
      project_id: projectId,
      theme_name: CONVERSATION_WO_THEME_NAME,
      deleted_at: null,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.projectTheme.create({
    data: {
      id: generateId(),
      project_id: projectId,
      theme_name: CONVERSATION_WO_THEME_NAME,
      description:
        "Posts from this run that matched no project theme but passed response-objective relevance.",
      is_active: true,
    },
    select: { id: true },
  });
  return created.id;
}

export type ConversationWithoutThemeSynthesisStats = {
  postsInRun: number;
  candidatesNoThemeRow: number;
  createdThemesAnalysis: number;
  skippedNoObjectivePass: number;
  skippedAllSourcesExcluded: number;
  errors: number;
};

/**
 * For posts ingested on this orchestration run with no ThemesAnalysis row yet, if at least one
 * response objective passes relevance (and source settings allow the platform), insert a
 * ThemesAnalysis row for the synthetic theme so downstream UI and response generation treat it
 * like any other theme hit.
 */
export async function synthesizeConversationWithoutThemeAnalyses(
  projectId: string,
  orchestrationRunId: string
): Promise<ConversationWithoutThemeSynthesisStats> {
  const stats: ConversationWithoutThemeSynthesisStats = {
    postsInRun: 0,
    candidatesNoThemeRow: 0,
    createdThemesAnalysis: 0,
    skippedNoObjectivePass: 0,
    skippedAllSourcesExcluded: 0,
    errors: 0,
  };

  const runId = orchestrationRunId.trim();
  if (!runId) return stats;

  const objectives = await prisma.responseObjective.findMany({
    where: { project_id: projectId, deleted_at: null },
  });
  if (objectives.length === 0) {
    console.log(`${LOG_PREFIX} skip project=${projectId} run=${runId} — no response objectives`);
    return stats;
  }

  const themeId = await getOrCreateConversationWithoutThemeProjectTheme(projectId);

  const postStubs = await prisma.post.findMany({
    where: {
      project_id: projectId,
      ingested_run_id: runId,
    },
    select: {
      id: true,
      platform: true,
      url: true,
      authorName: true,
      authorId: true,
      channelId: true,
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
      createdAt: true,
      sentiment: true,
      language: true,
      conversation_id: true,
    },
  });

  stats.postsInRun = postStubs.length;
  if (postStubs.length === 0) {
    console.log(`${LOG_PREFIX} project=${projectId} run=${runId} postsInRun=0`);
    return stats;
  }

  const postIds = postStubs.map((p) => p.id);
  const alreadyThemed = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      post_id: { in: postIds },
      deleted_at: null,
    },
    select: { post_id: true },
  });
  const themedPostIds = new Set(alreadyThemed.map((r) => r.post_id));

  const candidates = postStubs.filter((p) => !themedPostIds.has(p.id));
  stats.candidatesNoThemeRow = candidates.length;

  if (candidates.length === 0) {
    console.log(
      `${LOG_PREFIX} project=${projectId} run=${runId} candidates=0 (all posts already have theme rows)`
    );
    return stats;
  }

  console.log(
    `${LOG_PREFIX} project=${projectId} run=${runId} postsInRun=${stats.postsInRun} ` +
      `candidatesWithoutThemeRow=${stats.candidatesNoThemeRow}`
  );

  for (let i = 0; i < candidates.length; i += BATCH) {
    const stubChunk = candidates.slice(i, i + BATCH);
    const ids = stubChunk.map((p) => p.id);
    const contentRows = await prisma.post.findMany({
      where: { project_id: projectId, id: { in: ids } },
      select: { id: true, content: true },
    });
    const contentById = new Map(contentRows.map((r) => [r.id, r.content]));
    const chunk: PostRunStub[] = stubChunk.map((s) => ({
      ...s,
      content: contentById.get(s.id) ?? null,
    }));

    const convIds = [
      ...new Set(chunk.map((p) => p.conversation_id).filter((c): c is string => Boolean(c))),
    ];
    let participantListsByConvId = new Map<string, string>();
    if (convIds.length > 0) {
      const threadAuthors = await prisma.post.findMany({
        where: { project_id: projectId, conversation_id: { in: convIds } },
        select: { conversation_id: true, authorName: true },
      });
      const byConv = new Map<string, Set<string>>();
      for (const r of threadAuthors) {
        if (!r.conversation_id) continue;
        const name = sanitizeTextForDbStorage(r.authorName ?? null, 200);
        if (!name) continue;
        const set = byConv.get(r.conversation_id) ?? new Set();
        set.add(name);
        byConv.set(r.conversation_id, set);
      }
      for (const [cid, set] of byConv) {
        const names = [...set];
        if (names.length > 0) {
          participantListsByConvId.set(cid, JSON.stringify(names));
        }
      }
    }

    const refs = chunk.map((p) => ({
      id: `cwot-${p.id}`,
      post_id: p.id,
      post_content: p.content,
    }));
    const contextByKey = await resolveContextTextsForThemeRows(projectId, refs);

    for (const post of chunk) {
      const fullText =
        contextByKey.get(`cwot-${post.id}`) ??
        ((post.content || "").trim() || "(no content)");

      const objectiveResolutions = objectives.map((objective) => ({
        objective,
        resolved: resolveSourceReplyForThemeRow(post.platform, {
          source_reply_settings: objective.source_reply_settings,
          allowed_sources: objective.allowed_sources,
          excluded_sources: objective.excluded_sources,
          is_org_identified: objective.is_org_identified,
        }),
      }));

      const anySourceAllowed = objectiveResolutions.some((r) => !r.resolved.skip);
      if (!anySourceAllowed) {
        stats.skippedAllSourcesExcluded += 1;
        continue;
      }

      let bestScore01 = 0;
      let bestReasoning = "";

      try {
        for (const { objective, resolved } of objectiveResolutions) {
          if (resolved.skip) continue;
          const rel = await evaluateRelevance({
            objectiveDescription: objective.description || objective.name,
            relevanceGuidelines: objective.relevance_guidelines,
            platform: post.platform,
            fullText,
          });
          if (rel.relevance_score > bestScore01) {
            bestScore01 = rel.relevance_score;
            bestReasoning = rel.reasoning;
          }
        }

        if (bestScore01 < RESPONSE_RELEVANCE_THRESHOLD) {
          stats.skippedNoObjectivePass += 1;
          continue;
        }

        const isDiscord = post.platform.toLowerCase() === "discord";
        const relevanceInt = Math.min(100, Math.max(0, Math.round(bestScore01 * 100)));

        const safePostUrlCwot = sanitizeTextForDbStorage(post.url ?? null, 4000);
        const readKey =
          safePostUrlCwot && safePostUrlCwot.trim() !== ""
            ? normalizeThemeReadUrl(safePostUrlCwot).replace(/\\/g, "")
            : undefined;

        const participantNames = post.conversation_id
          ? participantListsByConvId.get(post.conversation_id)
          : undefined;

        await prisma.themesAnalysis.create({
          data: {
            id: generateId(),
            project_id: projectId,
            orchestration_run_id: runId,
            theme_id: themeId,
            theme_name: sanitizeTextForDbStorage(CONVERSATION_WO_THEME_NAME, 400) ?? CONVERSATION_WO_THEME_NAME,
            post_id: post.id,
            platform: sanitizeTextForDbStorage(post.platform, 64) || post.platform,
            post_content: sanitizeTextForDbStorage(post.content ?? null, 8000),
            post_url: safePostUrlCwot ?? undefined,
            read_url_key: readKey,
            discord_channel: isDiscord
              ? sanitizeTextForDbStorage(post.channelId ?? null, 256) ?? undefined
              : undefined,
            author_name: sanitizeTextForDbStorage(post.authorName ?? null, 200) ?? undefined,
            author_id: sanitizeTextForDbStorage(post.authorId ?? null, 200) ?? undefined,
            participant_names: participantNames ?? undefined,
            likes: post.metricsLikes || 0,
            comments: post.metricsComments || 0,
            shares: post.metricsShares || 0,
            total_reactions:
              (post.metricsLikes || 0) +
              (post.metricsComments || 0) +
              (post.metricsShares || 0),
            posted_at: post.createdAt,
            analyzed_at: new Date(),
            relevance_score: relevanceInt,
            sentiment: sanitizeTextForDbStorage(normalizeSentimentForRow(post.sentiment), 64) ?? "NEUTRAL",
            language: post.language
              ? sanitizeTextForDbStorage(post.language, 32) ?? undefined
              : undefined,
          },
        });

        stats.createdThemesAnalysis += 1;
        console.log(
          `${LOG_PREFIX} created themes_analysis postId=${post.id} platform=${post.platform} ` +
            `relevance~=${bestScore01.toFixed(3)} reasoning=${bestReasoning.slice(0, 120)}`
        );
      } catch (e) {
        stats.errors += 1;
        console.error(`${LOG_PREFIX} error postId=${post.id}`, e);
      }
    }
  }

  console.log(
    `${LOG_PREFIX} complete project=${projectId} run=${runId} created=${stats.createdThemesAnalysis} ` +
      `skippedNoPass=${stats.skippedNoObjectivePass} skippedSources=${stats.skippedAllSourcesExcluded} ` +
      `errors=${stats.errors}`
  );

  return stats;
}
