"use server";

import crypto from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";
import {
  getNormalizedPlatformFilter,
  isBlogPlatform,
  isFullSourceFilterSelection,
  recordPlatformMatches,
} from "@/lib/utils/platform";
import {
  discordChannelPairKey,
  extractDiscordChannelIdFromProjectProfileUrl,
} from "@/lib/discord-project-profile";
import { extractDiscordLabelsFromExtraJson } from "@/lib/discord-post-extra";
import { normalizeThemeReadUrl, themeDestinationKey } from "@/lib/theme-read-url";
import { applyThemesReadCascade } from "@/lib/themes-read-cascade";
import { revalidatePath } from "next/cache";
import { ulid as generateUlid } from "ulid";

/** One generated reply for a theme match (details view). */
export interface ThemeResponseEntry {
  objective_id: string;
  objective_name: string;
  relevance_score: number;
  reasoning: string;
  target_user: string;
  persona: string;
  response_text: string;
  /** LinkedIn private email; when set, this is the pipeline copy (subject is separate). */
  outreach_email_subject?: string | null;
  outreach_email_body?: string | null;
}

export type ThemeResponseGenerationFailure = {
  objective_id: string;
  objective_name: string;
  message: string;
};

export interface ThemeMatch {
  id: string;
  theme_id: string;
  theme_name: string;
  post_id: number;
  platform: string;
  post_content?: string | null;
  post_url?: string | null;
  link_url?: string | null; // Direct link for opening (Discord or native platforms)
  discord_channel?: string | null;
  discord_server?: string | null;
  discord_channel_id?: string | null;
  author_name?: string | null;
  author_id?: string | null;
  participant_names?: string[];
  likes: number;
  comments: number;
  shares: number;
  total_reactions: number;
  posted_at?: Date | null;
  relevance_score?: number | null;
  sentiment?: string | null;
  is_read: boolean;
  /** At least one stored ThemeItemResponse for this match */
  has_response?: boolean;
  response_entries?: ThemeResponseEntry[];
  /** Response pipeline failed after relevance passed (per objective); see stored JSON on ThemesAnalysis */
  response_generation_failures?: ThemeResponseGenerationFailure[];
  /** True when `response_generation_failures` is non-empty */
  has_response_generation_error?: boolean;
}

export interface ProjectThemeData {
  id: string;
  theme_name: string;
  description?: string | null;
  is_active: boolean;
  created_at: Date;
  matchCount?: number;
}

export type GetStoredThemesAnalysisOptions = {
  themeId?: string;
  platforms?: string[];
  minRelevance?: number;
  limit?: number;
  dateRange?: string;
  /** When set, filters `posted_at >= postedAfter` and takes precedence over `dateRange`. */
  postedAfter?: Date;
  language?: string;
};

function buildResponseGenerationFailures(
  raw: unknown,
  nameById: Map<string, string>
): ThemeResponseGenerationFailure[] | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: ThemeResponseGenerationFailure[] = [];
  for (const [id, msg] of Object.entries(raw)) {
    if (typeof msg !== "string" || !msg.trim()) continue;
    out.push({
      objective_id: id,
      objective_name: nameById.get(id) ?? id,
      message: msg.trim(),
    });
  }
  return out.length ? out : undefined;
}

/** When deduping thread rows, keep the union of per-objective generation errors. */
function mergeResponseGenerationFailures(
  a?: ThemeResponseGenerationFailure[],
  b?: ThemeResponseGenerationFailure[]
): ThemeResponseGenerationFailure[] | undefined {
  const map = new Map<string, ThemeResponseGenerationFailure>();
  for (const e of a ?? []) map.set(e.objective_id, e);
  for (const e of b ?? []) map.set(e.objective_id, e);
  const out = [...map.values()];
  return out.length ? out : undefined;
}

/**
 * Core themes analysis for a project owner (used by session UI and signed export routes).
 */
