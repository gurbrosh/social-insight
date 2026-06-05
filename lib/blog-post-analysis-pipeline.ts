/**
 * Blog post table analysis pipeline: process BlogPost rows using the persistent cursor,
 * analyze each (pre-check + key ideas), then create one Post per idea (idea_1..idea_7). No dedupe; no mention-count.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import { getBlogAnalysisCursor, updateBlogAnalysisCursor } from "@/lib/analysis-progress";
import {
  analyzeArticlePreCheckTitleOnly,
  extractKeyIdeasFromArticle,
} from "@/lib/blog-news-analysis-service";
import { isLikelyAdvertorialTitle } from "@/lib/blog-advertorial-patterns";
import { generateId } from "@/lib/utils/ulid";
import { sanitizeTextForDbStorage } from "@/lib/sanitize-text-for-db-storage";
import {
  getProjectContextForRelevance,
  getProjectBrandNames,
  shouldRejectThemeMatchForEntityMismatch,
  formatThemeListForLlmPrompt,
  buildThemeBrandRequirementsMap,
  composePostTextForBrandGate,
} from "@/lib/comprehensive-analysis";
import { runSentimentForPostIds } from "@/lib/analysis/core";
import { isUniqueConstraintError } from "@/lib/prisma-create-many-sqlite";

const BATCH_SIZE = 50;

type BlogNewsAnalysisCreateData = Parameters<typeof prisma.blogNewsAnalysis.create>[0]["data"];

/** Insert BlogNewsAnalysis; duplicate (project_id, article_url) is expected — not surfaced as a task/run error. */
async function createBlogNewsAnalysisOrSkipDuplicate(
  data: BlogNewsAnalysisCreateData
): Promise<{ id: string; article_url: string } | null> {
  try {
    const row = await prisma.blogNewsAnalysis.create({ data });
    return { id: row.id, article_url: row.article_url };
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) return null;
    throw err;
  }
}
/** Max blog summaries per LLM call for theme matching (summaries can be long). */
const BLOG_THEME_MATCH_BATCH_SIZE = 12;
/** Similarity threshold for grouping summaries into mention clusters (cosine). */
const SUMMARY_MENTION_SIMILARITY_THRESHOLD = 0.85;
/** Only consider qualified records from the last N days when computing mention_count. */
const MENTION_LOOKBACK_DAYS = 3;

