import { prisma } from "@/lib/prisma";
import { ulid as generateUlid } from "ulid";

type NumericProgressColumns =
  | "last_sentiment_post_id"
  | "last_chatter_post_id"
  | "last_themes_post_id"
  | "last_network_post_id"
  | "last_news_post_id"
  | "last_brand_post_id";

type TimestampProgressColumns =
  | "last_sanitized_chatter_at"
  | "last_sanitized_themes_at"
  | "last_sanitized_network_at"
  | "last_sanitized_news_at";

/** Blog analysis cursor: BlogPost.id (ULID) of last analyzed post; null = start from beginning. */
type BlogAnalysisProgressColumn = "last_blog_analysis_post_id";

type ProgressUpdates = Partial<Record<NumericProgressColumns, number>> &
  Partial<Record<TimestampProgressColumns, Date | null>> &
  Partial<Record<BlogAnalysisProgressColumn, string | null>>;

type AnalysisClient = Pick<typeof prisma, "analysisProgress">;

export async function getOrCreateAnalysisProgress(projectId: string) {
  const existing = await prisma.analysisProgress.findUnique({
    where: { project_id: projectId },
  });

  if (existing) {
    return existing;
  }

  return prisma.analysisProgress.create({
    data: {
      id: generateUlid(),
      project_id: projectId,
      last_blog_analysis_post_id: null,
    },
  });
}

export async function updateAnalysisProgress(projectId: string, updates: ProgressUpdates) {
  if (Object.keys(updates).length === 0) {
    return getOrCreateAnalysisProgress(projectId);
  }

  return prisma.analysisProgress.upsert({
    where: { project_id: projectId },
    update: updates,
    create: {
      id: generateUlid(),
      project_id: projectId,
      ...updates,
    },
  });
}

interface ResetAnalysisProgressOptions {
  resetSentiment?: boolean;
}

export async function resetAnalysisProgress(
  projectId: string,
  options: ResetAnalysisProgressOptions = {},
  client?: AnalysisClient
) {
  const { resetSentiment = true } = options;

  const db = client ?? prisma;

  const existing = await db.analysisProgress.findUnique({
    where: { project_id: projectId },
  });

  const oldValues = existing
    ? {
        last_sentiment_post_id: existing.last_sentiment_post_id,
        last_chatter_post_id: existing.last_chatter_post_id,
        last_themes_post_id: existing.last_themes_post_id,
        last_network_post_id: existing.last_network_post_id,
        last_news_post_id: existing.last_news_post_id,
        last_brand_post_id: existing.last_brand_post_id,
        last_blog_analysis_post_id: existing.last_blog_analysis_post_id,
      }
    : null;

  if (existing) {
    await db.analysisProgress.update({
      where: { project_id: projectId },
      data: {
        ...(resetSentiment ? { last_sentiment_post_id: 0 } : {}),
        last_chatter_post_id: 0,
        last_themes_post_id: 0,
        last_network_post_id: 0,
        last_news_post_id: 0,
        last_brand_post_id: 0,
        last_blog_analysis_post_id: null,
        last_sanitized_chatter_at: null,
        last_sanitized_themes_at: null,
        last_sanitized_network_at: null,
        last_sanitized_news_at: null,
      },
    });
    console.log(`[resetAnalysisProgress] ✅ Reset counters for project ${projectId}:`, {
      before: oldValues,
      after: {
        last_sentiment_post_id: resetSentiment ? 0 : existing.last_sentiment_post_id,
        last_chatter_post_id: 0,
        last_themes_post_id: 0,
        last_network_post_id: 0,
        last_news_post_id: 0,
        last_brand_post_id: 0,
        last_blog_analysis_post_id: null,
      },
    });
  } else {
    await db.analysisProgress.create({
      data: {
        id: generateUlid(),
        project_id: projectId,
        last_sentiment_post_id: resetSentiment ? 0 : 0,
        last_chatter_post_id: 0,
        last_themes_post_id: 0,
        last_network_post_id: 0,
        last_news_post_id: 0,
        last_brand_post_id: 0,
        last_blog_analysis_post_id: null,
        last_sanitized_chatter_at: null,
        last_sanitized_themes_at: null,
        last_sanitized_network_at: null,
        last_sanitized_news_at: null,
      },
    });
    console.log(
      `[resetAnalysisProgress] ✅ Created new progress record for project ${projectId} with all counters at 0`
    );
  }
}

/**
 * Set all analysis counters to the given post id so the next run only processes
 * posts with id > postId (e.g. after deleting YouTube, set to max non-YouTube id
 * so only re-scraped YouTube gets analyzed).
 */
export async function rewindAnalysisProgressToPostId(
  projectId: string,
  postId: number,
  client?: AnalysisClient
) {
  const db = client ?? prisma;
  const updates: Record<NumericProgressColumns, number> = {
    last_sentiment_post_id: postId,
    last_chatter_post_id: postId,
    last_themes_post_id: postId,
    last_network_post_id: postId,
    last_news_post_id: postId,
    last_brand_post_id: postId,
  };
  await db.analysisProgress.upsert({
    where: { project_id: projectId },
    update: updates,
    create: {
      id: generateUlid(),
      project_id: projectId,
      ...updates,
    },
  });
}

/**
 * Get the BlogPost.id (ULID) of the last analyzed blog post for this project.
 * Null means no blog analysis has run yet or cursor was reset; next run should process from the start.
 */
export async function getBlogAnalysisCursor(
  projectId: string,
  client?: AnalysisClient
): Promise<string | null> {
  const db = client ?? prisma;
  const progress = await db.analysisProgress.findUnique({
    where: { project_id: projectId },
    select: { last_blog_analysis_post_id: true },
  });
  return progress?.last_blog_analysis_post_id ?? null;
}

/**
 * Update the blog analysis cursor to the given BlogPost.id (ULID).
 * Call after processing BlogPost rows so the next run only processes id > cursor.
 */
export async function updateBlogAnalysisCursor(
  projectId: string,
  blogPostId: string,
  client?: AnalysisClient
) {
  const db = client ?? prisma;
  await db.analysisProgress.upsert({
    where: { project_id: projectId },
    update: { last_blog_analysis_post_id: blogPostId },
    create: {
      id: generateUlid(),
      project_id: projectId,
      last_blog_analysis_post_id: blogPostId,
    },
  });
}