export async function getStoredThemesAnalysisForUser(
  projectId: string,
  userId: string,
  options: GetStoredThemesAnalysisOptions = {}
): Promise<{
  success: boolean;
  matches?: ThemeMatch[];
  /** Per-theme match counts for current filters (sources, date, language); only set when matches are returned */
  themeCounts?: Record<string, number>;
  /** Total match count for current filters; only set when matches are returned */
  totalMatches?: number;
  error?: string;
}> {
  try {
    // Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: userId,
        deleted_at: null,
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Build query (never filter by themeId here so we can compute themeCounts for the dropdown)
    const where: any = {
      project_id: projectId,
      deleted_at: null,
    };

    if (options.platforms && options.platforms.length > 0) {
      // CRITICAL: SQLite is case-sensitive by default, so we need to filter in-memory after query
      // Query all records and filter by normalized platform name
      // Normalize platform names to lowercase for case-insensitive comparison
      // const normalizedPlatforms = options.platforms.map((p) => p.toLowerCase());
      // where.platform = { in: normalizedPlatforms }; // Can't use this - case mismatch
    }

    if (options.minRelevance) {
      where.relevance_score = { gte: options.minRelevance };
    }

    // Apply date range filter to posted_at
    if (options.postedAfter) {
      where.posted_at = { gte: options.postedAfter };
    } else if (options.dateRange && options.dateRange !== "all") {
      const dateFilter = getDateRangeFilter(options.dateRange);
      if (dateFilter) {
        where.posted_at = dateFilter;
      }
    }

    // Get stored themes analysis
    const themesRecords = await prisma.themesAnalysis.findMany({
      where,
      orderBy: [{ relevance_score: "desc" }, { posted_at: "desc" }],
      // Don't limit here - let filtering happen first, then limit at the end
    });

    // DEBUG: Log query results and platform breakdown (to diagnose "only blogs" when all sources selected)
    const totalCount = await prisma.themesAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    });
    const byPlatform: Record<string, number> = {};
    for (const r of themesRecords) {
      const key = (r.platform || "null").toLowerCase();
      byPlatform[key] = (byPlatform[key] ?? 0) + 1;
    }
    console.log(
      `[ThemesAnalysis] Query for project ${projectId}: found ${themesRecords.length} records (total in DB: ${totalCount}), filters: themeId=${options.themeId || "all"}, platforms=${JSON.stringify(options.platforms ?? [])}, minRelevance=${options.minRelevance || "none"}, dateRange=${options.dateRange || "all"}, byPlatform=${JSON.stringify(byPlatform)}`
    );

    // Apply platform filter in-memory (shared util handles blog/blogs and x/twitter equivalence).
    // When user has selected all sources (ProjectAnalysisTabs default), skip platform filter so
    // every theme record is shown regardless of stored platform value (avoids excluding e.g. "twitter" vs "x").
    let filteredRecords = themesRecords;
    if (options.platforms && options.platforms.length === 0) {
      filteredRecords = [];
    }
    const selectedAllSources = isFullSourceFilterSelection(options.platforms);
    if (options.platforms && options.platforms.length > 0 && !selectedAllSources) {
      const allowedPlatforms = getNormalizedPlatformFilter(options.platforms);
      filteredRecords = filteredRecords.filter((record) =>
        recordPlatformMatches(record.platform, allowedPlatforms)
      );
      console.log(
        `[ThemesAnalysis] After platform filter: ${filteredRecords.length} records (allowed: ${[...allowedPlatforms].sort().join(", ")})`
      );
    } else if (selectedAllSources) {
      console.log(
        `[ThemesAnalysis] All sources selected: skipping platform filter, showing all ${filteredRecords.length} records`
      );
    }

    // Apply language filter. When "English" is selected: show records that are "en" or
    // unknown (null, empty, "und", "eng", or any value not in known non-English codes).
    // We only exclude when language is a clear other-language code so the count doesn't
    // drop for English content stored with missing/odd language values.
    if (options.language && options.language !== "all") {
      const lang = options.language;
      const knownNonEnglish = new Set([
        "es",
        "spa",
        "fr",
        "fra",
        "de",
        "deu",
        "it",
        "ita",
        "pt",
        "por",
        "ru",
        "rus",
        "ja",
        "jpn",
        "ko",
        "kor",
        "zh",
        "cmn",
        "ar",
        "ara",
        "hi",
        "hin",
        "nl",
        "nld",
        "pl",
        "pol",
        "tr",
        "tur",
        "vi",
        "vie",
        "th",
        "tha",
        "sv",
        "swe",
        "da",
        "dan",
        "fi",
        "fin",
        // "no"/"nor" omitted: sometimes stored for "no language" so we include when filtering English
      ]);
      filteredRecords = filteredRecords.filter((record) => {
        const val = record.language;
        if (val == null) return true;
        const s = String(val).trim().toLowerCase();
        if (s === "" || s === lang) return true;
        if (lang === "en" && (s === "eng" || s === "und")) return true;
        if (knownNonEnglish.has(s)) return false;
        return true; // unknown/legacy: include
      });
    }

    // Get Discord profile mapping for channel names
    // Note: ProjectProfile stores channel ID in the 'url' field, NOT the name field
    const discordProfiles = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        platform: "discord",
        deleted_at: null,
      },
      select: {
        name: true, // This is the friendly channel name
        url: true, // This contains the full Discord channel URL
      },
    });

    const channelNameMap = new Map<string, { name: string; url: string }>();
    /** Labels keyed by `guildId/channelId` from discord.com URLs — matches post permalinks even when snowflake-only lookups fail. */
    const channelPairLabelMap = new Map<string, { name: string; url: string }>();
    for (const profile of discordProfiles) {
      const url = profile.url || "";
      const channelId = extractDiscordChannelIdFromProjectProfileUrl(url);
      if (channelId) {
        channelNameMap.set(String(channelId).trim(), { name: profile.name, url });
      }
      const label = profile.name?.trim();
      const pairKey = discordChannelPairKey(url);
      if (pairKey && label) {
        channelPairLabelMap.set(pairKey, { name: label, url });
      }
    }

    // Same Discord URLs as the scraper: Brand Related Sources (DISCORD) often hold the label; profiles alone may miss it.
    const discordRowsFromBrandSources = await prisma.projectBrandSource.findMany({
      where: {
        project_id: projectId,
        link_type: "DISCORD",
        deleted_at: null,
      },
      select: {
        url: true,
        channel_name: true,
        brand: { select: { brand_name: true } },
      },
    });
    for (const row of discordRowsFromBrandSources) {
      const chId = extractDiscordChannelIdFromProjectProfileUrl(row.url || "");
      if (!chId) continue;
      const key = String(chId).trim();
      const label = row.channel_name?.trim() || row.brand?.brand_name?.trim();
      if (!label) continue;
      if (!channelNameMap.has(key)) {
        channelNameMap.set(key, { name: label, url: row.url });
      }
      const pk = discordChannelPairKey(row.url || "");
      if (pk && !channelPairLabelMap.has(pk)) {
        channelPairLabelMap.set(pk, { name: label, url: row.url });
      }
    }

    const discordThemePostIds = [
      ...new Set(
        filteredRecords.filter((r) => r.platform.toLowerCase() === "discord").map((r) => r.post_id)
      ),
    ];
    const discordPostMetaById = new Map<
      number,
      { extraJson: unknown; channelId: string | null; url: string | null }
    >();
    if (discordThemePostIds.length > 0) {
      const discordPostRows = await prisma.post.findMany({
        where: { project_id: projectId, id: { in: discordThemePostIds } },
        select: { id: true, extraJson: true, channelId: true, url: true },
      });
      for (const row of discordPostRows) {
        discordPostMetaById.set(row.id, {
          extraJson: row.extraJson,
          channelId: row.channelId,
          url: row.url,
        });
      }
    }

    // Resolve blog name for theme rows with platform=blog: from Brand.blog_news_url and from ProjectBrandSource (BLOG)
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
        const name = pb.brand?.brand_name ?? pb.brand_name ?? "Blog";
        blogBaseToName.push({ baseUrl, name });
      } catch {
        // skip invalid URL
      }
    }

    // Discord channel labels from Brand.discord_url (project-linked brands)
    for (const pb of projectBrandsWithBlog) {
      const dUrl = pb.brand?.discord_url?.trim();
      if (!dUrl || !dUrl.toLowerCase().includes("discord")) continue;
      const chId = extractDiscordChannelIdFromProjectProfileUrl(dUrl);
      if (!chId) continue;
      const key = String(chId).trim();
      const label = pb.brand?.brand_name?.trim();
      if (!label) continue;
      if (!channelNameMap.has(key)) {
        channelNameMap.set(key, { name: label, url: dUrl });
      }
      const pk = discordChannelPairKey(dUrl);
      if (pk && !channelPairLabelMap.has(pk)) {
        channelPairLabelMap.set(pk, { name: label, url: dUrl });
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
        const name = (src.channel_name?.trim() || src.brand?.brand_name || "Blog").trim() || "Blog";
        blogBaseToName.push({ baseUrl, name });
      } catch {
        // skip invalid URL
      }
    }

    // Brand-level BLOG links (BrandAdditionalLink) for brands linked to this project
    const brandIds = projectBrandsWithBlog
      .map((pb) => pb.brand_id)
      .filter((id): id is string => id != null);
    if (brandIds.length > 0) {
      const brandBlogLinks = await prisma.brandAdditionalLink.findMany({
        where: {
          brand_id: { in: brandIds },
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
          const name =
            (link.channel_name?.trim() || link.brand?.brand_name || "Blog").trim() || "Blog";
          blogBaseToName.push({ baseUrl, name });
        } catch {
          // skip invalid URL
        }
      }

      const brandDiscordLinks = await prisma.brandAdditionalLink.findMany({
        where: {
          brand_id: { in: brandIds },
          deleted_at: null,
          link_type: "DISCORD",
        },
        select: {
          url: true,
          channel_name: true,
          brand: { select: { brand_name: true } },
        },
      });
      for (const row of brandDiscordLinks) {
        const chId = extractDiscordChannelIdFromProjectProfileUrl(row.url || "");
        if (!chId) continue;
        const key = String(chId).trim();
        const label = row.channel_name?.trim() || row.brand?.brand_name?.trim();
        if (!label) continue;
        if (!channelNameMap.has(key)) {
          channelNameMap.set(key, { name: label, url: row.url });
        }
        const pk = discordChannelPairKey(row.url || "");
        if (pk && !channelPairLabelMap.has(pk)) {
          channelPairLabelMap.set(pk, { name: label, url: row.url });
        }
      }
    }

    function resolveBlogAuthorName(postUrl: string | null): string | null {
      const u = (postUrl || "").trim().toLowerCase().replace(/\/+$/, "");
      if (!u) return null;
      for (const { baseUrl, name } of blogBaseToName) {
        const base = baseUrl.replace(/\/+$/, "");
        if (u === base || u.startsWith(base + "/") || u.startsWith(base + "?")) {
          return name;
        }
      }
      return null;
    }

    /** Fallback when no configured blog matches: derive a short label from the article URL (e.g. hostname). */
    function blogAuthorNameFromUrl(postUrl: string | null): string | null {
      const u = (postUrl || "").trim();
      if (!u) return null;
      try {
        const parsed = new URL(u);
        const host = parsed.hostname || "";
        if (!host) return null;
        // Strip www. for cleaner display
        const display = host.replace(/^www\./i, "");
        return display || null;
      } catch {
        return null;
      }
    }

    // Build a map of post_id -> root_post_id for deduplication
    // CRITICAL: Query ALL posts for the project/platform, not just theme matches
    // This is necessary because parent posts might not be in theme matches,
    // but we need them to correctly identify root posts for replies
    const platforms = [...new Set(filteredRecords.map((r) => r.platform.toLowerCase()))];

    // Query all posts for these platforms in this project to build complete thread relationships
    // Note: We query all platforms and filter in-memory to handle case sensitivity issues
    const allProjectPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
      },
      select: {
        id: true,
        postId: true,
        threadRefId: true,
        platform: true,
        url: true,
        createdAt: true,
      },
    });

    // Filter by platform (case-insensitive)
    const posts = allProjectPosts.filter((p) => platforms.includes(p.platform.toLowerCase()));

    // Build maps for efficient lookup
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const postIdMap = new Map(posts.map((p) => [p.postId, p]));

    /**
     * Find the root post ID for a given post by traversing up the threadRefId chain.
     * This works for ALL platforms (Facebook, LinkedIn, X/Twitter, Reddit, Discord).
     *
     * Platform-agnostic logic:
     * - Traverses up threadRefId chain until finding a post with no threadRefId (root)
     * - Works for all platforms that use threadRefId to link replies to parents
     *
     * Platform-specific enhancements:
     * - Facebook: Also checks story_fbid in URLs (Facebook comments sometimes reference
     *   story_fbid instead of postId in threadRefId)
     */
    const findRootPostId = (postId: number): number => {
      const post = postMap.get(postId);
      if (!post || !post.threadRefId) {
        return postId; // Already root or not found
      }

      // Platform-specific enhancement: Facebook story_fbid matching
      // This is additive - if it doesn't find a match, falls back to generic traversal
      if (post.platform.toLowerCase() === "facebook" && post.threadRefId) {
        // Check if any root post (no threadRefId) has this story_fbid in its URL
        for (const rootPost of posts.filter(
          (p) => !p.threadRefId && p.platform === post.platform
        )) {
          if (rootPost.url) {
            const storyFbidMatch = rootPost.url.match(/story_fbid=([^&]+)/);
            if (storyFbidMatch && storyFbidMatch[1] === post.threadRefId) {
              return rootPost.id;
            }
          }
        }

        // Also check if any post with this story_fbid in URL is a root (no threadRefId)
        for (const candidatePost of posts.filter(
          (p) => p.platform === post.platform && p.url && !p.threadRefId
        )) {
          if (candidatePost.url && candidatePost.url.includes(post.threadRefId)) {
            return candidatePost.id;
          }
        }
      }

      // GENERIC TRAVERSAL LOGIC - Works for ALL platforms
      // Traverse up the threadRefId chain until we find the root (no threadRefId)
      let currentRefId: string | null | undefined = post.threadRefId;
      const visited = new Set<string>();
      let depth = 0;
      const MAX_DEPTH = 50; // Prevent infinite loops from malformed data

      while (currentRefId && depth < MAX_DEPTH) {
        // Prevent cycles
        if (visited.has(currentRefId)) break;
        visited.add(currentRefId);

        // Look up parent post by its postId (platform-specific ID)
        const parentPost = postIdMap.get(currentRefId);
        if (!parentPost) {
          // Parent not found by postId
          // For Facebook: might be a story_fbid reference, check URLs
          if (post.platform.toLowerCase() === "facebook") {
            for (const rootPost of posts.filter(
              (p) => !p.threadRefId && p.platform === post.platform
            )) {
              if (rootPost.url && rootPost.url.includes(currentRefId)) {
                return rootPost.id;
              }
            }
          }
          // For other platforms or if Facebook check fails: treat as root
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

      // Fallback: return original post ID if traversal failed
      return postId;
    };

    // Build root post ID map
    const rootPostIdMap = new Map<number, number>();
    for (const record of filteredRecords) {
      if (!rootPostIdMap.has(record.post_id)) {
        rootPostIdMap.set(record.post_id, findRootPostId(record.post_id));
      }
    }

    // Date filter on thread root publish time (not ThemesAnalysis.posted_at alone).
    // Fixes YouTube (and similar): a comment ingested yesterday can set posted_at to "recent" while the
    // video root is older — "Last 1 day" should follow when the story (root) was published.
    const threadDateCutoff =
      options.postedAfter ??
      (options.dateRange && options.dateRange !== "all"
        ? getDateRangeFilter(options.dateRange)?.gte
        : undefined) ??
      null;

    if (threadDateCutoff) {
      filteredRecords = filteredRecords.filter((record) => {
        const rootId = rootPostIdMap.get(record.post_id) ?? record.post_id;
        const rootPost = postMap.get(rootId);
        if (!rootPost) return false;
        return rootPost.createdAt >= threadDateCutoff;
      });
    }

    // Resolve blog article URLs when theme record has no post_url (Post.url often null for blog pipeline)
    const blogPostIdsNeedingUrl = [
      ...new Set(
        filteredRecords
          .filter((r) => isBlogPlatform(r.platform) && !r.post_url)
          .map((r) => r.post_id)
      ),
    ];
    let blogArticleUrlByHashPrefix: Map<string, string> | null = null;
    let blogUrlByContent: Map<string, string> | null = null;
    const blogPostById = new Map<
      number,
      { id: number; url: string | null; postId: string; content: string | null }
    >();
    if (blogPostIdsNeedingUrl.length > 0) {
      const [blogPostsForUrl, analyses] = await Promise.all([
        prisma.post.findMany({
          where: { id: { in: blogPostIdsNeedingUrl } },
          select: { id: true, url: true, postId: true, content: true },
        }),
        prisma.blogNewsAnalysis.findMany({
          where: { project_id: projectId, deleted_at: null },
          select: {
            article_url: true,
            source_url: true,
            idea_1: true,
            idea_2: true,
            idea_3: true,
            idea_4: true,
            idea_5: true,
            idea_6: true,
            idea_7: true,
          },
        }),
      ]);
      for (const p of blogPostsForUrl) {
        blogPostById.set(p.id, {
          id: p.id,
          url: p.url,
          postId: p.postId,
          content: p.content,
        });
      }
      const map = new Map<string, string>();
      const byContent = new Map<string, string>();
      for (const a of analyses) {
        const u = (a.article_url ?? a.source_url ?? "").trim();
        if (u) {
          const hashPrefix = crypto.createHash("sha256").update(u).digest("hex").slice(0, 24);
          map.set(hashPrefix, u);
        }
        const urlForRow = u || (a.article_url ?? a.source_url ?? "").trim();
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
      blogArticleUrlByHashPrefix = map.size > 0 ? map : null;
      blogUrlByContent = byContent.size > 0 ? byContent : null;
    }

    // Group theme matches by (theme_id, root_post_id) and keep only one per group
    // Prefer root post entries, or highest relevance if no root post entry exists
    const themeThreadMap = new Map<string, ThemeMatch>();

    const responseObjectiveRows = await prisma.responseObjective.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });
    const responseObjectiveNameById = new Map(responseObjectiveRows.map((o) => [o.id, o.name]));

    // First pass: collect all matches with their root post IDs
    const matchesWithRoot: Array<{ match: ThemeMatch; rootPostId: number; isRoot: boolean }> = [];
    const readUrlKeyUpdates: { id: string; read_url_key: string }[] = [];

    for (const record of filteredRecords) {
      const rootPostId = rootPostIdMap.get(record.post_id) || record.post_id;
      const isRoot = rootPostId === record.post_id;

      let participantNames: string[] = [];
      try {
        const rawValue = record.participant_names;
        if (typeof rawValue === "string" && rawValue.trim() !== "") {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) {
            participantNames = parsed;
          }
        }
      } catch {
        // Silently handle parse errors
      }

      // Map Discord channel ID to friendly name (ProjectProfile or scraper extraJson) and build link URL
      let discordChannel = record.discord_channel;
      let discordServer = record.discord_server;
      let linkUrl: string | null = null;
      const discordChannelId: string | null = record.discord_channel;
      if (record.platform.toLowerCase() === "discord") {
        const meta = discordPostMetaById.get(record.post_id);
        const fromScrape = extractDiscordLabelsFromExtraJson(meta?.extraJson);

        const postUrlForPair =
          meta?.url?.trim() || postMap.get(record.post_id)?.url?.trim() || record.post_url?.trim();

        let mapped: { name: string; url: string } | undefined;
        if (postUrlForPair) {
          const pairKey = discordChannelPairKey(postUrlForPair);
          if (pairKey) {
            mapped = channelPairLabelMap.get(pairKey);
          }
        }

        if (!mapped) {
          const channelKeys = new Set<string>();
          if (record.discord_channel) channelKeys.add(String(record.discord_channel).trim());
          if (meta?.channelId) channelKeys.add(String(meta.channelId).trim());
          const urlForId = meta?.url?.trim() || postMap.get(record.post_id)?.url?.trim();
          if (urlForId) {
            const fromUrl = extractDiscordChannelIdFromProjectProfileUrl(urlForId);
            if (fromUrl) channelKeys.add(String(fromUrl).trim());
          }

          for (const k of channelKeys) {
            if (!k) continue;
            const m = channelNameMap.get(k);
            if (m) {
              mapped = m;
              break;
            }
          }
        }

        if (mapped) {
          discordChannel = mapped.name;
          linkUrl = mapped.url;
        } else if (fromScrape.channelName?.trim()) {
          discordChannel = fromScrape.channelName.trim();
        } else if (discordProfiles.length === 1) {
          const sole = discordProfiles[0];
          const soleName = sole.name?.trim();
          if (soleName) {
            discordChannel = soleName;
            linkUrl = sole.url || linkUrl;
          }
        }

        if (!discordServer?.trim() && fromScrape.guildName?.trim()) {
          discordServer = fromScrape.guildName.trim();
        }

        if (!linkUrl?.trim()) {
          linkUrl = fromScrape.messageUrl?.trim() || record.post_url || null;
        }
        if (!linkUrl?.trim()) {
          const u = meta?.url?.trim();
          if (u) linkUrl = u;
        }
        if (!linkUrl?.trim()) {
          const pg = postMap.get(record.post_id);
          const u = pg?.url?.trim();
          if (u) linkUrl = u;
        }
      } else {
        linkUrl = record.post_url || null;
        // Fallback: Post row often has url when ThemesAnalysis.post_url was not backfilled (e.g. YouTube, HN)
        if (!linkUrl?.trim()) {
          const pg = postMap.get(record.post_id);
          const u = pg?.url?.trim();
          if (u) linkUrl = u;
        }
        // Resolve blog article URL when stored post_url is null (blog pipeline often leaves Post.url null)
        if (
          !linkUrl &&
          isBlogPlatform(record.platform) &&
          (blogArticleUrlByHashPrefix || blogUrlByContent)
        ) {
          const post = blogPostById.get(record.post_id);
          if (post) {
            if (post.url) {
              linkUrl = post.url;
            } else if (post.postId && blogArticleUrlByHashPrefix) {
              const prefix = String(post.postId).split("--idea-")[0]?.trim();
              if (prefix) linkUrl = blogArticleUrlByHashPrefix.get(prefix) ?? null;
            }
            if (!linkUrl && post.content && blogUrlByContent) {
              const contentKey = post.content.trim().slice(0, 400);
              if (contentKey) linkUrl = blogUrlByContent.get(contentKey) ?? null;
            }
          }
        }
      }

      // For blog platform: show publication name (not article title). Stored author_name is often wrong (e.g. title).
      let authorName = record.author_name;
      const urlForAuthor = linkUrl ?? record.post_url;
      if (isBlogPlatform(record.platform)) {
        const publicationName =
          resolveBlogAuthorName(urlForAuthor) || blogAuthorNameFromUrl(urlForAuthor);
        if (publicationName) authorName = publicationName;
      }

      const computedReadKey = themeDestinationKey(linkUrl, record.post_url);
      if (computedReadKey && computedReadKey !== (record.read_url_key ?? null)) {
        readUrlKeyUpdates.push({ id: record.id, read_url_key: computedReadKey });
      }

      const responseGenerationFailures = buildResponseGenerationFailures(
        record.response_generation_errors,
        responseObjectiveNameById
      );

      const match: ThemeMatch = {
        id: record.id,
        theme_id: record.theme_id,
        theme_name: record.theme_name,
        post_id: record.post_id,
        platform: record.platform.toLowerCase(),
        post_content: record.post_content,
        post_url: record.post_url ?? linkUrl,
        link_url: linkUrl,
        discord_channel: discordChannel,
        discord_server: discordServer,
        discord_channel_id: discordChannelId,
        author_name: authorName,
        author_id: record.author_id,
        participant_names: participantNames,
        likes: record.likes,
        comments: record.comments,
        shares: record.shares,
        total_reactions: record.total_reactions,
        posted_at: record.posted_at,
        relevance_score: record.relevance_score,
        sentiment: record.sentiment,
        is_read: record.is_read,
        response_generation_failures: responseGenerationFailures,
        has_response_generation_error: (responseGenerationFailures?.length ?? 0) > 0,
      };

      matchesWithRoot.push({ match, rootPostId, isRoot });
    }

    if (readUrlKeyUpdates.length > 0) {
      await prisma.$transaction(
        readUrlKeyUpdates.map(({ id, read_url_key }) =>
          prisma.themesAnalysis.update({
            where: { id },
            data: { read_url_key },
          })
        )
      );
    }

    // Second pass: deduplicate by (theme_id, root_post_id) for social; for blog keep each row (one per story).
    for (const { match, rootPostId, isRoot } of matchesWithRoot) {
      const isBlog = isBlogPlatform(match.platform);
      const key = isBlog ? `${match.theme_id}:blog:${match.id}` : `${match.theme_id}:${rootPostId}`;
      const existing = themeThreadMap.get(key);

      if (!existing) {
        themeThreadMap.set(key, match);
      } else if (!isBlog) {
        // Social: prefer root post entries, else higher relevance
        const existingRootPostId = rootPostIdMap.get(existing.post_id);
        const existingIsRoot =
          existingRootPostId === undefined || existingRootPostId === existing.post_id;
        const shouldReplace =
          (isRoot && !existingIsRoot) ||
          (isRoot === existingIsRoot &&
            (match.relevance_score || 0) > (existing.relevance_score || 0));
        if (shouldReplace) {
          const mergedFailures = mergeResponseGenerationFailures(
            match.response_generation_failures,
            existing.response_generation_failures
          );
          themeThreadMap.set(key, {
            ...match,
            is_read: match.is_read || existing.is_read,
            response_generation_failures: mergedFailures,
            has_response_generation_error: (mergedFailures?.length ?? 0) > 0,
          });
        } else {
          const mergedFailures = mergeResponseGenerationFailures(
            existing.response_generation_failures,
            match.response_generation_failures
          );
          themeThreadMap.set(key, {
            ...existing,
            is_read: existing.is_read || match.is_read,
            response_generation_failures: mergedFailures,
            has_response_generation_error: (mergedFailures?.length ?? 0) > 0,
          });
        }
      }
    }

    let matches = Array.from(themeThreadMap.values());

    const matchIds = matches.map((m) => m.id);
    if (matchIds.length > 0) {
      const responseRows = await prisma.themeItemResponse.findMany({
        where: {
          themes_analysis_id: { in: matchIds },
          deleted_at: null,
        },
        include: {
          responseObjective: {
            select: { id: true, name: true, deleted_at: true },
          },
        },
      });
      const byThemeId = new Map<string, ThemeResponseEntry[]>();
      for (const r of responseRows) {
        if (r.responseObjective.deleted_at) continue;
        const entry: ThemeResponseEntry = {
          objective_id: r.response_objective_id,
          objective_name: r.responseObjective.name,
          relevance_score: r.relevance_score,
          reasoning: r.reasoning,
          target_user: r.target_user,
          persona: r.persona,
          response_text: r.response_text,
          outreach_email_subject: r.outreach_email_subject,
          outreach_email_body: r.outreach_email_body,
        };
        const list = byThemeId.get(r.themes_analysis_id) ?? [];
        list.push(entry);
        byThemeId.set(r.themes_analysis_id, list);
      }
      matches = matches.map((m) => {
        const entries = byThemeId.get(m.id);
        return {
          ...m,
          has_response: (entries?.length ?? 0) > 0,
          response_entries: entries ?? [],
        };
      });
    }

    // Counts for "Filter by Theme" dropdown (respect current filters: sources, date, language)
    const themeCounts: Record<string, number> = {};
    for (const m of matches) {
      themeCounts[m.theme_id] = (themeCounts[m.theme_id] ?? 0) + 1;
    }
    const totalMatches = matches.length;

    // If a specific theme was requested, return only that theme's matches
    if (options.themeId) {
      matches = matches.filter((m) => m.theme_id === options.themeId);
    }

    console.log(
      `[ThemesAnalysis] Deduplication: ${filteredRecords.length} records -> ${totalMatches} unique threads (removed ${filteredRecords.length - totalMatches} duplicates)`
    );

    return {
      success: true,
      matches,
      themeCounts,
      totalMatches,
    };
  } catch (error) {
    console.error("Error getting stored themes analysis:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Set read/unread for a theme match and all rows sharing the same normalized open URL.
 */
export async function setThemesAnalysisReadState(
  projectId: string,
  matchId: string,
  read: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });
    if (!project) {
      return { success: false, error: "Project not found" };
    }
    const record = await prisma.themesAnalysis.findFirst({
      where: {
        id: matchId,
        project_id: projectId,
        deleted_at: null,
      },
    });
    if (!record) {
      return { success: false, error: "Not found" };
    }
    const key =
      (record.read_url_key && record.read_url_key.trim()) ||
      (record.post_url && normalizeThemeReadUrl(record.post_url.trim())) ||
      null;
    await applyThemesReadCascade(projectId, {
      read,
      readUrlKey: key && key.length > 0 ? key : null,
      fallbackMatchId: matchId,
    });
    revalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (e) {
    console.error("setThemesAnalysisReadState", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Get stored themes analysis for a project (session-authenticated).
 */
export async function getStoredThemesAnalysis(
  projectId: string,
  options: GetStoredThemesAnalysisOptions = {}
): Promise<{
  success: boolean;
  matches?: ThemeMatch[];
  themeCounts?: Record<string, number>;
  totalMatches?: number;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }
  return getStoredThemesAnalysisForUser(projectId, session.user.id, options);
}

/**
 * Get project themes (user-defined themes to track)
 */
export async function getProjectThemes(projectId: string): Promise<{
  success: boolean;
  themes?: ProjectThemeData[];
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Get themes with match counts
    const themes = await prisma.projectTheme.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      orderBy: { created_at: "desc" },
    });

    // Get match counts for each theme
    const themesWithCounts: ProjectThemeData[] = await Promise.all(
      themes.map(async (theme) => {
        const matchCount = await prisma.themesAnalysis.count({
          where: {
            theme_id: theme.id,
            deleted_at: null,
          },
        });

        return {
          id: theme.id,
          theme_name: theme.theme_name,
          description: theme.description,
          is_active: theme.is_active,
          created_at: theme.created_at,
          matchCount: matchCount ?? 0, // Ensure it's always a number, default to 0
        };
      })
    );

    return { success: true, themes: themesWithCounts };
  } catch (error) {
    console.error("Error getting project themes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a new project theme
 */
export async function createProjectTheme(
  projectId: string,
  theme: {
    theme_name: string;
    description?: string;
  }
): Promise<{
  success: boolean;
  themeId?: string;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Create the theme
    const newTheme = await prisma.projectTheme.create({
      data: {
        id: generateUlid(),
        project_id: projectId,
        theme_name: theme.theme_name,
        description: theme.description,
        is_active: true,
      },
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true, themeId: newTheme.id };
  } catch (error) {
    console.error("Error creating project theme:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update a project theme
 */
export async function updateProjectTheme(
  projectId: string,
  themeId: string,
  updates: {
    theme_name?: string;
    description?: string | null;
    is_active?: boolean;
  }
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Verify project belongs to user and theme exists
    const theme = await prisma.projectTheme.findFirst({
      where: {
        id: themeId,
        project_id: projectId,
        deleted_at: null,
      },
      include: {
        project: {
          select: {
            user_id: true,
          },
        },
      },
    });

    if (!theme || theme.project.user_id !== session.user.id) {
      return { success: false, error: "Theme not found" };
    }

    // Update the theme
    await prisma.projectTheme.update({
      where: { id: themeId },
      data: updates,
    });

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  } catch (error) {
    console.error("Error updating project theme:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a project theme (soft delete)
 */
export async function deleteProjectTheme(
  projectId: string,
  themeId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Verify project belongs to user and theme exists
    const theme = await prisma.projectTheme.findFirst({
      where: {
        id: themeId,
        project_id: projectId,
        deleted_at: null,
      },
      include: {
        project: {
          select: {
            user_id: true,
          },
        },
      },
    });

    if (!theme || theme.project.user_id !== session.user.id) {
      return { success: false, error: "Theme not found" };
    }

    // Soft delete the theme and all associated ThemesAnalysis records
    await prisma.$transaction(async (tx) => {
      // Soft delete the theme
      await tx.projectTheme.update({
        where: { id: themeId },
        data: { deleted_at: new Date() },
      });

      // Soft delete all ThemesAnalysis records associated with this theme
      const deletedCount = await tx.themesAnalysis.updateMany({
        where: {
          theme_id: themeId,
          project_id: projectId,
          deleted_at: null, // Only delete records that aren't already deleted
        },
        data: { deleted_at: new Date() },
      });

      console.log(
        `[deleteProjectTheme] Soft deleted theme ${themeId} and ${deletedCount.count} associated ThemesAnalysis records`
      );
    });

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  } catch (error) {
    console.error("Error deleting project theme:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
