/**
 * Comprehensive Analysis Service
 * Runs 4 iterations of OpenAI analysis after scrape completion:
 * 1. Conversation Thread Identification (serves Chatter, Network, Themes)
 * 2. Per-Post Sentiment + Theme Matching
 * 3. Network Analysis (influential people)
 * 4. News Synthesis
 */

import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import { openaiChatModel, openaiEmbeddingModel } from "@/lib/openai-chat-model";
import { ulid as generateUlid } from "ulid";
import { detectLanguage } from "@/lib/utils/language-detector";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { promises as fs } from "fs";

import path from "path";

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  getOrCreateAnalysisProgress,
  updateAnalysisProgress,
  resetAnalysisProgress as resetAnalysisProgressState,
} from "@/lib/analysis-progress";
import { populateBrandAnalysis } from "@/lib/brand-analysis";
import { extractYouTubeVideoIdFromUrl } from "@/lib/data-transformer";
import { generatePostLink } from "@/lib/post-links";
import {
  buildSemanticProjectScope,
  buildKeywordBroaderDefinition,
} from "@/lib/blog-news-analysis-service";
import { isUniqueConstraintError } from "@/lib/prisma-create-many-sqlite";
import { postWhereExcludeGithubFromLegacySentimentPipeline } from "@/lib/analysis-post-source-policy";
import { extractDiscordChannelIdFromProjectProfileUrl } from "@/lib/discord-project-profile";
import { normalizeThemeReadUrl } from "@/lib/theme-read-url";
import { sanitizeTextForDbStorage } from "@/lib/sanitize-text-for-db-storage";

const isFacebookPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "facebook";

const isDiscordPlatform = (platform?: string | null) =>
  (platform || "").toLowerCase() === "discord";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getThemeCacheFilePath(projectId: string): string {
  return path.join("/tmp", `theme_eval_cache_${projectId}.json`);
}

/**
 * Find the root post ID for a given post by traversing up the threadRefId chain.
 * Returns the post's own ID if it's already a root post (no threadRefId).
 *
 * Platform-agnostic logic:
 * - Traverses up threadRefId chain until finding a post with no threadRefId (root)
 * - Works for ALL platforms: Facebook, LinkedIn, X/Twitter, Reddit, Discord
 *
 * Platform-specific enhancements:
 * - Facebook: Also checks story_fbid in URLs (Facebook comments sometimes reference
 *   story_fbid instead of postId in threadRefId). This is additive - if it doesn't
 *   find a match, falls back to generic traversal.
 *
 * Optimized to query only necessary posts for traversal.
 */
async function findRootPostId(
  postId: number,
  threadRefId: string | null | undefined,
  platform: string,
  projectId: string
): Promise<number> {
  // If no threadRefId, this is already a root post
  if (!threadRefId) {
    return postId;
  }

  // Get the current post to start traversal
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
    return postId; // Fallback: return original if not found
  }

  // Platform-specific enhancement: Facebook story_fbid matching
  // This is additive - if it doesn't find a match, falls back to generic traversal below
  if (isFacebookPlatform(platform) && threadRefId) {
    // Query root posts (no threadRefId) for this platform/project to check story_fbid
    const rootPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        platform: platform,
        threadRefId: null,
        url: { not: null },
      },
      select: {
        id: true,
        postId: true,
        url: true,
      },
      take: 1000, // Reasonable limit for root posts
    });

    for (const rootPost of rootPosts) {
      if (rootPost.url) {
        // Try query param first
        const queryMatch = rootPost.url.match(/[?&]story_fbid=([^&]+)/);
        if (queryMatch && queryMatch[1] === threadRefId) {
          return rootPost.id;
        }
        // Try URL path pattern: /posts/pfbid... or /reel/pfbid...
        const pathMatch = rootPost.url.match(
          /\/(?:posts|reel|permalink\.php)\/(pfbid[a-zA-Z0-9]+)/
        );
        if (pathMatch && pathMatch[1] === threadRefId) {
          return rootPost.id;
        }
        // Also check if threadRefId is contained anywhere in the URL (fallback)
        if (rootPost.url.includes(threadRefId)) {
          return rootPost.id;
        }
      }
    }
  }

  // GENERIC TRAVERSAL LOGIC - Works for ALL platforms
  // Traverse up the threadRefId chain until we find the root (no threadRefId)
  let currentRefId: string | null | undefined = threadRefId;
  const visited = new Set<string>();
  let depth = 0;
  const MAX_DEPTH = 50; // Prevent infinite loops from malformed data

  // Helper function to normalize LinkedIn URNs to numeric IDs for matching
  const normalizeLinkedInId = (id: string | null | undefined): string | null => {
    if (!id) return null;
    if (id.includes(":activity:")) {
      return id.split(":activity:")[1] || id;
    }
    if (id.includes(":ugcPost:")) {
      return id.split(":ugcPost:")[1] || id;
    }
    return id;
  };

  while (currentRefId && depth < MAX_DEPTH) {
    // Prevent cycles
    if (visited.has(currentRefId)) {
      break;
    }
    visited.add(currentRefId);

    // Normalize LinkedIn URNs to numeric IDs for matching
    const normalizedRefId = normalizeLinkedInId(currentRefId);

    // Query parent post by postId (platform-specific ID)
    // This works for all platforms: Reddit (parent_id), X/Twitter (in_reply_to_status_id),
    // LinkedIn (reply_to), Discord (parent_message_id), Facebook (postId or story_fbid)
    // For LinkedIn, we need to match both URN format and numeric format
    const parentPost: {
      id: number;
      postId: string;
      threadRefId: string | null;
    } | null = await prisma.post.findFirst({
      where: {
        project_id: projectId,
        platform: platform,
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

    if (!parentPost) {
      // Parent not found - current post is effectively root
      break;
    }

    // Found root post (no threadRefId)
    if (!parentPost.threadRefId) {
      return parentPost.id;
    }

    // Continue traversing up
    currentRefId = parentPost.threadRefId;
    depth++;
  }

  // If we couldn't find root, return original post ID
  return postId;
}

// NOTE: Cache has been removed - this function is kept as a no-op for backward compatibility
// The lastThemesPostId counter already handles incremental analysis perfectly without a cache
export async function clearThemeEvaluationCache(_projectId: string): Promise<void> {
  // No-op - cache removed, counter-based incremental analysis handles this
}

/** Re-export for backward compatibility; builder defines the canonical shape. */
type ConversationThread = import("@/lib/conversation-builder").ConversationThread;
type PostForThread = import("@/lib/conversation-builder").PostForThread;

/**
 * **Canonical project text for relevance** (Network, News, Themes, Chatter, ingestion filters, blog scoring).
 * Always use this (not ad-hoc keyword lists) so AND/OR rules stay consistent everywhere.
 * Prefer semantic scope ("what is this user curious about?") so relevance is judged by meaning, not word matching.
 * When require_keywords_with_brands (AND mode) is true, appends a strict rule: keyword topics must relate to a project brand; content must mention a brand and be on-topic in that sense.
 * Fallback to buildProjectEssence when semantic scope is empty (e.g. no keywords/brands/focus).
 */
export async function getProjectContextForRelevance(projectId: string): Promise<string> {
  const contexts = await buildProjectContextsForRelevance(projectId);
  return contexts.selected;
}

/** Append brands as the next numbered items, quoted, e.g. (4) "Brand Name". */
function appendBrandsAsNumberedScopeItems(scopeLine: string, brands: string[]): string {
  if (brands.length === 0) return scopeLine;
  // Only treat small indices as list markers—ignore years like (2024) in body text.
  const nums = [...scopeLine.matchAll(/\((\d+)\)/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= 99);
  const nextStart = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  let n = nextStart;
  const pieces = brands.map((b) => {
    const escaped = b.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `(${n++}) "${escaped}"`;
  });
  return `${scopeLine.trimEnd()} ${pieces.join(" ")}`.trim();
}

/**
 * Build both strict (AND) and broad (OR) relevance contexts for a project.
 * - strictContext: semantic scope + strict brand+topic rule
 * - broadContext: keyword-derived broad scope; project brands continue the same numbered list as (n) "Brand"
 * selected is chosen from project mode (require_keywords_with_brands).
 */
export async function buildProjectContextsForRelevance(projectId: string): Promise<{
  strictContext: string;
  broadContext: string;
  selected: string;
  mode: "AND" | "OR";
  /** Keyword-broader scope line (OR topic sentence); empty if no keywords / LLM failed. */
  keywordBroaderLine: string;
  /** Semantic “what they’re curious about” paragraph for AND / fallback. */
  semanticScopeLine: string;
}> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    select: {
      require_keywords_with_brands: true,
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });
  const [semantic, keywordBroader] = await Promise.all([
    buildSemanticProjectScope(projectId),
    buildKeywordBroaderDefinition(projectId),
  ]);
  const essenceFallback = await buildProjectEssence(projectId);

  const requireAnd = project?.require_keywords_with_brands ?? false;
  const keywordList = project?.keywords?.map((k) => k.keyword).filter(Boolean) ?? [];
  const brandList = project?.brands?.map((b) => b.brand_name).filter(Boolean) ?? [];
  const refLine =
    (keywordList.length > 0 ? `Keywords (for reference): ${keywordList.join(", ")}. ` : "") +
    (brandList.length > 0 ? `Brands: ${brandList.join(", ")}.` : "");

  const strictCore = semantic.trim() || essenceFallback;
  let broadCore = keywordBroader.trim() || semantic.trim() || essenceFallback;
  if (brandList.length > 0) {
    broadCore = appendBrandsAsNumberedScopeItems(broadCore, brandList);
  }

  const strictContext = `${strictCore}

⚠️ RELEVANCE RULE (AND mode): Keyword topics must be related to at least one of these project brands (same industry, product, or service domain as that brand—not generic industry chatter with no brand tie). Content qualifies when it mentions or is clearly about at least one listed brand AND the keyword topic is on-topic in that brand-related way. Keyword-only, brand-only, or generic keyword topics with no brand relationship do NOT qualify. Brand names: ${brandList.join(", ")}${refLine ? `\n${refLine}` : ""}`;

  const broadContext = `${broadCore}

⚠️ RELEVANCE RULE (OR mode): Content qualifies when it matches any numbered idea above—including quoted brand items—or clearly fits the thematic items. Topic-only content still qualifies if it clearly fits a non-brand item; do NOT require a brand mention.${refLine ? `\n${refLine}` : ""}`;

  const selected = requireAnd ? strictContext : broadContext;
  return {
    strictContext,
    broadContext,
    selected,
    mode: requireAnd ? "AND" : "OR",
    keywordBroaderLine: keywordBroader.trim(),
    semanticScopeLine: semantic.trim(),
  };
}

// Build a compact project essence context from name, description, monitoring_focus, keywords, brands
export async function buildProjectEssence(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      monitoring_focus: true,
      require_keywords_with_brands: true,
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });

  const keywordList = project?.keywords?.map((k) => k.keyword).filter(Boolean) || [];
  const brandList = project?.brands?.map((b) => b.brand_name).filter(Boolean) || [];
  const requireKeywordsWithBrands = project?.require_keywords_with_brands ?? false;

  // Build essence with monitoring_focus as the primary semantic context
  let essence = `Project: ${project?.name || "Unknown"}
${project?.description ? `Description: ${project.description}` : ""}`;

  // Monitoring Focus is the KEY semantic context - describe what they're looking for
  const monitoringFocus = project?.monitoring_focus as string | undefined;
  if (monitoringFocus) {
    essence += `\n\n🎯 MONITORING FOCUS (What we're looking for):\n${monitoringFocus}`;
  }

  essence += `\nKeywords: ${keywordList.join(", ")}
Brands: ${brandList.join(", ")}`.trim();

  // Add relevance mode instructions
  if (requireKeywordsWithBrands) {
    essence += `\n\n⚠️ RELEVANCE MODE (STRICT): Keyword topics must be related to at least one project brand. Records qualify ONLY when content mentions BOTH a project keyword (in that brand-related sense) AND a project brand. Keyword-only, brand-only, or generic keyword topics with no brand relationship do NOT qualify.`;
  } else {
    essence += `\n\n⚠️ RELEVANCE MODE (DEFAULT): Keywords can qualify on their own; posts about project brands automatically qualify.`;
  }

  return essence;
}

// Score an influencer for project relevance (0-100) based on their posts
async function scoreInfluencerRelevance(
  projectEssence: string,
  influencer: {
    authorName: string;
    platform: string;
    posts: Array<{
      content: string | null;
      createdAt: Date;
      metricsLikes?: number | null;
      metricsComments?: number | null;
      metricsShares?: number | null;
    }>;
  }
): Promise<{ score: number; reason?: string }> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const platformLower = influencer.platform.toLowerCase();
  // Same engagement ordering as summarizePersonIdeas — unsorted slice was noisy for relevance.
  const topPosts = [...influencer.posts]
    .sort((a, b) => {
      const aEng = (a.metricsLikes || 0) + (a.metricsComments || 0) + (a.metricsShares || 0);
      const bEng = (b.metricsLikes || 0) + (b.metricsComments || 0) + (b.metricsShares || 0);
      return bEng - aEng;
    })
    .slice(0, 5)
    .map(
      (p, i) =>
        `${i + 1}. [${p.createdAt.toISOString().split("T")[0]}] ${p.content?.substring(0, 300) || ""}`
    )
    .join("\n\n");

  const discordHint =
    platformLower === "discord"
      ? `\n\nNote: Discord messages are often short and informal. Score based on whether the discussion aligns with the project's monitoring focus and topics (keywords/brands), not on formal tone or length.`
      : "";

  const influencerText = `Platform: ${influencer.platform}\nAuthor: ${influencer.authorName}\n\nTop Posts:\n${topPosts}`;

  const prompt = `Project Essence:\n${projectEssence}

Evaluate this influencer for RELEVANCE to this project.
Return JSON with fields: score (0-100), reason (short).

Apply the RELEVANCE RULE (AND or OR mode) from the Project Essence above when scoring: In OR mode, topic/keyword match qualifies (score ≥50) even without a brand mention. In AND mode, keyword topics must be related to a project brand AND the influencer's content must mention or be about a project brand AND be on-topic in that brand-related way to qualify (score ≥50).

Rules:
- If MONITORING FOCUS exists: Content must align with what is described there - this is what the user is specifically looking for
- Semantic similarity to the project's intent (from monitoring focus, or keywords/brands/description combined) is the primary factor
- Author-name keyword matches alone do NOT count
- Using keywords as generic words (not the actual entity) is NOT relevant
- Domain/context should align with what followers of this project care about
- Only influencers who meet the RELEVANCE RULE (AND/OR) and genuinely discuss the project's intended topics are relevant
- **Among qualifying content:** prefer a higher score when posts explicitly name project keywords or brands from the context (or clear official variants); prefer a lower score in the same band when fit is only semantic/paraphrase without naming those terms
${discordHint}

Influencer Content:\n${influencerText}`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiChatModel("relevance"),
        messages: [
          {
            role: "system",
            content: "You assign relevance scores (0-100) with concise reasoning.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 250,
      }),
    });

    if (!response.ok) return { score: 0 };
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { score: 0 };
    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(content);
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return { score, reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
  } catch {
    return { score: 0 };
  }
}

