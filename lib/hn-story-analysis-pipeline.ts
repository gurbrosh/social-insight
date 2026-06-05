/**
 * Hacker News story analysis: relevance, up to 7 ideas, optional comment summary,
 * Post rows per idea (or summary-only when no ideas), plus one Post per fetched comment.
 * With `ingestedRunId` (orchestration), defers sentiment, theme matching, and sanitization to task-based analysis.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import { sanitizeTextForDbStorage } from "@/lib/sanitize-text-for-db-storage";
import { fetchItem } from "@/lib/hackernews/firebase-item";
import {
  fetchRankedCommentThreadsForStory,
  type RankedCommentThread,
} from "@/lib/hackernews/story-comment-tree";
import {
  analyzeArticlePreCheck,
  analyzeArticlePreCheckTitleOnly,
  extractKeyIdeasFromArticle,
  stripHtmlToPlainText,
} from "@/lib/blog-news-analysis-service";
import { summarizeHnCommentThreadsWithLLM } from "@/lib/hn-story-analysis-prompts";
import {
  getProjectContextForRelevance,
  getProjectBrandNames,
  shouldRejectThemeMatchForEntityMismatch,
  buildThemeBrandRequirementsMap,
  composePostTextForBrandGate,
} from "@/lib/comprehensive-analysis";
import { runSentimentForPostIds } from "@/lib/analysis/core";
import { isUniqueConstraintError } from "@/lib/prisma-create-many-sqlite";
import { matchBlogSummariesToThemesWithLLM } from "@/lib/blog-post-analysis-pipeline";
import type { HnFirebaseItem } from "@/lib/hackernews/types";
import { throwIfAborted } from "@/lib/custom-tasks/task-test-abort";

const HN_PLATFORM = "hackernews";
const LOG_PREFIX = "[HnStoryAnalysis]";
const THEME_BATCH = 12;

export interface RunHnStoryAnalysisOptions {
  /** Max stories to process this run (default 15). */
  limit?: number;
  /** When set, only these HN story ids are considered (must still match project keywords unless force is used). */
  storyIds?: string[];
  /** When true with storyIds, skip keyword filter (admin / tests). */
  forceStoryIds?: boolean;
  /**
   * Orchestration run id. When set, new Posts are stamped with `ingested_run_id` and inline
   * sentiment, HN-specific theme matching, and this function's sanitization are skipped so
   * orchestration completion can run task-based analysis (worker) like other sources.
   */
  ingestedRunId?: string | null;
  /** Exit between stories when aborted (admin test cancel). */
  signal?: AbortSignal;
  /**
   * How many stories to analyze concurrently (Firebase + LLM each). Default 10. Capped at 50.
   */
  analysisConcurrency?: number;
}

export interface RunHnStoryAnalysisResult {
  candidatesSeen: number;
  skippedAlreadyAnalyzed: number;
  storiesProcessed: number;
  skippedNotFound: number;
  skippedLowRelevanceOrAd: number;
  analysesCreated: number;
  postsCreated: number;
  sentimentAnalyzed: number;
  themeMatches: number;
  errorMessage?: string;
}

function hnItemUrl(id: string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

type HnCommentsEngagementMeta = {
  topLevelCount: number;
  fetchedCount: number;
  threadRoots: number[];
  storyPostedUnix: number | null;
};

function storyLevelExtraJson(
  storyId: string,
  engagementMeta: HnCommentsEngagementMeta,
  variant: "idea" | "summary"
): Prisma.InputJsonValue {
  return {
    hnKind: "story_analysis",
    hnStoryId: storyId,
    hnFirebaseItemId: storyId,
    hnPostVariant: variant,
    comments_engagement_meta: engagementMeta,
  } as unknown as Prisma.InputJsonValue;
}

function commentPostExtraJson(
  storyId: string,
  itemId: number,
  engagementMeta: HnCommentsEngagementMeta
): Prisma.InputJsonValue {
  return {
    hnKind: "comment",
    hnStoryId: storyId,
    hnFirebaseItemId: String(itemId),
    comments_engagement_meta: engagementMeta,
  } as unknown as Prisma.InputJsonValue;
}

function logTs(): string {
  return new Date().toISOString();
}

function buildStoryBodyText(story: NonNullable<HnFirebaseItem>): string {
  const title = (story.title && story.title.trim()) || "";
  const raw = story.text ? stripHtmlToPlainText(story.text) : "";
  const text = raw.trim();
  if (title && text) return `${title}\n\n${text}`;
  if (text) return text;
  return title;
}

async function loadProjectContext(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    select: {
      monitoring_focus: true,
      require_keywords_with_brands: true,
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
    },
  });
  const projectContext = project
    ? {
        brands: project.brands.map((b) => b.brand_name),
        monitoringFocus: project.monitoring_focus ?? undefined,
        keywords: project.keywords.map((k) => k.keyword),
        requireKeywordsWithBrands: project.require_keywords_with_brands ?? false,
      }
    : undefined;

  const semanticScope =
    project &&
    (project.brands.length > 0 ||
      project.keywords.length > 0 ||
      (project.monitoring_focus?.trim() ?? "") !== "")
      ? await getProjectContextForRelevance(projectId)
      : "";

  return { projectContext, semanticScope: semanticScope || undefined };
}

