/**
 * Network Analysis Service using OpenAI API
 * Identifies influential people and summarizes their key ideas
 */

import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import { openaiChatModel } from "@/lib/openai-chat-model";
import type { Prisma } from "@prisma/client";

export interface InfluentialPerson {
  platform: string;
  authorId: string;
  authorName: string;
  totalReactions: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  postCount: number;
  profileUrl?: string;
  posts: Array<{
    id: number;
    content?: string;
    url?: string;
    createdAt: Date;
    metricsLikes?: number;
    metricsComments?: number;
    metricsShares?: number;
    channelId?: string; // For Discord server names
    language?: string | null; // ISO 639-1 language code
  }>;
  ideas?: string[]; // Summarized ideas from OpenAI
  discordServerName?: string; // Discord server name instead of username
  isFollowable?: boolean; // Whether this person can be followed
}

/**
 * Get influential people from a project
 * Filters to only include individual people (not groups, channels, subreddits)
 */
export async function getInfluentialPeople(
  projectId: string,
  options: {
    limit?: number;
    platforms?: string[];
    dateRangeStart?: Date;
    dateRangeEnd?: Date;
    minReactions?: number;
  } = {}
): Promise<InfluentialPerson[]> {
  const { limit = 50, minReactions = 10 } = options;

  // Build query filters
  const whereClause: Prisma.PostWhereInput = {
    project_id: projectId,
    content: { not: null },
    NOT: { content: "" },
    authorId: { not: null },
    authorName: { not: null },
    // Only top-level posts: exclude replies/comments so engagement reflects the author's posts, not comment activity
    threadRefId: null,
  };

  if (options.platforms && options.platforms.length > 0) {
    whereClause.platform = { in: options.platforms };
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

  // Build a map of Discord channel IDs to server names
  const discordServerMap = new Map<string, string>();
  for (const profile of discordProfiles) {
    // Extract both server ID and channel ID from URL format: https://discord.com/channels/{SERVER_ID}/{CHANNEL_ID}
    const match = profile.url.match(/\/channels\/(\d+)\/(\d+)/);
    if (match) {
      const channelId = match[2]; // Use channel ID as the key (matches Post.channelId)
      discordServerMap.set(channelId, profile.name);
    }
  }

  // Get all posts with engagement metrics
  const posts = await prisma.post.findMany({
    where: whereClause,
    select: {
      id: true,
      platform: true,
      postId: true,
      authorId: true,
      authorName: true,
      content: true,
      url: true,
      createdAt: true,
      channelId: true, // For Discord server names
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
      language: true, // For language filtering
    },
    orderBy: { createdAt: "desc" },
  });

  // Group posts by platform + authorId
  const authorMap = new Map<string, InfluentialPerson>();

  for (const post of posts) {
    const key = `${post.platform}:${post.authorId}`;

    if (!authorMap.has(key)) {
      const isDiscord = post.platform.toLowerCase() === "discord";

      // For Discord, look up server name using channelId
      let serverName: string | undefined;
      if (isDiscord && post.channelId) {
        // Match post's channelId with profile's channel ID to get server name
        serverName = discordServerMap.get(post.channelId);
      }

      authorMap.set(key, {
        platform: post.platform,
        authorId: post.authorId!,
        authorName: post.authorName!,
        totalReactions: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        postCount: 0,
        posts: [],
        profileUrl: extractProfileUrl(post.platform, post.url || undefined),
        discordServerName: serverName,
        isFollowable: !isDiscord, // Discord users cannot be followed
      });
    }

    const author = authorMap.get(key)!;
    author.postCount++;
    author.totalLikes += post.metricsLikes || 0;
    author.totalComments += post.metricsComments || 0;
    author.totalShares += post.metricsShares || 0;
    author.totalReactions = author.totalLikes + author.totalComments + author.totalShares;

    // Keep track of posts for later analysis
    author.posts.push({
      id: post.id,
      content: post.content ?? undefined,
      url: post.url ?? undefined,
      createdAt: post.createdAt,
      metricsLikes: post.metricsLikes ?? undefined,
      metricsComments: post.metricsComments ?? undefined,
      metricsShares: post.metricsShares ?? undefined,
      channelId: post.channelId ?? undefined,
      language: post.language,
    });
  }

  // Filter out authors with low engagement and apply filters
  const influentialPeople = Array.from(authorMap.values())
    .filter((person) => person.totalReactions >= minReactions)
    .filter((person) => isIndividualPerson(person))
    .sort((a, b) => b.totalReactions - a.totalReactions)
    .slice(0, limit);

  return influentialPeople;
}

/**
 * Determine if an author is an individual person (not a group, channel, etc.)
 * Uses heuristics based on platform conventions
 */
function isIndividualPerson(person: InfluentialPerson): boolean {
  const platform = person.platform.toLowerCase();
  const name = person.authorName.toLowerCase();

  // Reddit: exclude if name starts with "r/" (subreddits) or "u/AutoModerator"
  if (platform === "reddit") {
    if (name.startsWith("r/") || name.includes("automoderator") || name.includes("bot")) {
      return false;
    }
  }

  // Discord: exclude channels (would need more context, but we can filter bots)
  if (platform === "discord") {
    if (name.includes("bot") || name.includes("webhook")) {
      return false;
    }
  }

  // Facebook: exclude pages/groups (harder to distinguish without API data)
  // For now, we'll include all but can refine based on specific patterns
  if (platform === "facebook") {
    if (name.includes("official") || name.includes("page") || name.includes("group")) {
      return false;
    }
  }

  // LinkedIn: Generally individual profiles, but exclude "LinkedIn News" etc.
  if (platform === "linkedin") {
    if (name.includes("linkedin") && !name.match(/^[a-zA-Z\s]+$/)) {
      return false;
    }
  }

  // X/Twitter: Exclude bots and automated accounts
  if (platform === "x" || platform === "twitter") {
    if (name.includes("bot") || name.includes("automated")) {
      return false;
    }
  }

  return true;
}

/**
 * Extract profile URL from post URL based on platform
 */
function extractProfileUrl(platform: string, postUrl?: string): string | undefined {
  if (!postUrl) return undefined;

  const platformLower = platform.toLowerCase();

  try {
    const url = new URL(postUrl);

    if (platformLower === "linkedin") {
      // LinkedIn post URL format: https://www.linkedin.com/feed/update/urn:li:activity:123456789/
      // LinkedIn profile URL format: https://www.linkedin.com/in/username/
      // We can't extract profile from post URL reliably, return undefined
      return undefined;
    }

    if (platformLower === "x" || platformLower === "twitter") {
      // Twitter URL format: https://twitter.com/username/status/123456789
      const match = url.pathname.match(/^\/([^/]+)\//);
      if (match) {
        return `https://twitter.com/${match[1]}`;
      }
    }

    if (platformLower === "facebook") {
      // Facebook URL format varies widely, hard to extract reliably
      return undefined;
    }

    if (platformLower === "reddit") {
      // Reddit URL format: https://reddit.com/r/subreddit/comments/...
      // User profile: https://reddit.com/user/username
      return undefined; // Can't extract from post URL
    }
  } catch (error) {
    console.error("Error extracting profile URL:", error);
  }

  return undefined;
}

/**
 * Format posts for OpenAI analysis - focus on extracting key ideas
 */
function formatPostsForIdeaSummary(person: InfluentialPerson): string {
  let formatted = `Author: ${person.authorName} (${person.platform})\n`;
  formatted += `Total posts: ${person.postCount}\n`;
  formatted += `Total engagement: ${person.totalReactions} reactions\n\n`;
  formatted += `Posts:\n`;

  // Sort posts by engagement and take top ones
  const topPosts = [...person.posts]
    .sort((a, b) => {
      const aEngagement = (a.metricsLikes || 0) + (a.metricsComments || 0) + (a.metricsShares || 0);
      const bEngagement = (b.metricsLikes || 0) + (b.metricsComments || 0) + (b.metricsShares || 0);
      return bEngagement - aEngagement;
    })
    .slice(0, 10); // Top 10 posts

  topPosts.forEach((post, index) => {
    const engagement =
      (post.metricsLikes || 0) + (post.metricsComments || 0) + (post.metricsShares || 0);
    formatted += `${index + 1}. [${post.createdAt.toISOString().split("T")[0]}] (${engagement} reactions)\n`;
    formatted += `   ${post.content?.substring(0, 500) || "No content"}\n\n`;
  });

  return formatted;
}

/**
 * Summarize a person's key ideas using OpenAI
 * Returns array of one-sentence summaries (one per distinct idea)
 */
export async function summarizePersonIdeas(person: InfluentialPerson): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not set, skipping idea summarization");
    return ["Ideas summary unavailable (OpenAI API key not configured)"];
  }

  if (person.posts.length === 0) {
    return ["No posts available to analyze"];
  }

  const formattedContent = formatPostsForIdeaSummary(person);

  try {
    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiChatModel("network"),
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
            content: `Analyze these posts and extract the key ideas:\n\n${formattedContent}`,
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
          `[OpenAI] Throttled (429) operation=network_ideas retryAfter=${retryAfter ?? "none"}`
        );
      }
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      return ["Error summarizing ideas (API error)"];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content returned from OpenAI API");
      return ["Error summarizing ideas (no response)"];
    }

    // Parse the JSON response
    let ideas: string[] = JSON.parse(content);

    if (!Array.isArray(ideas) || ideas.length === 0) {
      return ["Unable to extract distinct ideas from posts"];
    }
    // Consolidate to at most two lines; if more were discussed, say "Multiple other topics."
    if (ideas.length > 2) {
      ideas = [ideas[0], "Multiple other topics."];
    }
    return ideas;
  } catch (error) {
    console.error(`Error summarizing ideas for ${person.authorName}:`, error);
    return ["Error summarizing ideas (processing error)"];
  }
}

/**
 * Batch summarize ideas for multiple people
 * Processes in parallel with rate limiting
 */
export async function summarizeMultiplePeopleIdeas(
  people: InfluentialPerson[],
  options: {
    maxConcurrent?: number;
    delayMs?: number;
  } = {}
): Promise<InfluentialPerson[]> {
  const { maxConcurrent = 3, delayMs = 1000 } = options;

  const results: InfluentialPerson[] = [];

  // Process in batches to respect rate limits
  for (let i = 0; i < people.length; i += maxConcurrent) {
    const batch = people.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (person) => {
      const ideas = await summarizePersonIdeas(person);
      return { ...person, ideas };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Add delay between batches
    if (i + maxConcurrent < people.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