// Score a thread for project relevance (0-100) using multi-signal semantic check.
// When requireBrandWithKeywords is false (OR mode), topic-only content can qualify (score ≥50).
async function scoreThreadRelevance(
  projectEssence: string,
  thread: ConversationThread,
  options?: { requireBrandWithKeywords?: boolean }
): Promise<{ score: number; reason?: string }> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const repliesText = thread.replies
    .slice(0, 30)
    .map((r, i) => `${i + 1}. ${r.authorName || "Unknown"}: ${r.content?.substring(0, 220) || ""}`)
    .join("\n");
  const threadText = `Root (${thread.rootPost.platform}) ${thread.rootPost.authorName || "Unknown"}: ${
    thread.rootPost.content?.substring(0, 500) || ""
  }\nReplies (${thread.replies.length}):\n${repliesText}`;

  const orMode = options?.requireBrandWithKeywords === false;
  const modeBanner = orMode
    ? "THIS PROJECT USES OR MODE: Content that matches the project's topics/keywords qualifies with score ≥50 even when no brand is mentioned. Do NOT reject or score <50 solely for lacking a brand mention.\n\n"
    : "";

  const prompt = `${modeBanner}Project Essence:\n${projectEssence}

Evaluate this conversation for RELEVANCE to this project.
Return JSON with fields: score (0-100), reason (short).

⚠️ MANDATORY - READ FIRST: Look for "RELEVANCE RULE (OR mode)" or "RELEVANCE RULE (AND mode)" in the Project Essence above.
- If you see **OR mode**: Content that matches the project's topics/keywords/monitoring focus MUST score ≥50 even when NO brand is mentioned. Do NOT reject or score <50 solely because the content does not name a project brand. Topic-only or keyword-only content that fits the scope qualifies.
- If you see **AND mode**: Keyword topics must be related to a project brand; content must mention or be clearly about at least one project brand AND be on-topic in that brand-related way; keyword-only or generic topic-without-brand-relationship does NOT qualify (score <50).

CRITICAL SCORING:
- Score 0-30: Completely irrelevant - different industry or domain. DO NOT store.
- Score 31-49: Only use when content is marginally related or (in AND mode only) on-topic but no brand mention. In OR mode, if content clearly matches project topics/keywords, score ≥50.
- Score 50-69: Meets the relevance rule (in OR mode: topic/keyword match; in AND mode: brand + keyword topics related to that brand).
- Score 70-89: Clearly relevant - directly discusses project products/brands/services.
- Score 90-100: Highly relevant - core discussion about the project.

**Among conversations that both qualify (score ≥50):** prefer the upper end of the band when the text explicitly names project keywords or brands from the Project Essence (or clear variants); use the lower end of the band when relevance is only by paraphrase or generic domain talk without naming those terms.

Rules:
- In OR mode, "does not mention [brands]" is NOT a valid reason for score <50 when the content is about the project's domain.
- Author-name keyword matches alone do NOT count. High engagement does NOT make irrelevant content relevant.
- Completely different topic (unrelated industry) → 0-30.

Conversation:\n${threadText}`;

  // Retry logic with exponential backoff for rate limits and timeouts
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add timeout: 30 seconds per request (prevents hanging)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiChatModel("relevance"),
          messages: [
            {
              role: "system",
              content: "You assign relevance scores (0-100) with concise reasoning.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 250,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting (429) with retry
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(
          `[OpenAI] Throttled (429) operation=thread_scoring rootId=${thread.rootPost.id} retry=${attempt + 1}/${maxRetries} waitMs=${waitTime} retryAfter=${retryAfter ?? "none"}`
        );
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        return { score: 0 };
      }

      if (!response.ok) {
        // Non-rate-limit errors: return score 0 and log
        if (attempt === maxRetries - 1) {
          console.warn(
            `[Analysis] OpenAI API error ${response.status} when scoring thread rootId=${thread.rootPost.id}: ${response.statusText}`
          );
        }
        return { score: 0 };
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content?.trim();
      if (!content) return { score: 0 };
      content = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(content);
      const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;

      // Debug logging for low scores (omit per-thread spam unless ANALYSIS_VERBOSE_CHATTER)
      if (
        score < 50 &&
        (process.env.ANALYSIS_VERBOSE_CHATTER === "1" ||
          process.env.ANALYSIS_VERBOSE_CHATTER === "true")
      ) {
        console.log(
          `[Analysis] Low score (${score}) for thread rootId=${thread.rootPost.id}. ` +
            `Reason: ${reason || "none provided"}. ` +
            `Content preview: "${thread.rootPost.content?.substring(0, 100) || "no content"}..."`
        );
      }

      return { score, reason };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Handle timeout/abort
      if (lastError.name === "AbortError") {
        if (attempt < maxRetries - 1) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.warn(
            `[Analysis] Timeout when scoring thread rootId=${thread.rootPost.id}, retry ${attempt + 1}/${maxRetries} in ${waitTime}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        console.warn(
          `[Analysis] Timeout when scoring thread rootId=${thread.rootPost.id} after ${maxRetries} attempts`
        );
        return { score: 0 };
      }

      // Other errors: return score 0
      if (attempt === maxRetries - 1) {
        console.warn(
          `[Analysis] Error scoring thread rootId=${thread.rootPost.id}:`,
          lastError.message
        );
      }
      return { score: 0 };
    }
  }

  return { score: 0 };
}

// Embeddings utilities (batch-friendly)
async function embedTexts(texts: string[]): Promise<number[][]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const model = (await configService.getConfig("api", "embedding_model")) || openaiEmbeddingModel();

  // Split into manageable batches to avoid payload limits
  const batchSize = 100;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => (t || "").slice(0, 1500));
    const resp = await fetch(`${openaiBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!resp.ok) throw new Error(`Embeddings API error: ${resp.status}`);
    const data = await resp.json();
    for (const item of data.data) {
      vectors.push(item.embedding as number[]);
    }
    // Light pacing
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
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Main entry point: Run all 4 iterations
 */
type ComprehensiveAnalysisOptions = {
  skipSentiment?: boolean;
  onlyThemes?: boolean;
  sentimentOnly?: boolean;
  onlyChatter?: boolean;
  onlyNetwork?: boolean;
  onlyNews?: boolean;
};

/** Default sanitization outcome (no removals). Shared by early-return paths and main flow. */
function getDefaultSanitizationOutcome(): {
  networkRemoved: number;
  chatterRemoved: number;
  newsRemoved: number;
  themesRemoved: number;
  checkpoints: Record<string, Date | undefined>;
} {
  return {
    networkRemoved: 0,
    chatterRemoved: 0,
    newsRemoved: 0,
    themesRemoved: 0,
    checkpoints: {},
  };
}

export async function runComprehensiveAnalysis(
  projectId: string,
  options: ComprehensiveAnalysisOptions = {}
): Promise<{
  success: boolean;
  error?: string;
  stats?: {
    conversations: number;
    sentimentAnalyzed: number;
    influentialPeople: number;
    newsItems: number;
    themesMatched: number;
    sanitizationRemoved: number;
  };
}> {
  console.log(`[Analysis] Starting comprehensive analysis for project ${projectId}`);
  // Theme, chatter, and related steps run over all project posts in range (not just new data), so duration scales with total project size.

  // NOTE: Cache is NOT cleared here - only clear when we know things have actually changed
  // (posts deleted, themes changed, project essence changed, or explicit reset)

  const sentimentOnly = !!options.sentimentOnly;
  const skipSentiment = sentimentOnly ? false : !!options.skipSentiment;

  // Only clear all analysis when doing a full re-run; never clear when running a single mode (onlyThemes, onlyChatter, onlyNetwork, onlyNews)
  if (
    skipSentiment &&
    !options.onlyThemes &&
    !options.onlyChatter &&
    !options.onlyNetwork &&
    !options.onlyNews
  ) {
    await clearOldAnalysisRecords(projectId);
  }

  const progress = await getOrCreateAnalysisProgress(projectId);
  let lastSentimentPostId = progress.last_sentiment_post_id;
  let lastThemesPostId = progress.last_themes_post_id;
  let lastChatterPostId = progress.last_chatter_post_id;
  let lastNetworkPostId = progress.last_network_post_id;
  let lastNewsPostId = progress.last_news_post_id;
  let lastBrandPostId = progress.last_brand_post_id;
  let lastSanitizedChatterAt = progress.last_sanitized_chatter_at ?? null;
  let lastSanitizedThemesAt = progress.last_sanitized_themes_at ?? null;
  let lastSanitizedNetworkAt = progress.last_sanitized_network_at ?? null;
  let lastSanitizedNewsAt = progress.last_sanitized_news_at ?? null;

  const maxPostRow = await prisma.post.findFirst({
    where: { project_id: projectId },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  const maxPostIdInDb = maxPostRow?.id ?? 0;

  /**
   * After DB restore or swap, analysis cursors can still point at old (higher) post IDs.
   * That makes sentimentUpperBound wrong and skips themes/chatter (needs* flags false) while tables stay empty.
   */
  if (maxPostIdInDb > 0) {
    const normalize = (v: number) => (v > maxPostIdInDb ? 0 : v);
    const nSent = normalize(lastSentimentPostId);
    const nThemes = normalize(lastThemesPostId);
    const nChatter = normalize(lastChatterPostId);
    const nNet = normalize(lastNetworkPostId);
    const nNews = normalize(lastNewsPostId);
    const nBrand = normalize(lastBrandPostId);
    if (
      nSent !== lastSentimentPostId ||
      nThemes !== lastThemesPostId ||
      nChatter !== lastChatterPostId ||
      nNet !== lastNetworkPostId ||
      nNews !== lastNewsPostId ||
      nBrand !== lastBrandPostId
    ) {
      console.warn(
        `[Analysis] Progress cursors exceeded max post id ${maxPostIdInDb} (likely DB restore). Resetting affected cursors to 0 so themes/chatter/sentiment can run again. Before: sentiment=${lastSentimentPostId}, themes=${lastThemesPostId}, chatter=${lastChatterPostId}`
      );
      lastSentimentPostId = nSent;
      lastThemesPostId = nThemes;
      lastChatterPostId = nChatter;
      lastNetworkPostId = nNet;
      lastNewsPostId = nNews;
      lastBrandPostId = nBrand;
      await updateAnalysisProgress(projectId, {
        last_sentiment_post_id: lastSentimentPostId,
        last_themes_post_id: lastThemesPostId,
        last_chatter_post_id: lastChatterPostId,
        last_network_post_id: lastNetworkPostId,
        last_news_post_id: lastNewsPostId,
        last_brand_post_id: lastBrandPostId,
      });
    }
  }

  let sentimentStats = {
    postsAnalyzed: 0,
    themesMatched: 0,
    maxProcessedPostId: lastSentimentPostId,
  };

  if (!skipSentiment) {
    console.log("[Analysis] Step 1: Running sentiment analysis on new posts...");
    sentimentStats = await analyzeSentimentAndThemes(
      projectId,
      { sentimentOnly: true },
      { minPostIdExclusive: lastSentimentPostId }
    );
    console.log(
      `[Analysis] Sentiment stage processed ${sentimentStats.postsAnalyzed} posts (max post ID ${sentimentStats.maxProcessedPostId})`
    );

    if (sentimentOnly) {
      return {
        success: true,
        stats: {
          conversations: 0,
          sentimentAnalyzed: sentimentStats.postsAnalyzed,
          influentialPeople: 0,
          newsItems: 0,
          themesMatched: 0,
          sanitizationRemoved: 0,
        },
      };
    }

    if (sentimentStats.maxProcessedPostId > lastSentimentPostId) {
      lastSentimentPostId = sentimentStats.maxProcessedPostId;
      await updateAnalysisProgress(projectId, { last_sentiment_post_id: lastSentimentPostId });
    }
  } else {
    console.log("[Analysis] Step 1 skipped (sentiment analysis)");
  }

  // Upper bound must be the actual max post id in the DB — never Math.max(lastSentiment, max),
  // which inflates after a DB restore (old last_sentiment >> current max id) and skips themes/chatter.
  // When there are no posts yet, fall back to lastSentimentPostId for downstream no-op behavior.
  const sentimentUpperBound = maxPostIdInDb > 0 ? maxPostIdInDb : lastSentimentPostId;

  if (
    sentimentStats.postsAnalyzed === 0 &&
    maxPostIdInDb > 0 &&
    maxPostIdInDb > lastSentimentPostId
  ) {
    console.log(
      `[Analysis] Sentiment found 0 new posts (all posts already have sentiment), but max post ID in DB is ${maxPostIdInDb} (last sentiment: ${lastSentimentPostId}). Using ${sentimentUpperBound} as upper bound so threads/chatter/themes include new posts.`
    );
  }

  if (options?.onlyThemes) {
    // Build threads for theme analysis
    const threadsPromise = identifyConversationThreads(projectId, {
      minPostIdExclusive: lastThemesPostId,
      maxPostIdInclusive: sentimentUpperBound,
    });

    const themeResult = await runThemeAnalysisStep(
      projectId,
      lastThemesPostId,
      sentimentUpperBound,
      threadsPromise
    );
    if (themeResult.maxProcessedPostId > lastThemesPostId) {
      lastThemesPostId = themeResult.maxProcessedPostId;
    }

    const sanitizationStats =
      themeResult.themesMatched > 0
        ? await sanitizeAnalysisResults(projectId, {
            lastSanitizedThemesAt,
            process: { themes: true },
          })
        : getDefaultSanitizationOutcome();

    if (sanitizationStats.checkpoints.themes) {
      await updateAnalysisProgress(projectId, {
        last_sanitized_themes_at: sanitizationStats.checkpoints.themes,
      });
      lastSanitizedThemesAt = sanitizationStats.checkpoints.themes;
    }

    return {
      success: true,
      stats: {
        conversations: 0,
        sentimentAnalyzed: sentimentStats.postsAnalyzed,
        influentialPeople: 0,
        newsItems: 0,
        themesMatched: themeResult.themesMatched,
        sanitizationRemoved:
          sanitizationStats.networkRemoved +
          sanitizationStats.chatterRemoved +
          sanitizationStats.newsRemoved +
          sanitizationStats.themesRemoved,
      },
    };
  }

  if (options?.onlyNetwork) {
    const threadsPromise = identifyConversationThreads(projectId, {
      minPostIdExclusive: lastNetworkPostId,
      maxPostIdInclusive: sentimentUpperBound,
    });

    const networkResult = await runNetworkAnalysisStep(
      projectId,
      lastNetworkPostId,
      sentimentUpperBound,
      threadsPromise
    );

    if (networkResult.maxProcessedPostId > lastNetworkPostId) {
      lastNetworkPostId = networkResult.maxProcessedPostId;
      await updateAnalysisProgress(projectId, { last_network_post_id: lastNetworkPostId });
    }

    const sanitizationStats =
      networkResult.peopleCount > 0
        ? await sanitizeAnalysisResults(projectId, {
            lastSanitizedNetworkAt,
            process: { network: true },
          })
        : getDefaultSanitizationOutcome();

    if (sanitizationStats.checkpoints.network) {
      await updateAnalysisProgress(projectId, {
        last_sanitized_network_at: sanitizationStats.checkpoints.network,
      });
      lastSanitizedNetworkAt = sanitizationStats.checkpoints.network;
    }

    return {
      success: true,
      stats: {
        conversations: 0,
        sentimentAnalyzed: sentimentStats.postsAnalyzed,
        influentialPeople: networkResult.peopleCount,
        newsItems: 0,
        themesMatched: 0,
        sanitizationRemoved:
          sanitizationStats.networkRemoved +
          sanitizationStats.chatterRemoved +
          sanitizationStats.newsRemoved +
          sanitizationStats.themesRemoved,
      },
    };
  }

  if (options?.onlyNews) {
    const newsResult = await runNewsAnalysisStep(projectId, lastNewsPostId, sentimentUpperBound);

    if (newsResult.maxProcessedPostId > lastNewsPostId) {
      await updateAnalysisProgress(projectId, {
        last_news_post_id: newsResult.maxProcessedPostId,
      });
    }

    const sanitizationStatsNews =
      newsResult.newsCount > 0
        ? await sanitizeAnalysisResults(projectId, {
            lastSanitizedNewsAt,
            process: { news: true },
          })
        : getDefaultSanitizationOutcome();

    if (sanitizationStatsNews.checkpoints.news) {
      await updateAnalysisProgress(projectId, {
        last_sanitized_news_at: sanitizationStatsNews.checkpoints.news,
      });
    }

    return {
      success: true,
      stats: {
        conversations: 0,
        sentimentAnalyzed: sentimentStats.postsAnalyzed,
        influentialPeople: 0,
        newsItems: newsResult.newsCount,
        themesMatched: 0,
        sanitizationRemoved:
          sanitizationStatsNews.networkRemoved +
          sanitizationStatsNews.chatterRemoved +
          sanitizationStatsNews.newsRemoved +
          sanitizationStatsNews.themesRemoved,
      },
    };
  }

  if (
    sentimentUpperBound <=
    Math.max(
      lastThemesPostId,
      lastChatterPostId,
      lastNetworkPostId,
      lastNewsPostId,
      lastBrandPostId
    )
  ) {
    console.log("[Analysis] No new sentiment results to drive step 2 analyses");
  }

  if (options?.onlyChatter) {
    console.log("[Analysis] Running chatter-only analysis");
  }

  if (options?.onlyNetwork) {
    console.log("[Analysis] Running network-only analysis");
  }

  let needsThemeAnalysis = sentimentUpperBound > lastThemesPostId;
  let needsChatterAnalysis = sentimentUpperBound > lastChatterPostId;
  let needsNetworkAnalysis = sentimentUpperBound > lastNetworkPostId;
  let needsNewsAnalysis = sentimentUpperBound > lastNewsPostId;
  let needsBrandAnalysis = sentimentUpperBound > lastBrandPostId;

  if (options?.onlyChatter) {
    needsThemeAnalysis = false;
    needsNetworkAnalysis = false;
    needsNewsAnalysis = false;
    needsBrandAnalysis = false;
  }

  if (options?.onlyNetwork) {
    needsThemeAnalysis = false;
    needsChatterAnalysis = false;
    needsNewsAnalysis = false;
    needsBrandAnalysis = false;
  }

  if (options?.onlyNews) {
    needsThemeAnalysis = false;
    needsChatterAnalysis = false;
    needsNetworkAnalysis = false;
    needsBrandAnalysis = false;
  }

  const threadsRequired = needsChatterAnalysis || needsNetworkAnalysis;
  // CRITICAL: The lower bound should be the MINIMUM of all counters that need threads
  // This ensures we include ALL threads that any analysis step might need
  // Example: If lastChatterPostId=100, lastNetworkPostId=50, sentimentUpperBound=200
  // Then threadsLowerBound=50, which means we'll include threads with IDs 51-200
  // This is correct because network needs 51-200, and chatter needs 101-200
  const threadBounds: number[] = [];
  if (needsChatterAnalysis) threadBounds.push(lastChatterPostId);
  if (needsNetworkAnalysis) threadBounds.push(lastNetworkPostId);
  // If threads are required but no counters exist yet, start from 0
  const threadsLowerBound =
    threadsRequired && threadBounds.length > 0 ? Math.min(...threadBounds) : 0;

  console.log(
    `[Analysis] Thread bounds calculation: sentimentUpperBound=${sentimentUpperBound}, lastChatterPostId=${lastChatterPostId}, lastNetworkPostId=${lastNetworkPostId}, threadsLowerBound=${threadsLowerBound}`
  );

  const threadsPromise = threadsRequired
    ? identifyConversationThreads(projectId, {
        minPostIdExclusive: threadsLowerBound,
        maxPostIdInclusive: sentimentUpperBound,
      })
    : Promise.resolve<ConversationThread[]>([]);

  // Run step 2 analyses SEQUENTIALLY rather than in parallel.
  // This reduces concurrent OpenAI calls and other heavy work that can cause rate limits
  // or make debugging hangs difficult.
  const themeResult = needsThemeAnalysis
    ? await runThemeAnalysisStep(projectId, lastThemesPostId, sentimentUpperBound, threadsPromise)
    : { postsAnalyzed: 0, themesMatched: 0, maxProcessedPostId: lastThemesPostId };

  const chatterResult = needsChatterAnalysis
    ? await runChatterAnalysisStep(
        projectId,
        lastChatterPostId,
        sentimentUpperBound,
        threadsPromise
      )
    : { stored: 0, maxProcessedPostId: lastChatterPostId };

  const networkResult = needsNetworkAnalysis
    ? await runNetworkAnalysisStep(
        projectId,
        lastNetworkPostId,
        sentimentUpperBound,
        threadsPromise
      )
    : { peopleCount: 0, maxProcessedPostId: lastNetworkPostId };

  const newsResult = needsNewsAnalysis
    ? await runNewsAnalysisStep(projectId, lastNewsPostId, sentimentUpperBound)
    : { newsCount: 0, maxProcessedPostId: lastNewsPostId };

  const brandResult = needsBrandAnalysis
    ? await runBrandAnalysisStep(projectId, lastBrandPostId, sentimentUpperBound)
    : { processed: 0, brandMentions: 0, errors: 0, maxProcessedPostId: lastBrandPostId };

  if (themeResult.maxProcessedPostId > lastThemesPostId) {
    lastThemesPostId = themeResult.maxProcessedPostId;
    await updateAnalysisProgress(projectId, { last_themes_post_id: lastThemesPostId });
  }

  // Advance cursor so we don't re-process same threads when 0 stored (e.g. all rejected)
  if (chatterResult.maxProcessedPostId > lastChatterPostId) {
    lastChatterPostId = chatterResult.maxProcessedPostId;
    await updateAnalysisProgress(projectId, { last_chatter_post_id: lastChatterPostId });
  }

  if (networkResult.maxProcessedPostId > lastNetworkPostId) {
    lastNetworkPostId = networkResult.maxProcessedPostId;
    await updateAnalysisProgress(projectId, { last_network_post_id: lastNetworkPostId });
  }

  if (newsResult.maxProcessedPostId > lastNewsPostId) {
    lastNewsPostId = newsResult.maxProcessedPostId;
    await updateAnalysisProgress(projectId, { last_news_post_id: lastNewsPostId });
    console.log(
      `[Analysis] [News] Cursor saved: last_news_post_id=${lastNewsPostId} (next run will only process newer posts).`
    );
  }

  if (brandResult.maxProcessedPostId > lastBrandPostId) {
    lastBrandPostId = brandResult.maxProcessedPostId;
    await updateAnalysisProgress(projectId, { last_brand_post_id: lastBrandPostId });
  }

  const shouldSanitizeThemes = themeResult.themesMatched > 0;
  const shouldSanitizeChatter = chatterResult.stored > 0;
  const shouldSanitizeNetwork = networkResult.peopleCount > 0;
  const shouldSanitizeNews = newsResult.newsCount > 0;

  let sanitizationStats = getDefaultSanitizationOutcome();

  if (
    shouldSanitizeThemes ||
    shouldSanitizeChatter ||
    shouldSanitizeNetwork ||
    shouldSanitizeNews
  ) {
    const sanitizationResult = await sanitizeAnalysisResults(projectId, {
      lastSanitizedChatterAt,
      lastSanitizedThemesAt,
      lastSanitizedNetworkAt,
      lastSanitizedNewsAt,
      process: {
        chatter: shouldSanitizeChatter,
        themes: shouldSanitizeThemes,
        network: shouldSanitizeNetwork,
        news: shouldSanitizeNews,
      },
    });

    sanitizationStats = sanitizationResult;

    const progressUpdates: Parameters<typeof updateAnalysisProgress>[1] = {};
    if (sanitizationResult.checkpoints.chatter) {
      progressUpdates.last_sanitized_chatter_at = sanitizationResult.checkpoints.chatter;
      lastSanitizedChatterAt = sanitizationResult.checkpoints.chatter;
    }
    if (sanitizationResult.checkpoints.themes) {
      progressUpdates.last_sanitized_themes_at = sanitizationResult.checkpoints.themes;
      lastSanitizedThemesAt = sanitizationResult.checkpoints.themes;
    }
    if (sanitizationResult.checkpoints.network) {
      progressUpdates.last_sanitized_network_at = sanitizationResult.checkpoints.network;
      lastSanitizedNetworkAt = sanitizationResult.checkpoints.network;
    }
    if (sanitizationResult.checkpoints.news) {
      progressUpdates.last_sanitized_news_at = sanitizationResult.checkpoints.news;
      lastSanitizedNewsAt = sanitizationResult.checkpoints.news;
    }

    if (Object.keys(progressUpdates).length > 0) {
      await updateAnalysisProgress(projectId, progressUpdates);
    }
  }

  // CRITICAL: Log actual database counts after all processing to verify records exist
  const finalCounts = await Promise.all([
    prisma.chatterAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.themesAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.networkAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.postNews.count({
      where: { project_id: projectId, deleted_at: null },
    }),
  ]);

  console.log(
    `[Analysis] 📊 FINAL DATABASE COUNTS for project ${projectId} (after all processing):`
  );
  console.log(`  - Chatter: ${finalCounts[0]} records`);
  console.log(`  - Themes: ${finalCounts[1]} records`);
  console.log(`  - Network (Influencers): ${finalCounts[2]} records`);
  console.log(`  - News: ${finalCounts[3]} records`);
  console.log(
    `[Analysis] Summary stats (before sanitization): conversations=${chatterResult.stored}, themesMatched=${themeResult.themesMatched}, influentialPeople=${networkResult.peopleCount}, newsItems=${newsResult.newsCount}`
  );

  return {
    success: true,
    stats: {
      conversations: chatterResult.stored,
      sentimentAnalyzed: sentimentStats.postsAnalyzed,
      influentialPeople: networkResult.peopleCount,
      newsItems: newsResult.newsCount,
      themesMatched: themeResult.themesMatched,
      sanitizationRemoved:
        sanitizationStats.networkRemoved +
        sanitizationStats.chatterRemoved +
        sanitizationStats.newsRemoved +
        sanitizationStats.themesRemoved,
    },
  };
}

/**
 * ITERATION 1: Identify conversation threads (delegates to shared builder)
 */
interface AnalysisBounds {
  minPostIdExclusive?: number;
  maxPostIdInclusive?: number;
  /** Stamp analysis outputs and scope run-scoped sanitization to this orchestration run. */
  orchestrationRunId?: string | null;
}

async function identifyConversationThreads(
  projectId: string,
  bounds?: AnalysisBounds
): Promise<ConversationThread[]> {
  const { buildConversationThreads } = await import("@/lib/conversation-builder");
  const threads = await buildConversationThreads(projectId, bounds);
  const threadsWithReplies = threads.filter((t) => t.replies.length > 0);
  const threadsByPlatform = new Map<string, number>();
  return threads;
}

/**
 * Clear old analysis records for a project before re-running
 */
async function clearOldAnalysisRecords(projectId: string): Promise<void> {
  // Soft delete old records (set deleted_at)
  await prisma.chatterAnalysis.updateMany({
    where: { project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  await prisma.networkAnalysis.updateMany({
    where: { project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  await prisma.postNews.updateMany({
    where: { project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  await prisma.themesAnalysis.updateMany({
    where: { project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  await prisma.brandAnalysis.updateMany({
    where: { project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  // Cursors must be reset when derived tables are cleared; otherwise
  // sentimentUpperBound <= last_* and step-2 analyses (themes, chatter, network, news, brand) are skipped,
  // leaving the UI empty even though posts still have sentiment.
  await updateAnalysisProgress(projectId, {
    last_themes_post_id: 0,
    last_chatter_post_id: 0,
    last_network_post_id: 0,
    last_news_post_id: 0,
    last_brand_post_id: 0,
    last_sanitized_chatter_at: null,
    last_sanitized_themes_at: null,
    last_sanitized_network_at: null,
    last_sanitized_news_at: null,
  });

  console.log(
    `[Analysis] Cleared old analysis records for project ${projectId}; reset step-2 cursors so downstream analyses re-run`
  );
}

/**
 * ITERATION 2: Per-post sentiment + theme matching
 */
async function analyzeSentimentAndThemes(
  projectId: string,
  options?: { themesOnly?: boolean; sentimentOnly?: boolean },
  bounds?: AnalysisBounds
): Promise<{ postsAnalyzed: number; themesMatched: number; maxProcessedPostId: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping sentiment/theme analysis - no OpenAI API key");
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: bounds?.minPostIdExclusive ?? 0,
    };
  }

  const themesOnly = options?.themesOnly === true;
  const sentimentOnly = options?.sentimentOnly === true;

  if (themesOnly && sentimentOnly) {
    throw new Error("Cannot run sentimentOnly and themesOnly modes simultaneously");
  }

  const minPostIdExclusive = bounds?.minPostIdExclusive ?? 0;
  const maxPostIdInclusive = bounds?.maxPostIdInclusive;
  const stampRunId = bounds?.orchestrationRunId;

  // Determine query filters based on mode
  // NOTE: Post model doesn't have deleted_at field, so we don't filter by it
  const postWhere: Prisma.PostWhereInput = {
    project_id: projectId,
    content: { not: null },
    NOT: { content: "" },
    id: {
      gt: minPostIdExclusive,
      ...(maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
    },
    ...(themesOnly ? { sentiment: { not: null } } : { sentiment: null }),
    ...postWhereExcludeGithubFromLegacySentimentPipeline,
  };

  const posts = (await prisma.post.findMany({
    where: postWhere,
    select: {
      id: true,
      content: true,
      platform: true,
      authorId: true,
      authorName: true,
      url: true,
      createdAt: true,
      channelId: true,
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
      language: true,
      sentiment: true,
      threadRefId: true,
    },
  })) as PostForAnalysis[];

  if (posts.length === 0) {
    console.log(
      themesOnly
        ? "[Analysis] No posts found to evaluate themes in incremental range"
        : "[Analysis] No posts with NULL sentiment found to analyze"
    );
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: minPostIdExclusive,
    };
  }

  // Work on a mutable list separate from the original constant
  let postsForEval: PostForAnalysis[] = [...posts];

  const modeDescription = themesOnly
    ? "themes only"
    : sentimentOnly
      ? "sentiment only"
      : "sentiment + themes";
  console.log(
    `[Analysis] 📊 Preparing ${postsForEval.length} posts for OpenAI analysis (${modeDescription})`
  );

  const projectEssence = await getProjectContextForRelevance(projectId);

  // Get project themes (only needed when theme matching runs)
  const themes = await prisma.projectTheme.findMany({
    where: {
      project_id: projectId,
      is_active: true,
      deleted_at: null,
    },
    select: {
      id: true,
      theme_name: true,
      description: true,
      updated_at: true,
    },
  });

  const skipThemeMatching = sentimentOnly || themes.length === 0;
  if (skipThemeMatching) {
    if (sentimentOnly) {
      console.log(
        "[Analysis] Running sentiment analysis without theme matching (sentiment-only mode)"
      );
    } else {
      console.log("[Analysis] No themes defined, skipping theme matching");
    }
  }

  // Get Discord server names from project profiles
  const discordProfiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      deleted_at: null,
    },
    select: {
      name: true,
      url: true, // Contains the channel ID for Discord
    },
  });

  const discordServerMap = new Map<string, string>();
  for (const profile of discordProfiles) {
    const channelId = extractDiscordChannelIdFromProjectProfileUrl(profile.url || "");
    if (channelId) {
      discordServerMap.set(channelId, profile.name);
    }
  }

  // NOTE: Cache removed - it was redundant
  // Posts are immutable (never updated in place), and the lastThemesPostId counter already ensures
  // we only analyze NEW posts (id > lastThemesPostId). The counter handles incremental analysis perfectly.
  // No cache needed - it caused more problems than it solved.

  // Per-theme embedding prefilter to reduce posts sent to LLM (only when theme matching is enabled)
  if (!skipThemeMatching && postsForEval.length > 0 && themes.length > 0) {
    try {
      const beforeCount = postsForEval.length;
      console.log(
        `[Analysis] Prefilter: computing theme embeddings for ${themes.length} themes...`
      );
      const themeTexts = themes.map((t) => combineThemePrimaryText(t.theme_name, t.description));
      const themeEmbeds = await embedTexts(themeTexts);

      console.log(`[Analysis] Prefilter: computing embeddings for ${postsForEval.length} posts...`);
      const postTexts = postsForEval.map((p) => (p.content || "").slice(0, 1000));
      const postEmbeds = await embedTexts(postTexts);

      const BASE_SIM_THRESHOLD = 0.5;
      const FACEBOOK_SIM_THRESHOLD = 0.3;
      const TOP_K_PER_THEME = Math.min(150, postsForEval.length);
      const keepIdx = new Set<number>();
      let forcedFacebookKeeps = 0;

      const getThemeSimThreshold = (post: PostForAnalysis) =>
        isFacebookPlatform(post.platform) ? FACEBOOK_SIM_THRESHOLD : BASE_SIM_THRESHOLD;

      const shouldForceKeepForThemes = (post: PostForAnalysis) => {
        if (!isFacebookPlatform(post.platform)) return false;
        const isRoot = !post.threadRefId;
        const engagement =
          (post.metricsComments ?? 0) + (post.metricsLikes ?? 0) + (post.metricsShares ?? 0);
        const hasLongContent = (post.content?.length ?? 0) >= 80;
        return isRoot && (engagement >= 1 || hasLongContent);
      };

      for (let i = 0; i < postEmbeds.length; i++) {
        const pe = postEmbeds[i];
        let maxSim = 0;
        for (let j = 0; j < themeEmbeds.length; j++) {
          const sim = cosineSimilarity(pe, themeEmbeds[j]);
          if (sim > maxSim) maxSim = sim;
          const threshold = getThemeSimThreshold(postsForEval[i]);
          if (maxSim >= threshold) break;
        }
        if (maxSim >= getThemeSimThreshold(postsForEval[i])) keepIdx.add(i);
      }

      for (let j = 0; j < themeEmbeds.length; j++) {
        const sims: Array<{ i: number; s: number }> = [];
        for (let i = 0; i < postEmbeds.length; i++) {
          sims.push({ i, s: cosineSimilarity(postEmbeds[i], themeEmbeds[j]) });
        }
        sims.sort((a, b) => b.s - a.s);
        for (let k = 0; k < Math.min(TOP_K_PER_THEME, sims.length); k++) {
          keepIdx.add(sims[k].i);
        }
      }

      for (let i = 0; i < postsForEval.length; i++) {
        if (!keepIdx.has(i) && shouldForceKeepForThemes(postsForEval[i])) {
          keepIdx.add(i);
          forcedFacebookKeeps++;
        }
      }

      if (keepIdx.size > 0 && keepIdx.size < postsForEval.length) {
        const filtered: PostForAnalysis[] = [];
        for (let i = 0; i < postsForEval.length; i++) {
          if (keepIdx.has(i)) filtered.push(postsForEval[i]);
        }
        postsForEval = filtered;
        console.log(
          `[Analysis] Prefilter: keeping ${postsForEval.length}/${beforeCount} posts for theme evaluation${
            forcedFacebookKeeps > 0 ? ` (forced Facebook keeps: ${forcedFacebookKeeps})` : ""
          }`
        );
      }
    } catch (e) {
      console.warn("[Analysis] Prefilter: skipping due to error:", e);
    }
  }

  // When theme matching runs, load project brands and pre-review which themes reference which brands (strict).
  let projectBrandNames: string[] = [];
  let themeBrandRequirements = new Map<string, string[]>();
  if (!skipThemeMatching && themes.length > 0) {
    projectBrandNames = await getProjectBrandNames(projectId);
    if (projectBrandNames.length > 0) {
      console.log(
        `[Analysis] Theme–brand filter: project has ${projectBrandNames.length} brand(s): ${projectBrandNames.join(", ")}`
      );
    }
    themeBrandRequirements = buildThemeBrandRequirementsMap(themes, projectBrandNames);
    const withBrands = [...themeBrandRequirements.entries()].filter(([, b]) => b.length > 0);
    if (withBrands.length > 0) {
      console.log(
        `[Analysis] Theme–brand review: ${withBrands.length} theme(s) reference project brand(s) (strict token match); matches require that brand in post text.`
      );
      for (const [tid, brands] of withBrands) {
        const t = themes.find((x) => x.id === tid);
        if (t) {
          console.log(`[Analysis]   • "${t.theme_name}" → ${brands.join(", ")}`);
        }
      }
    }
  }

  const batchSize = 20;
  let totalAnalyzed = 0;
  let totalThemesMatched = 0;
  const processedPostIds = new Set<number>();

  // Sentiment-only: single canonical implementation (same as task worker / blog / HN pipelines).
  if (sentimentOnly) {
    const sentRes = await runSentimentForPostIds(
      projectId,
      postsForEval.map((p) => p.id)
    );
    totalAnalyzed = sentRes.analyzed;
    sentRes.processedPostIds.forEach((id) => processedPostIds.add(id));
    if (sentRes.processedPostIds.length < postsForEval.length) {
      const missing = postsForEval.length - sentRes.processedPostIds.length;
      const missingIds = postsForEval
        .filter((p) => !sentRes.processedPostIds.includes(p.id))
        .map((p) => p.id)
        .slice(0, 5);
      console.warn(
        `[Analysis] Sentiment: ${sentRes.processedPostIds.length}/${postsForEval.length} posts got sentiment. ` +
          `${missing} may be missing from OpenAI response. Missing IDs: ${missingIds.join(", ")}${missing > 5 ? "..." : ""}`
      );
    }
  } else {
    const batches: PostForAnalysis[][] = [];
    for (let i = 0; i < postsForEval.length; i += batchSize) {
      batches.push(postsForEval.slice(i, i + batchSize));
    }

    const poolSize = 3;
    let index = 0;

    async function runNext(): Promise<void> {
      const current = index++;
      if (current >= batches.length) return;
      const batch = batches[current];
      const start = current * batchSize;
      const end = start + batch.length;
      try {
        const result = await analyzeBatchSentimentAndThemes(
          batch,
          themes,
          skipThemeMatching,
          projectId,
          discordServerMap,
          projectEssence,
          themesOnly,
          false,
          projectBrandNames,
          themeBrandRequirements,
          stampRunId
        );
        totalAnalyzed += result.analyzed;
        totalThemesMatched += result.themesMatched;

        result.processedPostIds.forEach((postId) => processedPostIds.add(postId));

        if (result.processedPostIds.length < batch.length) {
          const missing = batch.length - result.processedPostIds.length;
          const missingIds = batch
            .filter((p) => !result.processedPostIds.includes(p.id))
            .map((p) => p.id)
            .slice(0, 5);
          console.warn(
            `[Analysis] Batch ${start}-${end}: ${result.processedPostIds.length}/${batch.length} posts got sentiment. ` +
              `${missing} posts did not receive sentiment (may be missing from OpenAI response). ` +
              `Missing IDs: ${missingIds.join(", ")}${missing > 5 ? "..." : ""}`
          );
        }
      } catch (error) {
        console.error(`[Analysis] Error analyzing batch ${start}-${end}:`, error);
      }

      const delayMs = 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      await runNext();
    }

    await Promise.all(Array.from({ length: Math.min(poolSize, batches.length) }, () => runNext()));
  }

  // CRITICAL BUG FIX: The checkpoint should only advance to ensure we don't skip any posts.
  //
  // Problem: If posts are queried but filtered out before batching (e.g., prefilter),
  // or if batches fail, those posts won't be in processedPostIds. If we advance the
  // checkpoint to the max of processedPostIds, we'll skip those unprocessed posts.
  //
  // Solution: Use the original posts array (all queried posts) for checkpoint calculation.
  // Only advance past posts that were:
  // 1. Actually processed (got sentiment) - in processedPostIds
  // 2. Intentionally filtered (in postsForEval but not processed) - these were sent to batches but didn't get sentiment
  //
  // Posts that were queried but NOT in postsForEval (filtered out before batching) should
  // NOT cause the checkpoint to advance - they should be retried in the next run.

  const allQueriedPostIds = new Set(posts.map((p) => p.id));
  const postsForEvalIds = new Set(postsForEval.map((p) => p.id));

  // Posts that were intentionally filtered (in postsForEval but not processed)
  // These were sent to batches but didn't get sentiment - we can advance past them
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const intentionallyFilteredIds = Array.from(postsForEvalIds).filter(
    (id) => !processedPostIds.has(id)
  );

  // Posts that were queried but never made it to batches (filtered out before batching)
  // These should NOT cause checkpoint to advance - they need to be retried
  const filteredOutBeforeBatching = Array.from(allQueriedPostIds).filter(
    (id) => !postsForEvalIds.has(id)
  );

  // Posts that were queried but not processed (either filtered or failed)
  const unprocessedPostIds = Array.from(allQueriedPostIds).filter(
    (id) => !processedPostIds.has(id)
  );

  let maxProcessedPostId = minPostIdExclusive;

  if (filteredOutBeforeBatching.length > 0) {
    // Some posts were filtered out before batching - don't advance past them
    // This is a problem - posts with content shouldn't be filtered out in sentiment-only mode
    const minFilteredId = Math.min(...filteredOutBeforeBatching);
    maxProcessedPostId = minFilteredId - 1; // Advance to just before the first filtered post

    console.warn(
      `[Analysis] ⚠️  WARNING: ${filteredOutBeforeBatching.length} posts were queried but filtered out before batching. ` +
        `This shouldn't happen in sentiment-only mode unless there's a bug. ` +
        `Queried: ${posts.length}, Made it to batches: ${postsForEval.length}, ` +
        `Min filtered ID: ${minFilteredId}, Setting checkpoint to: ${maxProcessedPostId}`
    );
  } else if (unprocessedPostIds.length > 0) {
    // Some posts made it to batches but didn't get processed - don't advance past them
    const minUnprocessedId = Math.min(...unprocessedPostIds);
    maxProcessedPostId = minUnprocessedId - 1; // Advance to just before the first unprocessed post

    console.warn(
      `[Analysis] ⚠️  WARNING: ${unprocessedPostIds.length} posts were sent to batches but didn't get sentiment. ` +
        `Queried: ${posts.length}, Processed: ${processedPostIds.size}, ` +
        `Min unprocessed ID: ${minUnprocessedId}, Setting checkpoint to: ${maxProcessedPostId}`
    );
  } else if (processedPostIds.size > 0) {
    // All queried posts were processed - safe to advance to max queried ID
    const maxQueriedId = Math.max(...Array.from(allQueriedPostIds));
    maxProcessedPostId = maxQueriedId;

    console.log(
      `[Analysis] ✅ All ${processedPostIds.size} queried posts processed. ` +
        `Max queried ID: ${maxQueriedId}, Setting checkpoint to: ${maxProcessedPostId}`
    );
  }
  // If no posts were processed at all, keep checkpoint at minPostIdExclusive

  // FIX FOR ISSUE #2: Re-query to catch posts created during analysis AND backfill old unanalyzed posts
  // This addresses two problems:
  // 1. Timing issue: posts created after the initial query runs
  // 2. Backfill: posts that were skipped in previous runs (checkpoint advanced past them incorrectly)
  if (processedPostIds.size > 0 && !themesOnly) {
    const maxProcessedId = Math.max(...Array.from(processedPostIds));

    // First, backfill old unanalyzed posts below the ORIGINAL checkpoint (minPostIdExclusive)
    // These are posts that should have been analyzed but were skipped in previous runs
    // We process up to 200 posts per run to gradually catch up on the backlog
    const backfillLimit = 200;
    const backfillQueryWhere: Prisma.PostWhereInput = {
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
      id: {
        gt: 0, // Start from the beginning (or could use a smarter lower bound)
        lt: minPostIdExclusive, // Only backfill posts below the original checkpoint
      },
      sentiment: null,
      ...postWhereExcludeGithubFromLegacySentimentPipeline,
    };

    const backfillPosts = (await prisma.post.findMany({
      where: backfillQueryWhere,
      select: {
        id: true,
        content: true,
        platform: true,
        authorId: true,
        authorName: true,
        url: true,
        createdAt: true,
        channelId: true,
        metricsLikes: true,
        metricsComments: true,
        metricsShares: true,
        language: true,
        sentiment: true,
        threadRefId: true,
      },
      take: backfillLimit,
      orderBy: { id: "desc" }, // Process newest first (most likely to be relevant)
    })) as PostForAnalysis[];

    if (backfillPosts.length > 0) {
      console.log(
        `[Analysis] 🔄 Found ${backfillPosts.length} old unanalyzed posts below checkpoint. Backfilling them now...`
      );

      // Process backfill posts in batches
      const backfillBatches: PostForAnalysis[][] = [];
      for (let i = 0; i < backfillPosts.length; i += batchSize) {
        backfillBatches.push(backfillPosts.slice(i, i + batchSize));
      }

      for (const batch of backfillBatches) {
        try {
          if (sentimentOnly) {
            const result = await runSentimentForPostIds(
              projectId,
              batch.map((p) => p.id)
            );
            totalAnalyzed += result.analyzed;
            result.processedPostIds.forEach((postId) => processedPostIds.add(postId));
          } else {
            const result = await analyzeBatchSentimentAndThemes(
              batch,
              themes,
              skipThemeMatching,
              projectId,
              discordServerMap,
              projectEssence,
              themesOnly,
              false,
              projectBrandNames,
              themeBrandRequirements,
              stampRunId
            );
            totalAnalyzed += result.analyzed;
            totalThemesMatched += result.themesMatched;
            result.processedPostIds.forEach((postId) => processedPostIds.add(postId));
          }

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`[Analysis] Error processing backfill batch:`, error);
          // Continue with other batches
        }
      }

      if (backfillPosts.length > 0) {
        const backfillProcessedIds = backfillPosts
          .filter((p) => processedPostIds.has(p.id))
          .map((p) => p.id);
        if (backfillProcessedIds.length > 0) {
          console.log(
            `[Analysis] ✅ Backfilled ${backfillProcessedIds.length} old unanalyzed posts.`
          );
        }
      }
    }

    // Then, catch posts created during analysis (new posts above what we just processed)
    const finalQueryWhere: Prisma.PostWhereInput = {
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
      id: {
        gt: maxProcessedId, // Query posts created after we finished processing
        ...(maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
      },
      sentiment: null,
      ...postWhereExcludeGithubFromLegacySentimentPipeline,
    };

    const newlyCreatedPosts = (await prisma.post.findMany({
      where: finalQueryWhere,
      select: {
        id: true,
        content: true,
        platform: true,
        authorId: true,
        authorName: true,
        url: true,
        createdAt: true,
        channelId: true,
        metricsLikes: true,
        metricsComments: true,
        metricsShares: true,
        language: true,
        sentiment: true,
        threadRefId: true,
      },
      take: 100, // Limit to avoid processing too many new posts in one run
    })) as PostForAnalysis[];

    if (newlyCreatedPosts.length > 0) {
      console.log(
        `[Analysis] 🔄 Found ${newlyCreatedPosts.length} posts created during analysis. Processing them now...`
      );

      // Process newly created posts
      const newBatches: PostForAnalysis[][] = [];
      for (let i = 0; i < newlyCreatedPosts.length; i += batchSize) {
        newBatches.push(newlyCreatedPosts.slice(i, i + batchSize));
      }

      for (const batch of newBatches) {
        try {
          if (sentimentOnly) {
            const result = await runSentimentForPostIds(
              projectId,
              batch.map((p) => p.id)
            );
            totalAnalyzed += result.analyzed;
            result.processedPostIds.forEach((postId) => processedPostIds.add(postId));
          } else {
            const result = await analyzeBatchSentimentAndThemes(
              batch,
              themes,
              skipThemeMatching,
              projectId,
              discordServerMap,
              projectEssence,
              themesOnly,
              false,
              projectBrandNames,
              themeBrandRequirements,
              stampRunId
            );
            totalAnalyzed += result.analyzed;
            totalThemesMatched += result.themesMatched;
            result.processedPostIds.forEach((postId) => processedPostIds.add(postId));
          }

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`[Analysis] Error processing newly created posts batch:`, error);
          // Continue with other batches
        }
      }

      if (newlyCreatedPosts.length > 0) {
        const newlyProcessedIds = newlyCreatedPosts
          .filter((p) => processedPostIds.has(p.id))
          .map((p) => p.id);
        if (newlyProcessedIds.length > 0) {
          const maxNewlyProcessedId = Math.max(...newlyProcessedIds);
          // Update maxProcessedPostId to include newly processed posts
          maxProcessedPostId = Math.max(maxProcessedPostId, maxNewlyProcessedId);
          console.log(
            `[Analysis] ✅ Processed ${newlyProcessedIds.length} newly created posts. ` +
              `Updated checkpoint to: ${maxProcessedPostId}`
          );
        }
      }
    }
  }

  return {
    postsAnalyzed: totalAnalyzed,
    themesMatched: totalThemesMatched,
    maxProcessedPostId,
  };
}

interface PostForAnalysis {
  id: number;
  content?: string | null;
  platform: string;
  authorId?: string | null;
  authorName?: string | null;
  url?: string | null;
  createdAt: Date;
  project_id?: string | null;
  channelId?: string | null;
  metricsLikes?: number | null;
  metricsComments?: number | null;
  metricsShares?: number | null;
  language?: string | null;
  threadRefId?: string | null;
}

interface ThemeForAnalysis {
  id: string;
  theme_name: string;
  description?: string | null;
}

/**
 * Fetch this project's brand names (from ProjectBrand) for theme-entity checks.
 */
export async function getProjectBrandNames(projectId: string): Promise<string[]> {
  const brands = await prisma.projectBrand.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { brand_name: true },
  });
  return brands.map((b) => b.brand_name).filter((n) => n && n.trim());
}

/**
 * Combined text for theme intent: **description first** (primary), then title.
 * Used for brand/entity detection, sentiment hints, and embeddings so the description drives matching.
 */
export function combineThemePrimaryText(
  themeName: string,
  themeDescription?: string | null
): string {
  const d = (themeDescription ?? "").trim();
  const n = (themeName ?? "").trim();
  if (d && n) return `${d}\n${n}`;
  return d || n;
}

/**
 * Format themes for LLM prompts: the description is the primary definition; the title is a short label.
 */
export function formatThemeListForLlmPrompt(
  themes: Array<{ theme_name: string; description?: string | null }>
): string {
  return themes
    .map((t, i) => {
      const label = (t.theme_name ?? "").trim();
      const primary = (t.description ?? "").trim();
      if (primary && label) {
        return `${i + 1}. Primary (what to match): ${primary}\n   Short label: "${label}"`;
      }
      if (primary) return `${i + 1}. Primary (what to match): ${primary}`;
      return `${i + 1}. "${label || "(unnamed theme)"}"`;
    })
    .join("\n");
}

/** Short single-token project brands: require word-boundary match so "agent" does not match inside "agentsh". */
const BRAND_PHRASE_WORD_BOUNDARY_MAX_LEN = 7;

/**
 * True if lowercased text mentions `brandPhrase` with the same rules for themes and posts
 * (substring for multi-word/long phrases; word boundaries for short single tokens).
 */
export function textMentionsBrandPhrase(contentLower: string, brandPhrase: string): boolean {
  const p = brandPhrase.toLowerCase().trim();
  if (!p) return false;
  if (p.includes(" ") || p.length > BRAND_PHRASE_WORD_BOUNDARY_MAX_LEN) {
    return contentLower.includes(p);
  }
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(contentLower);
}

/**
 * Project brands that **strictly** appear in theme text (same token/phrase rules as post checks).
 * Longer brand names are checked first so overlapping names resolve predictably.
 *
 * By default scans **both** theme description (primary) and theme name (label) via {@link combineThemePrimaryText}.
 *
 * @param options.textSource — `combined` (default): description + name; `label_only`: short label only (tests / rare overrides).
 */
export function getProjectBrandsReferencedInThemeStrict(
  themeName: string,
  themeDescription: string | null | undefined,
  projectBrandNames: string[],
  options?: { textSource?: "combined" | "label_only" }
): string[] {
  const textSource = options?.textSource ?? "combined";
  const combined =
    textSource === "label_only"
      ? (themeName ?? "").trim()
      : combineThemePrimaryText(themeName, themeDescription);
  if (!combined || projectBrandNames.length === 0) return [];
  const themeLower = combined.toLowerCase();
  const sorted = [...projectBrandNames]
    .map((b) => b.trim())
    .filter((b) => b.length >= 3)
    .sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const brand of sorted) {
    if (textMentionsBrandPhrase(themeLower, brand)) {
      found.push(brand);
    }
  }
  return found;
}

/**
 * @deprecated Use {@link getProjectBrandsReferencedInThemeStrict} — kept as alias (now strict, not substring).
 */
export function getBrandsMentionedInTheme(
  themeName: string,
  projectBrandNames: string[],
  themeDescription?: string | null,
  options?: { textSource?: "combined" | "label_only" }
): string[] {
  return getProjectBrandsReferencedInThemeStrict(
    themeName,
    themeDescription,
    projectBrandNames,
    options
  );
}

/**
 * Pre–theme analysis: map each theme id → project brand names that appear in that theme (strict).
 * Always scans **theme name + description** for project brand mentions.
 */
export function buildThemeBrandRequirementsMap(
  themes: Array<{ id: string; theme_name: string; description: string | null }>,
  projectBrandNames: string[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of themes) {
    const brands = getProjectBrandsReferencedInThemeStrict(
      t.theme_name,
      t.description,
      projectBrandNames,
      {
        textSource: "combined",
      }
    );
    map.set(t.id, brands);
  }
  return map;
}

/**
 * Text used to verify project brands in a post (title line + body; optional summary fallback for pipelines that only have summaries).
 */
export function composePostTextForBrandGate(
  post: { content?: string | null; authorName?: string | null } | null,
  summaryFallback?: string | null
): string {
  const parts = [post?.authorName, post?.content, summaryFallback].filter(
    (s) => s != null && String(s).trim() !== ""
  );
  return parts.join("\n\n").trim();
}

/** Optional: require literal "with/about/for …" phrase in post text (off by default; idea-based matching). */
function themeEntityLiteralGateEnabled(): boolean {
  return process.env.ANALYSIS_THEME_ENTITY_LITERAL_GATE === "1";
}

/**
 * Returns true if the theme's primary text implies negative sentiment (frustration, complaints, anger).
 * Used to reject matches when the post's sentiment is POSITIVE.
 */
function themeImpliesNegativeSentiment(
  themeName: string,
  themeDescription?: string | null
): boolean {
  const combined = combineThemePrimaryText(themeName, themeDescription);
  if (!combined.trim()) return false;
  const lower = combined.toLowerCase().trim();
  const negativePatterns = [
    "frustrated with",
    "frustration with",
    "complaints about",
    "complaining about",
    "angry at",
    "angry with",
    "unhappy with",
    "disappointed with",
    "dissatisfied with",
    "negative about",
    "criticism of",
    "criticizing",
  ];
  return negativePatterns.some((p) => lower.startsWith(p) || lower.includes(" " + p));
}

/**
 * Extract an entity phrase from a single theme string when it follows "with", "about", or "for".
 * Returns null if no such pattern; used so we can require the post to mention that entity even when project has no brands.
 */
function getEntityFromThemeName(themeName: string): string | null {
  const trimmed = themeName.trim();
  const match = trimmed.match(/\b(with|about|for)\s+(.+)$/i);
  if (!match || !match[2]?.trim()) return null;
  const entity = match[2].trim();
  if (entity.length < 2) return null;
  return entity;
}

/** Prefer entity phrasing from the description, then the title. */
function getEntityFromThemeText(
  themeName: string,
  themeDescription?: string | null
): string | null {
  const d = (themeDescription ?? "").trim();
  const n = (themeName ?? "").trim();
  if (d) {
    const fromDesc = getEntityFromThemeName(d);
    if (fromDesc) return fromDesc;
  }
  if (n) return getEntityFromThemeName(n);
  return null;
}

/**
 * Deterministic gate after the LLM scores a theme: brand-in-post check when the theme references
 * project brands; optional **literal** entity phrase check when `ANALYSIS_THEME_ENTITY_LITERAL_GATE=1`
 * (off by default—theme matching is semantic/idea-based, not keyword-based).
 *
 * When `brandsReferencedInTheme` is provided (from pre-review), it is the authoritative list of
 * project brands tied to this theme; when omitted, brands are recomputed with strict theme-text matching.
 */
export function getThemeEntityGateDecision(
  themeName: string,
  postContent: string | null | undefined,
  projectBrandNames: string[] | undefined,
  themeDescription?: string | null,
  brandsReferencedInTheme?: string[]
): { reject: boolean; reason: null | "brand" | "entity" } {
  if (!combineThemePrimaryText(themeName, themeDescription).trim())
    return { reject: false, reason: null };
  const names = projectBrandNames ?? [];
  let brandsInTheme: string[];
  if (names.length === 0) {
    brandsInTheme = [];
  } else if (brandsReferencedInTheme !== undefined) {
    brandsInTheme = brandsReferencedInTheme;
  } else {
    brandsInTheme = getProjectBrandsReferencedInThemeStrict(themeName, themeDescription, names, {
      textSource: "combined",
    });
  }

  if (brandsInTheme.length > 0) {
    if (!postContent?.trim()) return { reject: true, reason: "brand" };
    const contentLower = postContent.toLowerCase();
    const postMentionsAnyThemeBrand = brandsInTheme.some((b) =>
      textMentionsBrandPhrase(contentLower, b)
    );
    if (!postMentionsAnyThemeBrand) return { reject: true, reason: "brand" };
    return { reject: false, reason: null };
  }

  if (themeEntityLiteralGateEnabled()) {
    const entityInTheme = getEntityFromThemeText(themeName, themeDescription);
    if (entityInTheme) {
      const contentLower = (postContent ?? "").toLowerCase();
      if (!postContent?.trim() || !contentLower.includes(entityInTheme.toLowerCase().trim())) {
        return { reject: true, reason: "entity" };
      }
    }
  }

  return { reject: false, reason: null };
}

/** @see getThemeEntityGateDecision */
export function shouldRejectThemeMatchForEntityMismatch(
  themeName: string,
  postContent: string | null | undefined,
  projectBrandNames?: string[],
  themeDescription?: string | null,
  brandsReferencedInTheme?: string[]
): boolean {
  return getThemeEntityGateDecision(
    themeName,
    postContent,
    projectBrandNames,
    themeDescription,
    brandsReferencedInTheme
  ).reject;
}

/**
 * Validate and normalize sentiment to match Prisma SentimentType enum
 */
function normalizeSentiment(
  sentiment: string | null | undefined
): "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" {
  // Handle null/undefined
  if (!sentiment) {
    console.warn(`[Analysis] Missing sentiment value, defaulting to NEUTRAL`);
    return "NEUTRAL";
  }

  const normalized = sentiment.toUpperCase();

  // Valid values
  if (
    normalized === "POSITIVE" ||
    normalized === "NEGATIVE" ||
    normalized === "NEUTRAL" ||
    normalized === "MIXED"
  ) {
    return normalized as "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
  }

  // Map common variations and tone labels (we ask the model for tone; map to the four allowed values)
  const positiveWords = [
    "HAPPY",
    "JOY",
    "EXCITED",
    "GLAD",
    "PLEASED",
    "GREAT",
    "HUMOROUS",
    "HUMOR",
    "SUPPORT",
    "SUPPORTIVE",
    "PRAISE",
    "GRATEFUL",
    "GRATITUDE",
    "ENTHUSIASTIC",
  ];
  const negativeWords = [
    "SAD",
    "ANGRY",
    "MAD",
    "UPSET",
    "DISAPPOINTED",
    "FRUSTRATED",
    "BAD",
    "TERRIBLE",
    "OUTRAGE",
    "OUTRAGED",
    "COMPLAINT",
    "COMPLAINING",
    "CRITICAL",
    "CRITICISM",
    "SARCASTIC",
    "SARCASM",
  ];
  const mixedWords = ["MIXED", "AMBIVALENT", "CONFUSED", "CONFUSION", "UNCERTAIN"];

  if (positiveWords.includes(normalized)) return "POSITIVE";
  if (negativeWords.includes(normalized)) return "NEGATIVE";
  if (mixedWords.includes(normalized)) return "MIXED";

  // Default to NEUTRAL for truly unrecognized sentiments (log once per new value to avoid spam)
  console.warn(`[Analysis] Unknown sentiment "${sentiment}", defaulting to NEUTRAL`);
  return "NEUTRAL";
}

const SENTIMENT_ONLY_BATCH_SIZE = 20;

/**
 * Run sentiment analysis on a specific set of posts (e.g. blog-derived Posts).
 * Fetches posts by id, batches them, calls OpenAI for sentiment only, updates each post.
 * Returns the number of posts that received sentiment.
 */
export async function runSentimentForPostIds(
  projectId: string,
  postIds: number[]
): Promise<{ analyzed: number; processedPostIds: number[] }> {
  if (postIds.length === 0 || !process.env.OPENAI_API_KEY) {
    return { analyzed: 0, processedPostIds: [] };
  }

  const posts = await prisma.post.findMany({
    where: {
      id: { in: postIds },
      project_id: projectId,
      content: { not: null },
      ...postWhereExcludeGithubFromLegacySentimentPipeline,
    },
    select: {
      id: true,
      content: true,
      platform: true,
      authorName: true,
      url: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });

  if (posts.length === 0) return { analyzed: 0, processedPostIds: [] };

  const projectEssence = await buildProjectEssence(projectId);
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  let totalAnalyzed = 0;
  const processedPostIds: number[] = [];

  for (let i = 0; i < posts.length; i += SENTIMENT_ONLY_BATCH_SIZE) {
    const batch = posts.slice(i, i + SENTIMENT_ONLY_BATCH_SIZE);
    const prompt = `Project Context (ESSENCE):
${projectEssence}

Analyze these posts for sentiment only. Return sentiment for every post.

Posts:
${batch.map((p, idx) => `${idx + 1}. [${p.platform}] ${p.authorName ?? "Unknown"}: ${(p.content ?? "").substring(0, 500)}`).join("\n")}

For each post, provide sentiment: use ONLY one of POSITIVE, NEGATIVE, NEUTRAL, or MIXED.

Return ONLY valid JSON:
[{"post_index": 1, "sentiment": "POSITIVE"}, ...]`;

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiChatModel("sentiment"),
        messages: [
          {
            role: "system",
            content:
              "You are a sentiment analyst. Return ONLY valid JSON. For each post output post_index (1-based) and sentiment: POSITIVE, NEGATIVE, NEUTRAL, or MIXED. You MUST return one object per post.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: Math.max(1000, batch.length * 80 + 200),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Analysis] runSentimentForPostIds OpenAI error: ${response.status} ${err}`);
      break;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) continue;

    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    let results: Array<{ post_index?: number; sentiment?: string }>;
    try {
      results = JSON.parse(content);
      if (!Array.isArray(results)) results = [];
    } catch {
      continue;
    }

    for (const r of results) {
      const idx = (r.post_index ?? 0) - 1;
      const post = batch[idx];
      if (!post || !r.sentiment) continue;
      const validSentiment = normalizeSentiment(r.sentiment);
      await prisma.post.update({
        where: { id: post.id },
        data: { sentiment: validSentiment, ai_processed_at: new Date() },
      });
      processedPostIds.push(post.id);
      totalAnalyzed++;
    }
  }

  return { analyzed: totalAnalyzed, processedPostIds };
}

/** Filter threads to those containing any of the given post IDs (root or reply). */
function filterThreadsContainingPostIds(
  threads: ConversationThread[],
  postIds: Set<number>
): ConversationThread[] {
  if (postIds.size === 0) return [];
  return threads.filter((thread) => {
    if (postIds.has(thread.rootPost.id)) return true;
    for (const reply of thread.replies) {
      if (postIds.has(reply.id)) return true;
    }
    return false;
  });
}

/**
 * Run theme analysis for specific post IDs (task-based analysis).
 * Loads threads containing those posts, then runs theme matching.
 */
/**
 * When thread graph + Conversation lookup yield no threads, still run theme matching on each
 * post as a single-message conversation (avoids 0 matches purely from resolution gaps).
 */
async function buildStandaloneThreadsForPostIds(
  projectId: string,
  postIds: number[]
): Promise<ConversationThread[]> {
  if (postIds.length === 0) return [];
  const rows = await prisma.post.findMany({
    where: {
      id: { in: postIds },
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
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
    },
  });
  const byId = new Map(rows.map((p) => [p.id, p]));
  const out: ConversationThread[] = [];
  for (const id of postIds) {
    const p = byId.get(id);
    if (!p) continue;
    const root = p as PostForThread;
    const participants = new Set<string>();
    const key = (root.authorId ?? root.authorName)?.toString()?.trim();
    if (key) participants.add(key);
    out.push({
      rootPost: root,
      replies: [],
      participants,
      totalEngagement:
        (root.metricsLikes || 0) + (root.metricsComments || 0) + (root.metricsShares || 0),
    });
  }
  return out;
}

/**
 * Run theme analysis for specific post IDs. For posts with conversation_id, uses Conversation table
 * (root from any node). For STANDALONE or legacy, uses identifyConversationThreads.
 */
export async function runThemesForPostIds(
  projectId: string,
  postIds: number[],
  options?: { orchestrationRunId?: string | null }
): Promise<{ themesMatched: number }> {
  if (postIds.length === 0) return { themesMatched: 0 };
  let usedStandaloneFallback = false;
  const threads: ConversationThread[] = [];
  const { getConversationThreadFromDb } = await import("@/lib/conversation-builder");
  const posts = await prisma.$queryRaw<
    Array<{ id: number; post_conversation_role: string | null; conversation_id: string | null }>
  >`SELECT id, post_conversation_role, conversation_id FROM Post WHERE project_id = ${projectId} AND id IN (${Prisma.join(postIds)})`;
  const postRoleMap = new Map(
    posts.map((p) => [p.id, { role: p.post_conversation_role, conversationId: p.conversation_id }])
  );
  const fromDbIds: number[] = [];
  const seenThreadRoots = new Set<number>();

  for (const postId of postIds) {
    const info = postRoleMap.get(postId);
    if (!info?.conversationId?.trim()) continue;

    let rootPostIdForThread: number | null = null;
    if (info.role === "ROOT") {
      rootPostIdForThread = postId;
    } else {
      const conv = await prisma.conversation.findFirst({
        where: {
          id: info.conversationId,
          project_id: projectId,
          deleted_at: null,
        },
        select: { root_post_id: true },
      });
      if (conv) rootPostIdForThread = conv.root_post_id;
    }

    if (rootPostIdForThread === null) continue;

    if (seenThreadRoots.has(rootPostIdForThread)) {
      fromDbIds.push(postId);
      continue;
    }

    const fromDb = await getConversationThreadFromDb(projectId, rootPostIdForThread);
    if (fromDb) {
      seenThreadRoots.add(fromDb.rootPost.id);
      threads.push(fromDb);
      fromDbIds.push(postId);
    }
  }

  const legacyIds = postIds.filter((id) => !fromDbIds.includes(id));
  if (legacyIds.length > 0) {
    const { buildConversationThreadsForPostIds } = await import("@/lib/conversation-builder");
    const legacy = await buildConversationThreadsForPostIds(projectId, legacyIds);
    const postIdSet = new Set(legacyIds);
    const filtered = filterThreadsContainingPostIds(legacy, postIdSet);
    threads.push(...filtered);
  }

  const uniqueByRoot = new Map<number, ConversationThread>();
  for (const t of threads) {
    uniqueByRoot.set(t.rootPost.id, t);
  }
  let mergedThreads = [...uniqueByRoot.values()];

  if (mergedThreads.length === 0) {
    usedStandaloneFallback = true;
    console.warn(
      `[Themes:trace] runThemesForPostIds project=${projectId} postIds=${postIds.length}: ` +
        `no Conversation/legacy threads; using single-post fallback`
    );
    mergedThreads = await buildStandaloneThreadsForPostIds(projectId, postIds);
  }

  if (mergedThreads.length === 0) {
    console.warn(
      `[Themes:trace] runThemesForPostIds project=${projectId}: 0 threads after fallback (no posts with content?)`
    );
    return { themesMatched: 0 };
  }
  const minId = Math.min(...postIds);
  console.log(
    `[Themes:trace] runThemesForPostIds project=${projectId} postIds=${postIds.length} ` +
      `mergedThreads=${mergedThreads.length} standaloneFallback=${usedStandaloneFallback} lastProcessed=${minId - 1}`
  );
  const result = await analyzeThemesFromThreads(
    projectId,
    mergedThreads,
    minId - 1,
    options?.orchestrationRunId
  );
  return { themesMatched: result.themesMatched };
}

/**
 * Run chatter analysis for specific post IDs (task-based analysis).
 * Prefers Conversation table when post is ROOT with conversation_id; else falls back to identifyConversationThreads.
 */
export async function runChatterForPostIds(
  projectId: string,
  postIds: number[],
  options?: { orchestrationRunId?: string | null }
): Promise<{ stored: number }> {
  if (postIds.length === 0) return { stored: 0 };
  const runId = options?.orchestrationRunId;
  const threads: ConversationThread[] = [];
  const { getConversationThreadFromDb } = await import("@/lib/conversation-builder");
  for (const rootPostId of postIds) {
    const fromDb = await getConversationThreadFromDb(projectId, rootPostId);
    if (fromDb && fromDb.replies.length > 0) {
      threads.push(fromDb);
    }
  }
  if (threads.length === 0) {
    const minId = Math.min(...postIds);
    const maxId = Math.max(...postIds);
    const legacy = await identifyConversationThreads(projectId, {
      minPostIdExclusive: minId - 1,
      maxPostIdInclusive: maxId,
    });
    const postIdSet = new Set(postIds);
    const filtered = filterThreadsContainingPostIds(legacy, postIdSet);
    if (filtered.length === 0) return { stored: 0 };
    return { stored: await storeChatterAnalysis(projectId, filtered, runId) };
  }
  return { stored: await storeChatterAnalysis(projectId, threads, runId) };
}

/**
 * Run network analysis for specific post IDs (task-based analysis).
 * Loads threads containing those posts, then analyzes network.
 */
export async function runNetworkForPostIds(
  projectId: string,
  postIds: number[],
  options?: { orchestrationRunId?: string | null }
): Promise<{ peopleCount: number }> {
  if (postIds.length === 0) return { peopleCount: 0 };
  const minId = Math.min(...postIds);
  const maxId = Math.max(...postIds);
  const threads = await identifyConversationThreads(projectId, {
    minPostIdExclusive: minId - 1,
    maxPostIdInclusive: maxId,
  });
  const postIdSet = new Set(postIds);
  const filtered = filterThreadsContainingPostIds(threads, postIdSet);
  if (filtered.length === 0) return { peopleCount: 0 };
  const result = await analyzeNetwork(projectId, filtered, {
    minPostIdExclusive: minId - 1,
    maxPostIdInclusive: maxId,
    ...(options?.orchestrationRunId != null && options.orchestrationRunId !== ""
      ? { orchestrationRunId: options.orchestrationRunId }
      : {}),
  });
  return { peopleCount: result.peopleCount };
}

/**
 * Run news synthesis for specific post IDs (task-based analysis).
 */
export async function runNewsForPostIds(
  projectId: string,
  postIds: number[],
  options?: { orchestrationRunId?: string | null }
): Promise<{ newsCount: number }> {
  if (postIds.length === 0) return { newsCount: 0 };
  const minId = Math.min(...postIds);
  const maxId = Math.max(...postIds);
  const result = await synthesizeNews(projectId, [], {
    minPostIdExclusive: minId - 1,
    maxPostIdInclusive: maxId,
    ...(options?.orchestrationRunId != null && options.orchestrationRunId !== ""
      ? { orchestrationRunId: options.orchestrationRunId }
      : {}),
  });
  return { newsCount: result.newsCount };
}

/**
 * Run brand analysis for specific post IDs (task-based analysis).
 */
export async function runBrandForPostIds(
  projectId: string,
  postIds: number[]
): Promise<{ processed: number }> {
  if (postIds.length === 0) return { processed: 0 };
  const result = await populateBrandAnalysis(projectId, {
    postIds,
  });
  return { processed: result.processed };
}

async function analyzeBatchSentimentAndThemes(
  posts: PostForAnalysis[],
  themes: ThemeForAnalysis[],
  skipThemeMatching: boolean = false,
  projectId: string,
  discordServerMap: Map<string, string>,
  projectEssence: string,
  themesOnly: boolean = false,
  isRetry: boolean = false, // Prevent recursive retries
  projectBrandNames?: string[], // When set, theme matches are filtered by project brands singled out in the theme name
  /** Pre-review: theme id → project brands that appear in that theme (strict); drives brand-in-post gate */
  themeBrandRequirements?: Map<string, string[]>,
  orchestrationRunId?: string | null
): Promise<{ analyzed: number; themesMatched: number; processedPostIds: number[] }> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  let prompt = `Project context (relevance — AND/OR rules below apply to theme matching):
${projectEssence}

Analyze these social media posts for sentiment${skipThemeMatching ? "" : " and theme matching"}.

⚠️ IMPORTANT: You MUST analyze ALL posts provided, regardless of relevance. Return sentiment analysis for every post.

⚠️ RELEVANCE FOR THEME MATCHING (follow the same rules as Network / News / Chatter sanitization):
- Read **RELEVANCE RULE (OR mode)** or **RELEVANCE RULE (AND mode)** in the Project Context above. Do not use looser or different rules than that block.
- **OR mode**: For themes that do not name a specific entity, you may match by topic when the post satisfies the OR rule (topic/brand/focus as described above). Do not require a brand mention when the OR rule does not require one.
- **AND mode**: The post must satisfy the AND rule (keyword topics related to a project brand, brand mention, on-topic) before any theme match. Do not waive brand or keyword–brand relationship requirements just because the theme title does not name an entity.
- When a theme DOES name a specific entity in its title: only match posts that are about that entity; never match posts primarily about a different entity to that theme.

⚠️ CRITICAL: Before matching any theme, verify the post fits THIS PROJECT'S scope for that theme:
- 🎯 PRIMARY: If "MONITORING FOCUS" is specified above, use it as the PRIMARY semantic guide
- Understand what this project is REALLY about: MONITORING FOCUS (if provided) takes priority, then essence from name/description/keywords/brands together
- For themes that do not name an entity: post must be on-topic for the project's domain (semantic fit). For themes that name an entity: post must be about that entity
- Content must align with the PROJECT'S INTENDED CONTEXT—semantic similarity required, not just keyword presence
- Generic social content, entertainment, unrelated topics, or keywords used as generic words are NOT relevant
- If a post is NOT semantically relevant to the project essence for a given theme, do NOT match that theme

Posts:
${posts.map((p, i) => `${i + 1}. [${p.platform}] ${p.authorName}: ${p.content?.substring(0, 300) || "(no content)"}`).join("\n")}`;

  // DEBUG: For small batches, log what we're sending to diagnose missing posts
  if (posts.length <= 5) {
    console.log(
      `[Analysis] DEBUG: Analyzing ${posts.length} post(s). ` +
        `Post IDs: [${posts.map((p) => p.id).join(", ")}], ` +
        `Prompt length: ${prompt.length} chars, ` +
        `max_tokens: ${Math.max(3000, posts.length * 200 + 1000)}`
    );
    // Check if any posts have no content
    const postsWithNoContent = posts.filter((p) => !p.content || p.content.trim().length === 0);
    if (postsWithNoContent.length > 0) {
      console.warn(
        `[Analysis] ⚠️  ${postsWithNoContent.length} post(s) have no content: [${postsWithNoContent.map((p) => p.id).join(", ")}]`
      );
    }
  }

  if (!skipThemeMatching && themes.length > 0) {
    const batchHasDiscord = posts.some((p) => (p.platform || "").toLowerCase() === "discord");
    const discordBatchHint = batchHasDiscord
      ? `⚠️ DISCORD POSTS IN BATCH: Short informal messages still require **topic alignment** with each theme—never match only on a vague negative phrase unrelated to the theme's subject.\n\n`
      : "";
    prompt += `

Themes to match:
${formatThemeListForLlmPrompt(themes)}

⚠️ THEME PRIMARY VS LABEL: For each theme, **Primary (what to match)** is the authoritative definition. **Short label** is display-only. Apply entity rules, sentiment, and topic fit to the Primary text first; use the label when no description exists.

${discordBatchHint}⚠️ IDEAS, NOT KEYWORDS: Each theme is an **idea**. Match by **semantic** fit (topic, domain, intent)—synonyms and paraphrase count; do **not** require the post to repeat words from the theme.

⚠️ SUBJECT MATTER (semantic fit, not emotion alone): If a theme implies a **subject or domain**, the post must be **about that idea by meaning**; do **not** match based only on generic negative sentiment or "bad experience" when the post is clearly about something else. Match tone (frustration vs praise) **only after** the topic fits the theme.

⚠️ CRITICAL THEME MATCHING RULES:
1. READ THE ENTIRE POST. Do not judge from the first sentence alone—evaluate the full post to determine its tone and whether it fits the theme.
2. MATCH THE POST'S TONE TO THE THEME'S TONE (after topic fit): Identify the post's tone. Only match a theme if the post's tone fits the theme's implied tone **and** the post is about the theme's subject. A theme that implies frustration/complaint requires that tone; a theme that implies praise requires praise/support; neutral themes accept reporting or neutral tone. A post that ends in thanks or recognition has a positive tone—do NOT match it to a complaint/frustration theme.
3. FIRST CHECK (per theme): For each theme, decide if the post can match:
   - Apply OR vs AND from the Project Context: in OR mode, entity-less themes can match on topic when the OR rule is satisfied; in AND mode, the post must meet the AND rule (including brand relationship) before matching any theme.
   - If the theme's **Primary** text or label names a specific entity: only match when the post is about that entity; never match when the post is primarily about a different entity.
   - If the post is off-topic for the project's domain or fails the relevance rule above, do not match any themes.
4. ENTITY-IN-THEME RULE: For themes that do not name a specific entity, still apply **OR vs AND** from the Project Context (same as rule 3). When the **Primary** text or label names an entity explicitly, restrict to posts about that entity; never match a post about a different entity to that theme. If a theme names a specific entity, ONLY match posts that are (a) about that entity and (b) fit the theme's sentiment.
5. THEME SENTIMENT/ANGLE MUST MATCH: If the theme's **Primary** text or label includes a sentiment or angle, the post must express that same sentiment or angle—not just mention the entity. Neutral reporting does NOT match frustration themes. A post that thanks or recognizes a brand despite some problems is NOT a match for a frustration theme—the dominant tone must be frustration, not gratitude.
6. Only match a theme if the post DIRECTLY discusses that specific theme topic IN THE CONTEXT OF THIS PROJECT
7. The post content must be ABOUT the theme within the project's domain, not just vaguely related
8. General social content, ethical statements, or vague discussions do NOT match specific themes
9. Only assign high relevance scores (≥60) if content is clearly and explicitly about the theme AND relevant to the project. Among matches that both qualify, prefer higher relevance scores when the post explicitly names project keywords or brands from the context; prefer lower scores in the 60–100 range when fit is paraphrase-only without those names
10. When uncertain, do NOT match (false negatives are better than false positives)`;
  }

  prompt += `

For each post, provide:
1. Sentiment: use ONLY one of these four values—POSITIVE, NEGATIVE, NEUTRAL, or MIXED. Do not put tone labels in sentiment; map tone to one of the four (supportive → POSITIVE, complaint → NEGATIVE, etc.).`;

  if (!skipThemeMatching && themes.length > 0) {
    prompt += `
2. Matching themes (by number) and relevance score (0-100)
   - Only include themes if relevance ≥60 and content directly discusses the theme topic`;
  }

  prompt += `

Return ONLY valid JSON:
[
  {
    "post_index": 1,
    "sentiment": "POSITIVE"${
      !skipThemeMatching && themes.length > 0
        ? `,
    "themes": [{"theme_index": 1, "relevance": 85}]`
        : ""
    }
  }
]`;

  // Retry logic for transient API errors (502, 503, 504, 429)
  const maxRetries = 3;
  let retryCount = 0;
  let response: Response | null = null;

  while (retryCount < maxRetries) {
    try {
      response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiChatModel("themes"),
          messages: [
            {
              role: "system",
              content:
                "You are a sentiment and theme analysis expert. CRITICAL RULES: (1) You MUST analyze ALL posts provided - return sentiment for every post, regardless of relevance. (2) For the sentiment field output ONLY: POSITIVE, NEGATIVE, NEUTRAL, or MIXED. Do not output tone labels in sentiment—use them only internally for theme matching, then map to one of the four. (3) READ THE ENTIRE POST before matching themes. Identify each post's tone for theme matching only. Only match a theme if the post's tone fits the theme's implied tone. (4) Follow RELEVANCE RULE (AND or OR mode) in the user prompt. In OR mode, entity-less themes may match on topic without a brand mention when the OR rule allows. In AND mode, require the full AND rule (keyword topics related to a brand + brand mention) before theme matching—do not waive that for entity-less themes. For themes that DO name a specific entity: only match posts that are ABOUT that entity. (5) Distinguish between entity names in the theme and generic words. (6) When the theme EXPLICITLY names an entity, ONLY match posts about that entity; when the theme does not name an entity, still apply AND vs OR as in the project relevance rule. (7) If the theme name includes a sentiment/angle, the post must match that sentiment; do NOT match positive or neutral reporting to frustration themes. (8) Theme matching requires DIRECT discussion of the theme topic WITHIN the project context - vague content does NOT match. (9) General social/ethical statements unrelated to the project do NOT match themes. (10) Only assign themes with relevance ≥60 when content is clearly about the theme and on-topic per the relevance rule. (11) When uncertain about themes, do NOT match (false negatives are better than false positives), but ALWAYS return sentiment. (12) Return only valid JSON with post_index for every post provided.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          // Increase max_tokens based on batch size to prevent truncation
          // Each post needs ~100-200 tokens for response (more if themes are matched)
          // For 20 posts: 20 * 200 = 4000 tokens + 1000 buffer = 5000 tokens
          // Add extra buffer for JSON structure, system message, and theme arrays
          max_tokens: Math.max(3000, posts.length * 200 + 1000),
        }),
      });

      if (!response.ok) {
        // Retry on transient errors (502, 503, 504, 429)
        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504 ||
          response.status === 429
        ) {
          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");
            console.warn(
              `[OpenAI] Throttled (429) operation=sentiment_theme_batch retry=${retryCount + 1}/${maxRetries} retryAfter=${retryAfter ?? "none"}`
            );
          }
          retryCount++;
          const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
          console.warn(
            `[Analysis] OpenAI API error ${response.status}, retry ${retryCount}/${maxRetries} in ${waitTime}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        throw new Error(`OpenAI API error: ${response.status}`);
      }

      // Success - break out of retry loop
      break;
    } catch (error) {
      retryCount++;

      if (retryCount < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
        console.warn(`[Analysis] API error, retry ${retryCount}/${maxRetries} in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      throw error;
    }
  }

  if (!response) {
    throw new Error("Failed to get response from OpenAI API");
  }

  const data = await response.json();

  // Handle case where API returns error or empty response after retries
  if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    console.error(`[Analysis] Invalid OpenAI API response after retries:`, data);
    throw new Error(`OpenAI API returned invalid response: ${JSON.stringify(data)}`);
  }

  let content = data.choices[0]?.message?.content;
  if (!content) {
    console.error(`[Analysis] No content in OpenAI API response:`, data);
    throw new Error(`OpenAI API returned response without content: ${JSON.stringify(data)}`);
  }

  // Check if response was truncated (OpenAI sets finish_reason to "length" if truncated)
  const finishReason = data.choices[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn(
      `[Analysis] ⚠️  OpenAI response was TRUNCATED (finish_reason: length). ` +
        `This likely means max_tokens (${Math.max(2000, posts.length * 150 + 500)}) was too low for ${posts.length} posts. ` +
        `Response may be missing posts at the end.`
    );
  }

  // Log usage stats for debugging
  const usage = data.usage;
  if (usage) {
    console.log(
      `[Analysis] OpenAI API usage: prompt_tokens=${usage.prompt_tokens}, ` +
        `completion_tokens=${usage.completion_tokens}, total_tokens=${usage.total_tokens} ` +
        `(max_tokens=${Math.max(2000, posts.length * 150 + 500)}, batch_size=${posts.length})`
    );
  }

  // Strip markdown code fences if present
  content = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  let results: any[];
  try {
    results = JSON.parse(content);
    if (!Array.isArray(results)) {
      throw new Error(`OpenAI response is not an array: ${typeof results}`);
    }
  } catch (parseError) {
    console.error(`[Analysis] Failed to parse OpenAI response as JSON:`, parseError);
    console.error(`[Analysis] Response content (first 1000 chars):`, content.substring(0, 1000));
    console.error(
      `[Analysis] Response content (last 500 chars):`,
      content.substring(Math.max(0, content.length - 500))
    );
    // Check if content looks truncated (ends abruptly)
    if (!content.trim().endsWith("]") && !content.trim().endsWith("}")) {
      console.error(`[Analysis] ⚠️  Response appears to be TRUNCATED (doesn't end with ] or })`);
    }
    throw new Error(
      `Failed to parse OpenAI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    );
  }

  // Validate that we got results for all posts
  // Check if results have post_index field - if not, log the structure
  if (results.length > 0 && !results[0].hasOwnProperty("post_index")) {
    console.error(
      `[Analysis] ⚠️  Results don't have 'post_index' field! ` +
        `First result structure: ${JSON.stringify(results[0], null, 2)}. ` +
        `All result keys: ${results.map((r) => Object.keys(r).join(", ")).join(" | ")}`
    );
  }

  const resultPostIndices = new Set(
    results
      .map((r) => {
        // Try different possible field names
        return r.post_index ?? r.postIndex ?? r.index ?? r.id;
      })
      .filter((idx) => idx !== undefined && idx !== null)
  );
  const expectedIndices = new Set(posts.map((_, i) => i + 1));
  const missingIndices = Array.from(expectedIndices).filter((idx) => !resultPostIndices.has(idx));

  // DEBUG: For small batches, log what we actually received
  if (posts.length <= 5) {
    console.log(
      `[Analysis] DEBUG: Received ${results.length} result(s) for ${posts.length} post(s). ` +
        `Result post_indices: [${Array.from(resultPostIndices)
          .sort((a, b) => a - b)
          .join(", ")}], ` +
        `Expected: [${Array.from(expectedIndices)
          .sort((a, b) => a - b)
          .join(", ")}]`
    );
    if (results.length === 0) {
      console.error(
        `[Analysis] ⚠️  OpenAI returned EMPTY array! Full response:`,
        JSON.stringify(data, null, 2)
      );
    } else if (results.length < posts.length) {
      console.warn(
        `[Analysis] ⚠️  Partial response received. Results:`,
        JSON.stringify(results, null, 2)
      );
    }
  }

  // DEBUG: Log what we actually received vs what we expected
  if (results.length === 0) {
    console.error(
      `[Analysis] ⚠️  OpenAI returned EMPTY array for ${posts.length} post(s). ` +
        `This suggests the model didn't analyze any posts. ` +
        `Response length: ${content.length} chars, finish_reason: ${finishReason || "unknown"}`
    );
    // Log the actual response content for debugging
    console.error(`[Analysis] Full response content:`, content);
  } else if (missingIndices.length > 0) {
    console.warn(
      `[Analysis] OpenAI response missing ${missingIndices.length}/${posts.length} posts. ` +
        `Received ${results.length} result(s), expected ${posts.length}. ` +
        `Received post_indices: [${Array.from(resultPostIndices)
          .sort((a, b) => a - b)
          .join(", ")}], ` +
        `Expected: [${Array.from(expectedIndices)
          .sort((a, b) => a - b)
          .join(", ")}]`
    );
    // Log the actual results to see what we got
    console.warn(`[Analysis] Actual results received:`, JSON.stringify(results, null, 2));
  }

  // Track missing posts for retry
  // CRITICAL: Skip retry logic if this is already a retry attempt to prevent infinite loops
  const missingPosts: PostForAnalysis[] = [];
  if (missingIndices.length > 0 && !isRetry) {
    console.warn(
      `[Analysis] Missing post indices: ${missingIndices.slice(0, 10).join(", ")}${missingIndices.length > 10 ? "..." : ""}`
    );
    // Collect missing posts for retry
    for (const idx of missingIndices) {
      const post = posts[idx - 1];
      if (post) {
        missingPosts.push(post);
      }
    }
  } else if (missingIndices.length > 0 && isRetry) {
    // If this is a retry and posts are still missing, log and skip further retries
    console.warn(
      `[Analysis] ⚠️  Retry attempt still missing ${missingIndices.length}/${posts.length} posts. ` +
        `Skipping further retries to prevent infinite loop. Missing post indices: ${missingIndices.slice(0, 10).join(", ")}${missingIndices.length > 10 ? "..." : ""}`
    );
  }

  let themesMatched = 0;
  const postsWithSentiment = new Set<number>(); // Track which posts actually got sentiment
  let postsWithNoThemeMatch = 0;

  // Update posts with sentiment (unless themesOnly) and create theme matches
  for (const result of results) {
    const post = posts[result.post_index - 1];
    if (!post) {
      console.warn(
        `[Analysis] OpenAI response includes post_index ${result.post_index} but batch only has ${posts.length} posts`
      );
      continue;
    }

    // Validate that result has sentiment (unless themesOnly)
    if (!themesOnly && !result.sentiment) {
      console.warn(
        `[Analysis] OpenAI response missing sentiment for post ${post.id} (post_index ${result.post_index})`
      );
      continue; // Skip this post - it didn't get sentiment
    }

    if (!themesOnly) {
      // Update sentiment (with validation)
      const validSentiment = normalizeSentiment(result.sentiment);
      await prisma.post.update({
        where: { id: post.id },
        data: {
          sentiment: validSentiment,
          ai_processed_at: new Date(),
        },
      });
      postsWithSentiment.add(post.id); // Track that this post got sentiment
    }

    // Create theme matches (only if themes are defined)
    if (!skipThemeMatching) {
      const qualifyingThemes =
        result.themes?.filter((t: { theme_index: number; relevance: number }) => {
          const theme = themes[t.theme_index - 1];
          return theme && t.relevance >= 60;
        }) ?? [];
      if (qualifyingThemes.length === 0) {
        postsWithNoThemeMatch++;
      }
    }
    if (!skipThemeMatching && result.themes && result.themes.length > 0) {
      for (const themeMatch of result.themes) {
        const theme = themes[themeMatch.theme_index - 1];
        if (!theme || themeMatch.relevance < 60) continue; // Only store highly relevant matches (lowered from 70 to 60)

        try {
          // Attach theme to root for replies; dedupe below for all posts (project + theme + post).
          let targetPostId = post.id;
          let targetPost = post;

          if (post.threadRefId) {
            // This is a reply - find the root post
            const rootPostId = await findRootPostId(
              post.id,
              post.threadRefId,
              post.platform,
              projectId
            );

            // Get root post data for creating the theme match
            const rootPostData = await prisma.post.findUnique({
              where: { id: rootPostId },
              select: {
                id: true,
                platform: true,
                content: true,
                url: true,
                channelId: true,
                authorName: true,
                authorId: true,
                metricsLikes: true,
                metricsComments: true,
                metricsShares: true,
                createdAt: true,
                language: true,
              },
            });

            if (rootPostData) {
              targetPostId = rootPostId;
              targetPost = rootPostData as typeof post;
            }
            // If root post not found, fall back to using the reply post
          }

          // One row per (project, theme, post): root posts were missing this check before (replies only checked earlier).
          const existingThemeForPost = await prisma.themesAnalysis.findFirst({
            where: {
              project_id: projectId,
              theme_id: theme.id,
              post_id: targetPostId,
              deleted_at: null,
            },
          });
          if (existingThemeForPost) {
            // Task-based runs stamp orchestration_run_id; response generation filters on it.
            // Without this update, a prior row (e.g. legacy run with null) blocks inserts and the
            // current run never "owns" the row — run-scoped response gen sees zero rows.
            if (orchestrationRunId != null && orchestrationRunId !== "") {
              await prisma.themesAnalysis.update({
                where: { id: existingThemeForPost.id },
                data: {
                  orchestrationRun: { connect: { id: orchestrationRunId } },
                  analyzed_at: new Date(),
                },
              });
            }
            continue;
          }

          // Get Discord server name if applicable
          const isDiscord = targetPost.platform.toLowerCase() === "discord";
          const discordServer =
            isDiscord && targetPost.channelId
              ? discordServerMap.get(targetPost.channelId)
              : undefined;

          // Use post language if available, otherwise detect from content (with low minLength for short posts)
          const safeContentForDetection =
            sanitizeTextForDbStorage(targetPost.content ?? null) ?? "";
          let language =
            targetPost.language ||
            (safeContentForDetection ? detectLanguage(safeContentForDetection, 3) : null);
          // Don't store non-English for short content: franc often misclassifies (e.g. nl, sv, es, fr)
          // so those records would be excluded when filtering "English" even when content is English.
          const contentLen = safeContentForDetection?.length ?? 0;
          if (language && language !== "en" && contentLen < 80) {
            language = null;
          }

          const sanitizedContent = sanitizeTextForDbStorage(targetPost.content ?? null, 500);

          const safePostUrlForThemeRow = sanitizeTextForDbStorage(targetPost.url ?? null, 4000);
          const readUrlKeyDerived = safePostUrlForThemeRow
            ? normalizeThemeReadUrl(safePostUrlForThemeRow).replace(/\\/g, "")
            : undefined;

          // Server-side entity check: when theme singles out project brand(s), exclude posts about other brands
          if (
            shouldRejectThemeMatchForEntityMismatch(
              theme.theme_name,
              targetPost.content,
              projectBrandNames,
              theme.description,
              themeBrandRequirements?.get(theme.id)
            )
          ) {
            continue;
          }

          // Derive sentiment for the matched theme record from result (normalized)
          const matchSentiment = normalizeSentiment(result.sentiment);
          // Reject when theme implies frustration/complaint but post is positive or neutral (e.g. gratitude, recognition, or neutral reporting)
          if (themeImpliesNegativeSentiment(theme.theme_name, theme.description)) {
            if (matchSentiment === "POSITIVE" || matchSentiment === "NEUTRAL") continue;
          }

          await prisma.themesAnalysis.create({
            data: {
              id: generateUlid(),
              project_id: projectId,
              ...(orchestrationRunId != null && orchestrationRunId !== ""
                ? { orchestration_run_id: orchestrationRunId }
                : {}),
              theme_id: theme.id,
              theme_name: sanitizeTextForDbStorage(theme.theme_name ?? null, 400) ?? "—",
              post_id: targetPostId,
              platform: sanitizeTextForDbStorage(String(targetPost.platform), 64) || "unknown",
              post_content: sanitizedContent,
              post_url: safePostUrlForThemeRow ?? undefined,
              read_url_key: readUrlKeyDerived,
              discord_channel: isDiscord
                ? sanitizeTextForDbStorage(targetPost.channelId ?? null, 256) ?? undefined
                : undefined,
              discord_server: sanitizeTextForDbStorage(discordServer ?? null, 200) ?? undefined,
              author_name: sanitizeTextForDbStorage(targetPost.authorName ?? null, 200) ?? undefined,
              author_id:
                sanitizeTextForDbStorage(
                  targetPost.authorId != null ? String(targetPost.authorId) : null,
                  200
                ) ?? undefined,
              participant_names: undefined, // Not applicable for individual posts
              likes: targetPost.metricsLikes || 0,
              comments: targetPost.metricsComments || 0,
              shares: targetPost.metricsShares || 0,
              total_reactions:
                (targetPost.metricsLikes || 0) +
                (targetPost.metricsComments || 0) +
                (targetPost.metricsShares || 0),
              posted_at: targetPost.createdAt,
              analyzed_at: new Date(),
              relevance_score: themeMatch.relevance,
              sentiment: sanitizeTextForDbStorage(matchSentiment, 64) ?? "NEUTRAL",
              language: language ? sanitizeTextForDbStorage(language, 32) ?? undefined : undefined,
            },
          });

          themesMatched++;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            continue;
          }
          console.error(`[Analysis] Error creating theme match for post ${post.id}:`, error);
          // Continue with other theme matches
        }
      }
    }
  }

  // CRITICAL: Return the actual count of posts that got sentiment, not the batch size
  // If OpenAI response is missing some posts, they won't get sentiment and shouldn't be counted
  const actualAnalyzed = postsWithSentiment.size;
  const processedPostIds = Array.from(postsWithSentiment);

  if (!skipThemeMatching && postsWithNoThemeMatch > 0) {
    console.log(
      `[Analysis] [Themes] ❌ ${postsWithNoThemeMatch} posts had no theme match (relevance < 60 or no themes returned) - ` +
        `these posts will not appear in Themes`
    );
  }

  // Retry missing posts individually or in smaller batches
  // CRITICAL: Only retry once per post to prevent infinite loops
  if (missingPosts.length > 0 && !themesOnly) {
    console.log(`[Analysis] Retrying ${missingPosts.length} missing posts individually...`);

    // Retry missing posts one at a time to avoid truncation
    // Limit to single retry per post to prevent infinite loops
    const MAX_INDIVIDUAL_RETRIES = 1;
    for (const missingPost of missingPosts) {
      let retryAttempt = 0;
      let retrySuccess = false;

      while (retryAttempt < MAX_INDIVIDUAL_RETRIES && !retrySuccess) {
        retryAttempt++;
        try {
          if (skipThemeMatching) {
            const retryResult = await runSentimentForPostIds(projectId, [missingPost.id]);
            if (retryResult.analyzed > 0) {
              processedPostIds.push(...retryResult.processedPostIds);
              console.log(
                `[Analysis] ✅ Successfully retried post ${missingPost.id} (attempt ${retryAttempt})`
              );
              retrySuccess = true;
            }
          } else {
            const retryResult = await analyzeBatchSentimentAndThemes(
              [missingPost],
              themes,
              skipThemeMatching,
              projectId,
              discordServerMap,
              projectEssence,
              themesOnly,
              true, // isRetry: true to prevent recursive retries
              projectBrandNames,
              themeBrandRequirements,
              orchestrationRunId
            );

            if (retryResult.analyzed > 0) {
              processedPostIds.push(...retryResult.processedPostIds);
              themesMatched += retryResult.themesMatched;
              console.log(
                `[Analysis] ✅ Successfully retried post ${missingPost.id} (attempt ${retryAttempt})`
              );
              retrySuccess = true;
            }
          }

          if (!retrySuccess) {
            console.warn(
              `[Analysis] ⚠️  Retry attempt ${retryAttempt} failed for post ${missingPost.id} - will be retried in next analysis run`
            );
          }

          // Small delay between retries to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error(
            `[Analysis] Error retrying post ${missingPost.id} (attempt ${retryAttempt}):`,
            error instanceof Error ? error.message : String(error)
          );
          // Continue to next retry attempt or give up
        }
      }

      if (!retrySuccess) {
        console.warn(
          `[Analysis] ⚠️  Post ${missingPost.id} failed after ${MAX_INDIVIDUAL_RETRIES} retry attempt(s) - will be retried in next analysis run`
        );
      }
    }
  }

  if (actualAnalyzed < posts.length) {
    const missing = posts.length - actualAnalyzed;
    const missingPostIds = posts.filter((p) => !postsWithSentiment.has(p.id)).map((p) => p.id);
    console.warn(
      `[Analysis] OpenAI response only included ${actualAnalyzed}/${posts.length} posts. ` +
        `${missing} posts in batch did not receive sentiment analysis. ` +
        `Missing post IDs: ${missingPostIds.slice(0, 10).join(", ")}${missingPostIds.length > 10 ? "..." : ""}`
    );
  }

  return { analyzed: processedPostIds.length, themesMatched, processedPostIds };
}

/**
 * ITERATION 3: Network analysis (influential people)
 */
async function analyzeNetwork(
  projectId: string,
  threads: ConversationThread[],
  bounds?: AnalysisBounds
): Promise<{ peopleCount: number; maxProcessedPostId: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping network analysis - no OpenAI API key");
    return { peopleCount: 0, maxProcessedPostId: bounds?.minPostIdExclusive ?? 0 };
  }

  const minPostIdExclusive = bounds?.minPostIdExclusive ?? 0;
  const maxPostIdInclusive =
    bounds?.maxPostIdInclusive !== undefined ? bounds.maxPostIdInclusive : Number.POSITIVE_INFINITY;

  // Get all posts for the project
  const posts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      content: { not: null },
      authorId: { not: null },
      authorName: { not: null },
      id: {
        gt: minPostIdExclusive,
        ...(bounds?.maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
      },
    },
    select: {
      id: true,
      platform: true,
      authorId: true,
      authorName: true,
      content: true,
      url: true,
      channelId: true,
      createdAt: true,
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
      language: true,
    },
  });

  // Get Discord profiles for server name lookup
  const discordProfiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      deleted_at: null,
    },
    select: {
      name: true,
      url: true,
    },
  });

  const discordServerMap = new Map<string, string>();
  for (const profile of discordProfiles) {
    const match = profile.url.match(/\/channels\/(\d+)\/(\d+)/);
    if (match) {
      discordServerMap.set(match[2], profile.name);
    }
  }

  // Group posts by author (platform + authorId)
  const authorMap = new Map<
    string,
    {
      platform: string;
      authorId: string;
      authorName: string;
      posts: typeof posts;
      totalLikes: number;
      totalComments: number;
      totalShares: number;
      totalReactions: number;
      discordServerName?: string;
      profileUrl?: string;
    }
  >();

  for (const post of posts) {
    const key = `${post.platform}:${post.authorId}`;

    if (!authorMap.has(key)) {
      const isDiscord = post.platform.toLowerCase() === "discord";
      let serverName: string | undefined;
      if (isDiscord && post.channelId) {
        serverName = discordServerMap.get(post.channelId);
      }

      const profileFromUrl = extractProfileUrl(post.platform, post.url || undefined);
      const profileFromAuthor =
        post.platform.toLowerCase() === "youtube" &&
        post.authorName?.trim() &&
        /^@?[\w.-]+$/.test(post.authorName.trim())
          ? `https://www.youtube.com/@${post.authorName.trim().replace(/^@/, "")}`
          : undefined;
      const profileFromYouTubeChannelId =
        post.platform.toLowerCase() === "youtube" &&
        post.authorId?.trim() &&
        /^UC[\w-]{22}$/.test(post.authorId.trim())
          ? `https://www.youtube.com/channel/${post.authorId.trim()}`
          : undefined;
      authorMap.set(key, {
        platform: post.platform,
        authorId: post.authorId!,
        authorName: post.authorName!,
        posts: [],
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalReactions: 0,
        discordServerName: serverName,
        profileUrl: profileFromUrl ?? profileFromAuthor ?? profileFromYouTubeChannelId,
      });
    }

    const author = authorMap.get(key)!;
    author.posts.push(post);
    author.totalLikes += post.metricsLikes || 0;
    author.totalComments += post.metricsComments || 0;
    author.totalShares += post.metricsShares || 0;
    // Weighted scoring: Comments 3x, Shares 2x, Likes 1x
    author.totalReactions =
      author.totalLikes * 1 + author.totalComments * 3 + author.totalShares * 2;
    // Capture profile/page URL from any post if we don't have one yet (need a real link to count as influencer)
    if (!author.profileUrl) {
      const fromUrl = post.url ? extractProfileUrl(post.platform, post.url) : undefined;
      const fromAuthor =
        post.platform.toLowerCase() === "youtube" &&
        post.authorName?.trim() &&
        /^@?[\w.-]+$/.test(post.authorName.trim())
          ? `https://www.youtube.com/@${post.authorName.trim().replace(/^@/, "")}`
          : undefined;
      const fromYouTubeChannelId =
        post.platform.toLowerCase() === "youtube" &&
        post.authorId?.trim() &&
        /^UC[\w-]{22}$/.test(post.authorId.trim())
          ? `https://www.youtube.com/channel/${post.authorId.trim()}`
          : undefined;
      author.profileUrl = fromUrl ?? fromAuthor ?? fromYouTubeChannelId;
    }
  }

  // Filter out low-engagement authors and non-individuals (e.g. subreddits, bots).
  // Discord: do not require synthetic engagement here — reactions are often 0 on single messages;
  // authorMap only includes users with ≥1 post. Top-10-per-platform + relevance + ideas steps filter.
  const qualifyingPeople = Array.from(authorMap.values())
    .filter((person) => {
      const platform = person.platform.toLowerCase();
      if (platform === "discord") {
        return true;
      }
      return person.totalReactions >= 10;
    })
    .filter((person) => isIndividualPerson(person));

  // Ensure platform diversity: Take top 10 from each platform
  const peopleByPlatform = new Map<string, typeof qualifyingPeople>();
  for (const person of qualifyingPeople) {
    const platform = person.platform.toLowerCase();
    if (!peopleByPlatform.has(platform)) {
      peopleByPlatform.set(platform, []);
    }
    peopleByPlatform.get(platform)!.push(person);
  }

  // Take top 10 from each platform, sorted by engagement
  const influentialPeople: typeof qualifyingPeople = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_platform, people] of peopleByPlatform.entries()) {
    const topFromPlatform = people.sort((a, b) => b.totalReactions - a.totalReactions).slice(0, 10); // Top 10 per platform
    influentialPeople.push(...topFromPlatform);
  }

  // Sort combined results by engagement
  influentialPeople.sort((a, b) => b.totalReactions - a.totalReactions);

  // Task-based analysis enqueues NETWORK once per post; each call used to run relevance prep even when
  // nobody qualifies (e.g. Discord messages below engagement threshold). Skip expensive work early.
  if (influentialPeople.length === 0) {
    let maxProcessedPostIdEarly = minPostIdExclusive;
    if (threads.length > 0) {
      const maxIdConsidered = Math.max(
        ...threads.map((t) => Math.max(t.rootPost.id, ...(t.replies ?? []).map((r) => r.id)))
      );
      if (maxIdConsidered > maxProcessedPostIdEarly) {
        maxProcessedPostIdEarly = maxIdConsidered;
      }
    }
    console.log(
      `[Analysis] ✅ Network analysis: 0 influencers in scope (skip relevance/OpenAI); cursor advanced to post ${maxProcessedPostIdEarly}`
    );
    return { peopleCount: 0, maxProcessedPostId: maxProcessedPostIdEarly };
  }

  // Pre-filter by semantic relevance: score influencers based on contextual relevance
  const projectEssence = await getProjectContextForRelevance(projectId);
  const RELEVANCE_THRESHOLD = 20; // Same threshold as chatter
  /** Discord chat often scores lower than long-form posts; keep a floor so scoped authors are not all dropped. */
  const RELEVANCE_THRESHOLD_DISCORD = 12;

  const NETWORK_WAVE_CONCURRENCY = Math.max(
    1,
    parseInt(process.env.ANALYSIS_NETWORK_WAVE_CONCURRENCY ?? "5", 10) || 1
  );
  const networkWaveDelayMs = Math.max(
    0,
    parseInt(process.env.ANALYSIS_NETWORK_WAVE_DELAY_MS ?? "800", 10) || 0
  );

  console.log(
    `[Analysis] Scoring ${influentialPeople.length} influencers for relevance (waves of ${NETWORK_WAVE_CONCURRENCY}, delay ${networkWaveDelayMs}ms between waves)...`
  );

  const scoredInfluencers: Array<{
    person: (typeof influentialPeople)[0];
    score: number;
    reason?: string;
  }> = [];

  for (
    let waveStart = 0;
    waveStart < influentialPeople.length;
    waveStart += NETWORK_WAVE_CONCURRENCY
  ) {
    if (waveStart > 0 && networkWaveDelayMs > 0) {
      await new Promise((r) => setTimeout(r, networkWaveDelayMs));
    }
    const wave = influentialPeople.slice(waveStart, waveStart + NETWORK_WAVE_CONCURRENCY);
    const settled = await Promise.allSettled(
      wave.map((person) =>
        scoreInfluencerRelevance(projectEssence, {
          authorName: person.authorName,
          platform: person.platform,
          posts: person.posts,
        }).then(({ score, reason }) => ({ person, score, reason }))
      )
    );
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      const person = wave[i];
      if (res.status === "fulfilled") {
        scoredInfluencers.push(res.value);
      } else {
        console.error(
          `[Analysis] [Influencers] relevance scoring failed for ${person.authorName} (${person.platform}):`,
          res.reason
        );
        scoredInfluencers.push({ person, score: 0, reason: undefined });
      }
    }
  }

  const relevanceFloor = (platform: string) =>
    platform.toLowerCase() === "discord" ? RELEVANCE_THRESHOLD_DISCORD : RELEVANCE_THRESHOLD;

  // Sort by relevance score then engagement, keep only above threshold
  const rankedPeople = scoredInfluencers
    .filter((item) => item.score >= relevanceFloor(item.person.platform))
    .sort((a, b) => b.score - a.score || b.person.totalReactions - a.person.totalReactions)
    .map((item) => item.person);

  const filteredCount = influentialPeople.length - rankedPeople.length;
  if (filteredCount > 0) {
    const filtered = scoredInfluencers.filter((s) => s.score < relevanceFloor(s.person.platform));
    for (const item of filtered) {
      const floor = relevanceFloor(item.person.platform);
      console.log(
        `[Analysis] [Influencers] ❌ ${item.person.authorName} (${item.person.platform}) rejected: ` +
          `score ${item.score} < threshold ${floor}. Reason: ${item.reason || "none"}`
      );
    }
    console.log(
      `[Analysis] Filtered out ${filteredCount} influencers below relevance threshold (default ${RELEVANCE_THRESHOLD}, Discord ${RELEVANCE_THRESHOLD_DISCORD})`
    );
  }

  // Keep only people whose posts fall within the desired range
  const peopleInRange = rankedPeople.filter((person) => {
    const maxPostId = person.posts.reduce((max, post) => Math.max(max, post.id ?? 0), 0);
    return maxPostId > minPostIdExclusive && maxPostId <= maxPostIdInclusive;
  });

  console.log(
    `[Analysis] Analyzing ${peopleInRange.length} relevant influential people (waves of ${NETWORK_WAVE_CONCURRENCY}, delay ${networkWaveDelayMs}ms between waves)...`
  );

  let stored = 0;
  let maxProcessedPostId = minPostIdExclusive;

  const processNetworkPerson = async (
    person: (typeof influentialPeople)[0]
  ): Promise<{ stored: number; maxId: number }> => {
    const needsProfileUrl = !isDiscordPlatform(person.platform);
    if (needsProfileUrl && (!person.profileUrl?.trim() || !person.profileUrl.startsWith("http"))) {
      console.log(
        `[Analysis] [Influencers] ❌ Skipping ${person.authorName} (${person.platform}): no profile/page URL from posts (required for influencer storage)`
      );
      return { stored: 0, maxId: minPostIdExclusive };
    }

    try {
      const ideas = await summarizePersonIdeas(person, threads);

      const postDates = person.posts.map((p) => p.createdAt).filter(Boolean);
      const earliestPostAt =
        postDates.length > 0 ? new Date(Math.min(...postDates.map((d) => d.getTime()))) : null;
      const latestPostAt =
        postDates.length > 0 ? new Date(Math.max(...postDates.map((d) => d.getTime()))) : null;

      const languageCounts = new Map<string, number>();
      person.posts.forEach((p) => {
        if (p.language) {
          languageCounts.set(p.language, (languageCounts.get(p.language) || 0) + 1);
        }
      });
      const primaryLanguage =
        languageCounts.size > 0
          ? Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
          : null;

      await prisma.networkAnalysis.upsert({
        where: {
          project_id_platform_author_id: {
            project_id: projectId,
            platform: person.platform,
            author_id: person.authorId,
          },
        },
        update: {
          author_name: person.authorName,
          discord_server_name: person.discordServerName,
          profile_url: person.profileUrl,
          ideas_json: JSON.stringify(ideas),
          post_count: person.posts.length,
          total_likes: person.totalLikes,
          total_comments: person.totalComments,
          total_shares: person.totalShares,
          total_reactions: person.totalReactions,
          analyzed_at: new Date(),
          post_ids: JSON.stringify(person.posts.map((p) => p.id)),
          earliest_post_at: earliestPostAt,
          latest_post_at: latestPostAt,
          language: primaryLanguage,
          deleted_at: null,
          ...(bounds?.orchestrationRunId != null && bounds.orchestrationRunId !== ""
            ? { orchestration_run_id: bounds.orchestrationRunId }
            : {}),
        },
        create: {
          id: generateUlid(),
          project_id: projectId,
          platform: person.platform,
          author_id: person.authorId,
          author_name: person.authorName,
          discord_server_name: person.discordServerName,
          profile_url: person.profileUrl,
          ideas_json: JSON.stringify(ideas),
          post_count: person.posts.length,
          total_likes: person.totalLikes,
          total_comments: person.totalComments,
          total_shares: person.totalShares,
          total_reactions: person.totalReactions,
          analyzed_at: new Date(),
          post_ids: JSON.stringify(person.posts.map((p) => p.id)),
          earliest_post_at: earliestPostAt,
          latest_post_at: latestPostAt,
          language: primaryLanguage,
          ...(bounds?.orchestrationRunId != null && bounds.orchestrationRunId !== ""
            ? { orchestration_run_id: bounds.orchestrationRunId }
            : {}),
        },
      });

      const personMaxPostId = person.posts.reduce(
        (max, post) => Math.max(max, post.id ?? 0),
        minPostIdExclusive
      );
      console.log(
        `[Analysis] ✅ Stored network influencer: ${person.authorName} (${person.platform}), total_reactions=${person.totalReactions}`
      );
      return { stored: 1, maxId: personMaxPostId };
    } catch (error) {
      console.error(`[Analysis] ❌ Error analyzing ${person.authorName}:`, error);
      return { stored: 0, maxId: minPostIdExclusive };
    }
  };

  for (let waveStart = 0; waveStart < peopleInRange.length; waveStart += NETWORK_WAVE_CONCURRENCY) {
    if (waveStart > 0 && networkWaveDelayMs > 0) {
      await new Promise((r) => setTimeout(r, networkWaveDelayMs));
    }
    const wave = peopleInRange.slice(waveStart, waveStart + NETWORK_WAVE_CONCURRENCY);
    const settled = await Promise.allSettled(wave.map((p) => processNetworkPerson(p)));
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === "fulfilled") {
        stored += res.value.stored;
        maxProcessedPostId = Math.max(maxProcessedPostId, res.value.maxId);
      } else {
        console.error(
          `[Analysis] ❌ processNetworkPerson rejected ${wave[i].authorName}:`,
          res.reason
        );
      }
    }
  }

  // Verify storage by counting actual records in database
  const actualCount = await prisma.networkAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
  });

  console.log(
    `[Analysis] ✅ Network analysis complete: stored=${stored}/${peopleInRange.length}, actual DB count=${actualCount}`
  );

  if (stored > 0 && actualCount === 0) {
    console.warn(
      `[Analysis] ⚠️  WARNING: Stored ${stored} network records but DB count is 0. Records may have been deleted or not saved.`
    );
  } else if (stored !== actualCount) {
    console.warn(
      `[Analysis] ⚠️  WARNING: Stored count (${stored}) does not match DB count (${actualCount}). Records may have been upserted or deleted.`
    );
  }

  // Advance cursor to max post we considered so we don't re-process when 0 stored (e.g. all rejected)
  if (threads.length > 0) {
    const maxIdConsidered = Math.max(
      ...threads.map((t) => Math.max(t.rootPost.id, ...(t.replies ?? []).map((r) => r.id)))
    );
    if (maxIdConsidered > maxProcessedPostId) {
      maxProcessedPostId = maxIdConsidered;
    }
  }

  return { peopleCount: stored, maxProcessedPostId };
}