export interface BlogPostTableAnalysisResult {
  postsProcessed: number;
  analysesCreated: number;
  ideasDeduped: number;
  ideasExtracted: number;
  postsCreated: number;
  sentimentAnalyzed: number;
  newsItemsCreated: number;
  themeMatches: number;
  errorMessage?: string;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const model =
    (await configService.getConfig("api", "embedding_model")) || "text-embedding-3-small";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const batchSize = 100;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => (t || "").slice(0, 1500));
    const resp = await fetch(`${openaiBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!resp.ok) throw new Error(`Embeddings API error: ${resp.status}`);
    const data = (await resp.json()) as { data?: Array<{ embedding: number[] }> };
    for (const item of data.data ?? []) {
      vectors.push(item.embedding);
    }
    if (i + batchSize < texts.length) await new Promise((r) => setTimeout(r, 150));
  }
  return vectors;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** LLM-based theme matching for blog summaries. Returns for each summary_index the list of { theme_index, relevance } with relevance >= 60. */
export async function matchBlogSummariesToThemesWithLLM(
  /** Same as Network/News/Chatter: `getProjectContextForRelevance(projectId)` (includes AND/OR rules). */
  projectScopeForRelevance: string,
  themes: Array<{ id: string; theme_name: string; description: string | null }>,
  summaries: Array<{
    id: string;
    summary: string;
    article_url: string | null;
    article_date: Date | null;
  }>
): Promise<
  Array<{ summary_index: number; themes: Array<{ theme_index: number; relevance: number }> }>
> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const themeBlock = formatThemeListForLlmPrompt(themes);
  const summariesBlock = summaries
    .map((s, i) => `${i + 1}. ${(s.summary ?? "").trim().slice(0, 4000)}`)
    .join("\n\n");

  const prompt = `Project context (relevance — AND/OR rules below apply):
${projectScopeForRelevance}

You are matching BLOG ARTICLE SUMMARIES to project themes. Each summary is a short synopsis of a blog/news article.

⚠️ CRITICAL: Match by SEMANTIC/CONCEPTUAL relevance. Different wording for the same concept MUST match. Focus on whether the summary is ABOUT the theme topic, not literal keyword overlap.

RULES:
1. FIRST check: Does the summary satisfy **RELEVANCE RULE (AND mode)** or **RELEVANCE RULE (OR mode)** in the Project Context above? If NO → return empty themes for that summary.
2. Match a theme if the summary DIRECTLY discusses that theme topic in the project's context and satisfies the relevance rule. Use each theme's **Primary (what to match)** as the authoritative definition; the short label is display-only.
3. **OR mode**: Themes that do not name an entity can match by topic when the OR rule is satisfied.
4. **AND mode**: The summary must meet the AND rule (keyword topics related to a project brand + brand mention + on-topic) before matching any theme—even if the theme title does not name a brand.
5. Only when the theme's **Primary** text or label EXPLICITLY names an entity do you restrict to summaries about that entity.
6. Only include themes with relevance ≥60 when the summary clearly discusses the theme topic per the rules above.
7. When uncertain, do NOT match (false negatives better than false positives).

Themes to match:
${themeBlock}

Blog summaries (each numbered):
${summariesBlock}

Return ONLY valid JSON array. One object per summary. Use summary_index 1-based. Only include themes with relevance ≥60.
[
  { "summary_index": 1, "themes": [{"theme_index": 1, "relevance": 85}] },
  { "summary_index": 2, "themes": [] }
]`;

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a theme matching expert. Match blog article summaries to themes by SEMANTIC/CONCEPTUAL relevance. Same concept with different wording must match. Return only valid JSON array with summary_index (1-based) and themes array of { theme_index, relevance } with relevance ≥60.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: Math.max(2000, summaries.length * 150 + 500),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.warn(
      `[matchBlogSummariesToThemesWithLLM] No content in LLM response for ${summaries.length} summaries`
    );
    return [];
  }

  // Remove markdown code blocks and extract JSON array
  let trimmed = content.trim();
  // Remove ```json or ``` markers
  trimmed = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/g, "");
  // Extract JSON array if wrapped in other text
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    trimmed = arrayMatch[0];
  }
  try {
    const parsed = JSON.parse(trimmed) as Array<{
      summary_index?: number;
      themes?: Array<{ theme_index?: number; relevance?: number }>;
    }>;
    const result = (parsed || []).map((item) => ({
      summary_index: Math.max(1, Number(item.summary_index) || 0),
      themes: (item.themes || [])
        .map((t) => ({
          theme_index: Math.max(1, Number(t.theme_index) || 0),
          relevance: Math.max(0, Number(t.relevance) || 0),
        }))
        .filter((t) => t.relevance >= 60),
    }));
    const totalMatches = result.reduce((sum, r) => sum + r.themes.length, 0);
    if (totalMatches === 0 && summaries.length > 0) {
      console.log(
        `[matchBlogSummariesToThemesWithLLM] LLM returned ${parsed.length} summary entries but 0 theme matches (relevance >= 60)`
      );
      const allThemes = parsed.flatMap((p) => p.themes || []);
      const belowThreshold = allThemes.filter((t) => {
        const rel = Math.max(0, Number(t.relevance) || 0);
        return rel > 0 && rel < 60;
      });
      if (belowThreshold.length > 0) {
        console.log(
          `  → ${belowThreshold.length} theme match(es) had relevance < 60 (max: ${Math.max(...belowThreshold.map((t) => Number(t.relevance) || 0))})`
        );
      }
    }
    return result;
  } catch (parseErr) {
    console.error(
      `[matchBlogSummariesToThemesWithLLM] JSON parse failed. Content preview: ${content.substring(0, 500)}`,
      parseErr
    );
    return [];
  }
}

/**
 * (1) Identify blog posts to analyze using the persistent cursor.
 * (2) Analyze each (title-only pre-check, then key ideas) and write BlogNewsAnalysis.
 * (3) Create one Post per qualified idea (idea_1..idea_7); run sentiment. News comes from normal synthesis.
 * (4) Theme matching (when summaries exist).
 * (5) Run sanitization for new records.
 */
const LOG_PREFIX = "[BlogPostTableAnalysis]";

function logTs(): string {
  return new Date().toLocaleString();
}

export interface RunBlogPostTableAnalysisOptions {
  /** When true, run only pre-check + create rows + key-ideas extraction, then return (no dedupe, Posts, themes, mention count, sentiment). Use for testing cost/quality of idea extraction. */
  stopAfterKeyIdeas?: boolean;
  /** OrchestrationRun.id for task-based analysis; stamped on Post when creating from ideas. */
  ingestedRunId?: string | null;
  /** When set, process only these BlogPost IDs (task-based analysis). Bypasses cursor; skips cursor updates. */
  blogPostIds?: string[];
}

/**
 * Run blog post analysis for specific BlogPost IDs (task-based analysis).
 * Bypasses cursor; does not update cursor state.
 */
export async function runBlogPostAnalysisForIds(
  projectId: string,
  blogPostIds: string[],
  options?: { ingestedRunId?: string | null }
): Promise<BlogPostTableAnalysisResult> {
  if (blogPostIds.length === 0) {
    return {
      postsProcessed: 0,
      analysesCreated: 0,
      ideasDeduped: 0,
      ideasExtracted: 0,
      postsCreated: 0,
      sentimentAnalyzed: 0,
      newsItemsCreated: 0,
      themeMatches: 0,
    };
  }
  return runBlogPostTableAnalysis(projectId, {
    ...options,
    blogPostIds,
  });
}

export async function runBlogPostTableAnalysis(
  projectId: string,
  options?: RunBlogPostTableAnalysisOptions
): Promise<BlogPostTableAnalysisResult> {
  const result: BlogPostTableAnalysisResult = {
    postsProcessed: 0,
    analysesCreated: 0,
    ideasDeduped: 0,
    ideasExtracted: 0,
    postsCreated: 0,
    sentimentAnalyzed: 0,
    newsItemsCreated: 0,
    themeMatches: 0,
  };

  console.log(`[${logTs()}] ${LOG_PREFIX} Starting for project ${projectId}.`);

  if (!process.env.OPENAI_API_KEY) {
    result.errorMessage = "OPENAI_API_KEY is not set";
    console.warn(`${LOG_PREFIX} Skipped: OPENAI_API_KEY not set`);
    return result;
  }

  const useIdsMode = options?.blogPostIds && options.blogPostIds.length > 0;
  let posts: Awaited<ReturnType<typeof prisma.blogPost.findMany>>;

  if (useIdsMode) {
    posts = await prisma.blogPost.findMany({
      where: {
        project_id: projectId,
        id: { in: options!.blogPostIds! },
        deleted_at: null,
      },
      orderBy: { id: "asc" },
    });
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Task-based: processing ${posts.length} blog post(s) by ID.`
    );
  } else {
    const cursor = await getBlogAnalysisCursor(projectId);
    if (cursor) {
      console.log(`[${logTs()}] ${LOG_PREFIX} Cursor: resuming after post id ${cursor}`);
    } else {
      console.log(`[${logTs()}] ${LOG_PREFIX} Cursor: none (processing from start)`);
    }
    posts = await prisma.blogPost.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
  }

  if (posts.length === 0) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} No blog posts to analyze (${useIdsMode ? "IDs mode" : "cursor"}).`
    );
    return result;
  }

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

  // Semantic scope (includes AND rule + brands when project has require_keywords_with_brands)
  const semanticScope =
    project &&
    (project.brands.length > 0 ||
      project.keywords.length > 0 ||
      (project.monitoring_focus?.trim() ?? "") !== "")
      ? await getProjectContextForRelevance(projectId)
      : "";

  console.log(
    `[${logTs()}] ${LOG_PREFIX} Loaded ${posts.length} post(s). Analyzing with OpenAI...`
  );
  const createdAnalysisIds: string[] = [];
  const createdArticleUrls: string[] = [];
  const totalPosts = posts.length;
  const logEveryN = Math.max(1, Math.floor(totalPosts / 4)); // log at most 4 progress lines per batch

  for (let idx = 0; idx < posts.length; idx++) {
    const post = posts[idx];
    result.postsProcessed++;
    if (idx === 0 || (idx + 1) % logEveryN === 0 || idx === posts.length - 1) {
      console.log(`[${logTs()}] ${LOG_PREFIX} Analyzing post ${idx + 1}/${totalPosts}...`);
    }
    const sourceUrl = post.source_url ?? post.article_url;
    try {
      if (isLikelyAdvertorialTitle(post.article_title)) {
        await createBlogNewsAnalysisOrSkipDuplicate({
          id: generateId(),
          project_id: projectId,
          source_url: sourceUrl,
          article_url: post.article_url,
          article_title: post.article_title ?? undefined,
          article_date: post.article_date ?? undefined,
          is_ad: true,
          mention_count: 1,
        });
        if (!useIdsMode) await updateBlogAnalysisCursor(projectId, post.id);
        continue;
      }

      const preCheck = await analyzeArticlePreCheckTitleOnly({
        articleTitle: post.article_title,
        projectContext,
        semanticScope: semanticScope || undefined,
      });

      if (preCheck.is_ad) {
        await createBlogNewsAnalysisOrSkipDuplicate({
          id: generateId(),
          project_id: projectId,
          source_url: sourceUrl,
          article_url: post.article_url,
          article_title: post.article_title ?? undefined,
          article_date: post.article_date ?? undefined,
          is_ad: true,
          mention_count: 1,
        });
        if (!useIdsMode) await updateBlogAnalysisCursor(projectId, post.id);
        continue;
      }

      if (preCheck.relevance_score < 2) {
        await createBlogNewsAnalysisOrSkipDuplicate({
          id: generateId(),
          project_id: projectId,
          source_url: sourceUrl,
          article_url: post.article_url,
          article_title: post.article_title ?? undefined,
          article_date: post.article_date ?? undefined,
          relevance_score: preCheck.relevance_score,
          is_ad: false,
          mention_count: 1,
        });
        if (!useIdsMode) await updateBlogAnalysisCursor(projectId, post.id);
        continue;
      }

      // Qualified (not ad, relevance >= 2): create analysis row from initial assessment only (no full-article summary).
      // article_date from post (discovery); key ideas (idea_1..idea_7) filled later from article content.
      const created = await createBlogNewsAnalysisOrSkipDuplicate({
        id: generateId(),
        project_id: projectId,
        source_url: sourceUrl,
        article_url: post.article_url,
        article_title: post.article_title ?? undefined,
        article_date: post.article_date ?? undefined,
        relevance_score: preCheck.relevance_score,
        is_ad: false,
        mention_count: 1,
      });
      if (created) {
        createdAnalysisIds.push(created.id);
        createdArticleUrls.push(created.article_url);
        result.analysesCreated++;
      }
    } finally {
      if (!useIdsMode) await updateBlogAnalysisCursor(projectId, post.id);
    }
  }

  console.log(
    `[${logTs()}] ${LOG_PREFIX} Analysis done: ${result.analysesCreated} new BlogNewsAnalysis from ${result.postsProcessed} post(s).`
  );

  if (createdAnalysisIds.length === 0) {
    console.log(`[${logTs()}] ${LOG_PREFIX} No new analyses; skipping themes/Posts.`);
    return result;
  }

  if (options?.stopAfterKeyIdeas) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} stopAfterKeyIdeas: running only key-ideas extraction, then returning.`
    );
    const initiallyQualified = await prisma.blogNewsAnalysis.findMany({
      where: {
        id: { in: createdAnalysisIds },
        deleted_at: null,
        is_ad: { not: true },
        relevance_score: { gte: 2 },
      },
      select: { id: true, article_url: true },
    });
    const articleUrls = initiallyQualified.map((q) => q.article_url);
    const blogPostsWithContent = await prisma.blogPost.findMany({
      where: {
        project_id: projectId,
        article_url: { in: articleUrls },
        deleted_at: null,
      },
      select: { article_url: true, content: true },
    });
    const entries = blogPostsWithContent
      .map((p) => [p.article_url, p.content ?? ""] as [string, string])
      .filter(([, c]) => c.length > 0);
    const contentByUrl = new Map(entries);
    for (const q of initiallyQualified) {
      const content = contentByUrl.get(q.article_url);
      if (!content || content.trim().length === 0) {
        console.log(
          `[${logTs()}] ${LOG_PREFIX} Skipping idea extraction for ${q.article_url}: no content in BlogPost table.`
        );
        continue;
      }
      try {
        const ideas = await extractKeyIdeasFromArticle(content);
        if (ideas.length === 0) {
          console.log(
            `[${logTs()}] ${LOG_PREFIX} No ideas extracted for ${q.article_url} (empty result from OpenAI).`
          );
          continue;
        }
        await prisma.blogNewsAnalysis.update({
          where: { id: q.id },
          data: {
            idea_1: ideas[0] ?? null,
            idea_2: ideas[1] ?? null,
            idea_3: ideas[2] ?? null,
            idea_4: ideas[3] ?? null,
            idea_5: ideas[4] ?? null,
            idea_6: ideas[5] ?? null,
            idea_7: ideas[6] ?? null,
          },
        });
        result.ideasExtracted++;
      } catch (err) {
        console.error(
          `[${logTs()}] ${LOG_PREFIX} Key ideas extraction failed for ${q.article_url}:`,
          err
        );
      }
    }
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Done (stopAfterKeyIdeas). Ideas extracted: ${result.ideasExtracted}. Skipping themes/Posts/sentiment.`
    );
    return result;
  }

  // Key ideas extraction: for each initially qualified analysis (not ad, relevance >= 2), extract paragraph-level main ideas (idea_1..idea_7) with standalone sentences.
  // Extract ideas for ALL records that passed initial qualification, not just news-qualified ones.
  const initiallyQualified = await prisma.blogNewsAnalysis.findMany({
    where: {
      id: { in: createdAnalysisIds },
      deleted_at: null,
      is_ad: { not: true },
      relevance_score: { gte: 2 },
    },
    select: {
      id: true,
      article_url: true,
    },
  });
  console.log(
    `[${logTs()}] ${LOG_PREFIX} Extracting key ideas for ${initiallyQualified.length} initially qualified analysis/analyses (not ad, relevance >= 2).`
  );
  const articleUrls = initiallyQualified.map((q) => q.article_url);
  const blogPostsWithContent = await prisma.blogPost.findMany({
    where: {
      project_id: projectId,
      article_url: { in: articleUrls },
      deleted_at: null,
    },
    select: { article_url: true, content: true },
  });
  const entries = blogPostsWithContent
    .map((p) => [p.article_url, p.content ?? ""] as [string, string])
    .filter(([, c]) => c.length > 0);
  const contentByUrl = new Map(entries);
  for (const q of initiallyQualified) {
    const content = contentByUrl.get(q.article_url);
    if (!content || content.trim().length === 0) {
      console.log(
        `[${logTs()}] ${LOG_PREFIX} Skipping idea extraction for ${q.article_url}: no content in BlogPost table.`
      );
      continue;
    }
    try {
      const ideas = await extractKeyIdeasFromArticle(content);
      if (ideas.length === 0) {
        console.log(
          `[${logTs()}] ${LOG_PREFIX} No ideas extracted for ${q.article_url} (empty result from OpenAI).`
        );
        continue;
      }
      await prisma.blogNewsAnalysis.update({
        where: { id: q.id },
        data: {
          idea_1: ideas[0] ?? null,
          idea_2: ideas[1] ?? null,
          idea_3: ideas[2] ?? null,
          idea_4: ideas[3] ?? null,
          idea_5: ideas[4] ?? null,
          idea_6: ideas[5] ?? null,
          idea_7: ideas[6] ?? null,
        },
      });
      result.ideasExtracted++;
    } catch (err) {
      console.error(
        `[${logTs()}] ${LOG_PREFIX} Key ideas extraction failed for ${q.article_url}:`,
        err
      );
    }
  }
  if (result.ideasExtracted > 0) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Key ideas extracted for ${result.ideasExtracted} qualified analysis/analyses (idea_1..idea_7).`
    );
  } else if (initiallyQualified.length > 0) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} No ideas extracted (${initiallyQualified.length} qualified records, but content missing or extraction returned empty).`
    );
  }

  // Create one Post per qualified idea (idea_1..idea_7).
  // Same originating blog URL (url = article_url) on each; unique postId = hash(article_url)--idea-{n} to avoid unique constraint.
  // Only necessary fields: platform, postId, content, url, createdAt, project_id, authorName. No summary or full text. Then run normal analysis (sentiment).
  const BLOGS_PLATFORM = "blogs";
  const qualifyingForPost = await prisma.blogNewsAnalysis.findMany({
    where: {
      id: { in: createdAnalysisIds },
      deleted_at: null,
      is_ad: { not: true },
      relevance_score: { gte: 2 },
      OR: [
        { idea_1: { not: null } },
        { idea_2: { not: null } },
        { idea_3: { not: null } },
        { idea_4: { not: null } },
        { idea_5: { not: null } },
        { idea_6: { not: null } },
        { idea_7: { not: null } },
      ],
    },
    select: {
      id: true,
      article_url: true,
      source_url: true,
      article_title: true,
      article_date: true,
      created_at: true,
      idea_1: true,
      idea_2: true,
      idea_3: true,
      idea_4: true,
      idea_5: true,
      idea_6: true,
      idea_7: true,
    },
  });

  const newPostIds: number[] = [];
  const ideaColumnsForPost = [
    "idea_1",
    "idea_2",
    "idea_3",
    "idea_4",
    "idea_5",
    "idea_6",
    "idea_7",
  ] as const;

  for (const a of qualifyingForPost) {
    const originalUrl = (a.article_url ?? a.source_url ?? "").trim();
    const urlHash = originalUrl
      ? crypto.createHash("sha256").update(originalUrl).digest("hex").slice(0, 24)
      : a.id.slice(0, 24);
    const createdAt = a.article_date ?? a.created_at;
    const authorName = (a.article_title ?? "Blog").trim() || "Blog";

    for (let i = 0; i < ideaColumnsForPost.length; i++) {
      const ideaText = a[ideaColumnsForPost[i]]?.trim();
      if (!ideaText) continue;

      const n = i + 1;
      const postId = `${urlHash}--idea-${n}`;

      const upserted = await prisma.post.upsert({
        where: {
          project_id_platform_postId: {
            project_id: projectId,
            platform: BLOGS_PLATFORM,
            postId,
          },
        },
        create: {
          platform: BLOGS_PLATFORM,
          postId,
          url: originalUrl || undefined,
          content: ideaText.slice(0, 50000),
          createdAt,
          project_id: projectId,
          authorName,
          ...(options?.ingestedRunId != null ? { ingested_run_id: options.ingestedRunId } : {}),
        },
        update: {
          content: ideaText.slice(0, 50000),
          url: originalUrl || undefined,
          createdAt,
          authorName,
        },
        select: { id: true },
      });
      newPostIds.push(upserted.id);
      result.postsCreated++;
    }
  }

  if (result.postsCreated > 0) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Created/updated ${result.postsCreated} Post(s) from qualified ideas (one per idea, url=article_url, platform=${BLOGS_PLATFORM}).`
    );
    const needingSentiment = await prisma.post.findMany({
      where: { id: { in: newPostIds }, project_id: projectId, sentiment: null },
      select: { id: true },
    });
    const idsForSentiment = needingSentiment.map((p) => p.id);
    if (idsForSentiment.length > 0) {
      const sentimentResult = await runSentimentForPostIds(projectId, idsForSentiment);
      result.sentimentAnalyzed = sentimentResult.analyzed;
      console.log(
        `[${logTs()}] ${LOG_PREFIX} Sentiment analyzed: ${result.sentimentAnalyzed} blog Post(s).`
      );
    }
  }

  // Theme matching: LLM-based (same approach as social posts) so concepts match by meaning.
  const projectThemes = await prisma.projectTheme.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, theme_name: true, description: true },
  });
  // Theme matching uses summary; title-only analyses have summary=null and are skipped until logic uses title/ideas.
  const analysesForThemes = await prisma.blogNewsAnalysis.findMany({
    where: { id: { in: createdAnalysisIds }, deleted_at: null },
    select: { id: true, summary: true, article_url: true, article_date: true },
  });
  const qualifiedWithSummary = analysesForThemes.filter(
    (r) => r.summary != null && String(r.summary).trim() !== ""
  );
  if (projectThemes.length > 0 && qualifiedWithSummary.length > 0) {
    const projectScopeForRelevance = await getProjectContextForRelevance(projectId);
    const projectBrandNames = await getProjectBrandNames(projectId);
    const themeBrandRequirements = buildThemeBrandRequirementsMap(projectThemes, projectBrandNames);
    // Resolve blog name from Brand.blog_news_url and ProjectBrandSource (BLOG); same logic as themes-analysis
    const blogBaseToName: Array<{ baseUrl: string; name: string }> = [];
    const seenBases = new Set<string>();
    const projectBrandsWithBlog = await prisma.projectBrand.findMany({
      where: { project_id: projectId, deleted_at: null },
      include: { brand: true },
    });
    for (const pb of projectBrandsWithBlog) {
      const url = pb.brand?.blog_news_url?.trim();
      if (!url || !url.startsWith("http")) continue;
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, "") || "/";
        const baseUrl = `${parsed.origin}${path}`.toLowerCase();
        if (seenBases.has(baseUrl)) continue;
        seenBases.add(baseUrl);
        blogBaseToName.push({ baseUrl, name: pb.brand?.brand_name ?? pb.brand_name ?? "Blog" });
      } catch {
        // skip
      }
    }
    const projectBlogSources = await prisma.projectBrandSource.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        link_type: "OTHER_SOURCE",
        source_category: "BLOG",
      },
      include: { brand: { select: { brand_name: true } } },
    });
    for (const src of projectBlogSources) {
      const url = src.url?.trim();
      if (!url || !url.startsWith("http")) continue;
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, "") || "/";
        const baseUrl = `${parsed.origin}${path}`.toLowerCase();
        if (seenBases.has(baseUrl)) continue;
        seenBases.add(baseUrl);
        blogBaseToName.push({
          baseUrl,
          name: (src.channel_name?.trim() || src.brand?.brand_name || "Blog").trim() || "Blog",
        });
      } catch {
        // skip
      }
    }
    const brandIdsForBlog = projectBrandsWithBlog
      .map((pb) => pb.brand_id)
      .filter((id): id is string => id != null);
    if (brandIdsForBlog.length > 0) {
      const brandBlogLinks = await prisma.brandAdditionalLink.findMany({
        where: {
          brand_id: { in: brandIdsForBlog },
          deleted_at: null,
          link_type: "OTHER_SOURCE",
          source_category: "BLOG",
        },
        include: { brand: { select: { brand_name: true } } },
      });
      for (const link of brandBlogLinks) {
        const url = link.url?.trim();
        if (!url || !url.startsWith("http")) continue;
        try {
          const parsed = new URL(url);
          const path = parsed.pathname.replace(/\/+$/, "") || "/";
          const baseUrl = `${parsed.origin}${path}`.toLowerCase();
          if (seenBases.has(baseUrl)) continue;
          seenBases.add(baseUrl);
          blogBaseToName.push({
            baseUrl,
            name: (link.channel_name?.trim() || link.brand?.brand_name || "Blog").trim() || "Blog",
          });
        } catch {
          // skip
        }
      }
    }
    const resolveBlogName = (articleUrl: string | null): string | null => {
      const u = (articleUrl || "").trim().toLowerCase().replace(/\/+$/, "");
      if (!u) return null;
      for (const { baseUrl, name } of blogBaseToName) {
        const base = baseUrl.replace(/\/+$/, "");
        if (u === base || u.startsWith(base + "/") || u.startsWith(base + "?")) return name;
      }
      return null;
    };

    // Map article_url -> Post id (first blog Post for that url, e.g. idea_1) so ThemesAnalysis links to a real Post.
    const articleUrls = [
      ...new Set(
        qualifiedWithSummary.map((r) => (r.article_url || "").trim()).filter((u) => u.length > 0)
      ),
    ];
    const blogPostsForUrl = await prisma.post.findMany({
      where: {
        project_id: projectId,
        platform: BLOGS_PLATFORM,
        url: { in: articleUrls },
      },
      select: { id: true, url: true },
      orderBy: { postId: "asc" },
    });
    const postIdByArticleUrl = new Map<string, number>();
    for (const p of blogPostsForUrl) {
      const u = (p.url || "").trim();
      if (u && !postIdByArticleUrl.has(u)) postIdByArticleUrl.set(u, p.id);
    }

    for (
      let offset = 0;
      offset < qualifiedWithSummary.length;
      offset += BLOG_THEME_MATCH_BATCH_SIZE
    ) {
      const batch = qualifiedWithSummary.slice(offset, offset + BLOG_THEME_MATCH_BATCH_SIZE);
      try {
        const matches = await matchBlogSummariesToThemesWithLLM(
          projectScopeForRelevance,
          projectThemes,
          batch.map((r) => ({
            id: r.id,
            summary: r.summary ?? "",
            article_url: r.article_url,
            article_date: r.article_date,
          }))
        );
        const linkedIdsForGate = new Set<number>();
        for (const r of batch) {
          const pid = r.article_url ? postIdByArticleUrl.get(r.article_url.trim()) : undefined;
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
          const linkedPostId = item.article_url
            ? postIdByArticleUrl.get(item.article_url.trim())
            : undefined;
          if (linkedPostId == null) continue; // only create theme records when we have a Post to link to
          const blogAuthorName = resolveBlogName(item.article_url);
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
                  platform: BLOGS_PLATFORM,
                  post_content: sanitizeTextForDbStorage(item.summary ?? null, 4000),
                  post_url: sanitizeTextForDbStorage(item.article_url ?? null, 4000),
                  ...(blogAuthorName && {
                    author_name: sanitizeTextForDbStorage(blogAuthorName, 200) ?? undefined,
                  }),
                  posted_at: item.article_date ?? new Date(),
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
        console.error(
          `[${logTs()}] ${LOG_PREFIX} Blog theme matching batch failed (offset ${offset}):`,
          err
        );
      }
    }
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Blog theme matching: ${result.themeMatches} match(es) (LLM, ${qualifiedWithSummary.length} qualified summaries).`
    );
  }

  console.log(`[${logTs()}] ${LOG_PREFIX} Running sanitization (news + themes)...`);
  try {
    const { runSanitizationForProject } = await import("@/lib/comprehensive-analysis");
    const sanitOutcome = await runSanitizationForProject(projectId, { news: true, themes: true });
    console.log(
      `${LOG_PREFIX} Step 7: Done. newsRemoved=${sanitOutcome.newsRemoved}, themesRemoved=${sanitOutcome.themesRemoved}`
    );
  } catch (sanitizeErr) {
    console.error(`${LOG_PREFIX} Step 7: Sanitization failed:`, sanitizeErr);
  }

  console.log(
    `[${logTs()}] ${LOG_PREFIX} Complete. posts=${result.postsProcessed} analyses=${result.analysesCreated} ideasExtracted=${result.ideasExtracted} ` +
      `postRecords=${result.postsCreated} sentiment=${result.sentimentAnalyzed} news=${result.newsItemsCreated} themeMatches=${result.themeMatches}` +
      (result.errorMessage ? ` error=${result.errorMessage}` : "")
  );
  return result;
}

/**
 * Qualified = passed both gates: not an ad, and (relevance_score is null or >= 2).
 * Only qualified records are considered for summary-similarity mention clustering.
 */
function isQualifiedForMention(row: {
  is_ad: boolean | null;
  relevance_score: number | null;
}): boolean {
  if (row.is_ad === true) return false;
  if (row.relevance_score != null && row.relevance_score < 2) return false;
  return true;
}

/**
 * Update mention_count on BlogNewsAnalysis using summary similarity among qualified records
 * in the last MENTION_LOOKBACK_DAYS. Records that passed both tests (not ad, relevance >= 2)
 * are clustered by summary embedding similarity; each record in a cluster gets mention_count
 * = cluster size. Already-clustered records are skipped to avoid double counting.
 * Call at end of each run or batch.
 */
export async function updateBlogNewsMentionCounts(
  projectId?: string
): Promise<{ updated: number }> {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - MENTION_LOOKBACK_DAYS);

  const rows = await prisma.blogNewsAnalysis.findMany({
    where: {
      deleted_at: null,
      ...(projectId ? { project_id: projectId } : {}),
      OR: [
        { article_date: { gte: threeDaysAgo } },
        { article_date: null, created_at: { gte: threeDaysAgo } },
      ],
    },
    select: {
      id: true,
      project_id: true,
      summary: true,
      is_ad: true,
      relevance_score: true,
    },
  });

  const qualified = rows.filter(
    (r) => isQualifiedForMention(r) && r.summary != null && String(r.summary).trim() !== ""
  );
  if (qualified.length === 0) return { updated: 0 };

  const byProject = new Map<string, typeof qualified>();
  for (const r of qualified) {
    const list = byProject.get(r.project_id) ?? [];
    list.push(r);
    byProject.set(r.project_id, list);
  }

  let totalUpdated = 0;
  for (const [, list] of byProject) {
    if (list.length === 0) continue;
    const summaries = list.map((r) => (r.summary ?? "").trim().slice(0, 8000));
    const embeddings = await embedTexts(summaries);
    if (embeddings.length !== list.length) continue;

    const inCluster = new Set<string>();
    const mentionCountById = new Map<string, number>();
    const newsClusterIdById = new Map<string, string>();

    for (let i = 0; i < list.length; i++) {
      if (inCluster.has(list[i].id)) continue;
      const cluster: typeof list = [list[i]];
      inCluster.add(list[i].id);
      for (let j = 0; j < list.length; j++) {
        if (i === j || inCluster.has(list[j].id)) continue;
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        if (sim >= SUMMARY_MENTION_SIMILARITY_THRESHOLD) {
          cluster.push(list[j]);
          inCluster.add(list[j].id);
        }
      }
      const count = cluster.length;
      const clusterId = list[i].id;
      for (const r of cluster) {
        mentionCountById.set(r.id, count);
        newsClusterIdById.set(r.id, clusterId);
      }
    }

    for (const r of list) {
      const count = mentionCountById.get(r.id) ?? 1;
      const newsClusterId = newsClusterIdById.get(r.id) ?? null;
      await prisma.blogNewsAnalysis.update({
        where: { id: r.id },
        data: { mention_count: count, news_cluster_id: newsClusterId },
      });
      totalUpdated++;
    }
  }

  if (totalUpdated > 0 && projectId) {
    console.log(
      `[${logTs()}] ${LOG_PREFIX} Updated mention_count (summary similarity, last ${MENTION_LOOKBACK_DAYS} days) for ${totalUpdated} qualified row(s) (project ${projectId}).`
    );
  }
  return { updated: totalUpdated };
}
