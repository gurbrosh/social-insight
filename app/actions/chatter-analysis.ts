"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";
import { extractDiscordChannelIdFromProjectProfileUrl } from "@/lib/discord-project-profile";
import {
  getNormalizedPlatformFilter,
  isFullSourceFilterSelection,
  recordPlatformMatches,
} from "@/lib/utils/platform";

export interface ChatterConversation {
  id: string;
  discussion_title: string;
  topic_category?: string | null;
  summary?: string | null;
  key_points?: string[];
  sentiment?: string | null;
  platforms?: string[];
  participant_count: number;
  participant_names?: string[];
  discord_channel?: string | null;
  discord_server?: string | null;
  link_url?: string | null;
  total_messages: number;
  total_engagement: number;
  first_post_at?: Date | null;
  last_post_at?: Date | null;
  importance_score?: number | null;
  analyzed_at?: Date | null;
}

export type GetStoredChatterAnalysisOptions = {
  limit?: number;
  minImportance?: number;
  platforms?: string[];
  dateRange?: string;
  /** When set, filters `last_post_at >= lastPostAfter` and takes precedence over `dateRange`. */
  lastPostAfter?: Date;
  language?: string;
};

/**
 * Stored chatter analysis for a project owner (UI + signed exports).
 */
export async function getStoredChatterAnalysisForUser(
  projectId: string,
  userId: string,
  options: GetStoredChatterAnalysisOptions = {}
): Promise<{
  success: boolean;
  conversations?: ChatterConversation[];
  error?: string;
}> {
  try {
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

    // Build query
    const where: any = {
      project_id: projectId,
      deleted_at: null,
    };

    if (options.minImportance) {
      where.importance_score = { gte: options.minImportance };
    }

    // Apply date range filter to last_post_at (conversation activity)
    if (options.lastPostAfter) {
      where.last_post_at = { gte: options.lastPostAfter };
    } else if (options.dateRange && options.dateRange !== "all") {
      const dateFilter = getDateRangeFilter(options.dateRange);
      if (dateFilter) {
        where.last_post_at = dateFilter;
      }
    }

    // Apply language filter (handle gracefully if column doesn't exist)
    if (options.language && options.language !== "all") {
      where.language = options.language;
    }

    // Get stored chatter analysis
    let chatterRecords: any[] = [];
    try {
      chatterRecords = await prisma.chatterAnalysis.findMany({
        where,
        orderBy: [{ importance_score: "desc" }, { total_engagement: "desc" }],
        take: options.limit || 50,
      });
    } catch (error: any) {
      // Handle case where language column doesn't exist
      if (error?.message?.includes("language") || error?.message?.includes("no such column")) {
        console.warn(
          `[Chatter] Language column may not exist. Retrying without language filter...`
        );
        const whereWithoutLanguage = { ...where };
        delete whereWithoutLanguage.language;
        chatterRecords = await prisma.chatterAnalysis.findMany({
          where: whereWithoutLanguage,
          orderBy: [{ importance_score: "desc" }, { total_engagement: "desc" }],
          take: options.limit || 50,
        });
        // Apply language filter in-memory if needed
        if (options.language && options.language !== "all") {
          chatterRecords = chatterRecords.filter((record) => record.language === options.language);
        }
      } else {
        throw error;
      }
    }

    // DEBUG: Log query results
    const totalCount = await prisma.chatterAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    });
    console.log(
      `[ChatterAnalysis] Query for project ${projectId}: found ${chatterRecords.length} records (total in DB: ${totalCount}), filters: dateRange=${options.dateRange || "all"}, platforms=${options.platforms?.length || 0}, minImportance=${options.minImportance || "none"}`
    );

    // Filter by platforms if specified (stored as JSON). Skip when all sources match default
    // (same as Themes/Engagement) so blog/blogs and x/twitter aliases stay consistent.
    let filteredRecords = chatterRecords;
    if (options.platforms && options.platforms.length === 0) {
      filteredRecords = [];
    }
    const selectedAllSources = isFullSourceFilterSelection(options.platforms);
    if (options.platforms && options.platforms.length > 0 && !selectedAllSources) {
      const allowedPlatforms = getNormalizedPlatformFilter(options.platforms);
      filteredRecords = chatterRecords.filter((record) => {
        if (!record.platforms_json) return true; // Include records without platforms_json if no filter
        try {
          const platforms: string[] = JSON.parse(record.platforms_json);
          return platforms.some((p) => recordPlatformMatches(p, allowedPlatforms));
        } catch {
          return true; // Include records with invalid JSON if filter doesn't match (don't exclude on parse error)
        }
      });
    }

    // Preload Discord profiles for name mapping
    const discordProfiles = await prisma.projectProfile.findMany({
      where: { project_id: projectId, platform: "discord", deleted_at: null },
      select: { name: true, url: true },
    });
    const discordServerMap = new Map<string, string>();
    const discordUrlMap = new Map<string, string>();
    for (const p of discordProfiles) {
      const url = p.url || "";
      const channelId = extractDiscordChannelIdFromProjectProfileUrl(url);
      if (channelId) {
        discordServerMap.set(channelId, p.name);
        discordUrlMap.set(channelId, url);
      }
    }

    // Transform to ChatterConversation format
    const conversations: ChatterConversation[] = await Promise.all(
      filteredRecords.map(async (record) => {
        let keyPoints: string[] = [];
        let platforms: string[] = [];
        let participantNames: string[] = [];
        let linkUrl: string | null = null;

        try {
          if (record.key_points_json) {
            keyPoints = JSON.parse(record.key_points_json);
          }
          if (record.platforms_json) {
            platforms = JSON.parse(record.platforms_json);
          }
          if (record.participant_names) {
            participantNames = JSON.parse(record.participant_names);
          }
        } catch (error) {
          console.error("Error parsing JSON fields:", error);
        }

        // Derive link URL: for non-Discord use post permalink; for Discord use configured channel URL
        try {
          const isDiscord = platforms.some((p) => (p || "").toLowerCase() === "discord");
          if (!isDiscord && record.post_ids) {
            const postIds: number[] = JSON.parse(record.post_ids);
            const firstId = Array.isArray(postIds) ? postIds[0] : null;
            if (firstId != null) {
              const post = await prisma.post.findUnique({
                where: { id: firstId },
                select: { url: true, extraJson: true },
              });
              if (post?.url) {
                linkUrl = post.url;
              } else if (post?.extraJson) {
                const extra = post.extraJson as { facebookUrl?: string; url?: string };
                linkUrl = extra.facebookUrl || extra.url || null;
              }
            }
          } else if (isDiscord && record.discord_channel) {
            const configuredUrl = discordUrlMap.get(record.discord_channel);
            if (configuredUrl) linkUrl = configuredUrl;
          }
        } catch {
          // ignore link errors
        }

        return {
          id: record.id,
          discussion_title: record.discussion_title,
          topic_category: record.topic_category,
          summary: record.summary,
          key_points: keyPoints,
          sentiment: record.sentiment,
          platforms,
          participant_count: record.participant_count,
          participant_names: participantNames,
          discord_channel: record.discord_channel,
          discord_server:
            record.discord_server ||
            (record.discord_channel ? discordServerMap.get(record.discord_channel) || null : null),
          link_url: linkUrl,
          total_messages: record.total_messages,
          total_engagement: record.total_engagement,
          first_post_at: record.first_post_at,
          last_post_at: record.last_post_at,
          importance_score: record.importance_score,
          analyzed_at: record.analyzed_at,
        };
      })
    );

    return { success: true, conversations };
  } catch (error) {
    console.error("Error getting stored chatter analysis:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get stored chatter analysis (conversation threads) for a project
 */
export async function getStoredChatterAnalysis(
  projectId: string,
  options: GetStoredChatterAnalysisOptions = {}
): Promise<{
  success: boolean;
  conversations?: ChatterConversation[];
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }
  return getStoredChatterAnalysisForUser(projectId, session.user.id, options);
}