function extractProfileUrl(platform: string, postUrl?: string | null): string | undefined {
  if (!postUrl) return undefined;

  const platformLower = platform.toLowerCase();

  try {
    const url = new URL(postUrl);

    if (platformLower === "x" || platformLower === "twitter") {
      // Two-segment path: /username/status/123 or /username/...
      const match = url.pathname.match(/^\/([^/]+)\//);
      if (match && !match[1].toLowerCase().includes("status")) {
        return `https://twitter.com/${match[1]}`;
      }
      // Single-segment path: /username (some scrapers or short URLs)
      const single = url.pathname.match(/^\/([^/]+)$/);
      if (single) {
        const seg = single[1].toLowerCase();
        if (
          seg &&
          seg !== "home" &&
          seg !== "search" &&
          seg !== "explore" &&
          seg !== "settings" &&
          seg !== "compose"
        ) {
          return `https://twitter.com/${single[1]}`;
        }
      }
    } else if (platformLower === "reddit") {
      // Reddit: https://reddit.com/r/subreddit/comments/xyz/title/
      // or https://reddit.com/user/username
      const userMatch = url.pathname.match(/^\/user\/([^/]+)/);
      if (userMatch) {
        return `https://reddit.com/user/${userMatch[1]}`;
      }
    } else if (platformLower === "facebook") {
      // Facebook: https://facebook.com/username or https://facebook.com/profile.php?id=123
      if (url.pathname.includes("profile.php")) {
        // Keep the full URL with ID parameter
        return postUrl;
      }
      // permalink.php?story_fbid=...&id=... is a post URL; profile is in id param
      if (url.pathname.includes("permalink.php")) {
        const idParam = url.searchParams.get("id");
        if (idParam) {
          return `https://www.facebook.com/profile.php?id=${idParam}`;
        }
        return undefined; // can't get profile from permalink without id
      }
      const match = url.pathname.match(/^\/([^/]+)/);
      if (match) {
        const firstSegment = match[1];
        // Skip structural/post URLs (not profiles)
        const skipSegments = [
          "groups",
          "reel",
          "watch",
          "story",
          "stories",
          "events",
          "marketplace",
          "permalink.php",
          "sharer",
          "dialog",
        ];
        if (!skipSegments.includes(firstSegment)) {
          return `https://www.facebook.com/${firstSegment}`;
        }
      }
    } else if (platformLower === "linkedin") {
      // LinkedIn person: https://linkedin.com/in/username/
      const inMatch = url.pathname.match(/^\/in\/([^/]+)/);
      if (inMatch) {
        return `https://linkedin.com/in/${inMatch[1]}`;
      }
      // LinkedIn company: https://linkedin.com/company/slug/ (we extract but will filter companies out of influencers)
      const companyMatch = url.pathname.match(/^\/company\/([^/]+)/);
      if (companyMatch) {
        return `https://linkedin.com/company/${companyMatch[1]}`;
      }
    }
  } catch {
    // Invalid URL
  }

  return undefined;
}

function isIndividualPerson(person: { platform: string; authorName: string }): boolean {
  const platform = person.platform.toLowerCase();
  const name = person.authorName.toLowerCase();

  if (platform === "reddit") {
    if (name.startsWith("r/") || name.includes("automoderator") || name.includes("bot")) {
      return false;
    }
  }

  if (platform === "discord") {
    if (name.includes("bot") || name.includes("webhook")) {
      return false;
    }
  }

  return true;
}

async function summarizePersonIdeas(
  person: { platform: string; authorName: string; posts: any[] },
  _threads: ConversationThread[]
): Promise<string[]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  // Get top posts by engagement
  const topPosts = [...person.posts]
    .sort((a, b) => {
      const aEng = (a.metricsLikes || 0) + (a.metricsComments || 0) + (a.metricsShares || 0);
      const bEng = (b.metricsLikes || 0) + (b.metricsComments || 0) + (b.metricsShares || 0);
      return bEng - aEng;
    })
    .slice(0, 10);

  const postsText = topPosts
    .map(
      (p, i) =>
        `${i + 1}. [${p.createdAt.toISOString().split("T")[0]}] (${(p.metricsLikes || 0) + (p.metricsComments || 0) + (p.metricsShares || 0)} reactions)\n   ${p.content?.substring(0, 500)}`
    )
    .join("\n\n");

  // Retry with backoff to tolerate transient socket/API errors
  const maxRetries = 3;
  const baseDelayMs = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiChatModel("summarize"),
          messages: [
            {
              role: "system",
              content: `You are an expert at analyzing social media content and identifying key ideas.

Analyze the provided posts from a single author and extract their main ideas or themes.

Return at most TWO key ideas. Each as ONE short sentence.
- If the person had one main theme: return one sentence.
- If they had two main themes: return two sentences.
- If they had three or more distinct themes: return the two most important/engaged ideas only. Do not list every topic.

Keep each sentence concise (one line). We display max two lines per influencer; do not exhaust the space with long lists.

Return ONLY a JSON array of 1–2 strings, e.g.:
["First key idea in one sentence.", "Second key idea or multiple other topics."]

If you cannot identify clear ideas, return: ["Posts contain general commentary without distinct ideas."]

Do not include any other text or formatting.`,
            },
            {
              role: "user",
              content: `Analyze these posts from ${person.authorName} (${person.platform}):\n\n${postsText}`,
            },
          ],
          temperature: 0.5,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          console.warn(
            `[OpenAI] Throttled (429) operation=summarize_ideas retry=${attempt + 1}/${maxRetries} retryAfter=${retryAfter ?? "none"}`
          );
        }
        // Retry on transient statuses
        if ([429, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.error(`OpenAI API error: ${response.status}`);
        return ["Error summarizing ideas (API error)"];
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        return ["Error summarizing ideas (no response)"];
      }

      try {
        let ideas: string[] = JSON.parse(content);
        if (!Array.isArray(ideas) || ideas.length === 0) {
          return ["Unable to extract distinct ideas from posts"];
        }
        // Consolidate to at most two lines; if more were discussed, say "Multiple other topics."
        if (ideas.length > 2) {
          ideas = [ideas[0], "Multiple other topics."];
        }
        return ideas;
      } catch {
        return ["Error summarizing ideas (parsing error)"];
      }
    } catch {
      // Network/socket error
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return ["Error summarizing ideas (network error)"];
    }
  }

  return ["Error summarizing ideas (unknown)"];
}