/**
 * Distinct story ids from SourceMention for this project's keywords, most recent first, excluding already analyzed.
 */
export async function getCandidateHnStoryIds(projectId: string, limit: number): Promise<string[]> {
  const kwRows = await prisma.projectKeyword.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { keyword: true },
  });
  const keywords = kwRows.map((k) => k.keyword.trim()).filter(Boolean);
  if (keywords.length === 0) return [];

  const existing = await prisma.hnStoryAnalysis.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { hn_story_id: true },
  });
  const done = new Set(existing.map((e) => e.hn_story_id));

  const rows = await prisma.$queryRaw<Array<{ story_id: string }>>`
    SELECT sm.story_id AS story_id
    FROM SourceMention sm
    WHERE sm.source = 'hackernews'
    AND sm.deleted_at IS NULL
    AND sm.story_id IS NOT NULL
    AND sm.keyword IN (${Prisma.join(keywords)})
    GROUP BY sm.story_id
    ORDER BY MAX(sm.published_at_unix) DESC
    LIMIT ${limit * 4}
  `;

  const out: string[] = [];
  for (const r of rows) {
    if (!r.story_id || done.has(r.story_id)) continue;
    out.push(r.story_id);
    if (out.length >= limit) break;
  }
  return out;
}

function ideasFromAnalysisRow(row: {
  idea_1: string | null;
  idea_2: string | null;
  idea_3: string | null;
  idea_4: string | null;
  idea_5: string | null;
  idea_6: string | null;
  idea_7: string | null;
}): string[] {
  const cols = [row.idea_1, row.idea_2, row.idea_3, row.idea_4, row.idea_5, row.idea_6, row.idea_7];
  return cols.map((s) => (s && s.trim()) || "").filter(Boolean);
}

function buildSummaryLine(
  ideas: string[],
  title: string | null,
  commentsSummary: string | null
): string {
  const fromIdeas = ideas.slice(0, 3).join(" ");
  if (fromIdeas.trim().length > 0) return fromIdeas.trim().slice(0, 8000);
  if (commentsSummary && commentsSummary.trim().length > 0)
    return commentsSummary.trim().slice(0, 8000);
  return (title && title.trim()) || "";
}

const DEFAULT_ANALYSIS_CONCURRENCY = 10;
const MAX_ANALYSIS_CONCURRENCY = 50;

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

type OneStoryMetrics = {
  skippedAlreadyAnalyzed: number;
  storiesProcessed: number;
  skippedNotFound: number;
  skippedLowRelevanceOrAd: number;
  analysesCreated: number;
  postsCreated: number;
  sentimentAnalyzed: number;
  createdAnalysisId: string | null;
  preCheckError?: string;
};

