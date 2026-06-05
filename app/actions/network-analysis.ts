"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { InfluentialPerson } from "@/lib/network-analysis";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";
import {
  getNormalizedPlatformFilter,
  isFullSourceFilterSelection,
  recordPlatformMatches,
} from "@/lib/utils/platform";
import { revalidatePath } from "next/cache";
import { ulid as generateUlid } from "ulid";
import {
  getProjectSourcesForBrand,
  getDefaultSourcesForBrand,
  saveProjectBrandSources,
  type SourceInput,
} from "@/lib/projects/project-brand-sources-service";
import type { InfluencerPlatform } from "@/lib/brand-directory/brand-additional-links-service";

export type GetStoredNetworkAnalysisOptions = {
  limit?: number;
  platforms?: string[];
  minReactions?: number;
  dateRange?: string;
  /** When set, filters `latest_post_at >= latestPostAfter` and takes precedence over `dateRange`. */
  latestPostAfter?: Date;
  language?: string;
};

/**
 * Get influential people from stored NetworkAnalysis (for session UI and signed export routes).
 */
export async function getStoredNetworkAnalysisForUser(
  projectId: string,
  userId: string,
  options: GetStoredNetworkAnalysisOptions = {}
): Promise<{
  success: boolean;
  people?: InfluentialPerson[];
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

    const minReactions = options.minReactions ?? 10;

    // Build query — Discord often has total_reactions 0 (no public like/comment metrics).
    // A global `total_reactions >= min` would drop every Discord row and, with orderBy + take,
    // could exclude them before we ever apply in-memory rules.
    const where: Record<string, unknown> = {
      project_id: projectId,
      deleted_at: null,
      OR: [
        // SQLite Prisma has no `mode: insensitive` on string filters; store uses lowercase "discord".
        { platform: { in: ["discord", "Discord"] } },
        { total_reactions: { gte: minReactions } },
      ],
    };

    // CRITICAL: Platform filtering done in-memory for case-insensitive matching
    // Don't filter in SQL query - platform names may have different casing
    // if (options.platforms && options.platforms.length > 0) {
    //   where.platform = { in: options.platforms };
    // }

    // Apply date range filter to latest_post_at (most recent post date)
    if (options.latestPostAfter) {
      where.latest_post_at = { gte: options.latestPostAfter };
    } else if (options.dateRange && options.dateRange !== "all") {
      const dateFilter = getDateRangeFilter(options.dateRange);
      if (dateFilter) {
        where.latest_post_at = dateFilter;
      }
    }

    // Get stored network analysis
    const networkAnalysis = await prisma.networkAnalysis.findMany({
      where,
      orderBy: { total_reactions: "desc" },
      take: (options.limit || 50) * 2, // Fetch more to account for filtering
    });

    // DEBUG: Log query results
    const totalCount = await prisma.networkAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    });
    console.log(
      `[NetworkAnalysis] Query for project ${projectId}: found ${networkAnalysis.length} records (total in DB: ${totalCount}), filters: platforms=${options.platforms?.length || 0}, minReactions=${minReactions} (Discord exempt), dateRange=${options.dateRange || "all"}`
    );

    // Apply platform filter in-memory (shared util handles blog/blogs equivalence).
    // When all default sources are selected, skip filter (matches ThemesAnalysis / Engagement).
    let filteredRecords = networkAnalysis;
    if (options.platforms && options.platforms.length === 0) {
      filteredRecords = [];
    }
    const selectedAllSources = isFullSourceFilterSelection(options.platforms);
    if (options.platforms && options.platforms.length > 0 && !selectedAllSources) {
      const allowedPlatforms = getNormalizedPlatformFilter(options.platforms);
      filteredRecords = filteredRecords.filter((record) =>
        recordPlatformMatches(record.platform, allowedPlatforms)
      );
    }

    // Apply language filter in-memory
    if (options.language && options.language !== "all") {
      if (options.language === "en") {
        // For English: show records with language=en OR language=null (undetected)
        // BUT exclude any explicitly non-English languages
        filteredRecords = filteredRecords.filter((record) => {
          // Include English
          if (record.language === "en") return true;
          // Include NULL (likely English)
          if (record.language === null) return true;
          // Exclude all other languages
          return false;
        });
      } else {
        // For other languages: only exact matches
        filteredRecords = filteredRecords.filter((record) => record.language === options.language);
      }
    }

    // Non-Discord: require a real profile/page URL. Discord often has no permalink; show name + server.
    const withDisplayable = filteredRecords.filter((record) => {
      const p = record.platform.toLowerCase();
      if (p === "discord") {
        return true;
      }
      return Boolean(record.profile_url?.trim() && record.profile_url.startsWith("http"));
    });

    // Apply limit after filtering
    const finalRecords = withDisplayable.slice(0, options.limit || 50);

    const people: InfluentialPerson[] = finalRecords.map((record) => {
      const url = record.profile_url?.trim();
      const hasHttpProfile = Boolean(url && url.startsWith("http"));
      return {
        platform: record.platform,
        authorId: record.author_id,
        authorName: record.author_name,
        totalReactions: record.total_reactions,
        totalLikes: record.total_likes,
        totalComments: record.total_comments,
        totalShares: record.total_shares,
        postCount: record.post_count,
        profileUrl: hasHttpProfile ? url : undefined,
        posts: [], // Not needed in UI
        ideas: record.ideas_json ? JSON.parse(record.ideas_json) : undefined,
        discordServerName: record.discord_server_name || undefined,
        isFollowable: record.platform.toLowerCase() !== "discord",
      };
    });

    return { success: true, people };
  } catch (error) {
    console.error("Error getting stored network analysis:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get influential people from stored NetworkAnalysis table (NEW - reads from database)
 * Only returns people/company pages that have a real profile URL (no keyword-search fallbacks).
 */
export async function getStoredNetworkAnalysis(
  projectId: string,
  options: GetStoredNetworkAnalysisOptions = {}
): Promise<{
  success: boolean;
  people?: InfluentialPerson[];
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }
  return getStoredNetworkAnalysisForUser(projectId, session.user.id, options);
}

/**
 * Legacy method - now reads from database instead of computing on-demand
 * @deprecated Use getStoredNetworkAnalysis instead
 */
export async function getProjectInfluentialPeople(
  projectId: string,
  options: {
    limit?: number;
    platforms?: string[];
    dateRange?: string;
    minReactions?: number;
  } = {}
): Promise<{
  success: boolean;
  people?: InfluentialPerson[];
  error?: string;
}> {
  // Simply call the new database-backed method
  return getStoredNetworkAnalysis(projectId, {
    limit: options.limit,
    platforms: options.platforms,
    minReactions: options.minReactions,
  });
}

/** Map network-analysis platform string to Brand Related Sources InfluencerPlatform */
function toInfluencerPlatform(platform: string): InfluencerPlatform | null {
  const p = (platform || "").toLowerCase();
  if (p === "facebook") return "FACEBOOK";
  if (p === "linkedin") return "LINKEDIN";
  if (p === "x" || p === "twitter") return "TWITTER";
  if (p === "instagram") return "INSTAGRAM";
  if (p === "tiktok") return "TIKTOK";
  if (p === "bluesky") return "BLUESKY";
  if (p === "youtube") return "YOUTUBE";
  return null;
}

/** Normalize URL for comparison (trailing slash, case) */
function normalizeUrlForCompare(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Follow a profile - adds to ProjectProfile (scrapers) and to ProjectBrandSource for each project brand (Brand Related Sources → Existing Influencers)
 */
export async function followProfile(
  projectId: string,
  profile: {
    platform: string;
    authorName: string;
    authorId: string;
    profileUrl?: string;
  }
): Promise<{
  success: boolean;
  profileId?: string;
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

    // Normalize platform to lowercase so edit page "People & profiles" tabs show them (tabs use "facebook", "linkedin", etc.)
    const platformKey = (profile.platform || "").toLowerCase();

    // Check if profile already exists - check by URL first
    let existingProfile = await prisma.projectProfile.findFirst({
      where: {
        project_id: projectId,
        platform: platformKey,
        url: profile.profileUrl || profile.authorId,
        deleted_at: null,
      },
    });

    // Also check by author name (case-insensitive) to prevent duplicates
    if (!existingProfile) {
      const allProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          platform: platformKey,
          deleted_at: null,
        },
      });

      existingProfile =
        allProfiles.find((p) => p.name.toLowerCase() === profile.authorName.toLowerCase()) || null;
    }

    if (existingProfile) {
      return {
        success: false,
        error: "You are already following this profile",
      };
    }

    // Determine profile URL based on platform
    let profileUrl = profile.profileUrl;
    if (!profileUrl) {
      // Generate profile URL based on platform conventions
      const platform = profile.platform.toLowerCase();
      if (platform === "x" || platform === "twitter") {
        profileUrl = `https://twitter.com/${profile.authorName}`;
      } else if (platform === "linkedin") {
        // LinkedIn profile URLs are harder to construct without actual URL
        profileUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(profile.authorName)}`;
      } else if (platform === "reddit") {
        profileUrl = `https://www.reddit.com/user/${profile.authorName}`;
      } else if (platform === "facebook") {
        profileUrl = `https://facebook.com/${profile.authorId}`;
      } else if (platform === "discord") {
        // Discord doesn't have public profile URLs
        profileUrl = `discord://-/users/${profile.authorId}`;
      } else {
        // Fallback: use author ID
        profileUrl = profile.authorId;
      }
    }

    // Create the profile (used by scrapers and for "followed" state; projects with no brands rely on this)
    const newProfile = await prisma.projectProfile.create({
      data: {
        id: generateUlid(),
        project_id: projectId,
        platform: platformKey,
        name: profile.authorName,
        url: profileUrl,
        type: "person",
        is_selected: true,
      },
    });

    // Add to Brand Related Sources (Existing Influencers) for each project brand so it shows on Edit → Brand Related Sources
    const influencerPlatform = toInfluencerPlatform(profile.platform);
    if (influencerPlatform) {
      const projectBrands = await prisma.projectBrand.findMany({
        where: {
          project_id: projectId,
          brand_id: { not: null },
          deleted_at: null,
        },
        select: { brand_id: true },
      });
      const brandIds = projectBrands
        .map((pb) => pb.brand_id)
        .filter((id): id is string => id !== null);

      for (const brandId of brandIds) {
        const projectSources = await getProjectSourcesForBrand(projectId, brandId);
        let currentInput: SourceInput[];
        if (projectSources.length === 0) {
          currentInput = await getDefaultSourcesForBrand(brandId);
        } else {
          currentInput = projectSources.map((s) => ({
            link_type: s.link_type,
            platform: s.platform ?? undefined,
            source_category: s.source_category ?? undefined,
            url: s.url,
            channel_name: s.channel_name ?? undefined,
          }));
        }
        const alreadyAdded = currentInput.some(
          (s) =>
            s.link_type === "INFLUENCER" &&
            s.platform === influencerPlatform &&
            normalizeUrlForCompare(s.url) === normalizeUrlForCompare(profileUrl)
        );
        if (!alreadyAdded) {
          currentInput.push({
            link_type: "INFLUENCER",
            platform: influencerPlatform,
            url: profileUrl,
            channel_name: profile.authorName,
          });
          await saveProjectBrandSources(projectId, brandId, currentInput);
        }
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true, profileId: newProfile.id };
  } catch (error) {
    console.error("Error following profile:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Unfollow a profile - soft deletes from ProjectProfile and removes from Brand Related Sources (ProjectBrandSource) for each project brand
 */
export async function unfollowProfile(
  projectId: string,
  profile: {
    platform: string;
    profileUrl?: string;
    authorName?: string;
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

    const platformKey = (profile.platform || "").toLowerCase();

    // Find the profile to unfollow - try by URL first (match stored platform case-insensitively)
    const byUrl = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        url: profile.profileUrl,
        deleted_at: null,
      },
    });
    let existingProfile =
      byUrl.find((p) => (p.platform || "").toLowerCase() === platformKey) ?? null;

    // Fallback: search by author name if URL match fails
    if (!existingProfile && profile.authorName) {
      const allProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
      });
      existingProfile =
        allProfiles.find(
          (p) =>
            (p.platform || "").toLowerCase() === platformKey &&
            p.name.toLowerCase() === profile.authorName!.toLowerCase()
        ) ?? null;
    }

    if (!existingProfile) {
      return { success: false, error: "Profile not found in your follows" };
    }

    const urlToRemove = existingProfile.url;
    const influencerPlatform = toInfluencerPlatform(profile.platform);

    // Soft delete the profile
    await prisma.projectProfile.update({
      where: { id: existingProfile.id },
      data: { deleted_at: new Date() },
    });

    // Remove from Brand Related Sources (Existing Influencers) for each project brand
    if (influencerPlatform) {
      const projectBrands = await prisma.projectBrand.findMany({
        where: {
          project_id: projectId,
          brand_id: { not: null },
          deleted_at: null,
        },
        select: { brand_id: true },
      });
      const brandIds = projectBrands
        .map((pb) => pb.brand_id)
        .filter((id): id is string => id !== null);
      const normalizedRemoved = normalizeUrlForCompare(urlToRemove);

      for (const brandId of brandIds) {
        const current = await getProjectSourcesForBrand(projectId, brandId);
        const filtered = current.filter(
          (s) =>
            !(
              s.link_type === "INFLUENCER" &&
              (s.platform || "").toUpperCase() === influencerPlatform &&
              normalizeUrlForCompare(s.url) === normalizedRemoved
            )
        );
        if (filtered.length < current.length) {
          const asInput: SourceInput[] = filtered.map((s) => ({
            link_type: s.link_type,
            platform: s.platform ?? undefined,
            source_category: s.source_category ?? undefined,
            url: s.url,
            channel_name: s.channel_name ?? undefined,
          }));
          await saveProjectBrandSources(projectId, brandId, asInput);
        }
      }
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return { success: true };
  } catch (error) {
    console.error("Error unfollowing profile:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if a profile is already being followed
 */
export async function isProfileFollowed(
  projectId: string,
  platform: string,
  authorId: string
): Promise<{
  success: boolean;
  isFollowed?: boolean;
  profileId?: string;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const profile = await prisma.projectProfile.findFirst({
      where: {
        project_id: projectId,
        platform: platform,
        url: {
          contains: authorId,
        },
        deleted_at: null,
      },
    });

    return {
      success: true,
      isFollowed: !!profile,
      profileId: profile?.id,
    };
  } catch (error) {
    console.error("Error checking if profile is followed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