/** Max blog rows to load into memory for Iteration 4 (avoids OOM on large projects). */
function readNewsSynthesisMaxBlogPosts(): number {
  const raw = process.env.NEWS_SYNTHESIS_MAX_BLOG_POSTS;
  const n = raw != null && String(raw).trim() !== "" ? Number.parseInt(String(raw), 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 50_000) {
    return n;
  }
  return 1500;
}

/**
 * ITERATION 4: News synthesis
 */
async function synthesizeNews(
  projectId: string,
  _threads: ConversationThread[],
  bounds?: AnalysisBounds
): Promise<{ newsCount: number; maxProcessedPostId: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping news synthesis - no OpenAI API key");
    return { newsCount: 0, maxProcessedPostId: bounds?.minPostIdExclusive ?? 0 };
  }

  const minPostIdExclusive = bounds?.minPostIdExclusive ?? 0;
  const maxPostIdInclusive =
    bounds?.maxPostIdInclusive !== undefined ? bounds.maxPostIdInclusive : Number.POSITIVE_INFINITY;

  // Use same relevance context as other checks (includes AND/OR rule from project)
  const projectEssence = await getProjectContextForRelevance(projectId);

  const idRange = {
    gt: minPostIdExclusive,
    ...(bounds?.maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
  };

  const baseWhere = {
    project_id: projectId,
    content: { not: null },
    NOT: { content: "" },
    id: idRange,
  };

  const select = {
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
  };

  // Top 500 by createdAt (favors recently scraped social; blog posts use article_date so are often older)
  const top500 = await prisma.post.findMany({
    where: baseWhere,
    select,
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Include blog posts in range so they are never excluded by the 500 cap (blog createdAt often
  // tracks article_date, so posts can be older than typical social in top500). Loading every blog
  // in range at once can exhaust the Node heap (OOM); we take the newest N by createdAt and
  // allow override via NEWS_SYNTHESIS_MAX_BLOG_POSTS.
  const newsMaxBlogs = readNewsSynthesisMaxBlogPosts();
  const blogPostsWhere = {
    ...baseWhere,
    platform: "blogs",
    id: { notIn: top500.map((p) => p.id) },
  };
  const blogCountInRange = await prisma.post.count({ where: blogPostsWhere });
  const blogPostsInRange = await prisma.post.findMany({
    where: blogPostsWhere,
    select,
    orderBy: { createdAt: "desc" },
    take: newsMaxBlogs,
  });

  const posts =
    top500.length === 0 && blogPostsInRange.length === 0 ? [] : [...top500, ...blogPostsInRange];

  if (posts.length === 0) {
    return { newsCount: 0, maxProcessedPostId: minPostIdExclusive };
  }

  // Engagement pre-filter: keep non-blog posts with at least minimal engagement so social can contribute to News.
  // Blog posts are always included (they are qualified upstream and typically have no engagement metrics).
  const MIN_ENGAGEMENT_FOR_NEWS = 10;
  const nonBlogPosts = posts.filter((p) => (p.platform || "").toLowerCase() !== "blogs");
  const blogPostsOnly = posts.filter((p) => (p.platform || "").toLowerCase() === "blogs");
  const nonBlogAboveThreshold = nonBlogPosts.filter((post) => {
    const likes = post.metricsLikes ?? 0;
    const comments = post.metricsComments ?? 0;
    const shares = post.metricsShares ?? 0;
    return likes + comments + shares >= MIN_ENGAGEMENT_FOR_NEWS;
  });
  // If no non-blog posts meet threshold but we have non-blog posts, include top 50 by engagement so social can still contribute
  const nonBlogToInclude =
    nonBlogAboveThreshold.length > 0
      ? nonBlogAboveThreshold
      : nonBlogPosts.length > 0
        ? [...nonBlogPosts]
            .sort((a, b) => {
              const engA =
                (a.metricsLikes ?? 0) + (a.metricsComments ?? 0) + (a.metricsShares ?? 0);
              const engB =
                (b.metricsLikes ?? 0) + (b.metricsComments ?? 0) + (b.metricsShares ?? 0);
              return engB - engA;
            })
            .slice(0, 50)
        : [];
  if (nonBlogPosts.length > 0 && nonBlogAboveThreshold.length === 0) {
    console.log(
      `[Analysis] [News] No non-blog posts met engagement >= ${MIN_ENGAGEMENT_FOR_NEWS}; including top ${nonBlogToInclude.length} by engagement for news extraction.`
    );
  }
  const filteredPosts = [...blogPostsOnly, ...nonBlogToInclude];

  if (filteredPosts.length === 0) {
    console.log(`[Analysis] [News] No posts in range; skipping news synthesis.`);
    return { newsCount: 0, maxProcessedPostId: minPostIdExclusive };
  }

  if (blogPostsInRange.length > 0) {
    if (blogCountInRange > blogPostsInRange.length) {
      console.log(
        `[Analysis] [News] ${blogCountInRange} blog post(s) match in range (excluding top 500); ` +
          `loading ${blogPostsInRange.length} newest by createdAt for synthesis ` +
          `(cap NEWS_SYNTHESIS_MAX_BLOG_POSTS=${newsMaxBlogs}; raises Node heap if set too high).`
      );
    } else {
      console.log(
        `[Analysis] [News] Including ${blogPostsInRange.length} blog post(s) in range (not in top 500 by createdAt)`
      );
    }
  }

  // Group posts by platform
  const postsByPlatform = filteredPosts.reduce(
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
  let maxProcessedPostId = minPostIdExclusive;

  // Process each platform (skip YouTube: LLM rarely extracts formal news from video posts; avoids repeated 0-item batches and log noise)
  for (const [platform, platformPosts] of Object.entries(postsByPlatform)) {
    if ((platform || "").toLowerCase() === "youtube") {
      console.log(
        `[Analysis] [News] Skipping YouTube (${platformPosts.length} posts) - no news extraction for this platform.`
      );
      continue;
    }
    console.log(`[Analysis] Synthesizing news from ${platformPosts.length} ${platform} posts...`);

    // Build thread hierarchies for this platform
    const platformThreads = buildPlatformThreads(platform, platformPosts);

    // For blogs: map hash(article_url) prefix -> article_url so we can set source_url when Post.url is null
    let blogArticleUrlByHashPrefix: Map<string, string> | null = null;
    if ((platform || "").toLowerCase() === "blogs") {
      const analyses = await prisma.blogNewsAnalysis.findMany({
        where: { project_id: projectId, deleted_at: null },
        select: { id: true, article_url: true, source_url: true },
      });
      const map = new Map<string, string>();
      for (const a of analyses) {
        const u = (a.article_url ?? a.source_url ?? "").trim();
        if (u) {
          const hashPrefix = crypto.createHash("sha256").update(u).digest("hex").slice(0, 24);
          map.set(hashPrefix, u);
        }
        // When article_url was empty at Post creation, pipeline uses id.slice(0,24) as postId prefix
        const idPrefix = (a.id ?? "").slice(0, 24);
        if (idPrefix) {
          const urlForId = (a.article_url ?? a.source_url ?? "").trim() || null;
          if (urlForId) map.set(idPrefix, urlForId);
        }
      }
      blogArticleUrlByHashPrefix = map;
    }

    // Limit news items per platform for diversity (max 10 per platform)
    let platformNewsCount = 0;
    const maxNewsPerPlatform = 10;

    // Batch threads for analysis
    const batchSize = 40;
    for (
      let i = 0;
      i < platformThreads.length && platformNewsCount < maxNewsPerPlatform;
      i += batchSize
    ) {
      const batch = platformThreads.slice(i, i + batchSize);

      try {
        const batchResult = await analyzeNewsInBatch(platform, batch, projectId, projectEssence);
        let newsItems = batchResult.items;
        const isBlogPlatform = (platform || "").toLowerCase() === "blogs";

        if (newsItems.length === 0) {
          const rejectionReason = batchResult.rejectionReason ?? "(LLM did not provide a reason)";
          console.log(
            `[Analysis] [News] ❌ No news items extracted from ${batch.length} posts for platform ${platform}. Rejection reason: ${rejectionReason}`
          );

          // For social platforms (non-blogs) where the news LLM returned 0 items, log per-post
          // relevance reasons for a sample of posts so we can inspect why they are being rejected.
          if (!isBlogPlatform && process.env.NODE_ENV !== "production") {
            const sampleSize = Math.min(batch.length, 10);
            for (let s = 0; s < sampleSize; s++) {
              const thread = batch[s] as { rootPost?: any };
              const rootPost = thread?.rootPost ?? thread;
              const snippetSource = [rootPost?.content, rootPost?.url, rootPost?.authorName]
                .filter(Boolean)
                .join(" | ")
                .slice(0, 400);
              const relevance = await isPostRelevantToProjectContext(
                projectEssence,
                snippetSource,
                {
                  platform,
                  authorName: rootPost?.authorName ?? undefined,
                }
              );
              const postIdForLog = rootPost?.id ?? rootPost?.postId ?? "unknown";
              console.log(
                `[Analysis] [News] Social post in 0-item batch: platform=${platform} postId=${postIdForLog} relevant=${relevance.relevant} reason=${relevance.reason ?? "No detailed reason returned"} snippet="${snippetSource}"`
              );
            }
          }

          // Fallback for blogs: create one news item per post so blog content appears in News (gravitas)
          if (isBlogPlatform && batch.length > 0) {
            const now = new Date();
            newsItems = batch.map((thread: { rootPost: any }) => {
              const p = thread.rootPost;
              const content = (p.content || "").trim();
              const postId = p.id;
              const createdAt = p.createdAt ? new Date(p.createdAt) : now;
              return {
                title: content
                  ? content.substring(0, 80) + (content.length > 80 ? "…" : "")
                  : "Blog post",
                summary: content ? content.substring(0, 500) : "",
                content: content || null,
                sentiment: "NEUTRAL",
                importance_score: 60,
                tags: ["blog"],
                post_ids: [postId],
                date_range_start: createdAt,
                date_range_end: createdAt,
              };
            });
            console.log(
              `[Analysis] [News] Blogs fallback: created ${newsItems.length} news item(s) from batch (LLM returned 0)`
            );
          }
        }

        // Limit news items from this batch to stay within platform cap
        const itemsToStore = newsItems.slice(0, maxNewsPerPlatform - platformNewsCount);

        // Store news items
        const isBoundedRun = bounds?.maxPostIdInclusive !== undefined;
        const isBlogsPlatform = (platform || "").toLowerCase() === "blogs";
        for (const item of itemsToStore) {
          const itemMaxPostId = item.post_ids?.length
            ? Math.max(...item.post_ids)
            : minPostIdExclusive;
          const hasInRangePost =
            item.post_ids?.some(
              (postId: number) => postId > minPostIdExclusive && postId <= maxPostIdInclusive
            ) ?? false;
          // In task-based runs, always store blog fallback items (batch is already scoped; skip check can wrongly drop them)
          if (!hasInRangePost && !(isBoundedRun && isBlogsPlatform)) {
            continue;
          }

          totalNewsItems += 1;
          platformNewsCount += 1;
          if (itemMaxPostId > maxProcessedPostId) {
            maxProcessedPostId = itemMaxPostId;
          }

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
            const firstPostId = item.post_ids[0];
            const firstPost = newsItemPosts.find((p) => p.id === firstPostId);
            if (firstPost) {
              sourceUrl =
                generatePostLink({
                  url: firstPost.url ?? undefined,
                  platform: firstPost.platform ?? platform,
                  postId: firstPost.postId,
                  channelId: firstPost.channelId ?? undefined,
                }) ?? null;
              // Blog posts created from BlogNewsAnalysis use postId = hash(article_url)--idea-n; resolve article_url when Post.url is null
              if (
                sourceUrl == null &&
                isBlogsPlatform &&
                blogArticleUrlByHashPrefix &&
                firstPost.postId
              ) {
                const prefix = String(firstPost.postId).split("--idea-")[0]?.trim();
                if (prefix) {
                  const resolved = blogArticleUrlByHashPrefix.get(prefix);
                  if (resolved) sourceUrl = resolved;
                }
              }
            }
          }
          // If no language from posts, detect from news title/summary so filter works
          if (primaryLanguage == null) {
            const textForDetection = [item.title, item.summary, item.content]
              .filter(Boolean)
              .join(" ");
            primaryLanguage = detectLanguage(textForDetection, 3) ?? null;
          }

          // UI filter uses "blog" (singular); Post.platform is "blogs" — normalize so blog filter shows these
          const sourceForFilter = (platform || "").toLowerCase() === "blogs" ? "blog" : platform;

          await prisma.postNews.create({
            data: {
              id: generateUlid(),
              project_id: projectId,
              ...(bounds?.orchestrationRunId != null && bounds.orchestrationRunId !== ""
                ? { orchestration_run_id: bounds.orchestrationRunId }
                : {}),
              title: item.title,
              summary: item.summary,
              content: item.content,
              sentiment: normalizeSentiment(item.sentiment),
              importance_score: item.importance_score,
              tags: JSON.stringify(item.tags),
              post_ids: JSON.stringify(item.post_ids),
              sources: JSON.stringify([sourceForFilter]),
              source_url: sourceUrl ?? undefined,
              date_range_start: item.date_range_start,
              date_range_end: item.date_range_end,
              language: primaryLanguage,
            },
          });
        }

        // Delay between batches
        if (i + batchSize < platformThreads.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`[Analysis] Error analyzing news for ${platform}:`, error);
      }
    }
  }

  // Advance cursor only for legacy (unbounded) runs. Task-based runs use batches, not cursors.
  if (posts.length > 0) {
    const maxIdConsidered = Math.max(...posts.map((p: { id: number }) => p.id));
    if (maxIdConsidered > maxProcessedPostId) {
      maxProcessedPostId = maxIdConsidered;
      const isBoundedRun = bounds?.maxPostIdInclusive !== undefined;
      if (totalNewsItems === 0 && !isBoundedRun) {
        console.log(
          `[Analysis] [News] Advanced cursor to post id ${maxProcessedPostId} (no items stored this run; will not re-process these posts next run).`
        );
      }
    }
  }

  return { newsCount: totalNewsItems, maxProcessedPostId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPlatformThreads(platform: string, posts: any[]): any[] {
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
  const postMap = new Map(posts.map((p) => [p.postId, p]));

  return rootPosts.map((root) => {
    const threadComments = comments.filter((comment) => {
      if (!comment.threadRefId) return false;
      if (comment.threadRefId === root.postId) return true;

      let parent = postMap.get(comment.threadRefId);
      while (parent && parent.threadRefId) {
        if (parent.threadRefId === root.postId) return true;
        parent = postMap.get(String(parent.threadRefId));
      }

      return false;
    });

    return {
      rootPost: root,
      comments: threadComments,
    };
  });
}

/** Result of news extraction: items and optional rejection reason when 0 items (social only). */
type NewsBatchResult = { items: any[]; rejectionReason?: string };

export async function analyzeNewsInBatch(
  platform: string,
  threads: any[],
  _projectId: string,
  projectEssence: string
): Promise<NewsBatchResult> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const formattedContent = formatThreadsForNews(platform, threads);
  const isBlogsPlatform = (platform || "").toLowerCase() === "blogs";

  const blogsInstruction = isBlogsPlatform
    ? `

PLATFORM=BLOGS: The input below is from BLOG/ARTICLE excerpts or key ideas (one "thread" per post = one article idea). Do NOT treat these as social conversations.
- Extract ONE news item per post (or group very similar posts into one item). Each post has a post ID — use it in post_ids.
- Title: concise headline from the content. Summary: 1–3 sentences. Content: the idea in full if needed.
- Importance 50–80 for relevant blog insights; 60+ if clearly about project brands/keywords.
- INCLUDE same-industry and competitor news: When the project monitors specific brands, content about direct competitors or the same industry (e.g. another player in that sector, industry trends) is RELEVANT—someone following this project would care. Only reject when content is clearly from a different domain (e.g. unrelated industry, generic entertainment).
- If content is semantically relevant to the project essence or the same industry/domain, include it. Return an empty result only if ALL posts are off-topic for the project's domain.
- If you extract NO news items, you MUST respond with this exact JSON object (not an array): {"items": [], "rejection_reason": "One sentence explaining why no news was extracted from these blog excerpts."}`
    : "";

  const userPromptIntro = isBlogsPlatform
    ? "Analyze these blog/article excerpts and extract news items RELEVANT TO THIS PROJECT"
    : "Analyze these social media posts and extract news items RELEVANT TO THIS PROJECT";

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiChatModel("news"),
      messages: [
        {
          role: "system",
          content: `You are a news analyst expert. CRITICAL: Before extracting any news, evaluate semantic relevance to THIS PROJECT'S ESSENCE.

Project Context (ESSENCE):
${projectEssence}

⚠️ APPLY THE RELEVANCE RULE FROM THE PROJECT CONTEXT ABOVE:
- If the context says "OR mode": content qualifies when it is about the project's topics/domain OR mentions a project brand. Topic-only content (e.g. same industry, competitors, related themes) qualifies if it is clearly in scope—do NOT require a project brand to be mentioned.
- If the context says "AND mode": keyword topics must be related to a project brand; content must be about the topics in that brand-related sense AND mention or be clearly about a project brand.
- 🎯 MONITORING FOCUS (if present) is the primary guide for what "in scope" means.
- Only reject when content is clearly unrelated (different industry, generic entertainment, no meaningful connection to the project's domain).

Extract news items based on these criteria (ONLY if semantically relevant to project essence):
- BREAKING NEWS: Time-sensitive events, announcements, or developments related to the project
- TRENDS: Emerging patterns or topics gaining attention within the project's domain
- INSIGHTS: Valuable observations, data, or analysis relevant to the project
- CONTROVERSIES: Debates or contentious issues involving project keywords/brands
- ANNOUNCEMENTS: Product launches, updates, or official statements about project keywords/brands

SOCIAL PLATFORMS (Reddit, X, Discord, Facebook, LinkedIn, etc.): Treat user posts and threads as valid news sources. If ANY post in the batch is on-topic (matches project essence / relevance rule above), you MUST extract at least one news item—e.g. the single best item or a short summary of the on-topic discussion. Do not return empty solely because the content is from social media rather than a formal press release. "Newsworthy" here includes: notable or high-engagement discussion, viral threads, product/industry/news relevant to the project, announcements or opinions from users, and trending topics in the project's domain. Only return empty when ALL posts in the batch are clearly off-topic or unrelated to the project domain.

GRAVITAS: If the content came from blogs, news publications, or forums, it has gravitas. Treat such sources as inherently newsworthy when semantically relevant to the project — do not reject solely because it is not a formal announcement or social thread; extract as news when the content is on-topic.
${blogsInstruction}

For each news item, provide:
1. Title (concise, news-headline style)
2. Summary (2-3 sentences)
3. Content (detailed description if needed)
4. Sentiment (POSITIVE, NEGATIVE, NEUTRAL, or MIXED)
5. Importance score (0-100, where 100 is most important/trending)
6. Tags (relevant keywords/topics)
7. Post IDs involved (from the provided data)
8. Date range (earliest to latest post)

Respond with ONLY a JSON array of news items in this exact format:
[
  {
    "title": "News headline",
    "summary": "Brief summary of the news item",
    "content": "Detailed description (optional)",
    "sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED",
    "importance_score": 75,
    "tags": ["tag1", "tag2"],
    "post_ids": [123, 456],
    "date_range_start": "2025-01-01T00:00:00Z",
    "date_range_end": "2025-01-02T00:00:00Z"
  }
]

If no significant news items are found, return an empty array: []${isBlogsPlatform ? '. For BLOGS platform only: if you return no items, use this object instead: {"items": [], "rejection_reason": "One sentence why no news was extracted."}' : '. For SOCIAL platforms (non-blogs): if you return no items, use this object instead of []: {"items": [], "rejection_reason": "One sentence explaining why no news was extracted from this batch (e.g. no on-topic content, relevance rule not met, or nothing newsworthy)."} so we can log the reason.'}
Do not include any other text or formatting.`,
        },
        {
          role: "user",
          content: `${userPromptIntro}:\n\n${formattedContent}\n\nApply the project's relevance rule (OR or AND) from the context above. For social platforms: if any post is on-topic, extract at least one news item; only return empty when every post in the batch is clearly off-topic.`,
        },
      ],
      temperature: 0.5,
      max_tokens: isBlogsPlatform ? 4000 : 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content;

  if (!content) {
    return { items: [] };
  }

  // Strip markdown code fences if present
  content = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(content);
    const isBlogs = (platform || "").toLowerCase() === "blogs";
    if (!Array.isArray(parsed) && parsed && typeof parsed.rejection_reason === "string") {
      const reason = parsed.rejection_reason;
      if (isBlogs) {
        console.log(
          `[Analysis] [News] Blogs LLM returned 0 items. Reason: ${reason} (fallback will still create news entries for these posts).`
        );
      }
      return { items: [], rejectionReason: isBlogs ? undefined : reason };
    }
    const newsItems = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
    if (isBlogs && newsItems.length === 0) {
      console.log(
        `[Analysis] [News] Blogs batch returned 0 items (model did not provide rejection_reason).`
      );
    }
    const items = newsItems.map((item: any) => ({
      ...item,
      date_range_start: new Date(item.date_range_start),
      date_range_end: new Date(item.date_range_end),
    }));
    return { items };
  } catch (error) {
    console.error(`Error parsing news items:`, error);
    return { items: [] };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatThreadsForNews(platform: string, threads: any[]): string {
  let formatted = `Platform: ${platform.toUpperCase()}\n`;
  formatted += `Total threads: ${threads.length}\n\n`;

  threads.forEach((thread, index) => {
    formatted += `--- Thread ${index + 1} ---\n`;
    formatted += `Post ID (database — use this in post_ids): ${thread.rootPost.id}\n`;
    formatted += `Post by ${thread.rootPost.authorName || "Unknown"} (${thread.rootPost.createdAt.toISOString()})\n`;
    formatted += `Engagement: ${thread.rootPost.metricsLikes || 0} likes, ${thread.rootPost.metricsComments || 0} comments\n`;
    formatted += `Content: ${thread.rootPost.content?.substring(0, 500) || "No content"}\n`;

    if (thread.comments.length > 0) {
      formatted += `\nComments (${thread.comments.length}):\n`;
      thread.comments.slice(0, 10).forEach((comment: any, i: number) => {
        formatted += `  ${i + 1}. [ID ${comment.id}] ${comment.authorName || "Unknown"}: ${comment.content?.substring(0, 200) || "No content"}\n`;
      });
      if (thread.comments.length > 10) {
        formatted += `  ... and ${thread.comments.length - 10} more comments\n`;
      }
    }

    formatted += `\n`;
  });

  return formatted;
}

/**
 * Store chatter analysis (conversation threads that meet criteria)
 */
async function storeChatterAnalysis(
  projectId: string,
  threads: ConversationThread[],
  orchestrationRunId?: string | null
): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping chatter storage - no OpenAI API key");
    return 0;
  }

  // Get Discord server names from project profiles
  const discordProfiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      deleted_at: null,
    },
    select: {
      name: true,
      url: true, // Contains the channel ID for Discord
    },
  });

  const discordServerMap = new Map<string, string>();
  for (const profile of discordProfiles) {
    // Extract channel ID from URL: https://discord.com/channels/<guildId>/<channelId>
    const url = profile.url || "";
    let channelId: string | null = null;
    const m = url.match(/discord\.com\/channels\/[^/]+\/(\d+)/);
    if (m && m[1]) channelId = m[1];
    if (!channelId) {
      // Fallback: last path segment
      try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);
        channelId = parts[parts.length - 1] || null;
      } catch {}
    }
    if (channelId) {
      discordServerMap.set(channelId, profile.name);
    }
  }

  // Minimum conversation size (≥2 participants OR enough replies - handles platforms like Facebook)
  const allCandidates = threads.filter((t) => {
    const isFb = isFacebookPlatform(t.rootPost.platform);
    const replyThreshold = isFb ? 2 : 1;
    return t.participants.size >= 2 || t.replies.length >= replyThreshold;
  });

  if (allCandidates.length === 0) {
    console.log("[Analysis] No candidate conversation threads found");
    return 0;
  }

  const discordInputCount = threads.filter((t) => isDiscordPlatform(t.rootPost.platform)).length;
  const discordCandidateCount = allCandidates.filter((t) =>
    isDiscordPlatform(t.rootPost.platform)
  ).length;
  if (discordInputCount > 0 || discordCandidateCount > 0) {
    console.log(
      `[Analysis] [Chatter][Discord] project=${projectId} threads_in=${discordInputCount} (after participant/reply filter: ${discordCandidateCount})`
    );
    if (discordInputCount > 0 && discordCandidateCount === 0) {
      console.log(
        `[Analysis] [Chatter][Discord] all ${discordInputCount} Discord thread(s) dropped by size rule (need ≥2 participants OR ≥1 reply for non-Facebook)`
      );
    }
  }

  // Use same relevance context as other checks (includes AND/OR rule from project)
  const projectEssence = await getProjectContextForRelevance(projectId);
  const projectConfig = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    select: { require_keywords_with_brands: true },
  });
  const requireBrandWithKeywords = projectConfig?.require_keywords_with_brands ?? false;
  console.log(
    `[Analysis] [Chatter] Relevance mode: ${requireBrandWithKeywords ? "AND (brand + topic required)" : "OR (topic-only qualifies)"}`
  );

  /** Parallel LLM waves for scoring + persist (same pattern as theme analysis). */
  const CHATTER_THREAD_CONCURRENCY = Math.max(
    1,
    parseInt(process.env.ANALYSIS_CHATTER_THREAD_CONCURRENCY ?? "10", 10) || 1
  );
  const chatterWaveDelayMs = Math.max(
    0,
    parseInt(process.env.ANALYSIS_CHATTER_WAVE_DELAY_MS ?? "200", 10) || 0
  );

  /** Skip expensive LLM relevance calls when cosine(essence, thread) is clearly too low (off-topic banter). */
  const minSimDefault = parseFloat(process.env.CHATTER_MIN_SIM_FOR_LLM ?? "0.24");
  const minSimForLlm = Number.isFinite(minSimDefault)
    ? Math.min(0.95, Math.max(0, minSimDefault))
    : 0.24;
  const discordMinEnv = process.env.CHATTER_DISCORD_MIN_SIM_FOR_LLM;
  const minSimDiscord =
    discordMinEnv != null && discordMinEnv !== "" ? parseFloat(discordMinEnv) : NaN;
  const chatterVerbose =
    process.env.ANALYSIS_VERBOSE_CHATTER === "1" || process.env.ANALYSIS_VERBOSE_CHATTER === "true";

  // Embedding prefilter to shrink candidate set
  console.log(`[Analysis] Computing embeddings for ${allCandidates.length} threads...`);
  const essenceEmb = (await embedTexts([projectEssence]))[0];
  console.log(`[Analysis] Project essence embedding computed`);
  const threadTexts = allCandidates.map((t) => {
    const repliesText = t.replies
      .slice(0, 15)
      .map(
        (r, i) => `${i + 1}. ${r.authorName || "Unknown"}: ${r.content?.substring(0, 180) || ""}`
      )
      .join("\n");
    return `Root (${t.rootPost.platform}) ${t.rootPost.authorName || "Unknown"}: ${
      t.rootPost.content?.substring(0, 400) || ""
    }\nReplies:\n${repliesText}`;
  });
  const threadEmbs = await embedTexts(threadTexts);
  console.log(`[Analysis] Thread embeddings computed, computing similarities...`);
  const withSim = allCandidates.map((t, i) => ({
    thread: t,
    sim: cosineSimilarity(essenceEmb, threadEmbs[i]),
  }));
  console.log(
    `[Analysis] Similarities computed. Max sim: ${Math.max(...withSim.map((x) => x.sim)).toFixed(3)}, Min sim: ${Math.min(...withSim.map((x) => x.sim)).toFixed(3)}`
  );

  // Use top N by similarity with platform-balanced sampling (ensure representation)
  const topNEnv = parseInt(process.env.CHATTER_TOP_N_TO_SCORE ?? "100", 10);
  const TOP_N_TO_SCORE = Math.min(
    Math.max(1, Number.isFinite(topNEnv) ? topNEnv : 100),
    150,
    withSim.length
  );

  // Normalize platform labels (treat 'x' and 'twitter' the same)
  const getPlatformKey = (p: string) => {
    const v = (p || "").toLowerCase();
    if (v === "twitter") return "x";
    return v;
  };

  // Group by platform
  const byPlatform = new Map<string, typeof withSim>();
  for (const item of withSim) {
    const key = getPlatformKey(item.thread.rootPost.platform);
    if (!byPlatform.has(key)) byPlatform.set(key, []);
    byPlatform.get(key)!.push(item);
  }

  // Sort each platform bucket by similarity desc
  for (const [, arr] of byPlatform) {
    arr.sort((a, b) => b.sim - a.sim);
  }

  // Balanced selection: allocate equal base quota per platform, then fill remaining by global best
  const platforms = Array.from(byPlatform.keys());
  const baseQuota = Math.max(1, Math.floor(TOP_N_TO_SCORE / Math.max(1, platforms.length)));
  const selected: typeof withSim = [];

  // Take base quota per platform
  for (const key of platforms) {
    const arr = byPlatform.get(key)!;
    const take = Math.min(baseQuota, arr.length);
    if (take > 0) {
      selected.push(...arr.slice(0, take));
      byPlatform.set(key, arr.slice(take));
    }
  }

  // Fill remaining slots by best available across all platforms
  const remaining = TOP_N_TO_SCORE - selected.length;
  if (remaining > 0) {
    const leftovers = Array.from(byPlatform.values()).flat();
    leftovers.sort((a, b) => b.sim - a.sim);
    selected.push(...leftovers.slice(0, remaining));
  }

  const prefiltered = selected;
  const perPlatformCounts = platforms.reduce(
    (acc: Record<string, number>, key) => {
      acc[key] = prefiltered.filter(
        (i) => getPlatformKey(i.thread.rootPost.platform) === key
      ).length;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log(
    `[Analysis] Using ${prefiltered.length} threads by similarity (balanced). Per-platform: ${JSON.stringify(
      perPlatformCounts
    )}`
  );

  // Discord: show which roots were dropped before LLM scoring (embedding / balanced quota)
  const discordRootsInCandidates = new Set(
    allCandidates.filter((t) => isDiscordPlatform(t.rootPost.platform)).map((t) => t.rootPost.id)
  );
  const discordRootsInPrefiltered = new Set(
    prefiltered
      .filter((i) => isDiscordPlatform(i.thread.rootPost.platform))
      .map((i) => i.thread.rootPost.id)
  );
  if (discordRootsInCandidates.size > 0) {
    const dropped = [...discordRootsInCandidates].filter(
      (id) => !discordRootsInPrefiltered.has(id)
    );
    const simByRoot = new Map(
      withSim
        .filter((x) => isDiscordPlatform(x.thread.rootPost.platform))
        .map((x) => [x.thread.rootPost.id, x.sim] as const)
    );
    const skippedDetail =
      dropped.length > 0
        ? `; not scored (embedding/balanced cap): ${dropped
            .map((id) => `rootId=${id} sim=${(simByRoot.get(id) ?? 0).toFixed(3)}`)
            .join("; ")}`
        : "";
    console.log(
      `[Analysis] [Chatter][Discord] prefilter: ${discordRootsInPrefiltered.size}/${discordRootsInCandidates.size} root(s) selected for LLM scoring${skippedDetail}`
    );
  }

  // Score prefiltered threads for relevance (multi-signal via model) in parallel waves
  console.log(
    `[Analysis] Scoring ${prefiltered.length} candidate threads (waves of ${CHATTER_THREAD_CONCURRENCY}, delay ${chatterWaveDelayMs}ms). ` +
      `Embedding gate: sim≥${minSimForLlm.toFixed(3)}${Number.isFinite(minSimDiscord) ? ` (Discord: ${minSimDiscord.toFixed(3)})` : ""} → LLM; below → score 0 without LLM.`
  );
  const scoredThreads: Array<{ thread: ConversationThread; score: number; reason?: string }> = [];

  const scoreOnePrefiltered = async (
    item: (typeof prefiltered)[0]
  ): Promise<{ thread: ConversationThread; score: number; reason?: string }> => {
    const isDiscord = isDiscordPlatform(item.thread.rootPost.platform);
    const minSim = isDiscord && Number.isFinite(minSimDiscord) ? minSimDiscord : minSimForLlm;

    if (item.sim < minSim) {
      return {
        thread: item.thread,
        score: 0,
        reason: `Embedding similarity ${item.sim.toFixed(3)} < ${minSim.toFixed(3)} (LLM skipped)`,
      };
    }

    const rootContentPreview = item.thread.rootPost.content?.substring(0, 150) || "(no content)";
    const replyCount = item.thread.replies.length;
    const participantCount = item.thread.participants.size;
    if (chatterVerbose) {
      console.log(
        `[Analysis] Scoring thread rootId=${item.thread.rootPost.id} (${item.thread.rootPost.platform}): ` +
          `"${rootContentPreview}..." (${replyCount} replies, ${participantCount} participants)`
      );
    }
    const { score, reason } = await scoreThreadRelevance(projectEssence, item.thread, {
      requireBrandWithKeywords,
    });
    if (chatterVerbose) {
      console.log(
        `[Analysis] Thread rootId=${item.thread.rootPost.id} scored: ${score.toFixed(1)}${reason ? ` (${reason})` : ""}`
      );
    }
    return { thread: item.thread, score, reason };
  };

  for (let waveStart = 0; waveStart < prefiltered.length; waveStart += CHATTER_THREAD_CONCURRENCY) {
    if (waveStart > 0 && chatterWaveDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chatterWaveDelayMs));
    }
    const wave = prefiltered.slice(waveStart, waveStart + CHATTER_THREAD_CONCURRENCY);
    const settled = await Promise.allSettled(wave.map((item) => scoreOnePrefiltered(item)));
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      const item = wave[i];
      if (res.status === "fulfilled") {
        scoredThreads.push(res.value);
      } else {
        console.error(
          `[Analysis] Error scoring thread rootId=${item.thread.rootPost.id}:`,
          res.reason
        );
        scoredThreads.push({ thread: item.thread, score: 0, reason: undefined });
      }
    }
    const done = Math.min(waveStart + CHATTER_THREAD_CONCURRENCY, prefiltered.length);
    if (done % 10 === 0 || done === prefiltered.length) {
      console.log(`[Analysis] Scored ${done}/${prefiltered.length} threads...`);
    }
  }
  console.log(`[Analysis] Completed scoring ${scoredThreads.length}/${prefiltered.length} threads`);
  {
    const skippedEmb = scoredThreads.filter((s) => (s.reason ?? "").includes("LLM skipped")).length;
    const llmCalls = scoredThreads.length - skippedEmb;
    console.log(
      `[Analysis] [Chatter] Relevance: ${llmCalls} thread(s) scored with LLM, ${skippedEmb} skipped (embedding similarity below CHATTER_MIN_SIM_FOR_LLM / CHATTER_DISCORD_MIN_SIM_FOR_LLM)`
    );
  }

  // CRITICAL: Relevance thresholds - items below these scores are considered irrelevant
  // and will NOT be stored, regardless of engagement metrics
  // These thresholds ensure only genuinely relevant conversations are stored
  const MIN_SCORE_TO_KEEP = 50; // Minimum relevance score required (increased from 40)
  const FACEBOOK_SCORE_THRESHOLD = 40; // Facebook threshold (increased from 25)
  const getScoreThreshold = (thread: ConversationThread) =>
    isFacebookPlatform(thread.rootPost.platform) ? FACEBOOK_SCORE_THRESHOLD : MIN_SCORE_TO_KEEP;

  const discordScored = scoredThreads.filter((s) => isDiscordPlatform(s.thread.rootPost.platform));
  if (discordScored.length > 0) {
    console.log(
      `[Analysis] [Chatter][Discord] --- Scores (discord threshold=${MIN_SCORE_TO_KEEP}, facebook=${FACEBOOK_SCORE_THRESHOLD}; set ANALYSIS_VERBOSE_CHATTER=1 for per-thread detail) ---`
    );
    for (const s of [...discordScored].sort((a, b) => b.score - a.score)) {
      const skippedByEmb = (s.reason ?? "").includes("LLM skipped");
      if (skippedByEmb && !chatterVerbose) {
        continue;
      }
      const th = getScoreThreshold(s.thread);
      const pass = s.score >= th;
      const ch = s.thread.rootPost.channelId ?? "?";
      const reasonShort = s.reason ? s.reason.replace(/\s+/g, " ").slice(0, 160) : "";
      console.log(
        `[Analysis] [Chatter][Discord] rootId=${s.thread.rootPost.id} channelId=${ch} score=${s.score.toFixed(1)} need≥${th} → ${pass ? "PASS" : "FAIL"}${reasonShort ? ` | ${reasonShort}` : ""}`
      );
    }
  }

  if (scoredThreads.length === 0) {
    console.log("[Analysis] No threads received a relevance score");
  } else {
    const scores = scoredThreads.map((s) => s.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = scores.reduce((sum, val) => sum + val, 0) / scores.length;
    console.log(
      `[Analysis] Thread relevance scores — min: ${minScore.toFixed(2)}, avg: ${avgScore.toFixed(
        2
      )}, max: ${maxScore.toFixed(2)}`
    );
  }

  // CRITICAL: Only keep threads that meet the minimum relevance threshold
  // Items below the threshold are considered irrelevant and will NOT be stored,
  // regardless of how high their engagement is
  const threadRelevanceMap = new Map<ConversationThread, number>();
  const passingThreads = scoredThreads.filter((s) => {
    const threshold = getScoreThreshold(s.thread);
    const passes = s.score >= threshold;
    if (passes) {
      threadRelevanceMap.set(s.thread, s.score);
    } else if (chatterVerbose) {
      console.log(
        `[Analysis] [Chatter] ❌ Thread rootId=${s.thread.rootPost.id} (${s.thread.rootPost.platform}) rejected: ` +
          `score ${s.score.toFixed(1)} < threshold ${threshold}. ` +
          `Reason: ${s.reason || "none"}. ` +
          `Content preview: "${(s.thread.rootPost.content || "").substring(0, 80)}..."`
      );
    }
    return passes;
  });

  const kept = passingThreads
    .sort((a, b) => b.score - a.score || b.thread.totalEngagement - a.thread.totalEngagement)
    .map((s) => s.thread);
  console.log(
    `[Analysis] Threads passing thresholds (default=${MIN_SCORE_TO_KEEP}, facebook=${FACEBOOK_SCORE_THRESHOLD}): ${kept.length}`
  );

  const discordPass = passingThreads.filter((s) => isDiscordPlatform(s.thread.rootPost.platform));
  const discordFail = scoredThreads.filter(
    (s) => isDiscordPlatform(s.thread.rootPost.platform) && s.score < getScoreThreshold(s.thread)
  );
  if (discordScored.length > 0) {
    console.log(
      `[Analysis] [Chatter][Discord] summary: scored=${discordScored.length} pass=${discordPass.length} fail=${discordFail.length} (roots that cleared threshold; dedup may reduce stored count)`
    );
  }

  // CRITICAL: Removed fallback mechanism that kept top 10 even if none passed threshold
  // This was causing off-topic items to be stored when they shouldn't be
  // If no threads pass the relevance threshold, we should not store any
  if (kept.length === 0 && scoredThreads.length > 0) {
    console.log(
      `[Analysis] ⚠️  No threads passed relevance thresholds (min=${MIN_SCORE_TO_KEEP}, facebook=${FACEBOOK_SCORE_THRESHOLD}). ` +
        `Top scores were: ${scoredThreads
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((s) => s.score.toFixed(1))
          .join(", ")}. ` +
        `Not storing any threads - they are likely off-topic.`
    );
  }

  if (kept.length === 0) {
    console.log("[Analysis] No threads passed relevance threshold");
    return 0;
  }

  console.log(`[Analysis] Final threads to store: ${kept.length}`);

  // Simple dedup: same day + normalized root snippet
  const normalizeKey = (t: ConversationThread) => {
    const day = new Date(t.rootPost.createdAt).toISOString().slice(0, 10);
    const snippet = (t.rootPost.content || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    const baseKey = `${day}|${(t.rootPost.platform || "").toLowerCase()}|${snippet}`;
    if (isFacebookPlatform(t.rootPost.platform)) {
      return `${baseKey}|${t.rootPost.postId || t.rootPost.id}`;
    }
    return baseKey;
  };

  const seen = new Set<string>();
  const finalThreads: ConversationThread[] = [];
  let duplicatesRemoved = 0;
  for (const t of kept) {
    const key = normalizeKey(t);
    if (seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(key);
    finalThreads.push(t);
  }

  if (duplicatesRemoved > 0) {
    console.log(`[Analysis] Removed ${duplicatesRemoved} duplicate threads during deduplication`);
  }
  console.log(`[Analysis] Final chatter threads selected: ${finalThreads.length}`);
  {
    const nDiscord = finalThreads.filter((t) => isDiscordPlatform(t.rootPost.platform)).length;
    if (nDiscord > 0) {
      console.log(
        `[Analysis] [Chatter][Discord] ${nDiscord} Discord thread(s) in final store list (after dedup)`
      );
    }
  }

  console.log(
    `[Analysis] Storing ${finalThreads.length} relevant chatter threads (waves of ${CHATTER_THREAD_CONCURRENCY}, delay ${chatterWaveDelayMs}ms between waves)...`
  );

  const existingChatterRows = await prisma.chatterAnalysis.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { post_ids: true },
  });
  const postIdsWithExistingChatter = new Set<number>();
  for (const record of existingChatterRows) {
    if (!record.post_ids) continue;
    try {
      const ids = JSON.parse(record.post_ids) as number[];
      if (Array.isArray(ids)) ids.forEach((id) => postIdsWithExistingChatter.add(id));
    } catch {
      // Rows that are not valid JSON are handled in isDuplicateChatterRoot
    }
  }

  const isDuplicateChatterRoot = (rootId: number): boolean => {
    if (postIdsWithExistingChatter.has(rootId)) return true;
    const rootPostIdStr = String(rootId);
    return existingChatterRows.some((record) => {
      if (!record.post_ids) return false;
      try {
        const existingPostIds = JSON.parse(record.post_ids) as number[];
        return existingPostIds.includes(rootId);
      } catch {
        return record.post_ids.includes(rootPostIdStr);
      }
    });
  };

  let stored = 0;

  const persistChatterThread = async (thread: ConversationThread): Promise<number> => {
    const relevanceScore = threadRelevanceMap.get(thread);
    try {
      if (isDiscordPlatform(thread.rootPost.platform)) {
        console.log(
          `[Analysis] [Chatter][Discord] persist pipeline rootId=${thread.rootPost.id} channelId=${thread.rootPost.channelId ?? "?"} relevance=${relevanceScore !== undefined ? relevanceScore.toFixed(1) : "?"} participants=${thread.participants.size} replies=${thread.replies.length}`
        );
      }
      console.log(
        `[Analysis] Processing chatter thread rootId=${thread.rootPost.id} participants=${thread.participants.size} replies=${thread.replies.length} totalEngagement=${thread.totalEngagement}`
      );
      const analysis = await analyzeConversationThread(thread);
      console.log(
        `[Analysis] Chatter thread rootId=${thread.rootPost.id} analysis result:`,
        analysis ? { title: analysis.title, sentiment: analysis.sentiment } : "null"
      );
      if (!analysis) {
        console.log(
          `[Analysis] Chatter thread rootId=${thread.rootPost.id} returned null analysis`
        );
        return 0;
      }

      const isDiscord = thread.rootPost.platform.toLowerCase() === "discord";
      const discordServer =
        isDiscord && thread.rootPost.channelId
          ? discordServerMap.get(thread.rootPost.channelId)
          : undefined;

      const allThreadPosts = [thread.rootPost, ...thread.replies];
      const threadLanguages = allThreadPosts
        .map((p) => (p as { language?: string }).language)
        .filter(Boolean);
      const languageCounts = new Map<string, number>();
      threadLanguages.forEach((lang) => {
        if (!lang) return;
        languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
      });
      const primaryLanguage =
        languageCounts.size > 0
          ? Array.from(languageCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
          : null;

      const platformValue = thread.rootPost.platform;
      const platformsArray = [platformValue];
      console.log(
        `[Analysis] Storing chatter thread: rootId=${thread.rootPost.id}, platform="${platformValue}", isDiscord=${isDiscord}, rootPost.platform="${thread.rootPost.platform}"`
      );

      const postIdsArray = [thread.rootPost.id, ...thread.replies.map((r) => r.id)];

      if (isDuplicateChatterRoot(thread.rootPost.id)) {
        console.log(
          `[Analysis] ⏭️  Skipping duplicate chatter thread rootId=${thread.rootPost.id} (already exists)`
        );
        return 0;
      }

      try {
        const chatterRecord = await prisma.chatterAnalysis.create({
          data: {
            id: generateUlid(),
            project_id: projectId,
            ...(orchestrationRunId != null && orchestrationRunId !== ""
              ? { orchestration_run_id: orchestrationRunId }
              : {}),
            discussion_title: analysis.title,
            topic_category: analysis.category,
            summary: analysis.summary,
            key_points_json: JSON.stringify(analysis.keyPoints),
            sentiment: normalizeSentiment(analysis.sentiment),
            platforms_json: JSON.stringify(platformsArray),
            post_ids: JSON.stringify(postIdsArray),
            participant_count: thread.participants.size,
            participant_names: JSON.stringify(Array.from(thread.participants)),
            discord_channel: isDiscord ? thread.rootPost.channelId : undefined,
            discord_server: discordServer,
            total_messages: 1 + thread.replies.length,
            total_engagement: thread.totalEngagement,
            first_post_at: thread.rootPost.createdAt,
            last_post_at:
              thread.replies[thread.replies.length - 1]?.createdAt || thread.rootPost.createdAt,
            analyzed_at: new Date(),
            importance_score: calculateImportanceScore(thread, relevanceScore),
            language: primaryLanguage,
          },
        });
        postIdsArray.forEach((id) => postIdsWithExistingChatter.add(id));
        console.log(
          `[Analysis] ✅ Stored chatter thread ${chatterRecord.id} for rootId=${thread.rootPost.id}, platform="${platformValue}", importance_score=${chatterRecord.importance_score}, title="${analysis.title}"`
        );
        return 1;
      } catch (createError) {
        console.error(
          `[Analysis] ❌ FAILED to store chatter thread for rootId=${thread.rootPost.id}:`,
          createError
        );
        if (createError instanceof Error) {
          console.error(`[Analysis] Error details: ${createError.message}`);
          if (createError.stack) console.error(`[Analysis] Stack: ${createError.stack}`);
        }
        return 0;
      }
    } catch (error) {
      console.error(`[Analysis] Error analyzing thread rootId=${thread.rootPost.id}:`, error);
      if (error instanceof Error) {
        console.error(`[Analysis] Error details: ${error.message}, stack: ${error.stack}`);
      }
      return 0;
    }
  };

  for (
    let waveStart = 0;
    waveStart < finalThreads.length;
    waveStart += CHATTER_THREAD_CONCURRENCY
  ) {
    if (waveStart > 0 && chatterWaveDelayMs > 0) {
      await new Promise((r) => setTimeout(r, chatterWaveDelayMs));
    }
    const wave = finalThreads.slice(waveStart, waveStart + CHATTER_THREAD_CONCURRENCY);
    const settled = await Promise.allSettled(wave.map((t) => persistChatterThread(t)));
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === "fulfilled" && res.value === 1) stored++;
      else if (res.status === "rejected") {
        console.error(
          `[Analysis] persistChatterThread rejected rootId=${wave[i].rootPost.id}:`,
          res.reason
        );
      }
    }
  }

  // Verify storage by counting actual records in database
  const actualCount = await prisma.chatterAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
  });

  console.log(
    `[Analysis] ✅ Chatter storage complete: stored=${stored}/${finalThreads.length}, actual DB count=${actualCount}`
  );

  if (stored !== actualCount) {
    console.warn(
      `[Analysis] ⚠️  WARNING: Stored count (${stored}) does not match DB count (${actualCount}). This may indicate some records failed to save or were deleted.`
    );
  }

  return stored;
}