async function analyzeSingleHnStory(
  storyId: string,
  projectId: string,
  projectContext: Awaited<ReturnType<typeof loadProjectContext>>["projectContext"],
  semanticScope: Awaited<ReturnType<typeof loadProjectContext>>["semanticScope"],
  options: RunHnStoryAnalysisOptions | undefined
): Promise<OneStoryMetrics> {
  const z = (): OneStoryMetrics => ({
    skippedAlreadyAnalyzed: 0,
    storiesProcessed: 0,
    skippedNotFound: 0,
    skippedLowRelevanceOrAd: 0,
    analysesCreated: 0,
    postsCreated: 0,
    sentimentAnalyzed: 0,
    createdAnalysisId: null,
  });

  throwIfAborted(options?.signal);

  const existing = await prisma.hnStoryAnalysis.findFirst({
    where: { project_id: projectId, hn_story_id: storyId },
  });
  if (existing) {
    return { ...z(), skippedAlreadyAnalyzed: 1 };
  }

  const out = z();
  out.storiesProcessed = 1;

  const story = await fetchItem(storyId);
  if (!story || story.type !== "story") {
    out.skippedNotFound = 1;
    console.warn(`${LOG_PREFIX} Story ${storyId} missing or not a story`);
    return out;
  }

  const storyUrl = hnItemUrl(storyId);
  const storyBody = buildStoryBodyText(story);
  const title = story.title ?? null;
  const storyPostedAt = story.time ? new Date(story.time * 1000) : null;

  let preCheck: { is_ad: boolean; relevance_score: number };
  try {
    if (storyBody.length < 100) {
      preCheck = await analyzeArticlePreCheckTitleOnly({
        articleTitle: title,
        projectContext,
        semanticScope,
      });
    } else {
      preCheck = await analyzeArticlePreCheck({
        articleTitle: title,
        articleText: storyBody,
        projectContext,
      });
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Pre-check failed for story ${storyId}:`, e);
    out.preCheckError = e instanceof Error ? e.message : "pre-check failed";
    return out;
  }

  if (preCheck.is_ad || preCheck.relevance_score < 2) {
    out.skippedLowRelevanceOrAd = 1;
    try {
      await prisma.hnStoryAnalysis.create({
        data: {
          id: generateId(),
          project_id: projectId,
          hn_story_id: storyId,
          story_url: storyUrl,
          title,
          story_text: storyBody || null,
          story_posted_at: storyPostedAt,
          relevance_score: preCheck.relevance_score,
          is_ad: preCheck.is_ad,
          ingested_run_id: options?.ingestedRunId ?? undefined,
        },
      });
      out.analysesCreated = 1;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        out.skippedAlreadyAnalyzed = 1;
        out.skippedLowRelevanceOrAd = 0;
      } else {
        throw err;
      }
    }
    return out;
  }

  let ideas: string[] = [];
  try {
    const textForIdeas = storyBody.length >= 40 ? storyBody : `${title ?? ""}\n\n${storyBody}`;
    ideas = await extractKeyIdeasFromArticle(textForIdeas || title || "");
  } catch (e) {
    console.error(`${LOG_PREFIX} Idea extraction failed for ${storyId}:`, e);
  }

  let threads: RankedCommentThread[] = [];
  let commentItemsById = new Map<number, HnFirebaseItem>();
  let engagementMeta: HnCommentsEngagementMeta = {
    topLevelCount: 0,
    fetchedCount: 0,
    threadRoots: [],
    storyPostedUnix: story.time ?? null,
  };
  try {
    const fetched = await fetchRankedCommentThreadsForStory(storyId);
    threads = fetched.threads;
    commentItemsById = fetched.commentItemsById;
    engagementMeta = {
      topLevelCount: fetched.meta.topLevelCount,
      fetchedCount: fetched.meta.fetchedCount,
      threadRoots: threads.map((t) => t.rootCommentId),
      storyPostedUnix: story.time ?? null,
    };
  } catch (e) {
    console.warn(`${LOG_PREFIX} Comment fetch failed for ${storyId}:`, e);
  }

  let commentsSummary: string | null = null;
  if (threads.length > 0) {
    try {
      commentsSummary = await summarizeHnCommentThreadsWithLLM({
        storyTitle: title,
        threads,
      });
    } catch (e) {
      console.warn(`${LOG_PREFIX} Comment summary LLM failed for ${storyId}:`, e);
    }
  }

  const ideaData = {
    idea_1: ideas[0] ?? null,
    idea_2: ideas[1] ?? null,
    idea_3: ideas[2] ?? null,
    idea_4: ideas[3] ?? null,
    idea_5: ideas[4] ?? null,
    idea_6: ideas[5] ?? null,
    idea_7: ideas[6] ?? null,
  };

  const summaryLine = buildSummaryLine(ideas, title, commentsSummary);

  let analysisId: string;
  try {
    const created = await prisma.hnStoryAnalysis.create({
      data: {
        id: generateId(),
        project_id: projectId,
        hn_story_id: storyId,
        story_url: storyUrl,
        title,
        story_text: storyBody || null,
        story_posted_at: storyPostedAt,
        summary: summaryLine || null,
        ...ideaData,
        relevance_score: preCheck.relevance_score,
        is_ad: false,
        comments_summary: commentsSummary,
        comments_engagement_meta: engagementMeta as unknown as Prisma.InputJsonValue,
        ingested_run_id: options?.ingestedRunId ?? undefined,
      },
    });
    analysisId = created.id;
    out.createdAnalysisId = analysisId;
    out.analysesCreated = 1;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ...z(), skippedAlreadyAnalyzed: 1 };
    }
    throw err;
  }

  const analysisRow = await prisma.hnStoryAnalysis.findUnique({
    where: { id: analysisId },
  });
  if (!analysisRow) return out;

  const ideaList = ideasFromAnalysisRow(analysisRow);
  const createdAt = storyPostedAt ?? new Date();
  const authorName = (title && title.trim()) || "Hacker News";
  const storyPostIds: number[] = [];

  const storyMetricsLikes = typeof story.score === "number" ? story.score : null;
  const storyMetricsComments = typeof story.descendants === "number" ? story.descendants : null;

  for (let i = 0; i < ideaList.length; i++) {
    const ideaText = ideaList[i];
    const n = i + 1;
    const postId = `${storyId}--idea-${n}`;

    const upserted = await prisma.post.upsert({
      where: {
        project_id_platform_postId: {
          project_id: projectId,
          platform: HN_PLATFORM,
          postId,
        },
      },
      create: {
        platform: HN_PLATFORM,
        postId,
        url: storyUrl,
        content: ideaText.slice(0, 50000),
        createdAt,
        project_id: projectId,
        authorName,
        hn_story_analysis_id: analysisId,
        metricsLikes: storyMetricsLikes,
        metricsComments: storyMetricsComments,
        extraJson: storyLevelExtraJson(storyId, engagementMeta, "idea"),
        ...(options?.ingestedRunId != null ? { ingested_run_id: options.ingestedRunId } : {}),
      },
      update: {
        content: ideaText.slice(0, 50000),
        url: storyUrl,
        createdAt,
        authorName,
        hn_story_analysis_id: analysisId,
        metricsLikes: storyMetricsLikes,
        metricsComments: storyMetricsComments,
        extraJson: storyLevelExtraJson(storyId, engagementMeta, "idea"),
      },
      select: { id: true },
    });
    storyPostIds.push(upserted.id);
    out.postsCreated += 1;
  }

  if (ideaList.length === 0) {
    const summaryText = (analysisRow.summary && analysisRow.summary.trim()) || "";
    if (summaryText.length > 0) {
      const postId = `${storyId}--summary`;
      const upserted = await prisma.post.upsert({
        where: {
          project_id_platform_postId: {
            project_id: projectId,
            platform: HN_PLATFORM,
            postId,
          },
        },
        create: {
          platform: HN_PLATFORM,
          postId,
          url: storyUrl,
          content: summaryText.slice(0, 50000),
          createdAt,
          project_id: projectId,
          authorName,
          hn_story_analysis_id: analysisId,
          metricsLikes: storyMetricsLikes,
          metricsComments: storyMetricsComments,
          extraJson: storyLevelExtraJson(storyId, engagementMeta, "summary"),
          ...(options?.ingestedRunId != null ? { ingested_run_id: options.ingestedRunId } : {}),
        },
        update: {
          content: summaryText.slice(0, 50000),
          url: storyUrl,
          createdAt,
          authorName,
          hn_story_analysis_id: analysisId,
          metricsLikes: storyMetricsLikes,
          metricsComments: storyMetricsComments,
          extraJson: storyLevelExtraJson(storyId, engagementMeta, "summary"),
        },
        select: { id: true },
      });
      storyPostIds.push(upserted.id);
      out.postsCreated += 1;
    }
  }

  const storyNumId = Number(storyId);
  const storyNumOk = Number.isFinite(storyNumId);
  for (const [cid, item] of commentItemsById) {
    if (!item || item.type !== "comment") continue;
    if (item.deleted || item.dead) continue;
    const rawText = item.text ? stripHtmlToPlainText(item.text) : "";
    const text = rawText.trim();
    if (!text) continue;

    const firebaseId = item.id ?? cid;
    const postId = String(firebaseId);
    const parent = item.parent;
    const threadRefId =
      storyNumOk && parent != null && parent !== storyNumId ? String(parent) : String(storyId);

    const commentCreated = item.time ? new Date(item.time * 1000) : createdAt;
    const replyCount = Array.isArray(item.kids) ? item.kids.length : null;
    const commentLikes = typeof item.score === "number" ? item.score : null;

    const commentUrl = hnItemUrl(postId);
    const cAuthor = (item.by && item.by.trim()) || null;

    const upserted = await prisma.post.upsert({
      where: {
        project_id_platform_postId: {
          project_id: projectId,
          platform: HN_PLATFORM,
          postId,
        },
      },
      create: {
        platform: HN_PLATFORM,
        postId,
        url: commentUrl,
        content: text.slice(0, 50000),
        createdAt: commentCreated,
        project_id: projectId,
        authorName: cAuthor,
        threadRefId,
        hn_story_analysis_id: analysisId,
        metricsLikes: commentLikes,
        metricsComments: replyCount,
        extraJson: commentPostExtraJson(storyId, firebaseId, engagementMeta),
        ...(options?.ingestedRunId != null ? { ingested_run_id: options.ingestedRunId } : {}),
      },
      update: {
        content: text.slice(0, 50000),
        url: commentUrl,
        createdAt: commentCreated,
        authorName: cAuthor,
        threadRefId,
        hn_story_analysis_id: analysisId,
        metricsLikes: commentLikes,
        metricsComments: replyCount,
        extraJson: commentPostExtraJson(storyId, firebaseId, engagementMeta),
      },
      select: { id: true },
    });
    storyPostIds.push(upserted.id);
    out.postsCreated += 1;
  }

  if (options?.ingestedRunId == null) {
    const needingSentiment = await prisma.post.findMany({
      where: {
        id: { in: storyPostIds },
        project_id: projectId,
        sentiment: null,
      },
      select: { id: true },
    });
    const sentimentIds = needingSentiment.map((p) => p.id);
    if (sentimentIds.length > 0) {
      const sres = await runSentimentForPostIds(projectId, sentimentIds);
      out.sentimentAnalyzed += sres.analyzed;
    }
  }

  return out;
}

/**
 * Run HN story analysis for a project: fetch Firebase story, pre-check, ideas, comments, Posts, sentiment, themes.
 */
export async function runHnStoryAnalysis(
  projectId: string,
  options?: RunHnStoryAnalysisOptions
): Promise<RunHnStoryAnalysisResult> {
  const result: RunHnStoryAnalysisResult = {
    candidatesSeen: 0,
    skippedAlreadyAnalyzed: 0,
    storiesProcessed: 0,
    skippedNotFound: 0,
    skippedLowRelevanceOrAd: 0,
    analysesCreated: 0,
    postsCreated: 0,
    sentimentAnalyzed: 0,
    themeMatches: 0,
  };

  /** When admin passes explicit story ids, allow up to this many analyses per run. */
  const FORCED_STORY_MAX = 2000;
  const uniqueFromOptions =
    options?.storyIds && options.storyIds.length > 0
      ? [...new Set(options.storyIds.map((s) => String(s).trim()).filter(Boolean))]
      : [];

  const limit =
    uniqueFromOptions.length > 0 && options?.forceStoryIds
      ? Math.max(
          1,
          Math.min(
            options?.limit ?? Math.min(uniqueFromOptions.length, FORCED_STORY_MAX),
            FORCED_STORY_MAX
          )
        )
      : Math.max(1, Math.min(options?.limit ?? 15, 100));

  let storyIds: string[] = [];

  if (uniqueFromOptions.length > 0) {
    if (options?.forceStoryIds) {
      storyIds = uniqueFromOptions.slice(0, limit);
    } else {
      const keywords = await prisma.projectKeyword.findMany({
        where: { project_id: projectId, deleted_at: null },
        select: { keyword: true },
      });
      const kwSet = new Set(keywords.map((k) => k.keyword.trim()));
      const existing = await prisma.hnStoryAnalysis.findMany({
        where: { project_id: projectId, deleted_at: null },
        select: { hn_story_id: true },
      });
      const done = new Set(existing.map((e) => e.hn_story_id));

      const mentionStoryIds = await prisma.sourceMention.findMany({
        where: {
          source: "hackernews",
          deleted_at: null,
          story_id: { in: uniqueFromOptions },
          keyword: { in: [...kwSet] },
        },
        distinct: ["story_id"],
        select: { story_id: true },
      });
      const allowed = new Set(
        mentionStoryIds.map((m) => m.story_id).filter((s): s is string => s != null)
      );
      storyIds = uniqueFromOptions.filter((id) => allowed.has(id) && !done.has(id)).slice(0, limit);
    }
  } else {
    storyIds = await getCandidateHnStoryIds(projectId, limit);
  }

  result.candidatesSeen = storyIds.length;
  if (storyIds.length === 0) {
    console.log(`${LOG_PREFIX} No candidate HN stories for project ${projectId}.`);
    return result;
  }

  const { projectContext, semanticScope } = await loadProjectContext(projectId);

  const createdAnalysisIds: string[] = [];

  const envConcRaw = process.env.HN_STORY_ANALYSIS_CONCURRENCY?.trim();
  const fromEnv = envConcRaw && envConcRaw !== "" ? Number.parseInt(envConcRaw, 10) : undefined;
  const concurrency = Math.max(
    1,
    Math.min(
      options?.analysisConcurrency ??
        (fromEnv != null && !Number.isNaN(fromEnv) ? fromEnv : DEFAULT_ANALYSIS_CONCURRENCY),
      MAX_ANALYSIS_CONCURRENCY
    )
  );

  const outcomes = await mapWithConcurrency(storyIds, concurrency, async (storyId) =>
    analyzeSingleHnStory(storyId, projectId, projectContext, semanticScope, options)
  );

  for (const o of outcomes) {
    result.skippedAlreadyAnalyzed += o.skippedAlreadyAnalyzed;
    result.storiesProcessed += o.storiesProcessed;
    result.skippedNotFound += o.skippedNotFound;
    result.skippedLowRelevanceOrAd += o.skippedLowRelevanceOrAd;
    result.analysesCreated += o.analysesCreated;
    result.postsCreated += o.postsCreated;
    result.sentimentAnalyzed += o.sentimentAnalyzed;
    if (o.createdAnalysisId) {
      createdAnalysisIds.push(o.createdAnalysisId);
    }
    if (o.preCheckError) {
      result.errorMessage = o.preCheckError;
    }
  }

  const deferToTaskAnalysis = options?.ingestedRunId != null;

  if (!deferToTaskAnalysis) {
    // Theme matching (same LLM path as blog; uses analysis summary + story URL).
    const projectThemes = await prisma.projectTheme.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { id: true, theme_name: true, description: true },
    });
    const qualifiedAnalyses = await prisma.hnStoryAnalysis.findMany({
      where: {
        id: { in: createdAnalysisIds },
        deleted_at: null,
        is_ad: { not: true },
        relevance_score: { gte: 2 },
        summary: { not: null },
      },
      select: {
        id: true,
        summary: true,
        story_url: true,
        title: true,
        created_at: true,
        story_posted_at: true,
      },
    });
    const withSummary = qualifiedAnalyses.filter(
      (r) => r.summary != null && String(r.summary).trim() !== ""
    );

    if (projectThemes.length > 0 && withSummary.length > 0) {
      const projectScopeForRelevance = await getProjectContextForRelevance(projectId);
      const projectBrandNames = await getProjectBrandNames(projectId);
      const themeBrandRequirements = buildThemeBrandRequirementsMap(
        projectThemes,
        projectBrandNames
      );

      const storyUrls = [
        ...new Set(withSummary.map((r) => (r.story_url || "").trim()).filter(Boolean)),
      ];
      const hnPostsForUrl = await prisma.post.findMany({
        where: {
          project_id: projectId,
          platform: HN_PLATFORM,
          url: { in: storyUrls },
        },
        select: { id: true, url: true },
        orderBy: { postId: "asc" },
      });
      const postIdByStoryUrl = new Map<string, number>();
      for (const p of hnPostsForUrl) {
        const u = (p.url || "").trim();
        if (u && !postIdByStoryUrl.has(u)) postIdByStoryUrl.set(u, p.id);
      }

      for (let offset = 0; offset < withSummary.length; offset += THEME_BATCH) {
        const batch = withSummary.slice(offset, offset + THEME_BATCH);
        try {
          const matches = await matchBlogSummariesToThemesWithLLM(
            projectScopeForRelevance,
            projectThemes,
            batch.map((r) => ({
              id: r.id,
              summary: r.summary ?? "",
              article_url: r.story_url,
              article_date: r.story_posted_at ?? r.created_at,
            }))
          );
          const linkedIdsForGate = new Set<number>();
          for (const r of batch) {
            const pid = r.story_url ? postIdByStoryUrl.get(r.story_url.trim()) : undefined;
            if (pid != null) linkedIdsForGate.add(pid);
          }
          const postsForBrandGate =
            linkedIdsForGate.size > 0
              ? await prisma.post.findMany({
                  where: { id: { in: [...linkedIdsForGate] } },
                  select: { id: true, content: true, authorName: true },
                })
              : [];
          const postByIdForBrandGate = new Map(postsForBrandGate.map((p) => [p.id, p]));

          for (const m of matches) {
            const item = batch[m.summary_index - 1];
            if (!item) continue;
            const linkedPostId = item.story_url
              ? postIdByStoryUrl.get(item.story_url.trim())
              : undefined;
            if (linkedPostId == null) continue;
            const postRow = postByIdForBrandGate.get(linkedPostId);
            const contentForBrandCheck = composePostTextForBrandGate(
              postRow ?? null,
              item.summary ?? ""
            );
            for (const t of m.themes) {
              const theme = projectThemes[t.theme_index - 1];
              if (!theme) continue;
              if (
                shouldRejectThemeMatchForEntityMismatch(
                  theme.theme_name,
                  contentForBrandCheck,
                  projectBrandNames,
                  theme.description,
                  themeBrandRequirements.get(theme.id)
                )
              ) {
                continue;
              }
              try {
                await prisma.themesAnalysis.create({
                  data: {
                    id: generateId(),
                    project_id: projectId,
                    theme_id: theme.id,
                    theme_name: sanitizeTextForDbStorage(theme.theme_name ?? null, 400) ?? "—",
                    post_id: linkedPostId,
                    platform: HN_PLATFORM,
                    post_content: sanitizeTextForDbStorage(item.summary ?? null, 4000),
                    post_url: sanitizeTextForDbStorage(item.story_url ?? null, 4000),
                    author_name:
                      sanitizeTextForDbStorage(
                        item.title && item.title.trim() ? item.title : null,
                        400
                      ) ?? undefined,
                    posted_at: item.story_posted_at ?? item.created_at ?? new Date(),
                    relevance_score: t.relevance,
                    analyzed_at: new Date(),
                  },
                });
                result.themeMatches++;
              } catch (e) {
                if (!isUniqueConstraintError(e)) throw e;
              }
            }
          }
        } catch (err) {
          console.error(`${LOG_PREFIX} Theme batch failed (offset ${offset}):`, err);
        }
      }
    }

    try {
      const { runSanitizationForProject } = await import("@/lib/comprehensive-analysis");
      await runSanitizationForProject(projectId, { news: true, themes: true });
    } catch (e) {
      console.warn(`${LOG_PREFIX} Sanitization skipped or failed:`, e);
    }
  } else {
    console.log(
      `${logTs()} ${LOG_PREFIX} Skipping inline theme matching and sanitization (ingested_run_id=${options.ingestedRunId}); orchestration task-based analysis will run.`
    );
  }

  console.log(
    `${logTs()} ${LOG_PREFIX} Done. concurrency=${concurrency} candidates=${result.candidatesSeen} processed=${result.storiesProcessed} ` +
      `skippedDup=${result.skippedAlreadyAnalyzed} notFound=${result.skippedNotFound} lowRel=${result.skippedLowRelevanceOrAd} ` +
      `analyses=${result.analysesCreated} posts=${result.postsCreated} sentiment=${result.sentimentAnalyzed} themes=${result.themeMatches}`
  );

  return result;
}
