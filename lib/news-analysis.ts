/**
 * News Analysis Service using OpenAI API
 * Analyzes batches of posts to extract news items, trends, and insights
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import { detectLanguage } from "@/lib/utils/language-detector";
import {
  getSourceFilterDbValues,
  isBlogPlatform,
  isFullSourceFilterSelection,
  normalizeSourceForDisplay,
} from "@/lib/utils/platform";
import { generatePostLink } from "@/lib/post-links";
import { ulid as generateUlid } from "ulid";
import {
  analyzeNewsInBatch,
  checkRelevanceBatch,
  getProjectContextForRelevance,
} from "@/lib/comprehensive-analysis";

export interface PostThread {
  rootPost: {
    id: number;
    postId: string;
    authorName?: string;
    content?: string;
    createdAt: Date;
    url?: string;
    metricsLikes?: number;
    metricsComments?: number;
    metricsShares?: number;
  };
  comments: Array<{
    id: number;
    authorName?: string;
    content?: string;
    createdAt: Date;
  }>;
}

export interface NewsItem {
  title: string;
  summary: string;
  content?: string;
  sentiment: string;
  importance_score: number;
  tags: string[];
  post_ids: number[];
  date_range_start: Date;
  date_range_end: Date;
}

/**
 * Build thread hierarchies for Reddit and X posts
 * Groups comments with their root posts
 */
async function buildThreadHierarchies(
  platform: string,
  posts: Array<{
    id: number;
    postId: string;
    authorName?: string;
    content?: string;
    createdAt: Date;
    url?: string;
    threadRefId?: string;
    metricsLikes?: number;
    metricsComments?: number;
    metricsShares?: number;
  }>
): Promise<PostThread[]> {
  // For platforms that support threading (Reddit, X, Twitter — same as comprehensive analysis)
  if (!["reddit", "x", "twitter"].includes(platform.toLowerCase())) {
    // For non-threaded platforms, each post is its own "thread"
    return posts.map((post) => ({
      rootPost: post,
      comments: [],
    }));
  }

  // Separate root posts from comments
  const rootPosts = posts.filter((p) => !p.threadRefId);
  const comments = posts.filter((p) => p.threadRefId);

  // Build a map of postId -> post for quick lookup
  const postMap = new Map(posts.map((p) => [p.postId, p]));

  // Build threads
  const threads: PostThread[] = rootPosts.map((root) => {
    // Find all comments that reference this root post (directly or indirectly)
    const threadComments = comments.filter((comment) => {
      if (!comment.threadRefId) return false;

      // Direct reply to root
      if (comment.threadRefId === root.postId) return true;

      // Reply to a comment in this thread (traverse up)
      let parent = postMap.get(comment.threadRefId);
      while (parent && parent.threadRefId) {
        if (parent.threadRefId === root.postId) return true;
        parent = postMap.get(parent.threadRefId);
      }

      return false;
    });

    return {
      rootPost: root,
      comments: threadComments,
    };
  });

  return threads;
}

/**
 * Extract news from a batch using the same model path as `synthesizeNews` (comprehensive analysis).
 * The previous prompt here required "formal announcements only" and excluded "user discussions",
 * which made **all** social content return 0 items — contradictory to the shared News extractor.
 */
async function analyzePostBatch(
  platform: string,
  threads: PostThread[],
  projectId: string,
  projectContext: string
): Promise<NewsItem[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  if (threads.length === 0) {
    return [];
  }

  try {
    const mappedThreads = threads.map((t) => ({
      rootPost: t.rootPost,
      comments: t.comments,
    }));
    const result = await analyzeNewsInBatch(platform, mappedThreads, projectId, projectContext);
    const raw = result.items as NewsItem[];
    return raw.map((item) => {
      const ids = Array.isArray(item.post_ids) ? item.post_ids : [];
      const numericIds = ids
        .map((id) => (typeof id === "string" ? parseInt(id, 10) : id))
        .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
      const finalPostIds =
        numericIds.length > 0 ? numericIds : threads.length > 0 ? [threads[0].rootPost.id] : [];
      return { ...item, post_ids: finalPostIds };
    });
  } catch (error) {
    console.error(`Error analyzing news for ${platform}:`, error);
    return [];
  }
}