async function analyzeConversationThread(thread: ConversationThread): Promise<{
  title: string;
  category: string;
  summary: string;
  keyPoints: string[];
  sentiment: string;
} | null> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const conversation = `Root post by ${thread.rootPost.authorName}:
${thread.rootPost.content}

Replies (${thread.replies.length}):
${thread.replies
  .slice(0, 15)
  .map((r, i) => `${i + 1}. ${r.authorName}: ${r.content?.substring(0, 200)}`)
  .join("\n")}`;

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiChatModel("chatter"),
      messages: [
        {
          role: "system",
          content: `Analyze this conversation thread. Determine if it's a meaningful discussion (not nonsensical).
If meaningful, provide:
1. A concise title (max 100 chars)
2. Category (Technical/Product/Community/Business/Social)
3. Brief summary (2-3 sentences)
4. Key discussion points (array of strings)
5. Overall sentiment (POSITIVE/NEGATIVE/NEUTRAL/MIXED)

Return only valid JSON or {"is_nonsensical": true} if not meaningful.`,
        },
        { role: "user", content: conversation },
      ],
      temperature: 0.5,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  let content = data.choices[0].message.content;

  // Strip markdown code fences if present
  content = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  const result = JSON.parse(content);

  if (result.is_nonsensical) {
    return null;
  }

  return {
    title: result.title,
    category: result.category,
    summary: result.summary,
    keyPoints: result.key_points || [],
    sentiment: result.sentiment,
  };
}

function calculateImportanceScore(thread: ConversationThread, relevanceScore?: number): number {
  // Score based on engagement and participation
  const engagementScore = Math.min(thread.totalEngagement / 10, 50); // Max 50 points
  const participationScore = Math.min(thread.participants.size * 5, 30); // Max 30 points
  const lengthScore = Math.min(thread.replies.length / 2, 20); // Max 20 points

  // Base importance from engagement metrics (max 100)
  const baseImportance = engagementScore + participationScore + lengthScore;

  // CRITICAL: Weight importance by relevance score to prevent off-topic items from getting perfect scores
  // If relevance score is provided, multiply base importance by (relevance / 100)
  // This ensures that even high-engagement off-topic items can't get a perfect 100
  if (relevanceScore !== undefined) {
    // Scale: relevance 40-100 maps to 0.4-1.0 multiplier
    // This means:
    // - Relevance 40 (minimum threshold) → 40% of base importance
    // - Relevance 100 (perfect) → 100% of base importance
    const relevanceMultiplier = relevanceScore / 100;
    return Math.round(baseImportance * relevanceMultiplier);
  }

  // Fallback: if no relevance score provided, return base importance
  // (for backward compatibility, though this shouldn't happen in normal flow)
  return Math.round(baseImportance);
}

/**
 * ITERATION 5: Sanitization - Remove off-topic results using AI
 */
interface SanitizationOptions {
  lastSanitizedChatterAt?: Date | null;
  lastSanitizedThemesAt?: Date | null;
  lastSanitizedNetworkAt?: Date | null;
  lastSanitizedNewsAt?: Date | null;
  /** When set, only rows stamped with this run id are sanitized (ignores date checkpoints for those rows). */
  orchestrationRunId?: string | null;
  process?: {
    chatter?: boolean;
    themes?: boolean;
    network?: boolean;
    news?: boolean;
  };
}

interface SanitizationOutcome {
  networkRemoved: number;
  chatterRemoved: number;
  newsRemoved: number;
  themesRemoved: number;
  checkpoints: {
    chatter?: Date;
    themes?: Date;
    network?: Date;
    news?: Date;
  };
}

async function sanitizeAnalysisResults(
  projectId: string,
  options?: SanitizationOptions
): Promise<SanitizationOutcome> {
  const defaultOutcome: SanitizationOutcome = {
    networkRemoved: 0,
    chatterRemoved: 0,
    newsRemoved: 0,
    themesRemoved: 0,
    checkpoints: {},
  };

  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping sanitization - no OpenAI API key");
    return defaultOutcome;
  }

  const shouldProcessChatter = options?.process?.chatter ?? false;
  const shouldProcessThemes = options?.process?.themes ?? false;
  const shouldProcessNetwork = options?.process?.network ?? false;
  const shouldProcessNews = options?.process?.news ?? false;
  const runScoped = Boolean(options?.orchestrationRunId);

  if (
    !shouldProcessChatter &&
    !shouldProcessThemes &&
    !shouldProcessNetwork &&
    !shouldProcessNews
  ) {
    return defaultOutcome;
  }

  const projectExists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!projectExists) {
    console.log("[Analysis] Project not found for sanitization");
    return defaultOutcome;
  }

  // Use semantic project scope for relevance (what is this user curious about?)
  const projectContext = await getProjectContextForRelevance(projectId);

  const stats: SanitizationOutcome = {
    networkRemoved: 0,
    chatterRemoved: 0,
    newsRemoved: 0,
    themesRemoved: 0,
    checkpoints: {},
  };

  if (shouldProcessNetwork) {
    const networkOutcome = await sanitizeNetwork(
      projectId,
      projectContext,
      runScoped ? null : (options?.lastSanitizedNetworkAt ?? null),
      options?.orchestrationRunId ?? null
    );
    stats.networkRemoved = networkOutcome.removed;
    if (networkOutcome.lastProcessedAt) {
      stats.checkpoints.network = networkOutcome.lastProcessedAt;
    }
  }

  if (shouldProcessChatter) {
    const chatterOutcome = await sanitizeChatter(
      projectId,
      projectContext,
      runScoped ? null : (options?.lastSanitizedChatterAt ?? null),
      options?.orchestrationRunId ?? null
    );
    stats.chatterRemoved = chatterOutcome.removed;
    if (chatterOutcome.lastProcessedAt) {
      stats.checkpoints.chatter = chatterOutcome.lastProcessedAt;
    }

    // Only run duplicate consolidation on the initial pass (not run-scoped sanitization)
    if (!options?.lastSanitizedChatterAt && !runScoped) {
      stats.chatterRemoved += await consolidateChatterDuplicates(projectId, projectContext);
    }
  }

  if (shouldProcessThemes) {
    const themeOutcome = await sanitizeThemes(
      projectId,
      projectContext,
      runScoped ? null : (options?.lastSanitizedThemesAt ?? null),
      options?.orchestrationRunId ?? null
    );
    stats.themesRemoved = themeOutcome.removed;
    if (themeOutcome.lastProcessedAt) {
      stats.checkpoints.themes = themeOutcome.lastProcessedAt;
    }
  }

  if (shouldProcessNews) {
    const newsOutcome = await sanitizeNews(
      projectId,
      projectContext,
      runScoped ? null : (options?.lastSanitizedNewsAt ?? null),
      options?.orchestrationRunId ?? null
    );
    stats.newsRemoved = newsOutcome.removed;
    if (newsOutcome.lastProcessedAt) {
      stats.checkpoints.news = newsOutcome.lastProcessedAt;
    }
  }

  // Run news deduplication after all sanitization steps complete, over the final set of items.
  if (shouldProcessNews) {
    const dedupRemoved = await deduplicateNewsSemantically(
      projectId,
      options?.orchestrationRunId ?? null
    );
    stats.newsRemoved += dedupRemoved;
    if (dedupRemoved > 0) {
      console.log(
        `[Sanitization] Semantic news deduplication removed ${dedupRemoved} near-duplicate item(s)`
      );
    }
  }

  return stats;
}

/**
 * Run sanitization for a project (news, themes, chatter, network).
 * Exported for use by blog-post-analysis-pipeline after creating new PostNews/themes.
 */
export async function runSanitizationForProject(
  projectId: string,
  options: { news?: boolean; themes?: boolean; chatter?: boolean; network?: boolean } = {},
  /** When set, only sanitize analysis rows created by this orchestration run (task-based analysis). */
  scope?: { orchestrationRunId: string }
): Promise<{ newsRemoved: number; themesRemoved: number }> {
  // Use persisted sanitization checkpoints so we only re-evaluate records created
  // after the last successful sanitization run for each category. This prevents
  // items that previously passed sanitization from being re-checked and potentially
  // removed in later runs. Run-scoped sanitization uses orchestration_run_id instead.
  const progress = await getOrCreateAnalysisProgress(projectId);
  const runScoped = scope?.orchestrationRunId != null && scope.orchestrationRunId !== "";

  const outcome = await sanitizeAnalysisResults(projectId, {
    lastSanitizedChatterAt: runScoped ? null : (progress.last_sanitized_chatter_at ?? null),
    lastSanitizedThemesAt: runScoped ? null : (progress.last_sanitized_themes_at ?? null),
    lastSanitizedNetworkAt: runScoped ? null : (progress.last_sanitized_network_at ?? null),
    lastSanitizedNewsAt: runScoped ? null : (progress.last_sanitized_news_at ?? null),
    orchestrationRunId: runScoped ? scope.orchestrationRunId : null,
    process: {
      news: options.news ?? false,
      themes: options.themes ?? false,
      chatter: options.chatter ?? false,
      network: options.network ?? false,
    },
  });

  const progressUpdates: Record<string, Date | null> = {};
  if (!runScoped) {
    if (outcome.checkpoints.chatter) {
      progressUpdates.last_sanitized_chatter_at = outcome.checkpoints.chatter;
    }
    if (outcome.checkpoints.themes) {
      progressUpdates.last_sanitized_themes_at = outcome.checkpoints.themes;
    }
    if (outcome.checkpoints.network) {
      progressUpdates.last_sanitized_network_at = outcome.checkpoints.network;
    }
    if (outcome.checkpoints.news) {
      progressUpdates.last_sanitized_news_at = outcome.checkpoints.news;
    }
    if (Object.keys(progressUpdates).length > 0) {
      await updateAnalysisProgress(projectId, progressUpdates);
    }
  }

  return { newsRemoved: outcome.newsRemoved, themesRemoved: outcome.themesRemoved };
}

/**
 * Sanitize Network Analysis records
 */