/**
 * Analyze news for posts grouped by platform
 */
export async function analyzeProjectNews(
  projectId: string,
  options: {
    dateRangeStart?: Date;
    dateRangeEnd?: Date;
    platforms?: string[];
    requireSentiment?: boolean; // Default true - only analyze posts with sentiment
    append?: boolean; // When false, existing news items are soft-deleted before re-analysis
  } = {}
): Promise<{
  processed: number;
  newsItems: number;
  duration: number;
  platforms: Record<string, number>;
}> {
  const startTime = Date.now();
  const { requireSentiment = true } = options;

  if (!options.append) {
    await prisma.postNews.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
  }

  // Build query filters
  const whereClause: any = {
    project_id: projectId,
    content: { not: null },
    NOT: { content: "" },
  };

  // Only analyze posts that have been sentiment analyzed (default behavior)
  if (requireSentiment) {
    whereClause.sentiment = { not: null };
  }

  if (options.dateRangeStart && options.dateRangeEnd) {
    whereClause.createdAt = {
      gte: options.dateRangeStart,
      lte: options.dateRangeEnd,
    };
  } else if (options.dateRangeStart) {
    whereClause.createdAt = { gte: options.dateRangeStart };
  } else if (options.dateRangeEnd) {
    whereClause.createdAt = { lte: options.dateRangeEnd };
  }

  if (options.platforms && options.platforms.length > 0) {
    whereClause.platform = { in: options.platforms };
  }

  // Get all posts for analysis
  const rawPosts = await prisma.post.findMany({
    where: whereClause,
    select: {
      id: true,
      postId: true,
      platform: true,
      authorName: true,
      content: true,
      createdAt: true,
      url: true,
      threadRefId: true,
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (rawPosts.length === 0) {
    return {
      processed: 0,
      newsItems: 0,
      duration: 0,
      platforms: {},
    };
  }

  const projectContext = await getProjectContextForRelevance(projectId);

  // Convert null to undefined for type compatibility
  const posts = rawPosts.map((post) => ({
    id: post.id,
    postId: post.postId,
    platform: post.platform,
    authorName: post.authorName ?? undefined,
    content: post.content ?? undefined,
    createdAt: post.createdAt,
    url: post.url ?? undefined,
    threadRefId: post.threadRefId ?? undefined,
    metricsLikes: post.metricsLikes ?? undefined,
    metricsComments: post.metricsComments ?? undefined,
    metricsShares: post.metricsShares ?? undefined,
  }));

  // Group posts by platform
  const postsByPlatform = posts.reduce(
    (acc, post) => {
      const platform = post.platform.toLowerCase();
      if (!acc[platform]) {
        acc[platform] = [];
      }
      acc[platform].push(post);
      return acc;
    },
    {} as Record<string, typeof posts>
  );

  let totalNewsItems = 0;
  const platformStats: Record<string, number> = {};

  // Process each platform
  for (const [platform, platformPosts] of Object.entries(postsByPlatform)) {
    console.log(`Analyzing ${platformPosts.length} posts from ${platform}...`);

    // Build thread hierarchies
    const threads = await buildThreadHierarchies(platform, platformPosts);

    // Align with synthesizeNews: many social posts have null/low metrics — do not require 50+ engagement.
    const MIN_ENGAGEMENT_THRESHOLD = 10;
    let filteredThreads = threads.filter((thread) => {
      const engagement =
        (thread.rootPost.metricsLikes || 0) +
        (thread.rootPost.metricsComments || 0) +
        (thread.rootPost.metricsShares || 0);
      return engagement >= MIN_ENGAGEMENT_THRESHOLD;
    });
    if (filteredThreads.length === 0 && threads.length > 0) {
      filteredThreads = [...threads]
        .sort((a, b) => {
          const engA =
            (a.rootPost.metricsLikes || 0) +
            (a.rootPost.metricsComments || 0) +
            (a.rootPost.metricsShares || 0);
          const engB =
            (b.rootPost.metricsLikes || 0) +
            (b.rootPost.metricsComments || 0) +
            (b.rootPost.metricsShares || 0);
          return engB - engA;
        })
        .slice(0, 50);
      console.log(
        `[News] No threads with engagement >= ${MIN_ENGAGEMENT_THRESHOLD}; using top ${filteredThreads.length} by engagement (same fallback as synthesizeNews)`
      );
    }

    console.log(
      `Filtered ${threads.length} threads to ${filteredThreads.length} for news extraction (threshold ${MIN_ENGAGEMENT_THRESHOLD} or top-50 fallback)`
    );

    // Batch threads for OpenAI analysis (to avoid token limits)
    const batchSize = (await configService.getConfig("performance", "news_batch_size")) || 20;
    const threadBatches = [];
    for (let i = 0; i < filteredThreads.length; i += batchSize) {
      threadBatches.push(filteredThreads.slice(i, i + batchSize));
    }

    // Analyze each batch
    for (const batch of threadBatches) {
      const newsItems = await analyzePostBatch(platform, batch, projectId, projectContext);

      // Model often assigns 55–59 for valid social items; 60+ was dropping almost everything non-blog
      const MIN_IMPORTANCE_SCORE = 50;
      const highImportanceItems = newsItems.filter(
        (item) => (item.importance_score || 0) >= MIN_IMPORTANCE_SCORE
      );

      console.log(
        `Filtered ${newsItems.length} news items to ${highImportanceItems.length} with importance_score >= ${MIN_IMPORTANCE_SCORE}`
      );

      // Save news items to database
      for (const item of highImportanceItems) {
        // Determine primary language and primary post link from the posts in this news item
        let primaryLanguage = null;
        let sourceUrl: string | null = null;
        if (item.post_ids && item.post_ids.length > 0) {
          const newsItemPosts = await prisma.post.findMany({
            where: { id: { in: item.post_ids } },
            select: {
              id: true,
              language: true,
              url: true,
              postId: true,
              platform: true,
              channelId: true,
            },
          });
          const langCounts = new Map<string, number>();
          newsItemPosts.forEach((p) => {
            if (p.language) {
              langCounts.set(p.language, (langCounts.get(p.language) || 0) + 1);
            }
          });
          primaryLanguage =
            langCounts.size > 0
              ? Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
              : null;
          const firstPost = newsItemPosts.find((p) => p.id === item.post_ids[0]);
          if (firstPost) {
            sourceUrl =
              generatePostLink({
                url: firstPost.url ?? undefined,
                platform: firstPost.platform ?? platform,
                postId: firstPost.postId,
                channelId: firstPost.channelId ?? undefined,
              }) ??
              firstPost.url ??
              null;
          }
        }
        // If no language from posts, detect from news title/summary so filter works
        if (primaryLanguage == null) {
          const textForDetection = [item.title, item.summary, item.content]
            .filter(Boolean)
            .join(" ");
          primaryLanguage = detectLanguage(textForDetection, 3) ?? null;
        }

        await prisma.postNews.create({
          data: {
            id: generateUlid(),
            project_id: projectId,
            title: item.title,
            summary: item.summary,
            content: item.content,
            sentiment: item.sentiment,
            importance_score: item.importance_score,
            tags: JSON.stringify(item.tags),
            post_ids: JSON.stringify(item.post_ids),
            sources: JSON.stringify([platform]),
            ...(sourceUrl != null && sourceUrl.trim() !== "" && { source_url: sourceUrl }),
            date_range_start: new Date(item.date_range_start),
            date_range_end: new Date(item.date_range_end),
            language: primaryLanguage,
          },
        });

        totalNewsItems++;
      }

      // Add delay between batches to respect rate limits
      if (threadBatches.indexOf(batch) < threadBatches.length - 1) {
        const delay = (await configService.getConfig("performance", "news_batch_delay")) || 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    platformStats[platform] = threadBatches.length;
  }

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  return {
    processed: posts.length,
    newsItems: totalNewsItems,
    duration,
    platforms: platformStats,
  };
}

/**
 * Calculate similarity score between two titles (0-1)
 * Uses word overlap and common phrases
 */
function calculateTitleSimilarity(title1: string, title2: string): number {
  // Normalize titles: lowercase, remove extra spaces
  const normalize = (str: string) => str.toLowerCase().trim().replace(/\s+/g, " ");
  const norm1 = normalize(title1);
  const norm2 = normalize(title2);

  // If titles are identical, similarity is 1.0
  if (norm1 === norm2) return 1.0;

  // Split into words
  const words1 = new Set(norm1.split(" "));
  const words2 = new Set(norm2.split(" "));

  // Calculate Jaccard similarity (intersection over union)
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  const jaccard = intersection.size / union.size;

  // Boost similarity if there are significant common phrases (3+ words)
  let phraseBonus = 0;
  for (const word of words1) {
    if (norm2.includes(word)) {
      // Try to find 3-word or 4-word phrases
      const phrase1 = norm1.substring(
        norm1.indexOf(word),
        Math.min(norm1.indexOf(word) + 50, norm1.length)
      );
      const phrase2 = norm2.substring(
        norm2.indexOf(word),
        Math.min(norm2.indexOf(word) + 50, norm2.length)
      );

      // Check for common 3-4 word sequences
      const words1_sub = phrase1.split(" ").slice(0, 4);
      const words2_sub = phrase2.split(" ").slice(0, 4);

      let commonLength = 0;
      for (let i = 0; i < Math.min(words1_sub.length, words2_sub.length); i++) {
        if (words1_sub[i] === words2_sub[i]) {
          commonLength++;
        } else {
          break;
        }
      }

      if (commonLength >= 3) {
        phraseBonus += 0.3;
      }
    }
  }

  return Math.min(jaccard + phraseBonus, 1.0);
}

/**
 * Deduplicate news items based on title similarity
 * Keeps the latest item when duplicates are found
 */
function deduplicateNewsItems(items: any[]): any[] {
  if (items.length === 0) return items;

  // Sort by date (newest first)
  const sorted = [...items].sort((a, b) => {
    const dateA = a.date_range_start ? new Date(a.date_range_start).getTime() : 0;
    const dateB = b.date_range_start ? new Date(b.date_range_start).getTime() : 0;
    return dateB - dateA;
  });

  const result: any[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    if (processed.has(sorted[i].id)) continue;

    const current = sorted[i];
    const duplicates: any[] = [current];

    // Find similar items (check items that come after current)
    for (let j = i + 1; j < sorted.length; j++) {
      if (processed.has(sorted[j].id)) continue;

      const similarity = calculateTitleSimilarity(current.title, sorted[j].title);

      // Threshold for considering items as duplicates
      if (similarity > 0.6) {
        duplicates.push(sorted[j]);
        processed.add(sorted[j].id);
      }
    }

    // Keep the latest item, but merge post_ids and sources from all duplicates
    const latestItem = duplicates[0]; // Already sorted by date, newest first

    // Merge post_ids and sources from all duplicates
    const allPostIds = new Set(latestItem.post_ids || []);
    const allSources = new Set(latestItem.sources || []);

    duplicates.forEach((dup) => {
      if (dup.post_ids) {
        dup.post_ids.forEach((id: any) => allPostIds.add(id));
      }
      if (dup.sources) {
        dup.sources.forEach((source: any) => allSources.add(source));
      }
    });

    // Update the latest item with merged data
    latestItem.post_ids = Array.from(allPostIds);
    latestItem.sources = Array.from(allSources);

    result.push(latestItem);
    processed.add(current.id);
  }

  // Sort result by importance_score, then by date (descending)
  return result.sort((a, b) => {
    const importanceDiff = (b.importance_score || 0) - (a.importance_score || 0);
    if (importanceDiff !== 0) return importanceDiff;

    const dateA = a.date_range_start ? new Date(a.date_range_start).getTime() : 0;
    const dateB = b.date_range_start ? new Date(b.date_range_start).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Get news items for a project with relevance filtering
 */
export async function getProjectNews(
  projectId: string,
  options: {
    limit?: number;
    offset?: number;
    minImportance?: number;
    dateRangeStart?: Date;
    dateRangeEnd?: Date;
    language?: string;
    /** When set, only return items whose sources include at least one of these (e.g. ["blog"]). Fetches more from DB then filters so filtered views get results. */
    sourceFilter?: string[];
  } = {}
) {
  // Default minimum importance score to 60 (matching the analysis threshold)
  const { limit = 50, offset = 0, minImportance = 60, sourceFilter } = options;

  /** Explicit empty array from the client = user disabled all sources; show no items. */
  if (sourceFilter !== undefined && sourceFilter.length === 0) {
    return {
      newsItems: [],
      total: 0,
      hasMore: false,
    };
  }

  // Build source conditions for DB filter (shared util handles blog/blogs equivalence)
  const sourceConditions: { sources: { contains: string } }[] = [];
  const applySourceFilter =
    Boolean(sourceFilter?.length) && !isFullSourceFilterSelection(sourceFilter);
  if (applySourceFilter) {
    for (const s of sourceFilter!) {
      for (const dbVal of getSourceFilterDbValues(s)) {
        sourceConditions.push({ sources: { contains: `"${dbVal}"` } });
      }
    }
  }

  // Single AND array so Prisma/SQLite applies all conditions correctly (no mixed top-level OR/AND)
  const andParts: any[] = [{ project_id: projectId }, { deleted_at: null }];
  if (minImportance > 0) {
    andParts.push({ importance_score: { gte: minImportance } });
  }
  if (options.dateRangeStart) {
    andParts.push({ date_range_start: { gte: options.dateRangeStart } });
  }
  if (options.dateRangeEnd) {
    andParts.push({ date_range_end: { lte: options.dateRangeEnd } });
  }
  // Language: match selected language OR null (undetected)
  if (options.language && options.language !== "all") {
    andParts.push({ OR: [{ language: options.language }, { language: null }] });
  }
  if (sourceConditions.length > 0) {
    andParts.push({ OR: sourceConditions });
  }

  const whereClause = { AND: andParts };

  const fetchLimit = applySourceFilter ? limit * 2 : limit * 2;

  let newsItems: any[] = [];
  let total = 0;

  try {
    newsItems = await prisma.postNews.findMany({
      where: whereClause,
      orderBy: [{ importance_score: "desc" }, { date_range_start: "desc" }],
      take: fetchLimit,
      skip: applySourceFilter ? 0 : offset,
    });

    total = await prisma.postNews.count({
      where: whereClause,
    });

    if (applySourceFilter && newsItems.length === 0) {
      const totalAny = await prisma.postNews.count({
        where: { project_id: projectId, deleted_at: null },
      });
      const sample = await prisma.postNews.findFirst({
        where: { project_id: projectId, deleted_at: null },
        select: { id: true, sources: true, title: true },
      });
      console.log(
        `[News] sourceFilter=[${sourceFilter?.join(",") ?? ""}] returned 0; project total PostNews=${totalAny}; sample row sources=${sample?.sources ?? "null"}`
      );
    }
  } catch (error: any) {
    // Handle case where language column doesn't exist in database
    if (error?.message?.includes("language") || error?.message?.includes("no such column")) {
      console.warn(
        `[News] Language column may not exist in PostNews table. Retrying without language filter...`
      );
      // Retry without language condition (strip OR with language from AND array)
      const andWithoutLanguage = andParts.filter(
        (p: any) => !(p.OR && Array.isArray(p.OR) && p.OR.some((o: any) => "language" in o))
      );
      const whereClauseWithoutLanguage = { AND: andWithoutLanguage };

      newsItems = await prisma.postNews.findMany({
        where: whereClauseWithoutLanguage,
        orderBy: [{ importance_score: "desc" }, { date_range_start: "desc" }],
        take: fetchLimit,
        skip: applySourceFilter ? 0 : offset,
      });

      total = await prisma.postNews.count({
        where: whereClauseWithoutLanguage,
      });
    } else {
      // Re-throw if it's a different error
      throw error;
    }
  }

  // Parse and deduplicate news items. Normalize "blogs" -> "blog" so UI source filter (blog) matches.
  const parsedItems = newsItems.map((item) => {
    try {
      const rawSources: string[] = item.sources ? JSON.parse(item.sources) : [];
      const sources = rawSources.map((s) => normalizeSourceForDisplay(s) || s);
      return {
        ...item,
        tags: item.tags ? JSON.parse(item.tags) : [],
        post_ids: item.post_ids ? JSON.parse(item.post_ids) : [],
        sources,
      };
    } catch (error) {
      console.error(`Error parsing JSON for news item ${item.id}:`, error);
      return {
        ...item,
        tags: [],
        post_ids: [],
        sources: [],
      };
    }
  });

  // Filter by source when requested (e.g. only blog); expand keys via getSourceFilterDbValues
  let afterSourceFilter = parsedItems;
  if (applySourceFilter) {
    const allowed = new Set<string>();
    for (const s of sourceFilter!) {
      for (const v of getSourceFilterDbValues(s)) {
        allowed.add(v.toLowerCase());
      }
    }
    afterSourceFilter = parsedItems.filter((item) => {
      const sources = item.sources || [];
      return sources.some((s: string) => allowed.has(String(s).toLowerCase()));
    });
  }

  // Deduplicate similar news items. No LLM filtering — UI reads strictly from DB.
  const deduplicatedItems = deduplicateNewsItems(afterSourceFilter);

  // Apply offset when not using source filter; then take limit
  const offsetToUse = applySourceFilter ? 0 : offset;
  const finalItems = deduplicatedItems.slice(offsetToUse, offsetToUse + limit);

  // Prefetch primary posts (first post_id) for deep linking
  const primaryPostIds = finalItems
    .map((item) => {
      if (Array.isArray(item.post_ids) && item.post_ids.length > 0) {
        const firstId = Number(item.post_ids[0]);
        return Number.isFinite(firstId) ? firstId : null;
      }
      return null;
    })
    .filter((id): id is number => id !== null);

  const primaryPosts = primaryPostIds.length
    ? await prisma.post.findMany({
        where: { id: { in: primaryPostIds } },
        select: {
          id: true,
          postId: true,
          platform: true,
          url: true,
          channelId: true,
          createdAt: true,
          content: true,
        },
      })
    : [];

  const primaryPostMap = new Map(
    primaryPosts.map((post) => [
      post.id,
      {
        id: post.id,
        externalId: post.postId,
        platform: post.platform,
        url: post.url,
        channelId: post.channelId,
        createdAt: post.createdAt.toISOString(),
        content: post.content ?? undefined,
      },
    ])
  );

  // Resolve blog article URLs when Post.url is null (postId = hash(article_url)--idea-n or id--idea-n)
  const blogPrimaryPosts = primaryPosts.filter((p) => isBlogPlatform(p.platform) && !p.url);
  const hasBlogItems = finalItems.some((item) =>
    (item.sources ?? []).some((s: string) => isBlogPlatform(s))
  );
  let blogArticleUrlByHashPrefix: Map<string, string> | null = null;
  let blogUrlByContent: Map<string, string> | null = null;
  let blogUrlByTitle: Map<string, string> | null = null;
  let blogPostUrlByTitle: Map<string, string> | null = null;
  /** Fallback: match by word overlap when title substring fails (news titles are LLM summaries, not article titles). */
  const blogCandidatesForWordMatch: Array<{ title: string; url: string }> = [];
  if (blogPrimaryPosts.length > 0 || hasBlogItems) {
    const [analyses, blogPosts] = await Promise.all([
      prisma.blogNewsAnalysis.findMany({
        where: { project_id: projectId, deleted_at: null },
        select: {
          id: true,
          article_url: true,
          source_url: true,
          article_title: true,
          idea_1: true,
          idea_2: true,
          idea_3: true,
          idea_4: true,
          idea_5: true,
          idea_6: true,
          idea_7: true,
        },
      }),
      prisma.blogPost.findMany({
        where: { project_id: projectId, deleted_at: null },
        select: { article_url: true, article_title: true },
      }),
    ]);
    const map = new Map<string, string>();
    const byContent = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const a of analyses) {
      const u = (a.article_url ?? a.source_url ?? "").trim();
      if (u) {
        const hashPrefix = crypto.createHash("sha256").update(u).digest("hex").slice(0, 24);
        map.set(hashPrefix, u);
      }
      const idPrefix = (a.id ?? "").slice(0, 24);
      if (idPrefix && u) map.set(idPrefix, u);
      const urlForRow = u || (a.article_url ?? a.source_url ?? "").trim();
      const titleNorm = (a.article_title ?? "").trim().toLowerCase().slice(0, 120);
      if (titleNorm && urlForRow) byTitle.set(titleNorm, urlForRow);
      const ideaCols = [
        a.idea_1,
        a.idea_2,
        a.idea_3,
        a.idea_4,
        a.idea_5,
        a.idea_6,
        a.idea_7,
      ].filter(Boolean) as string[];
      for (const idea of ideaCols) {
        const key = idea.trim().slice(0, 400);
        if (key && urlForRow) byContent.set(key, urlForRow);
      }
    }
    const bpTitleMap = new Map<string, string>();
    for (const bp of blogPosts) {
      const u = (bp.article_url ?? "").trim();
      const t = (bp.article_title ?? "").trim().toLowerCase();
      if (!u || !t) continue;
      for (const len of [120, 80, 60, 40]) {
        if (t.length >= len) bpTitleMap.set(t.slice(0, len), u);
      }
    }
    blogArticleUrlByHashPrefix = map;
    blogUrlByContent = byContent;
    blogUrlByTitle = byTitle;
    blogPostUrlByTitle = bpTitleMap.size > 0 ? bpTitleMap : null;
    for (const a of analyses) {
      const u = (a.article_url ?? a.source_url ?? "").trim();
      const t = (a.article_title ?? "").trim();
      if (u && t) blogCandidatesForWordMatch.push({ title: t, url: u });
    }
    for (const bp of blogPosts) {
      const u = (bp.article_url ?? "").trim();
      const t = (bp.article_title ?? "").trim();
      if (u && t) blogCandidatesForWordMatch.push({ title: t, url: u });
    }
  }

  const enrichedItems = finalItems.map((item) => {
    const primaryPostId =
      Array.isArray(item.post_ids) && item.post_ids.length > 0 ? Number(item.post_ids[0]) : null;
    const primary_post = primaryPostId ? (primaryPostMap.get(primaryPostId) ?? null) : null;
    const linkFromPost =
      primary_post &&
      generatePostLink({
        url: primary_post.url ?? undefined,
        platform: primary_post.platform,
        postId: primary_post.externalId,
        channelId: primary_post.channelId ?? undefined,
      });
    let resolvedLink = item.source_url || linkFromPost || (primary_post?.url ?? null);
    if (
      !resolvedLink &&
      (blogArticleUrlByHashPrefix ||
        blogUrlByTitle ||
        blogPostUrlByTitle ||
        blogCandidatesForWordMatch.length > 0)
    ) {
      const isBlogItem = (item.sources ?? []).some((s: string) => isBlogPlatform(s));
      if (primary_post && isBlogPlatform(primary_post.platform)) {
        if (primary_post.externalId && blogArticleUrlByHashPrefix) {
          const prefix = String(primary_post.externalId).split("--idea-")[0]?.trim();
          if (prefix) resolvedLink = blogArticleUrlByHashPrefix.get(prefix) ?? null;
        }
        if (!resolvedLink && primary_post.content && blogUrlByContent) {
          const contentKey = primary_post.content.trim().slice(0, 400);
          if (contentKey) resolvedLink = blogUrlByContent.get(contentKey) ?? null;
        }
      }
      const tryTitleMatch = (titleMap: Map<string, string> | null) => {
        if (!item.title || !titleMap) return null;
        const raw = String(item.title).trim().toLowerCase();
        for (const len of [120, 80, 60, 50, 40]) {
          const titleNorm = raw.slice(0, len);
          if (titleNorm.length < 15) break;
          const url = titleMap.get(titleNorm) ?? null;
          if (url) return url;
        }
        if (raw.length > 15) {
          for (const [key, u] of titleMap) {
            if (key.length >= 20 && (raw.includes(key) || key.includes(raw.slice(0, 80)))) return u;
          }
        }
        return null;
      };
      if (!resolvedLink && isBlogItem) {
        resolvedLink = tryTitleMatch(blogUrlByTitle) ?? tryTitleMatch(blogPostUrlByTitle);
        if (!resolvedLink && item.title && blogCandidatesForWordMatch.length > 0) {
          const words = String(item.title)
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2);
          let best = { score: 0, url: "" };
          for (const c of blogCandidatesForWordMatch) {
            const t = c.title.toLowerCase();
            const score = words.filter((w) => t.includes(w)).length;
            if (score >= 3 && score > best.score) best = { score, url: c.url };
          }
          if (best.url) resolvedLink = best.url;
        }
      }
    }
    return {
      ...item,
      primary_post: primary_post
        ? {
            id: primary_post.id,
            externalId: primary_post.externalId,
            platform: primary_post.platform,
            url: primary_post.url,
            channelId: primary_post.channelId,
            createdAt: primary_post.createdAt,
          }
        : null,
      source_url: resolvedLink || null,
    };
  });

  const totalForResponse = applySourceFilter ? deduplicatedItems.length : total;

  return {
    newsItems: enrichedItems,
    total: totalForResponse,
    hasMore: offsetToUse + limit < totalForResponse,
  };
}

const NEWS_RELEVANCE_BATCH_SIZE = 25;
const NEWS_ITEM_CONTENT_MAX_LENGTH = 2500;

/**
 * Filter news items by semantic relevance to the project (what is this user curious about?).
 * Uses contextual scope, not keyword/brand matching.
 */
async function filterByProjectRelevance(projectId: string, newsItems: any[]): Promise<any[]> {
  if (newsItems.length === 0) return newsItems;

  const projectContext = await getProjectContextForRelevance(projectId);
  const offTopicIds = new Set<string>();

  for (let start = 0; start < newsItems.length; start += NEWS_RELEVANCE_BATCH_SIZE) {
    const batch = newsItems.slice(start, start + NEWS_RELEVANCE_BATCH_SIZE);
    const items = batch.map((item, i) => {
      const idx = start + i;
      const parts = [
        item.title ?? "",
        item.summary ?? "",
        item.content ?? "",
        ...(Array.isArray(item.tags) ? item.tags : []),
      ].filter(Boolean);
      const content = parts.join("\n").trim().slice(0, NEWS_ITEM_CONTENT_MAX_LENGTH);
      return { id: String(idx), type: "news" as const, content };
    });

    const irrelevantIds = await checkRelevanceBatch(projectContext, items);
    irrelevantIds.forEach((id) => offTopicIds.add(id));
  }

  // Never filter out blog-sourced items: they were ingested for this project and the user chose to see blogs
  const relevantItems = newsItems.filter((_, i) => {
    if (!offTopicIds.has(String(i))) return true;
    const item = newsItems[i];
    const sources = item.sources || [];
    const isBlog = sources.some((s: string) => isBlogPlatform(s));
    return isBlog; // keep blog items even if relevance filter marked them off-topic
  });
  console.log(
    `Filtered ${newsItems.length} news items to ${relevantItems.length} by semantic project relevance`
  );
  return relevantItems;
}