async function sanitizeNetwork(
  projectId: string,
  projectContext: string,
  since?: Date | null,
  orchestrationRunId?: string | null
): Promise<{ removed: number; lastProcessedAt?: Date }> {
  const records = await prisma.networkAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(orchestrationRunId
        ? { orchestration_run_id: orchestrationRunId }
        : since
          ? { created_at: { gt: since } }
          : {}),
    },
    select: {
      id: true,
      author_name: true,
      platform: true,
      ideas_json: true,
      post_ids: true,
      created_at: true,
    },
  });

  if (records.length === 0) return { removed: 0 };

  const batchSize = 10; // Smaller batches for detailed content
  let removed = 0;
  const lastProcessedAt = records.reduce<Date | undefined>((max, record) => {
    return !max || record.created_at > max ? record.created_at : max;
  }, undefined);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Get actual post content for each influencer
    const enrichedBatch = await Promise.all(
      batch.map(async (r) => {
        let postIds: number[] = [];
        try {
          if (r.post_ids) {
            postIds = JSON.parse(r.post_ids);
          }
        } catch {
          // Invalid JSON
        }

        // Get sample of actual posts (up to 5)
        const samplePosts = await prisma.post.findMany({
          where: {
            id: { in: postIds.slice(0, 5) },
          },
          select: {
            content: true,
          },
        });

        const ideas = r.ideas_json ? JSON.parse(r.ideas_json) : [];
        const postContent = samplePosts.map((p) => p.content?.substring(0, 200)).join(" | ");

        return {
          id: r.id,
          type: "influencer",
          content: `Platform: ${r.platform}\nAuthor: ${r.author_name}\nIdeas: ${ideas.join(" • ")}\nSample Posts: ${postContent || "None"}`,
        };
      })
    );

    const irrelevantIds = await checkRelevanceBatch(projectContext, enrichedBatch);

    if (irrelevantIds.length > 0) {
      console.log(
        `[Sanitization] Removing ${irrelevantIds.length} off-topic network influencers from batch ${i}-${i + batchSize}`
      );
      await prisma.networkAnalysis.updateMany({
        where: { id: { in: irrelevantIds } },
        data: { deleted_at: new Date() },
      });
      removed += irrelevantIds.length;
    }

    // Delay between batches
    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { removed, lastProcessedAt };
}

/**
 * Sanitize Chatter Analysis records
 */
async function sanitizeChatter(
  projectId: string,
  projectContext: string,
  since?: Date | null,
  orchestrationRunId?: string | null
): Promise<{ removed: number; lastProcessedAt?: Date }> {
  const records = await prisma.chatterAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(orchestrationRunId
        ? { orchestration_run_id: orchestrationRunId }
        : since
          ? { created_at: { gt: since } }
          : {}),
    },
    select: {
      id: true,
      discussion_title: true,
      summary: true,
      key_points_json: true,
      post_ids: true,
      created_at: true,
    },
  });

  if (records.length === 0) return { removed: 0 };

  const batchSize = 10; // Smaller batches for detailed content
  let removed = 0;
  const lastProcessedAt = records.reduce<Date | undefined>((max, record) => {
    return !max || record.created_at > max ? record.created_at : max;
  }, undefined);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Get actual post content for each conversation and check for keyword mentions
    const enrichedBatch = await Promise.all(
      batch.map(async (r) => {
        let postIds: number[] = [];
        let keyPoints: string[] = [];

        try {
          if (r.post_ids) postIds = JSON.parse(r.post_ids);
          if (r.key_points_json) keyPoints = JSON.parse(r.key_points_json);
        } catch {
          // Invalid JSON
        }

        // Get actual posts to check for keyword mentions
        const allPosts = await prisma.post.findMany({
          where: {
            id: { in: postIds },
          },
          select: {
            content: true,
          },
        });

        // Count keyword mentions in actual posts
        const keywords =
          projectContext
            .match(/Keywords: ([^\n]+)/)?.[1]
            ?.split(", ")
            .map((k) => k.trim().toLowerCase()) || [];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const keywordMentions = allPosts.filter((p) =>
          keywords.some((keyword) => p.content?.toLowerCase().includes(keyword))
        ).length;

        // REMOVED: No longer skip sanitization based on keyword count
        // Always run semantic relevance check - it's more accurate

        // Get sample of posts for sanitization check (use all posts, not just 5)
        const allPostContent = allPosts.map((p) => p.content?.substring(0, 150)).join(" | ");

        return {
          id: r.id,
          type: "conversation",
          content: `Title: ${r.discussion_title}\nSummary: ${r.summary || "None"}\nKey Points: ${keyPoints.join(" • ")}\nSample Posts (${allPosts.length} total): ${allPostContent || "None"}`,
        };
      })
    );

    // All items need to be checked for semantic relevance
    const itemsToCheck = enrichedBatch.filter((item) => item !== null) as Array<{
      id: string;
      type: string;
      content: string;
    }>;

    const irrelevantIds = await checkRelevanceBatch(projectContext, itemsToCheck);

    if (irrelevantIds.length > 0) {
      console.log(
        `[Sanitization] Removing ${irrelevantIds.length} off-topic conversations from batch ${i}-${i + batchSize}`
      );
      await prisma.chatterAnalysis.updateMany({
        where: { id: { in: irrelevantIds } },
        data: { deleted_at: new Date() },
      });
      removed += irrelevantIds.length;
    }

    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { removed, lastProcessedAt };
}

/**
 * Sanitize News Analysis records
 */
async function sanitizeNews(
  projectId: string,
  projectContext: string,
  since?: Date | null,
  orchestrationRunId?: string | null
): Promise<{ removed: number; lastProcessedAt?: Date }> {
  const records = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(orchestrationRunId
        ? { orchestration_run_id: orchestrationRunId }
        : since
          ? { created_at: { gt: since } }
          : {}),
    },
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      tags: true,
      sources: true,
      created_at: true,
    },
  });

  if (records.length === 0) return { removed: 0 };

  const batchSize = 15;
  let removed = 0;
  const lastProcessedAt = records.reduce<Date | undefined>((max, record) => {
    return !max || record.created_at > max ? record.created_at : max;
  }, undefined);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const enrichedBatch = batch.map((r) => {
      let tags: string[] = [];
      try {
        if (r.tags) tags = JSON.parse(r.tags);
      } catch {
        // Invalid JSON
      }
      let sourceLine = "";
      try {
        const sources: string[] = r.sources ? JSON.parse(r.sources) : [];
        if (sources.length > 0) sourceLine = `\nSource: ${sources.join(", ")}`;
      } catch {
        // ignore
      }

      return {
        id: r.id,
        type: "news",
        content: `Title: ${r.title}\nSummary: ${r.summary || "None"}\nContent: ${r.content?.substring(0, 300) || "None"}\nTags: ${tags.join(", ")}${sourceLine}`,
      };
    });

    const irrelevantIds = await checkRelevanceBatch(projectContext, enrichedBatch, "news");

    if (irrelevantIds.length > 0) {
      const irrelevantSet = new Set(irrelevantIds);
      const removedBlogNews = batch.filter((r) => {
        if (!irrelevantSet.has(r.id)) return false;
        try {
          const sources: string[] = r.sources ? JSON.parse(r.sources) : [];
          return sources.map((s: string) => s.toLowerCase()).includes("blog");
        } catch {
          return false;
        }
      });
      if (removedBlogNews.length > 0) {
        for (const r of removedBlogNews) {
          const titlePreview = (r.title || "").slice(0, 60);
          console.log(
            `[Sanitization] Removing blog post from News: id=${r.id} title="${titlePreview}${(r.title || "").length > 60 ? "..." : ""}"`
          );
        }
      }

      // For non-blog news items that are removed as off-topic, log a semantic rejection reason so we
      // can see why they failed the project relevance rule.
      const removedNonBlogNews = batch.filter((r) => {
        if (!irrelevantSet.has(r.id)) return false;
        try {
          const sources: string[] = r.sources ? JSON.parse(r.sources) : [];
          return !sources.map((s: string) => s.toLowerCase()).includes("blog");
        } catch {
          return false;
        }
      });
      if (removedNonBlogNews.length > 0) {
        for (const r of removedNonBlogNews) {
          let platform = "unknown";
          try {
            const sources: string[] = r.sources ? JSON.parse(r.sources) : [];
            if (sources.length > 0) {
              platform = String(sources[0]).toLowerCase();
            }
          } catch {
            // ignore
          }
          const textForReason = (r.content || r.summary || r.title || "").slice(0, 400);
          const relevance = await isPostRelevantToProjectContext(projectContext, textForReason, {
            platform,
          });
          const titlePreview = (r.title || "").slice(0, 60);
          console.log(
            `[Sanitization] [News] Non-blog item removed as off-topic: id=${r.id} source=${platform} title="${titlePreview}${(r.title || "").length > 60 ? "..." : ""}" Reason: ${
              relevance.reason ??
              "No detailed reason returned (likely did not meet the project's relevance rule)."
            }`
          );
        }
      }

      console.log(
        `[Sanitization] Removing ${irrelevantIds.length} off-topic news items from batch ${i}-${i + batchSize}`
      );
      await prisma.postNews.updateMany({
        where: { id: { in: irrelevantIds } },
        data: { deleted_at: new Date() },
      });
      removed += irrelevantIds.length;
    }

    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { removed, lastProcessedAt };
}

/**
 * Semantic deduplication of News: remove items that describe the same story/event/announcement (different wording, same substance).
 * Keeps one representative per group; soft-deletes the rest.
 */
async function deduplicateNewsSemantically(
  projectId: string,
  orchestrationRunId?: string | null
): Promise<number> {
  let records = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(orchestrationRunId ? { orchestration_run_id: orchestrationRunId } : {}),
    },
    select: { id: true, title: true, summary: true, content: true, created_at: true },
    orderBy: { created_at: "asc" },
  });
  if (records.length < 2) return 0;

  let totalRemoved = 0;

  // First pass: lightweight lexical deduplication based on title/summary similarity.
  // This removes near-duplicate news items that clearly describe the same story,
  // without requiring an LLM call. Semantic dedup then runs on the remaining items.
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "for",
    "with",
    "of",
    "to",
    "in",
    "on",
    "at",
    "by",
    "from",
    "that",
    "this",
    "these",
    "those",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "it",
    "its",
    "as",
    "about",
  ]);

  const tokenize = (text: string | null | undefined): Set<string> => {
    if (!text) return new Set();
    const cleaned = text
      .toLowerCase()
      // Remove punctuation and symbols, keep letters, numbers, and spaces
      .replace(/[^a-z0-9\s]/g, " ");
    const tokens = cleaned
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !stopwords.has(t));
    return new Set(tokens);
  };

  const lexicalDuplicateIds: string[] = [];
  const lexicalDuplicateSet = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (lexicalDuplicateSet.has(a.id)) continue;
    const titleTokensA = tokenize(a.title ?? "");
    const fullTokensA = tokenize(`${a.title ?? ""} ${a.summary ?? ""}`);
    if (titleTokensA.size === 0 && fullTokensA.size === 0) continue;

    for (let j = i + 1; j < records.length; j++) {
      const b = records[j];
      if (lexicalDuplicateSet.has(b.id)) continue;
      const titleTokensB = tokenize(b.title ?? "");
      const fullTokensB = tokenize(`${b.title ?? ""} ${b.summary ?? ""}`);
      if (titleTokensB.size === 0 && fullTokensB.size === 0) continue;

      // Title similarity: Jaccard (strict) or containment (shorter title's tokens mostly in longer).
      let isDuplicate = false;
      if (titleTokensA.size > 0 && titleTokensB.size > 0) {
        const titleIntersection = Array.from(titleTokensA).filter((t) =>
          titleTokensB.has(t)
        ).length;
        const titleUnion = titleTokensA.size + titleTokensB.size - titleIntersection;
        if (titleUnion > 0) {
          const jaccardTitle = titleIntersection / titleUnion;
          if (jaccardTitle >= 0.8) isDuplicate = true;
        }
        // Containment: if the smaller set's tokens are largely contained in the larger, same story (different phrasing).
        if (!isDuplicate) {
          const smaller = titleTokensA.size <= titleTokensB.size ? titleTokensA : titleTokensB;
          const larger = titleTokensA.size <= titleTokensB.size ? titleTokensB : titleTokensA;
          const contained = Array.from(smaller).filter((t) => larger.has(t)).length;
          if (smaller.size > 0 && contained / smaller.size >= 0.75) isDuplicate = true;
        }
      }

      // Fallback: title+summary similarity (Jaccard or containment).
      if (!isDuplicate && fullTokensA.size > 0 && fullTokensB.size > 0) {
        const fullIntersection = Array.from(fullTokensA).filter((t) => fullTokensB.has(t)).length;
        const fullUnion = fullTokensA.size + fullTokensB.size - fullIntersection;
        if (fullUnion > 0) {
          const jaccardFull = fullIntersection / fullUnion;
          if (jaccardFull >= 0.65) isDuplicate = true;
        }
        if (!isDuplicate) {
          const smaller = fullTokensA.size <= fullTokensB.size ? fullTokensA : fullTokensB;
          const larger = fullTokensA.size <= fullTokensB.size ? fullTokensB : fullTokensA;
          const contained = Array.from(smaller).filter((t) => larger.has(t)).length;
          if (smaller.size > 0 && contained / smaller.size >= 0.7) isDuplicate = true;
        }
      }

      if (isDuplicate) {
        lexicalDuplicateIds.push(b.id);
        lexicalDuplicateSet.add(b.id);
      }
    }
  }

  if (lexicalDuplicateIds.length > 0) {
    await prisma.postNews.updateMany({
      where: { id: { in: lexicalDuplicateIds } },
      data: { deleted_at: new Date() },
    });
    totalRemoved += lexicalDuplicateIds.length;
    // Remove lexically deduplicated items from in-memory list before semantic dedup
    records = records.filter((r) => !lexicalDuplicateSet.has(r.id));
  }

  if (!process.env.OPENAI_API_KEY || records.length < 2) {
    return totalRemoved;
  }

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const batchSize = 28;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    if (batch.length < 2) continue;
    const itemsText = batch
      .map((r, idx) => {
        const body = (r.content || r.summary || "").slice(0, 220).trim();
        return `${idx + 1}. Title: ${(r.title || "").slice(0, 140)}\n   Summary: ${(r.summary || "").slice(0, 220)}${body ? `\n   Content: ${body}` : ""}`;
      })
      .join("\n\n");

    const prompt = `You are deduplicating news items. Group items that describe the SAME underlying story, event, announcement, product, or comparison—even if headlines and wording differ. Same substance = duplicate (e.g. different phrasings of the same product launch, same "A vs B" comparison, same news from different sources). Only keep items separate when they are about genuinely different events or distinct angles. When in doubt, group items that a reader would consider "the same news."

Items (by index):
${itemsText}

Return ONLY valid JSON: { "duplicate_groups": [[a, b, c], [d, e]] } where each inner array lists 1-based indices of items that are the same story (keep the first index, remove the others). If no duplicates, return { "duplicate_groups": [] }.`;

    try {
      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiChatModel("news"),
          messages: [
            {
              role: "system",
              content:
                "You identify near-duplicate news items: same underlying story/event/announcement/product/comparison, regardless of wording or source. Return only JSON with duplicate_groups. Group liberally when the substance is the same.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.0,
          max_tokens: 600,
        }),
      });
      if (!response.ok) continue;

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content?.trim() || "";
      content = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(content);
      const groups: number[][] = Array.isArray(parsed.duplicate_groups)
        ? parsed.duplicate_groups
        : [];

      const idsToRemove: string[] = [];
      for (const group of groups) {
        if (!Array.isArray(group) || group.length < 2) continue;
        const indices = group
          .map((n: number) => Number(n))
          .filter((n) => n >= 1 && n <= batch.length);
        const sorted = [...new Set(indices)].sort((a, b) => a - b);
        for (let k = 1; k < sorted.length; k++) {
          const rec = batch[sorted[k] - 1];
          if (rec) idsToRemove.push(rec.id);
        }
      }
      if (idsToRemove.length > 0) {
        await prisma.postNews.updateMany({
          where: { id: { in: idsToRemove } },
          data: { deleted_at: new Date() },
        });
        totalRemoved += idsToRemove.length;
      }
    } catch {
      // Skip batch on parse or API error
    }
    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return totalRemoved;
}

/**
 * Sanitize Themes Analysis records.
 * Removes (1) LLM-flagged off-topic matches and (2) matches that fail the brand/entity rule (theme names a brand but content doesn't match precisely).
 */
async function sanitizeThemes(
  projectId: string,
  projectContext: string,
  since?: Date | null,
  orchestrationRunId?: string | null
): Promise<{ removed: number; lastProcessedAt?: Date }> {
  const records = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(orchestrationRunId
        ? { orchestration_run_id: orchestrationRunId }
        : since
          ? { created_at: { gt: since } }
          : {}),
    },
    select: {
      id: true,
      theme_id: true,
      theme_name: true,
      post_content: true,
      author_name: true,
      platform: true,
      created_at: true,
    },
  });

  if (records.length === 0) return { removed: 0 };

  const themeIds = [...new Set(records.map((r) => r.theme_id).filter(Boolean))];
  const themeRows =
    themeIds.length > 0
      ? await prisma.projectTheme.findMany({
          where: { id: { in: themeIds }, project_id: projectId, deleted_at: null },
          select: { id: true, theme_name: true, description: true },
        })
      : [];
  const themeDescriptionById = new Map(themeRows.map((t) => [t.id, t.description]));

  const projectBrandNames = await getProjectBrandNames(projectId);
  const themeBrandRequirements = buildThemeBrandRequirementsMap(themeRows, projectBrandNames);
  const batchSize = 20;
  let removed = 0;
  const lastProcessedAt = records.reduce<Date | undefined>((max, record) => {
    return !max || record.created_at > max ? record.created_at : max;
  }, undefined);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const irrelevantIds = await checkRelevanceBatch(
      projectContext,
      batch.map((r) => {
        const desc = themeDescriptionById.get(r.theme_id);
        const themeBlock = desc?.trim()
          ? `Primary (what to match): ${desc.trim()}\nShort label: ${r.theme_name}`
          : `Theme: ${r.theme_name}`;
        return {
          id: r.id,
          type: "theme_match",
          content: `${themeBlock}\nAuthor: ${r.author_name}\nContent: ${r.post_content?.substring(0, 500) || "None"}`,
        };
      })
    );

    // Deterministic brand/entity rule: same as at creation — primary text + title name a brand → content must match precisely; else disqualify
    const brandMismatchIds = batch
      .filter((r) =>
        shouldRejectThemeMatchForEntityMismatch(
          r.theme_name,
          r.post_content,
          projectBrandNames,
          themeDescriptionById.get(r.theme_id),
          themeBrandRequirements.get(r.theme_id)
        )
      )
      .map((r) => r.id);

    const allIdsToRemove = [...new Set([...irrelevantIds, ...brandMismatchIds])];

    if (allIdsToRemove.length > 0) {
      if (brandMismatchIds.length > 0) {
        console.log(
          `[Sanitization] Removing ${brandMismatchIds.length} theme match(es) failing brand/entity rule (batch ${i}-${i + batchSize})`
        );
      }
      const irrelevantSet = new Set(irrelevantIds);
      const removedBlogThemes = batch.filter(
        (r) => irrelevantSet.has(r.id) && (r.platform || "").toLowerCase() === "blog"
      );
      if (removedBlogThemes.length > 0) {
        for (const r of removedBlogThemes) {
          const contentPreview = (r.post_content || "").slice(0, 50);
          console.log(
            `[Sanitization] Removing blog post from Themes: id=${r.id} theme="${r.theme_name}" content_preview="${contentPreview}${(r.post_content || "").length > 50 ? "..." : ""}"`
          );
        }
      }
      console.log(
        `[Sanitization] Removing ${allIdsToRemove.length} off-topic theme matches from batch ${i}-${i + batchSize}`
      );
      await prisma.themesAnalysis.updateMany({
        where: { id: { in: allIdsToRemove } },
        data: { deleted_at: new Date() },
      });
      removed += allIdsToRemove.length;
    }

    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { removed, lastProcessedAt };
}

/**
 * Consolidate duplicate chatter items into a single summarized entry
 */
async function consolidateChatterDuplicates(
  projectId: string,
  projectContext: string
): Promise<number> {
  const beforeCount = await prisma.chatterAnalysis.count({
    where: { project_id: projectId, deleted_at: null },
  });

  console.log(
    `[Sanitization] Starting chatter consolidation for project ${projectId}: ${beforeCount} records before consolidation`
  );

  const records = await prisma.chatterAnalysis.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: {
      id: true,
      discussion_title: true,
      summary: true,
      post_ids: true,
      first_post_at: true,
      last_post_at: true,
      topic_category: true,
      sentiment: true,
      key_points_json: true,
      participant_count: true,
      total_messages: true,
      total_engagement: true,
    },
  });

  if (records.length === 0) {
    console.log(`[Sanitization] No chatter records to consolidate for project ${projectId}`);
    return 0;
  }

  // Group by semantic content similarity: normalize title + summary into a generic topic signature (no project-specific keywords).
  const extractCoreTopic = (title: string, summary: string | null): string => {
    const combined = `${title} ${summary || ""}`.toLowerCase().replace(/[^\w\s]/g, " ");
    const words = combined
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 8)
      .join(" ");
    return words.trim();
  };

  const groups = new Map<string, typeof records>();
  for (const r of records) {
    const coreTopic = extractCoreTopic(r.discussion_title || "", r.summary);
    // Use core topic as key - items about the same idea will group
    if (!groups.has(coreTopic)) groups.set(coreTopic, []);
    groups.get(coreTopic)!.push(r);
  }

  // Identify groups with more than 1 item
  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);

  // CRITICAL: Log grouping details to diagnose if everything is being grouped together
  console.log(
    `[Sanitization] Consolidation grouping: ${groups.size} unique groups found from ${records.length} records`
  );
  const groupSizes = Array.from(groups.values())
    .map((g) => g.length)
    .sort((a, b) => b - a);
  console.log(
    `[Sanitization] Group sizes: ${groupSizes.slice(0, 5).join(", ")}${groupSizes.length > 5 ? ` (showing top 5 of ${groupSizes.length})` : ""}`
  );

  if (duplicateGroups.length === 0) {
    const afterCount = await prisma.chatterAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    });
    console.log(
      `[Sanitization] No duplicate chatter items found: ${beforeCount} records unchanged (after=${afterCount})`
    );
    return 0;
  }

  console.log(`[Sanitization] Found ${duplicateGroups.length} duplicate groups to consolidate`);
  let removed = 0;

  for (const group of duplicateGroups) {
    console.log(
      `[Sanitization] Consolidating group of ${group.length} items (keeping 1, removing ${group.length - 1})`
    );
    // Keep the one with highest engagement/messages; merge the rest
    const sorted = [...group].sort(
      (a, b) =>
        (b.total_engagement || 0) - (a.total_engagement || 0) ||
        (b.total_messages || 0) - (a.total_messages || 0)
    );
    const keeper = sorted[0];
    const toMerge = sorted.slice(1);

    // Merge key points and extend summary via OpenAI
    // Note: keyPoints is parsed but intentionally not used - kept for potential future use
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _keyPoints: string[] = (() => {
      try {
        return JSON.parse(keeper.key_points_json || "[]");
      } catch {
        return [];
      }
    })();

    const mergedSummaries = [keeper.summary, ...toMerge.map((x) => x.summary)]
      .filter(Boolean)
      .join("\n\n");

    try {
      const openaiBaseUrl =
        (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
      const mergePrompt = `Project context:\n${projectContext}\n\nSummarize these highly similar discussions into one concise summary, preserving key points.\n\nDiscussions:\n${mergedSummaries}`;
      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiChatModel("chatter"),
          messages: [
            {
              role: "system",
              content:
                "You consolidate duplicate discussions into one concise, non-repetitive summary with bullet key points.",
            },
            { role: "user", content: mergePrompt },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const merged = (data.choices?.[0]?.message?.content || "").trim();
        if (merged) {
          await prisma.chatterAnalysis.update({
            where: { id: keeper.id },
            data: { summary: merged },
          });
        }
      }
    } catch {}

    // Soft delete merged duplicates
    const ids = toMerge.map((x) => x.id);
    if (ids.length > 0) {
      await prisma.chatterAnalysis.updateMany({
        where: { id: { in: ids } },
        data: { deleted_at: new Date() },
      });
      removed += ids.length;
    }
  }

  const afterCount = await prisma.chatterAnalysis.count({
    where: { project_id: projectId, deleted_at: null },
  });

  if (removed > 0) {
    console.log(
      `[Sanitization] ✅ Consolidated duplicate chatter items: removed=${removed}, before=${beforeCount}, after=${afterCount}`
    );
  } else {
    console.log(
      `[Sanitization] No duplicate chatter items found: ${beforeCount} records unchanged`
    );
  }

  if (beforeCount - removed !== afterCount) {
    console.warn(
      `[Sanitization] ⚠️  WARNING: Consolidation math mismatch: before(${beforeCount}) - removed(${removed}) = expected(${beforeCount - removed}), but actual count is ${afterCount}`
    );
  }

  return removed;
}

/**
 * Check a batch of items for relevance using OpenAI (semantic project scope).
 * Exported for use by news-analysis and other callers.
 * @param contextType - When "news", applies gravitas rule for blogs/news/forums sources.
 */
export async function checkRelevanceBatch(
  projectContext: string,
  items: Array<{ id: string; type: string; content: string }>,
  contextType?: string
): Promise<string[]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const gravitasInstruction =
    contextType === "news"
      ? `
GRAVITAS (news only): If an item's Source is blogs, news publications, or forums, it has gravitas. Do NOT mark it OFF-TOPIC unless it is clearly unrelated to the project domain; when in doubt, keep it. When a piece clearly sits in the same industry or subject area as the project, treat it as relevant news even if it mentions products, prices, or benefits—only mark it OFF-TOPIC if it is outside the domain or reads primarily as a sales pitch or step-by-step optimization guide.`
      : "";

  const isThemeMatchBatch = items.length > 0 && items.every((it) => it.type === "theme_match");
  const themeMatchInstruction = isThemeMatchBatch
    ? `
THEME MATCHES (this batch only): These items are theme matches that already passed theme-matching rules (entity, tone, relevance). Only mark OFF-TOPIC if the content is clearly unrelated to the project domain OR is purely promotional/ad-like (written to sell or drive sign-ups). When in doubt, KEEP the item—do not re-judge theme fit.`
    : "";

  const prompt = `Given this project context:
${projectContext}

Your task: Understand the ESSENCE of this project, then review each item for semantic relevance.

Apply the RELEVANCE RULE (AND or OR mode) from the project context above: In OR mode, content that matches project keywords/topics qualifies as relevant even without a brand mention. In AND mode, keyword topics must be related to a project brand; content must mention or be about a project brand AND be on-topic in that brand-related way; keyword-only, brand-only, or generic topic without brand relationship is OFF-TOPIC.

⚠️ SEMANTIC CONTEXT: Evaluate relevance using ALL available context:
- MONITORING FOCUS (if specified) - describes what the project is specifically looking for
- KEYWORDS - domain-specific terms that indicate broader interest
- BRANDS - specific entities being monitored
- DESCRIPTION - general project context

🎯 PROJECT ESSENCE ANALYSIS:
First, understand what this project is really about. Look at the monitoring focus (if provided), keywords, brands, and description together to form a clear picture:
- What is the core product/service/brand being monitored?
- What industry/domain does it operate in?
- What would someone following this project care about?

Then evaluate each item using the RELEVANCE RULE (AND/OR) and SEMANTIC SIMILARITY:
- Does it meet the project's relevance rule (AND: keyword topics related to a brand + brand mention + on-topic; OR: topic or brand)?
- Would someone following this project care about this content?
- Is it in the same domain/conversation space?

CRITICAL GUIDELINES:
- Follow the RELEVANCE RULE (AND or OR mode) from the project context when marking items ON-TOPIC vs OFF-TOPIC.
- **MONITORING FOCUS**: If monitoring focus is specified, use it as the primary guide for what the project cares about.
- Keep an item when it meets the project's relevance rule and clearly relates to the project scope.
- Mark OFF-TOPIC when the content fails the relevance rule (in AND mode: no brand mention, or keyword topics not related to a project brand; or in either mode: unrelated industry/topic).
- **PROMOTIONAL / AD-LIKE**: Treat an item as promotional only when its primary purpose is to persuade the audience to take a commercial or sign-up action (for example, to buy something, upgrade, claim an offer, open an account, or maximize rewards). Neutral or analytical coverage of product changes, service changes, corporate decisions, financial performance, or industry developments should be treated as informational news, not ads, even when written positively. Do not mark such informational pieces OFF-TOPIC solely because they mention products, perks, or loyalty programs; only mark OFF-TOPIC when the piece is outside the project domain or reads primarily like marketing copy or a how-to optimization guide.
- Author-name keyword matches alone are not enough; the actual content must align.
- Hashtag spam or list dumps that never discuss the project are OFF-TOPIC.
- Generic discussions about unrelated topics are OFF-TOPIC.
- When uncertain, apply the RELEVANCE RULE: in OR mode, keyword/topic match can keep the item; in AND mode, require keyword topics related to a brand plus brand mention plus on-topic.
${gravitasInstruction}
${themeMatchInstruction}

Items to review:
${items.map((item, i) => `${i + 1}. [${item.type}]\n${item.content}`).join("\n\n---\n\n")}

Return ONLY valid JSON with the numbers (1-based index) of OFF-TOPIC items:
{
  "off_topic_indices": [2, 5, 7]
}

If ALL items are relevant, return: {"off_topic_indices": []}`;

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiChatModel("relevance"),
      messages: [
        {
          role: "system",
          content:
            "You review social listening results for relevance. Mark OFF-TOPIC when: (1) no meaningful connection to the project context, or (2) the item is primarily promotional or ad-like (written to sell, promote, or drive sign-ups; keep factual reporting and genuine discussion). Preserve items that could plausibly relate. When evidence is ambiguous, keep the item.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.0, // Zero temperature for maximum strictness
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    console.error(`[Analysis] OpenAI API error during sanitization: ${response.status}`);
    return [];
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content;

  if (!content) {
    return [];
  }

  // Strip markdown fences
  content = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const result = JSON.parse(content);
    const offTopicIndices = result.off_topic_indices || [];

    // Map indices back to item IDs
    return offTopicIndices.map((index: number) => items[index - 1]?.id).filter(Boolean);
  } catch (error) {
    console.error("[Analysis] Error parsing sanitization response:", error);
    return [];
  }
}

/**
 * Check a single post for relevance to project context (e.g. before inserting into DownstreamPost).
 * Uses same semantic rules as checkRelevanceBatch. Returns { relevant: true } or { relevant: false, reason }.
 * When OPENAI_API_KEY is missing or API fails, returns { relevant: true } (allow post through) to avoid blocking.
 */
export async function isPostRelevantToProjectContext(
  projectContext: string,
  postContent: string | null | undefined,
  options?: { platform?: string; authorName?: string }
): Promise<{ relevant: boolean; reason?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { relevant: true };
  }
  const content = (postContent || "").trim();
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const meta =
    options?.platform || options?.authorName
      ? `\n[Platform: ${options.platform ?? "unknown"}${options.authorName ? `, Author: ${options.authorName}` : ""}]`
      : "";
  const prompt = `Given this project context:
${projectContext}

Your task: Decide if this single post is RELEVANT to the project (semantic relevance).

Apply the RELEVANCE RULE (AND or OR mode) from the project context above: In OR mode, content that matches project topics/keywords/domain qualifies even without a brand mention. In AND mode, keyword topics must be related to a project brand; content must mention or be about a project brand AND be on-topic in that brand-related way. Mark OFF_TOPIC only when the content clearly fails the relevance rule (in AND mode: no brand mention, or topics not related to a project brand; or in either mode: unrelated industry, generic spam, no meaningful connection).

Post to evaluate:${meta}
${content || "(no text content)"}

Return ONLY valid JSON: {"relevant": true} or {"relevant": false, "reason": "brief explanation of why off-topic"}`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiChatModel("relevance"),
        messages: [
          {
            role: "system",
            content:
              'You judge whether a single social post is relevant to a project. Return only JSON: {"relevant": true} or {"relevant": false, "reason": "brief explanation"}. When in doubt, keep the post (relevant: true).',
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.0,
        max_tokens: 100,
      }),
    });
    if (!response.ok) {
      console.warn(
        "[Analysis] OpenAI API error in single-post relevance check, allowing post through"
      );
      return { relevant: true };
    }
    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/```json?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(text);
    const relevant = parsed?.relevant !== false;
    const reason = typeof parsed?.reason === "string" ? parsed.reason : undefined;
    return { relevant, reason: relevant ? undefined : reason || "no reason provided" };
  } catch (error) {
    console.warn("[Analysis] Error in single-post relevance check, allowing post through:", error);
    return { relevant: true };
  }
}

function getThreadMaxPostId(thread: ConversationThread): number {
  let maxId = thread.rootPost.id;
  for (const reply of thread.replies) {
    if (reply.id > maxId) {
      maxId = reply.id;
    }
  }
  return maxId;
}

/** True if any post in the thread is newer than the last processed cursor (incremental theme pass). */
function threadNeedsThemePass(thread: ConversationThread, lastProcessedPostId: number): boolean {
  if (thread.rootPost.id > lastProcessedPostId) return true;
  return thread.replies.some((r) => r.id > lastProcessedPostId);
}

/** Max chars for entity/brand gate string (unbounded joins could retain huge buffers and worsen OOM under load). */
const THEME_ENTITY_COMBINED_TEXT_MAX = 32_000;

function isRetryableOpenAiNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) {
    const m = String(e.message);
    if (
      m.includes("fetch failed") ||
      m.includes("terminated") ||
      m.includes("aborted") ||
      m.includes("network")
    ) {
      return true;
    }
  }
  if (e && typeof e === "object" && "cause" in e) {
    const c = (e as { cause?: unknown }).cause;
    if (c && typeof c === "object" && "code" in c) {
      const code = String((c as { code?: string }).code);
      if (
        code === "EPIPE" ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ECONNREFUSED" ||
        code === "UND_ERR_SOCKET"
      ) {
        return true;
      }
    }
  }
  return false;
}

/** One block of text for the whole thread (root + replies) — single LLM evaluation per conversation. */
function formatConversationForThemePrompt(thread: ConversationThread): string {
  const root = thread.rootPost;
  const lines: string[] = [];
  lines.push(
    `ROOT [${root.platform}] ${root.authorName ?? "Unknown"}:\n${(root.content ?? "").substring(0, 5000)}`
  );
  if (thread.replies.length > 0) {
    const maxReplies = 40;
    const slice = thread.replies.slice(0, maxReplies);
    for (let i = 0; i < slice.length; i++) {
      const r = slice[i];
      lines.push(
        `REPLY ${i + 1} [${r.authorName ?? "Unknown"}]:\n${(r.content ?? "").substring(0, 500)}`
      );
    }
    if (thread.replies.length > maxReplies) {
      lines.push(`... (${thread.replies.length - maxReplies} more replies omitted for length)`);
    }
  }
  return lines.join("\n\n---\n\n");
}

function filterThreadsByBounds(
  threads: ConversationThread[],
  minPostIdExclusive: number,
  maxPostIdInclusive: number
): ConversationThread[] {
  const filtered = threads.filter((thread) => {
    const maxId = getThreadMaxPostId(thread);
    const rootId = thread.rootPost.id;
    // CRITICAL: A thread is in range if EITHER:
    // 1. The max ID (including replies) is in range, OR
    // 2. The root post ID is in range (even if replies are outside)
    // This ensures threads aren't excluded just because some replies have older/newer IDs
    const rootInRange = rootId > minPostIdExclusive && rootId <= maxPostIdInclusive;
    const maxInRange = maxId > minPostIdExclusive && maxId <= maxPostIdInclusive;
    return rootInRange || maxInRange;
  });

  // Debug: Log filtering details for Discord threads
  const discordThreads = threads.filter((t) => t.rootPost.platform.toLowerCase() === "discord");
  if (discordThreads.length > 0) {
    const discordFiltered = filtered.filter((t) => t.rootPost.platform.toLowerCase() === "discord");
    console.log(
      `[filterThreadsByBounds] Discord threads: ${discordFiltered.length}/${discordThreads.length} in range (${minPostIdExclusive} < id <= ${maxPostIdInclusive})`
    );
  }

  return filtered;
}

async function runThemeAnalysisStep(
  projectId: string,
  lastProcessedPostId: number,
  upperBoundPostId: number,
  threadsPromise: Promise<ConversationThread[]>
): Promise<{ postsAnalyzed: number; themesMatched: number; maxProcessedPostId: number }> {
  if (upperBoundPostId <= lastProcessedPostId) {
    console.log(
      `[Analysis] Skipping theme analysis: upperBound(${upperBoundPostId}) <= lastProcessed(${lastProcessedPostId})`
    );
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: lastProcessedPostId,
    };
  }

  // Get all threads in the range
  const allThreads = await threadsPromise;
  const filteredThreads = filterThreadsByBounds(allThreads, lastProcessedPostId, upperBoundPostId);

  if (filteredThreads.length === 0) {
    console.log(
      `[Analysis] No threads in range (${lastProcessedPostId} < postId <= ${upperBoundPostId}) for theme analysis`
    );
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: lastProcessedPostId,
    };
  }

  console.log(
    `[Analysis] Starting theme analysis for project ${projectId}: ${filteredThreads.length} threads in range (${lastProcessedPostId} < postId <= ${upperBoundPostId})`
  );

  // Analyze themes using conversation threads (root post + replies)
  return analyzeThemesFromThreads(projectId, filteredThreads, lastProcessedPostId, undefined);
}

async function analyzeThemesFromThreads(
  projectId: string,
  threads: ConversationThread[],
  lastProcessedPostId: number,
  orchestrationRunId?: string | null
): Promise<{ postsAnalyzed: number; themesMatched: number; maxProcessedPostId: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Analysis] Skipping theme analysis - no OpenAI API key");
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: lastProcessedPostId,
    };
  }

  const projectEssence = await getProjectContextForRelevance(projectId);
  const themes = await prisma.projectTheme.findMany({
    where: {
      project_id: projectId,
      is_active: true,
      deleted_at: null,
    },
    select: {
      id: true,
      theme_name: true,
      description: true,
    },
  });

  if (themes.length === 0) {
    console.log("[Analysis] No themes defined, skipping theme analysis");
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: lastProcessedPostId,
    };
  }

  const projectBrandNames = await getProjectBrandNames(projectId);
  if (projectBrandNames.length > 0) {
    console.log(
      `[Analysis] Theme–brand filter (threads): project has ${projectBrandNames.length} brand(s): ${projectBrandNames.join(", ")}`
    );
  }
  const themeBrandRequirements = buildThemeBrandRequirementsMap(themes, projectBrandNames);
  const withBrands = [...themeBrandRequirements.entries()].filter(([, b]) => b.length > 0);
  if (withBrands.length > 0) {
    console.log(
      `[Analysis] Theme–brand review (threads): ${withBrands.length} theme(s) reference project brand(s) (strict).`
    );
    for (const [tid, brands] of withBrands) {
      const t = themes.find((x) => x.id === tid);
      if (t) console.log(`[Analysis]   • "${t.theme_name}" → ${brands.join(", ")}`);
    }
  }

  // Get Discord server names
  const discordProfiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      deleted_at: null,
    },
    select: {
      name: true,
      url: true,
    },
  });

  const discordServerMap = new Map<string, string>();
  for (const profile of discordProfiles) {
    const url = profile.url || "";
    const m = url.match(/discord\.com\/channels\/[^/]+\/(\d+)/);
    const channelId =
      m?.[1] ||
      (() => {
        try {
          const u = new URL(url);
          const parts = u.pathname.split("/").filter(Boolean);
          return parts[parts.length - 1] || null;
        } catch {
          return null;
        }
      })();
    if (channelId) {
      discordServerMap.set(channelId, profile.name);
    }
  }

  // One OpenAI call per conversation (thread). Matches attach to the root post.
  const threadsNeedingPass = threads.filter((t) => threadNeedsThemePass(t, lastProcessedPostId));

  if (threadsNeedingPass.length === 0) {
    const maxPostId =
      threads.length > 0
        ? Math.max(...threads.map((t) => getThreadMaxPostId(t)))
        : lastProcessedPostId;
    console.log(
      `[Analysis] No conversations in range (${lastProcessedPostId} < postId) for theme analysis`
    );
    return {
      postsAnalyzed: 0,
      themesMatched: 0,
      maxProcessedPostId: maxPostId,
    };
  }

  const rootIdsUnique = [...new Set(threadsNeedingPass.map((t) => t.rootPost.id))];
  const sentimentRootIds = new Set<number>();
  const ROOT_BATCH = 500;
  for (let i = 0; i < rootIdsUnique.length; i += ROOT_BATCH) {
    const slice = rootIdsUnique.slice(i, i + ROOT_BATCH);
    const rows = await prisma.post.findMany({
      where: { id: { in: slice }, sentiment: { not: null } },
      select: { id: true },
    });
    rows.forEach((r) => sentimentRootIds.add(r.id));
  }

  let threadsReady = threadsNeedingPass.filter((t) => sentimentRootIds.has(t.rootPost.id));

  // THEMES-only runs (orchestration) often skip SENTIMENT; roots then have no sentiment and we used to
  // bail out with 0 theme matches. Prefer threads whose root already has sentiment; otherwise still run.
  if (threadsReady.length === 0 && threadsNeedingPass.length > 0) {
    console.warn(
      `[Analysis] Theme analysis: ${threadsNeedingPass.length} thread(s) in range but no root post has sentiment yet. ` +
        `Running theme matching anyway (missing sentiment is treated as neutral for frustration-theme rules). ` +
        `Run SENTIMENT before THEMES when possible for accurate tone filters.`
    );
    threadsReady = threadsNeedingPass;
  }

  console.log(
    `[Analysis] Evaluating ${threadsReady.length} conversation(s) as a whole (one LLM call per thread; matches stored on root)`
  );

  /** Cumulative diagnostics for task/worker logs — set ANALYSIS_THEMES_TRACE=1 for per-thread lines. */
  const themeTrace = {
    badThemeIndex: 0,
    belowRelevance60: 0,
    rejectedBrandGate: 0,
    rejectedEntityPhrase: 0,
    rejectedNegativeSentiment: 0,
    skippedDuplicate: 0,
    prismaErrors: 0,
    llmRejectedOrFailed: 0,
    rawLlmThemeRows: 0,
  };

  console.log(
    `[Themes:trace] entityGate brandScan=combined(name+description) entityLiteral=${themeEntityLiteralGateEnabled() ? "on" : "off"} ` +
      `(set ANALYSIS_THEME_ENTITY_LITERAL_GATE=1 for literal with/about/for phrase in post)`
  );

  let totalAnalyzed = 0;
  let totalThemesMatched = 0;
  const processedPostIds = new Set<number>();

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  /** Space waves so GC can reclaim prompt/response buffers; large runs + parallel fetches caused heap OOM. */
  const themeBatchDelayMs = 1_500;
  /** Default 1: parallel theme LLM calls multiply peak memory; set ANALYSIS_THEMES_THREAD_CONCURRENCY=2 if needed. */
  const THREAD_THEME_CONCURRENCY = Math.max(
    1,
    parseInt(process.env.ANALYSIS_THEMES_THREAD_CONCURRENCY ?? "1", 10) || 1
  );

  const markThreadPostsProcessed = (thread: ConversationThread) => {
    processedPostIds.add(thread.rootPost.id);
    for (const r of thread.replies) {
      processedPostIds.add(r.id);
    }
  };

  const runThemeLlmForConversation = async (thread: ConversationThread): Promise<void> => {
    const item = {
      post: thread.rootPost,
      isRoot: true as const,
      threadRoot: thread.rootPost,
      threadReplies: thread.replies,
    };
    const conversationBody = formatConversationForThemePrompt(thread);
    let combinedTextForEntityCheck = [
      thread.rootPost.content,
      ...thread.replies.map((r) => r.content),
    ]
      .filter((c): c is string => Boolean(c && String(c).trim()))
      .join("\n\n");
    if (combinedTextForEntityCheck.length > THEME_ENTITY_COMBINED_TEXT_MAX) {
      combinedTextForEntityCheck = combinedTextForEntityCheck.slice(
        0,
        THEME_ENTITY_COMBINED_TEXT_MAX
      );
    }

    const isDiscordThread = (thread.rootPost.platform || "").toLowerCase() === "discord";
    const discordSubjectHint = isDiscordThread
      ? `⚠️ DISCORD: Messages are often short and informal. Still judge **semantic topic fit** to each theme's idea—never match only on a vague negative phrase unrelated to that idea.\n\n`
      : "";

    const prompt = `Project context (relevance — AND/OR rules below apply to theme matching):
${projectEssence}

You are evaluating ONE social conversation (root post + replies) as a **single unit**. Decide which themes apply to the **whole discussion** — topic, tone, and entities in aggregate—not by scoring each message separately.

FULL CONVERSATION:
${conversationBody}

Themes to match:
${formatThemeListForLlmPrompt(themes)}

⚠️ THEME PRIMARY VS LABEL: **Primary (what to match)** is authoritative; **Short label** is display-only.

⚠️ IDEAS, NOT KEYWORDS: Each theme is an **idea** to evaluate against. Match when the conversation is **semantically** about that idea (topic, domain, intent)—including synonyms, paraphrase, and implicit references. Do **not** require posts to repeat specific words or phrases from the theme title or description.

${discordSubjectHint}⚠️ SUBJECT MATTER (semantic fit, not emotion alone):
- When a theme implies a **subject or domain** (e.g. AI tools, a product category, a named area of concern), the conversation must be **substantially about that idea**, judged by meaning—not by string overlap with the theme text. Do **not** match based only on generic negative sentiment, frustration, or phrases like "not a great experience" when the thread is clearly about something else (e.g. unrelated daily life, vehicles, food, weather).
- **Tone** (frustration vs praise) matters **only after** the topic fits the theme's idea. A matching bad mood does **not** prove the theme fits if the subject matter does not.

⚠️ RELEVANCE FOR THEME MATCHING (same rules as Network / News / Chatter):
- Read **RELEVANCE RULE (OR mode)** or **RELEVANCE RULE (AND mode)** in the Project Context above.
- **OR mode**: For themes that do not name a specific entity, you may match by topic when the conversation satisfies the OR rule.
- **AND mode**: The conversation must satisfy the AND rule before any theme match.
- When the theme's **Primary** text or label names a specific entity: only match if the conversation is substantially about that entity.

⚠️ CRITICAL THEME MATCHING RULES (conversation as a whole):
1. Read the ENTIRE thread. Tone and topic come from the combined discussion.
2. **Topic first:** Confirm the thread is about the theme's subject domain before considering tone; see SUBJECT MATTER above.
3. MATCH THE DOMINANT TONE of the thread to the theme's implied tone (frustration vs praise vs neutral) **only where topic already fits**.
4. PROJECT RELEVANCE: Apply AND/OR from Project Context to the overall conversation.
5. ENTITY-IN-THEME RULE: When the **Primary** text or label names an entity, the conversation must be about that entity.
6. THEME SENTIMENT/ANGLE: If the **Primary** text or label implies a specific angle (e.g. frustration about that subject), the thread must show that angle in aggregate **for that subject**, not unrelated frustration.
7. RELEVANCE SCORES (0–100): Only ≥60 when the conversation clearly fits the theme and project scope.

Return ONLY valid JSON — one object with a "themes" array (not an array of posts):
{
  "themes": [{"theme_index": 1, "relevance": 85}]
}
Use theme_index 1-based matching the list above. Use "themes": [] when no theme matches.`;

    const maxRetries = 5;
    let response: Response | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(`${openaiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: openaiChatModel("themes"),
            messages: [
              {
                role: "system",
                content:
                  'You are a theme analysis expert. Evaluate ONE conversation as a single unit. Themes describe ideas: match by semantic topic and intent, not by requiring exact words from the theme. Reject tone-only matches when the topic is wrong. Return ONLY valid JSON: one object with a "themes" array; theme_index 1-based, relevance 0-100; use "themes": [] when nothing matches.',
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 1500,
          }),
        });

        if (response.ok) break;
        if ([429, 502, 503, 504].includes(response.status) && attempt < maxRetries - 1) {
          const retryAfter = response.status === 429 ? response.headers.get("retry-after") : null;
          const waitMs = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 60000)
            : Math.min(2000 * Math.pow(2, attempt), 30000);
          if (response.status === 429) {
            console.warn(
              `[OpenAI] Throttled (429) operation=theme_conversation rootId=${thread.rootPost.id} retry=${attempt + 1}/${maxRetries} waitMs=${waitMs}`
            );
          }
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`OpenAI API error: ${response.status}`);
      } catch (e) {
        if (attempt < maxRetries - 1 && isRetryableOpenAiNetworkError(e)) {
          const waitMs = Math.min(1500 * Math.pow(2, attempt), 30_000);
          console.warn(
            `[OpenAI] Network error operation=theme_conversation rootId=${thread.rootPost.id} retry=${attempt + 1}/${maxRetries} waitMs=${waitMs}`,
            e
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw e;
      }
    }

    if (!response!.ok) {
      throw new Error(`OpenAI API error: ${response!.status}`);
    }

    const data = await response!.json();
    let content = data.choices?.[0]?.message?.content ?? "";
    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed: { themes?: Array<{ theme_index: number; relevance: number }> };
    try {
      parsed = JSON.parse(content) as {
        themes?: Array<{ theme_index: number; relevance: number }>;
      };
    } catch (parseErr) {
      console.warn(
        `[Analysis] Theme conversation rootId=${thread.rootPost.id}: JSON parse failed; first 200: ${(content ?? "").slice(0, 200)}`
      );
      throw parseErr;
    }

    if (Array.isArray(parsed)) {
      if (
        parsed.length === 1 &&
        parsed[0] &&
        typeof parsed[0] === "object" &&
        parsed[0] !== null &&
        "themes" in parsed[0]
      ) {
        parsed = parsed[0] as { themes?: Array<{ theme_index: number; relevance: number }> };
      } else {
        parsed = { themes: [] };
      }
    }

    const themeResults = parsed.themes ?? [];
    themeTrace.rawLlmThemeRows += themeResults.length;
    if (process.env.ANALYSIS_THEMES_TRACE === "1") {
      const prev = themeResults
        .map((t) => `idx${t.theme_index}@${typeof t.relevance === "number" ? t.relevance : "?"}`)
        .join(", ");
      console.log(
        `[Themes:trace] rootId=${thread.rootPost.id} platform=${thread.rootPost.platform} ` +
          `llmRows=${themeResults.length}${prev ? ` [${prev}]` : ""}`
      );
    }

    markThreadPostsProcessed(thread);
    totalAnalyzed++;

    const post = item.post;
    const targetPost = item.threadRoot;
    const targetPostId = targetPost.id;

    const seenThemeIndices = new Set<number>();
    for (const themeMatch of themeResults) {
      const ti = themeMatch.theme_index;
      if (typeof ti !== "number" || !Number.isFinite(ti)) {
        themeTrace.badThemeIndex++;
        continue;
      }
      if (seenThemeIndices.has(ti)) {
        themeTrace.skippedDuplicate++;
        continue;
      }
      seenThemeIndices.add(ti);

      const theme = themes[ti - 1];
      if (!theme) {
        themeTrace.badThemeIndex++;
        continue;
      }

      const relevance = typeof themeMatch.relevance === "number" ? themeMatch.relevance : 0;
      if (relevance < 60) {
        themeTrace.belowRelevance60++;
        continue;
      }

      try {
        const existingMatch = await prisma.themesAnalysis.findFirst({
          where: {
            project_id: projectId,
            theme_id: theme.id,
            post_id: targetPostId,
            deleted_at: null,
          },
        });

        if (existingMatch) {
          if (orchestrationRunId != null && orchestrationRunId !== "") {
            await prisma.themesAnalysis.update({
              where: { id: existingMatch.id },
              data: {
                orchestrationRun: { connect: { id: orchestrationRunId } },
                analyzed_at: new Date(),
              },
            });
          }
          themeTrace.skippedDuplicate++;
          continue;
        }

        const isDiscord = targetPost.platform.toLowerCase() === "discord";
        const rawDiscordServer =
          isDiscord && targetPost.channelId
            ? discordServerMap.get(targetPost.channelId)
            : undefined;

        // Sanitize every string field for libSQL/Prisma (see `sanitizeTextForDbStorage`). Do not
        // sanitize `participant_names` after JSON.stringify — sanitize each name, then stringify.
        const safeContent = sanitizeTextForDbStorage(targetPost.content ?? null, 500);

        const entityGate = getThemeEntityGateDecision(
          theme.theme_name,
          combinedTextForEntityCheck,
          projectBrandNames,
          theme.description,
          themeBrandRequirements.get(theme.id)
        );
        if (entityGate.reject) {
          if (entityGate.reason === "brand") themeTrace.rejectedBrandGate++;
          else if (entityGate.reason === "entity") themeTrace.rejectedEntityPhrase++;
          continue;
        }

        const dbPost = await prisma.post.findUnique({
          where: { id: targetPostId },
          select: { sentiment: true },
        });
        const storedSentiment = dbPost?.sentiment;
        const hasStoredSentiment = storedSentiment != null && String(storedSentiment).trim() !== "";
        // Themes-only runs often have no SENTIMENT step; treating null as NEUTRAL must NOT block
        // "frustration/complaint" themes — that produced 0 matches. Only enforce when we have real sentiment.
        const postSentiment = hasStoredSentiment ? normalizeSentiment(storedSentiment) : "NEUTRAL";
        if (
          hasStoredSentiment &&
          themeImpliesNegativeSentiment(theme.theme_name, theme.description)
        ) {
          if (postSentiment === "POSITIVE" || postSentiment === "NEUTRAL") {
            themeTrace.rejectedNegativeSentiment++;
            continue;
          }
        }

        let language =
          (targetPost as { language?: string }).language ||
          (safeContent ? detectLanguage(safeContent, 3) : null);
        const contentLen = safeContent?.length ?? 0;
        if (language && language !== "en" && contentLen < 80) {
          language = null;
        }

        const participantNameList = [
          ...new Set(
            [item.threadRoot.authorName, ...item.threadReplies.map((r) => r.authorName)]
              .filter(Boolean)
              .map((name) => sanitizeTextForDbStorage(name as string, 200))
              .filter((n): n is string => n != null)
          ),
        ];
        const participantNamesJson =
          participantNameList.length > 0 ? JSON.stringify(participantNameList) : null;

        const safeThemePostUrl = sanitizeTextForDbStorage(targetPost.url ?? null, 4000);
        const readUrlKeyRaw = safeThemePostUrl ? normalizeThemeReadUrl(safeThemePostUrl) : "";
        const readUrlKey = readUrlKeyRaw ? readUrlKeyRaw.replace(/\\/g, "") : undefined;

        const dataForThemeCreate: Prisma.ThemesAnalysisCreateInput = {
          id: generateUlid(),
          project: { connect: { id: projectId } },
          ...(orchestrationRunId != null && orchestrationRunId !== ""
            ? { orchestrationRun: { connect: { id: orchestrationRunId } } }
            : {}),
          theme_id: theme.id,
          theme_name: sanitizeTextForDbStorage(theme.theme_name ?? null, 400) ?? "—",
          post_id: targetPostId,
          platform: sanitizeTextForDbStorage(String(targetPost.platform), 64) || "unknown",
          post_content: safeContent,
          post_url: safeThemePostUrl ?? undefined,
          discord_channel: isDiscord
            ? sanitizeTextForDbStorage(targetPost.channelId ?? null, 256) ?? undefined
            : undefined,
          discord_server: sanitizeTextForDbStorage(rawDiscordServer ?? null, 200) ?? undefined,
          author_name: sanitizeTextForDbStorage(targetPost.authorName ?? null, 200) ?? undefined,
          author_id:
            sanitizeTextForDbStorage(
              targetPost.authorId != null ? String(targetPost.authorId) : null,
              200
            ) ?? undefined,
          participant_names: participantNamesJson ?? undefined,
          likes: targetPost.metricsLikes || 0,
          comments: targetPost.metricsComments || 0,
          shares: targetPost.metricsShares || 0,
          total_reactions:
            (targetPost.metricsLikes || 0) +
            (targetPost.metricsComments || 0) +
            (targetPost.metricsShares || 0),
          posted_at: targetPost.createdAt,
          analyzed_at: new Date(),
          relevance_score: themeMatch.relevance,
          sentiment: sanitizeTextForDbStorage(postSentiment, 64) ?? "NEUTRAL",
          language: language ? sanitizeTextForDbStorage(language, 32) ?? undefined : undefined,
          read_url_key: readUrlKey,
        };

        await prisma.themesAnalysis.create({
          data: dataForThemeCreate,
        });

        totalThemesMatched++;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          themeTrace.skippedDuplicate++;
          continue;
        }
        themeTrace.prismaErrors++;
        console.error(`[Analysis] Error creating theme match for post ${post.id}:`, error);
      }
    }
  };

  for (let waveStart = 0; waveStart < threadsReady.length; waveStart += THREAD_THEME_CONCURRENCY) {
    if (waveStart > 0) {
      await new Promise((r) => setTimeout(r, themeBatchDelayMs));
    }
    const wave = threadsReady.slice(waveStart, waveStart + THREAD_THEME_CONCURRENCY);
    const settled = await Promise.allSettled(
      wave.map((thread) => runThemeLlmForConversation(thread))
    );
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      const thread = wave[i];
      if (res.status === "rejected") {
        themeTrace.llmRejectedOrFailed++;
        console.error(
          `[Analysis] Theme conversation failed rootId=${thread.rootPost.id}:`,
          res.reason
        );
        markThreadPostsProcessed(thread);
      }
    }
    // Yield so GC can reclaim prompt/response buffers between waves (reduces heap pressure on long runs).
    await new Promise((r) => setTimeout(r, 0));
  }

  const maxProcessedPostId =
    processedPostIds.size > 0
      ? Math.max(...processedPostIds)
      : threads.length > 0
        ? Math.max(...threads.map((t) => getThreadMaxPostId(t)))
        : lastProcessedPostId;

  console.log(
    `[Analysis] ✅ Theme analysis complete: conversationsAnalyzed=${totalAnalyzed}, themesMatched=${totalThemesMatched}, maxPostId=${maxProcessedPostId}`
  );
  console.log(
    `[Themes:trace] summary project=${projectId} threadsReady=${threadsReady.length} analyzed=${totalAnalyzed} ` +
      `stored=${totalThemesMatched} rawLlmRows=${themeTrace.rawLlmThemeRows} ` +
      `badIdx=${themeTrace.badThemeIndex} below60=${themeTrace.belowRelevance60} ` +
      `brandGate=${themeTrace.rejectedBrandGate} entityPhrase=${themeTrace.rejectedEntityPhrase} ` +
      `negSentimentReject=${themeTrace.rejectedNegativeSentiment} ` +
      `dupSkip=${themeTrace.skippedDuplicate} prismaErr=${themeTrace.prismaErrors} llmFailed=${themeTrace.llmRejectedOrFailed} ` +
      `(set ANALYSIS_THEMES_TRACE=1 for per-thread LLM rows)`
  );

  return {
    /** Conversations (threads) that received a theme LLM pass; one shot per thread. */
    postsAnalyzed: totalAnalyzed,
    themesMatched: totalThemesMatched,
    maxProcessedPostId,
  };
}

async function runChatterAnalysisStep(
  projectId: string,
  lastProcessedPostId: number,
  upperBoundPostId: number,
  threadsPromise: Promise<ConversationThread[]>
): Promise<{ stored: number; maxProcessedPostId: number }> {
  if (upperBoundPostId <= lastProcessedPostId) {
    console.log(
      `[Analysis] Skipping chatter analysis: upperBound(${upperBoundPostId}) <= lastProcessed(${lastProcessedPostId})`
    );
    return { stored: 0, maxProcessedPostId: lastProcessedPostId };
  }

  // Count chatter records BEFORE storing new ones
  const beforeCount = await prisma.chatterAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
  });

  console.log(
    `[Analysis] Starting chatter analysis for project ${projectId}: lastProcessed=${lastProcessedPostId}, upperBound=${upperBoundPostId}, existing chatter records=${beforeCount}`
  );

  const threads = await threadsPromise;

  // Log platform distribution of threads for debugging
  const platformCounts = new Map<string, number>();
  threads.forEach((t) => {
    const platform = t.rootPost.platform.toLowerCase();
    platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);
  });
  if (platformCounts.size > 0) {
    const platforms = Array.from(platformCounts.entries())
      .map(([p, c]) => `${p}:${c}`)
      .join(", ");
    console.log(`[Analysis] Threads by platform (before filtering): ${platforms}`);
  }

  // Debug: Log Discord thread info before filtering
  const discordThreads = threads.filter((t) => t.rootPost.platform.toLowerCase() === "discord");
  if (discordThreads.length > 0) {
    console.log(`[Analysis] Found ${discordThreads.length} Discord threads before filtering:`);
    discordThreads.slice(0, 5).forEach((thread) => {
      const maxId = getThreadMaxPostId(thread);
      const inRange = maxId > lastProcessedPostId && maxId <= upperBoundPostId;
      console.log(
        `  - Discord thread: rootId=${thread.rootPost.id}, maxId=${maxId}, replies=${thread.replies.length}, participants=${thread.participants.size}, inRange=${inRange}`
      );
    });
  }

  const filteredThreads = filterThreadsByBounds(threads, lastProcessedPostId, upperBoundPostId);

  if (filteredThreads.length === 0) {
    console.log(
      `[Analysis] No threads in range (${lastProcessedPostId} < postId <= ${upperBoundPostId}) for chatter analysis`
    );
    console.log(
      `[Analysis] Total threads before filtering: ${threads.length} (Discord: ${discordThreads.length})`
    );
    return { stored: 0, maxProcessedPostId: lastProcessedPostId };
  }

  console.log(
    `[Analysis] Filtered ${filteredThreads.length} threads from ${threads.length} total (range: ${lastProcessedPostId} < postId <= ${upperBoundPostId})`
  );

  const discordInBatch = filteredThreads.filter((t) => isDiscordPlatform(t.rootPost.platform));
  if (discordInBatch.length > 0) {
    console.log(
      `[Analysis] [Chatter][Discord] ${discordInBatch.length} Discord root(s) in this chatter batch (post id bounds applied)`
    );
    discordInBatch.slice(0, 25).forEach((thread) => {
      const ch = thread.rootPost.channelId ?? "?";
      console.log(
        `[Analysis] [Chatter][Discord]   rootId=${thread.rootPost.id} channelId=${ch} replies=${thread.replies.length} participants=${thread.participants.size}`
      );
    });
    if (discordInBatch.length > 25) {
      console.log(
        `[Analysis] [Chatter][Discord]   … and ${discordInBatch.length - 25} more Discord root(s)`
      );
    }
  }

  const stored = await storeChatterAnalysis(projectId, filteredThreads);

  // Count chatter records AFTER storing
  const afterCount = await prisma.chatterAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
  });

  console.log(
    `[Analysis] ✅ Chatter analysis complete: stored=${stored}, before=${beforeCount}, after=${afterCount}, netAdded=${afterCount - beforeCount}`
  );

  if (stored !== afterCount - beforeCount) {
    console.warn(
      `[Analysis] ⚠️  WARNING: Stored count (${stored}) does not match net added (${afterCount - beforeCount}). Records may have been deleted or failed to save.`
    );
  }

  // CRITICAL: Use root post ID, not max reply ID, for counter tracking
  // Threads are identified by their root post, so we track which root posts we've processed
  // Using max reply ID would incorrectly skip threads with roots between the root ID and max reply ID
  const maxProcessedPostId =
    filteredThreads.length > 0
      ? filteredThreads.reduce(
          (max, thread) => Math.max(max, thread.rootPost.id),
          lastProcessedPostId
        )
      : lastProcessedPostId;

  return { stored, maxProcessedPostId };
}

async function runNetworkAnalysisStep(
  projectId: string,
  lastProcessedPostId: number,
  upperBoundPostId: number,
  threadsPromise: Promise<ConversationThread[]>
): Promise<{ peopleCount: number; maxProcessedPostId: number }> {
  if (upperBoundPostId <= lastProcessedPostId) {
    return { peopleCount: 0, maxProcessedPostId: lastProcessedPostId };
  }

  const threads = await threadsPromise;
  const filteredThreads = filterThreadsByBounds(threads, lastProcessedPostId, upperBoundPostId);

  if (filteredThreads.length === 0) {
    return { peopleCount: 0, maxProcessedPostId: lastProcessedPostId };
  }

  return analyzeNetwork(projectId, filteredThreads, {
    minPostIdExclusive: lastProcessedPostId,
    maxPostIdInclusive: upperBoundPostId,
  });
}

async function runNewsAnalysisStep(
  projectId: string,
  lastProcessedPostId: number,
  upperBoundPostId: number
): Promise<{ newsCount: number; maxProcessedPostId: number }> {
  if (upperBoundPostId <= lastProcessedPostId) {
    return { newsCount: 0, maxProcessedPostId: lastProcessedPostId };
  }

  return synthesizeNews(projectId, [], {
    minPostIdExclusive: lastProcessedPostId,
    maxPostIdInclusive: upperBoundPostId,
  });
}

async function runBrandAnalysisStep(
  projectId: string,
  lastProcessedPostId: number,
  upperBoundPostId: number
): Promise<{
  processed: number;
  brandMentions: number;
  errors: number;
  maxProcessedPostId: number;
}> {
  if (upperBoundPostId <= lastProcessedPostId) {
    return { processed: 0, brandMentions: 0, errors: 0, maxProcessedPostId: lastProcessedPostId };
  }

  return populateBrandAnalysis(projectId, {
    minPostIdExclusive: lastProcessedPostId,
    maxPostIdInclusive: upperBoundPostId,
  });
}

export async function resetAnalysisProgress(projectId: string) {
  await resetAnalysisProgressState(projectId);
}
