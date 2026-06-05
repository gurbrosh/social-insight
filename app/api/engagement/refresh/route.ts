import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ulid as generateUlid } from "ulid";
import { getEnvironmentService } from "@/lib/environment-service";
import { getTwitterAccessToken } from "@/lib/twitter-oauth";

export const dynamic = "force-dynamic";

// Extract tweet ID from Twitter/X URL
function extractTweetId(url: string): string | null {
  try {
    // Match patterns like:
    // https://twitter.com/username/status/1234567890
    // https://x.com/username/status/1234567890
    // https://twitter.com/i/web/status/1234567890
    // https://x.com/i/web/status/1234567890
    const match = url.match(/(?:twitter\.com|x\.com)\/(?:i\/web\/)?[\w@]+\/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Fetch Twitter/X conversation thread using Twitter API v2
async function fetchTwitterThreadLight(
  conversationUrl: string,
  userId?: string
): Promise<
  Array<{
    authorName?: string | null;
    content?: string | null;
    createdAt: Date;
    postId: string;
    metricsLikes?: number;
    metricsComments?: number;
    metricsShares?: number;
  }>
> {
  // Priority 1: Try to get user's OAuth token (if userId provided)
  let bearerToken: string | null = null;

  if (userId) {
    bearerToken = await getTwitterAccessToken(userId);
    if (bearerToken) {
      console.log("[Engagement] Using user OAuth token for Twitter API");
    }
  }

  // Priority 2: Fallback to global bearer token (for backward compatibility during migration)
  if (!bearerToken) {
    try {
      const envService = getEnvironmentService();
      const envVars = await envService.listEnvVars();
      bearerToken = envVars.TWITTER_BEARER_TOKEN || envVars.X_BEARER_TOKEN || null;
    } catch (error) {
      console.warn("[Engagement] Failed to get token from environment service:", error);
    }
  }

  if (!bearerToken) {
    try {
      const { getDualEnvironmentServices } = await import("@/lib/environment-service");
      const { remote } = getDualEnvironmentServices();
      const remoteVars = await remote.listEnvVars();
      bearerToken = remoteVars.TWITTER_BEARER_TOKEN || remoteVars.X_BEARER_TOKEN || null;
    } catch (error) {
      console.warn("[Engagement] Failed to get token from remote service:", error);
    }
  }

  if (!bearerToken) {
    bearerToken = process.env.TWITTER_BEARER_TOKEN || process.env.X_BEARER_TOKEN || null;
  }

  if (!bearerToken) {
    console.warn("[Engagement] Twitter API token not configured, skipping on-demand fetch");
    return [];
  }

  try {
    const tweetId = extractTweetId(conversationUrl);
    if (!tweetId) {
      console.warn("[Engagement] Could not extract tweet ID from URL:", conversationUrl);
      return [];
    }

    const results: Array<{
      authorName?: string | null;
      content?: string | null;
      createdAt: Date;
      postId: string;
      metricsLikes?: number;
      metricsComments?: number;
      metricsShares?: number;
    }> = [];

    // Step 1: Get the root tweet to find conversation_id
    const tweetUrl = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=author_id,created_at,text,public_metrics,conversation_id,referenced_tweets&expansions=author_id&user.fields=username,name`;
    const tweetResp = await fetch(tweetUrl, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "User-Agent": "SocialInsight/engagement-check",
      },
    });

    if (!tweetResp.ok) {
      console.warn(
        `[Engagement] Twitter API error fetching tweet: ${tweetResp.status} ${tweetResp.statusText}`
      );
      return [];
    }

    const tweetData = await tweetResp.json();
    const rootTweet = tweetData.data;
    if (!rootTweet) return [];

    const conversationId = rootTweet.conversation_id || tweetId;
    const usersMap = new Map();
    if (tweetData.includes?.users) {
      tweetData.includes.users.forEach((u: any) => {
        usersMap.set(u.id, { username: u.username, name: u.name });
      });
    }

    // Add root tweet
    const rootAuthor = usersMap.get(rootTweet.author_id);
    results.push({
      authorName: rootAuthor?.username || null,
      content: rootTweet.text || null,
      createdAt: new Date(rootTweet.created_at),
      postId: rootTweet.id,
      metricsLikes: rootTweet.public_metrics?.like_count || 0,
      metricsComments: rootTweet.public_metrics?.reply_count || 0,
      metricsShares:
        (rootTweet.public_metrics?.retweet_count || 0) +
        (rootTweet.public_metrics?.quote_count || 0),
    });

    // Step 2: Search for replies in this conversation
    // Use conversation_id to find all replies
    const searchUrl = `https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${conversationId}&tweet.fields=author_id,created_at,text,public_metrics,in_reply_to_user_id&expansions=author_id&user.fields=username,name&max_results=100`;
    const searchResp = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "User-Agent": "SocialInsight/engagement-check",
      },
    });

    if (searchResp.ok) {
      const searchData = await searchResp.json();
      const replies = searchData.data || [];
      const replyUsers = new Map();
      if (searchData.includes?.users) {
        searchData.includes.users.forEach((u: any) => {
          replyUsers.set(u.id, { username: u.username, name: u.name });
        });
      }

      for (const reply of replies) {
        // Skip the root tweet itself (already added)
        if (reply.id === tweetId) continue;

        const replyAuthor = replyUsers.get(reply.author_id);
        results.push({
          authorName: replyAuthor?.username || null,
          content: reply.text || null,
          createdAt: new Date(reply.created_at),
          postId: reply.id,
          metricsLikes: reply.public_metrics?.like_count || 0,
          metricsComments: reply.public_metrics?.reply_count || 0,
          metricsShares:
            (reply.public_metrics?.retweet_count || 0) + (reply.public_metrics?.quote_count || 0),
        });
      }
    }

    return results;
  } catch (error) {
    console.error("[Engagement] Error fetching Twitter thread:", error);
    return [];
  }
}

// Minimal Reddit thread fetcher using public JSON endpoint. No DB writes; used only for detection.
async function fetchRedditThreadLight(conversationUrl: string): Promise<
  Array<{
    authorName?: string | null;
    content?: string | null;
    createdAt: Date;
    postId: string;
    metricsLikes?: number;
    metricsComments?: number;
    metricsShares?: number;
  }>
> {
  try {
    const url = conversationUrl.endsWith("/")
      ? `${conversationUrl}.json`
      : `${conversationUrl}/.json`;
    const resp = await fetch(url, { headers: { "User-Agent": "SocialInsight/engagement-check" } });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Reddit JSON returns [post, comments]
    const results: Array<{
      authorName?: string | null;
      content?: string | null;
      createdAt: Date;
      postId: string;
      metricsLikes?: number;
      metricsComments?: number;
      metricsShares?: number;
    }> = [];
    if (Array.isArray(data) && data.length >= 1 && data[0]?.data?.children?.length) {
      const post = data[0].data.children[0]?.data;
      if (post) {
        results.push({
          authorName: post.author || null,
          content: post.selftext || post.title || null,
          createdAt: new Date((post.created_utc || post.created || 0) * 1000),
          postId: post.id || post.name || "",
          metricsLikes: post.ups || 0,
          metricsComments: post.num_comments || 0,
          metricsShares: 0, // Reddit doesn't have shares
        });
      }
    }
    if (Array.isArray(data) && data.length >= 2 && data[1]?.data?.children?.length) {
      for (const c of data[1].data.children) {
        const cd = c?.data;
        if (!cd) continue;
        // Skip morecomments kind
        if (c.kind === "more") continue;
        results.push({
          authorName: cd.author || null,
          content: cd.body || null,
          createdAt: new Date((cd.created_utc || cd.created || 0) * 1000),
          postId: cd.id || cd.name || "",
          metricsLikes: cd.ups || 0,
          metricsComments: cd.num_comments || 0,
          metricsShares: 0, // Reddit doesn't have shares
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * POST /api/engagement/refresh
 * Checks an engagement session for:
 * 1. User replies (using platform identities)
 * 2. New replies to user's comments
 * 3. Metrics changes (reactions, replies, shares)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { engagementId } = body as { engagementId?: string };

    if (!engagementId) {
      return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
    }

    // Verify ownership
    const engagement = await prisma.engagementSession.findFirst({
      where: {
        id: engagementId,
        started_by_user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement session not found or unauthorized" },
        { status: 404 }
      );
    }

    // Get the specific identity used for this engagement, or all identities if none selected
    let userIdentities;
    if (engagement.selected_identity_id) {
      const selectedIdentity = await prisma.userPlatformIdentity.findFirst({
        where: {
          id: engagement.selected_identity_id,
          user_id: session.user.id,
          deleted_at: null,
        },
      });
      userIdentities = selectedIdentity ? [selectedIdentity] : [];
    } else {
      userIdentities = await prisma.userPlatformIdentity.findMany({
        where: {
          user_id: session.user.id,
          platform: engagement.platform.toLowerCase(),
          deleted_at: null,
        },
      });
    }

    if (userIdentities.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No platform identities configured. Add your handle/username to detect replies.",
        detected: false,
      });
    }

    // Extract conversation context from destination URL
    const conversationUrl = engagement.destination_url;
    let conversationPosts: any[] = [];
    let rootPostId: string | null = null;

    // Extract post ID from URL based on platform and try local DB first
    if (engagement.platform.toLowerCase() === "reddit") {
      const match = conversationUrl.match(/\/comments\/([a-z0-9]+)\//);
      if (match) {
        rootPostId = match[1];
        const rootPost = await prisma.post.findFirst({
          where: { platform: "reddit", postId: rootPostId },
        });
        if (rootPost) {
          conversationPosts = await prisma.post.findMany({
            where: {
              platform: "reddit",
              OR: [{ postId: rootPostId }, { threadRefId: rootPostId }],
            },
            select: {
              id: true,
              postId: true,
              authorName: true,
              authorId: true,
              content: true,
              createdAt: true,
              metricsLikes: true,
              metricsComments: true,
              metricsShares: true,
            },
            orderBy: { createdAt: "asc" },
          });
        }
      }
    } else if (
      engagement.platform.toLowerCase() === "x" ||
      engagement.platform.toLowerCase() === "twitter"
    ) {
      if (engagement.post_id) {
        const rootPost = await prisma.post.findUnique({ where: { id: engagement.post_id } });
        if (rootPost) {
          rootPostId = rootPost.postId;
          conversationPosts = await prisma.post.findMany({
            where: { platform: "x", OR: [{ postId: rootPostId }, { threadRefId: rootPostId }] },
            select: {
              id: true,
              postId: true,
              authorName: true,
              authorId: true,
              content: true,
              createdAt: true,
              metricsLikes: true,
              metricsComments: true,
              metricsShares: true,
            },
            orderBy: { createdAt: "asc" },
          });
        }
      }
    } else {
      if (engagement.post_id) {
        const rootPost = await prisma.post.findUnique({ where: { id: engagement.post_id } });
        if (rootPost) {
          rootPostId = rootPost.postId;
          conversationPosts = [rootPost];
        }
      }
    }

    // Fetch on-demand for real-time detection
    // For Twitter/X: Always fetch to get latest replies (not dependent on scrapers)
    // For Reddit: Only fetch if DB didn't yield results
    let fetchedThread: Array<{
      authorName?: string | null;
      content?: string | null;
      createdAt: Date;
      postId: string;
      metricsLikes?: number;
      metricsComments?: number;
      metricsShares?: number;
    }> = [];

    if (
      engagement.platform.toLowerCase() === "x" ||
      engagement.platform.toLowerCase() === "twitter"
    ) {
      // Always fetch Twitter/X for real-time detection (not dependent on scrapers)
      fetchedThread = await fetchTwitterThreadLight(conversationUrl, session.user.id);
    } else if (
      engagement.platform.toLowerCase() === "reddit" &&
      (conversationPosts.length === 0 || !rootPostId)
    ) {
      // Only fetch Reddit if DB didn't yield results
      fetchedThread = await fetchRedditThreadLight(conversationUrl);
    }

    // Normalize identities
    const normalizedIdentities = userIdentities.map((id) =>
      id.identity
        .toLowerCase()
        .trim()
        .replace(/^@/, "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
    );

    // Also create versions without u/ prefix for Reddit (author names in DB typically don't have u/)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const normalizedIdentitiesWithoutU = normalizedIdentities.map((id) =>
      id.replace(/^u\//, "").replace(/^www\.reddit\.com\/user\//, "")
    );

    const engagementStartTime = engagement.started_at;

    // Combine DB posts and fetched thread, deduplicating by postId
    const allPosts = new Map<string, any>();

    // Add DB posts
    conversationPosts.forEach((post) => {
      if (post.postId) {
        allPosts.set(post.postId, post);
      }
    });

    // Add/update with fetched posts (fetched data is more recent, so it overrides)
    fetchedThread.forEach((post) => {
      if (post.postId) {
        allPosts.set(post.postId, post);
      }
    });

    const allPostsArray = Array.from(allPosts.values());

    // Find user replies from all posts (DB + fetched)
    const userRepliesCombined = allPostsArray.filter((post) => {
      if (!post.authorName || !post.createdAt) return false;
      if (new Date(post.createdAt) <= engagementStartTime) return false;
      const authorNormalized = post.authorName.toLowerCase().trim();
      const authorWithoutU = authorNormalized.replace(/^u\//, "");

      // Match against both normalized identities (with and without u/ prefix)
      return normalizedIdentities.some((id) => {
        const idWithoutU = id.replace(/^u\//, "").replace(/^www\.reddit\.com\/user\//, "");
        return (
          authorNormalized === id ||
          authorNormalized.includes(id) ||
          id.includes(authorNormalized) ||
          authorWithoutU === idWithoutU ||
          authorWithoutU.includes(idWithoutU) ||
          idWithoutU.includes(authorWithoutU)
        );
      });
    });

    // Check for moderation-removed comments (bot messages mentioning user identity)
    let moderationDetected = false;
    const moderationPatterns = [
      /your (submission|comment|post) has been removed/i,
      /sorry, your (submission|comment|post) has been removed/i,
      /this (action|removal) was performed automatically/i,
      /contact the moderators/i,
      /inadequate account karma/i,
    ];

    // Check all posts (DB + fetched) for moderation messages
    const allThreadPosts = allPostsArray;
    for (const post of allThreadPosts) {
      if (!post.authorName || !post.content) continue;

      // Check if this is a bot/mod message (common Reddit bot names)
      const authorLower = post.authorName.toLowerCase();
      const isBotMessage =
        authorLower.includes("bot") ||
        authorLower.includes("automoderator") ||
        authorLower === "[deleted]" ||
        authorLower === "[removed]";

      if (isBotMessage) {
        // Check if the message mentions removal and references one of our identities
        const contentLower = (post.content || "").toLowerCase();
        const mentionsRemoval = moderationPatterns.some((pattern) => pattern.test(contentLower));

        if (mentionsRemoval) {
          // Check if it might be about the user (mentions identity or is a response)
          const mentionsIdentity = normalizedIdentities.some(
            (id) =>
              contentLower.includes(id.toLowerCase()) ||
              contentLower.includes("your") || // Generic "your comment" suggests it's about the user
              (post.createdAt && new Date(post.createdAt) > engagementStartTime) // Recent bot message after engagement
          );

          if (mentionsIdentity) {
            moderationDetected = true;
            break;
          }
        }
      }
    }

    // Metrics (from root post - prefer fetched if available, otherwise DB)
    const rootPost =
      fetchedThread.length > 0
        ? fetchedThread.find((p) => p.postId === rootPostId) || fetchedThread[0]
        : conversationPosts[0];
    const totalComments = Math.max(0, allPostsArray.length - 1); // All posts minus root
    const reactions = rootPost?.metricsLikes || 0;
    const shares = rootPost?.metricsShares || 0;

    // Last snapshot
    const lastSnapshot = await prisma.engagementEvent.findFirst({
      where: { engagement_id: engagementId, type: "reaction_snapshot", deleted_at: null },
      orderBy: { occurred_at: "desc" },
    });

    const currentMetrics = {
      reactions,
      replies: totalComments,
      shares,
      timestamp: new Date().toISOString(),
    };
    const previousMetrics = lastSnapshot?.payload
      ? JSON.parse(lastSnapshot.payload as string)
      : null;
    const metricsChanged =
      !previousMetrics ||
      previousMetrics.reactions !== currentMetrics.reactions ||
      previousMetrics.replies !== currentMetrics.replies ||
      previousMetrics.shares !== currentMetrics.shares;

    const eventsCreated: string[] = [];

    // Check for moderation removal
    if (moderationDetected) {
      const existingModEvent = await prisma.engagementEvent.findFirst({
        where: {
          engagement_id: engagementId,
          type: "moderation_removed",
          deleted_at: null,
        },
      });

      if (!existingModEvent) {
        await prisma.engagementEvent.create({
          data: {
            id: generateUlid(),
            engagement_id: engagementId,
            type: "moderation_removed",
            payload: JSON.stringify({
              reason: "Comment or post appears to have been removed by moderation",
              detected_at: new Date().toISOString(),
            }),
            occurred_at: new Date(),
          },
        });
        eventsCreated.push("moderation_removed");
      }
    }

    if (userRepliesCombined.length > 0) {
      // Check for existing detected_user_reply event to get previous metrics
      const existingReplyEvent = await prisma.engagementEvent.findFirst({
        where: { engagement_id: engagementId, type: "detected_user_reply", deleted_at: null },
      });

      // Build current reply metrics with engagement data
      const currentReplies = userRepliesCombined.map((r) => {
        const post = r as any;
        return {
          postId: r.postId || post.postId || "",
          content: (post.content || (r as any).content)?.substring(0, 200) || null,
          createdAt: r.createdAt,
          metrics: {
            upvotes: post.metricsLikes ?? (r as any).metricsLikes ?? 0,
            replies: post.metricsComments ?? (r as any).metricsComments ?? 0,
            shares: post.metricsShares ?? (r as any).metricsShares ?? 0,
          },
        };
      });

      // Get previous metrics per reply
      const previousReplies: Record<string, { upvotes: number; replies: number; shares: number }> =
        {};
      if (existingReplyEvent?.payload) {
        try {
          const prevData = JSON.parse(existingReplyEvent.payload as string);
          if (prevData.replies && Array.isArray(prevData.replies)) {
            prevData.replies.forEach((r: any) => {
              if (r.postId && r.metrics) {
                previousReplies[r.postId] = r.metrics;
              }
            });
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Check if any reply metrics changed
      let repliesChanged = false;
      if (!existingReplyEvent) {
        repliesChanged = true; // New reply detected
      } else {
        // Check if metrics changed for any reply
        for (const reply of currentReplies) {
          const prev = previousReplies[reply.postId];
          if (
            !prev ||
            prev.upvotes !== reply.metrics.upvotes ||
            prev.replies !== reply.metrics.replies ||
            prev.shares !== reply.metrics.shares
          ) {
            repliesChanged = true;
            break;
          }
        }

        // Also check if new replies were added
        const currentIds = new Set(currentReplies.map((r) => r.postId));
        const prevIds = new Set(Object.keys(previousReplies));
        if (currentIds.size !== prevIds.size || ![...currentIds].every((id) => prevIds.has(id))) {
          repliesChanged = true;
        }
      }

      if (!existingReplyEvent || repliesChanged) {
        // Upsert the reply event with current metrics
        if (existingReplyEvent) {
          await prisma.engagementEvent.update({
            where: { id: existingReplyEvent.id },
            data: {
              payload: JSON.stringify({
                reply_count: currentReplies.length,
                replies: currentReplies,
                last_updated: new Date().toISOString(),
              }),
              occurred_at: userRepliesCombined[0].createdAt,
            },
          });
        } else {
          await prisma.engagementEvent.create({
            data: {
              id: generateUlid(),
              engagement_id: engagementId,
              type: "detected_user_reply",
              payload: JSON.stringify({
                reply_count: currentReplies.length,
                replies: currentReplies,
                last_updated: new Date().toISOString(),
              }),
              occurred_at: userRepliesCombined[0].createdAt,
            },
          });
        }
        eventsCreated.push("detected_user_reply");

        // Create individual metrics change events for each reply that changed
        for (const reply of currentReplies) {
          const prev = previousReplies[reply.postId];
          if (
            !prev ||
            prev.upvotes !== reply.metrics.upvotes ||
            prev.replies !== reply.metrics.replies ||
            prev.shares !== reply.metrics.shares
          ) {
            await prisma.engagementEvent.create({
              data: {
                id: generateUlid(),
                engagement_id: engagementId,
                type: "reply_metrics_update",
                payload: JSON.stringify({
                  postId: reply.postId,
                  previous: prev || { upvotes: 0, replies: 0, shares: 0 },
                  current: reply.metrics,
                  changed: {
                    upvotes: prev ? reply.metrics.upvotes - prev.upvotes : reply.metrics.upvotes,
                    replies: prev ? reply.metrics.replies - prev.replies : reply.metrics.replies,
                    shares: prev ? reply.metrics.shares - prev.shares : reply.metrics.shares,
                  },
                }),
                occurred_at: new Date(),
              },
            });
            eventsCreated.push("reply_metrics_update");
          }
        }
      }
    }

    if (metricsChanged) {
      await prisma.engagementEvent.create({
        data: {
          id: generateUlid(),
          engagement_id: engagementId,
          type: "reaction_snapshot",
          payload: JSON.stringify(currentMetrics),
          occurred_at: new Date(),
        },
      });
      eventsCreated.push("reaction_snapshot");
    }

    await prisma.engagementSession.update({
      where: { id: engagementId },
      data: { last_check_at: new Date() },
    });

    return NextResponse.json({
      success: true,
      detected: userRepliesCombined.length > 0 || metricsChanged || moderationDetected,
      userReplies: userRepliesCombined.length,
      moderationDetected,
      metrics: currentMetrics,
      metricsChanged,
      eventsCreated,
      source: conversationPosts.length > 0 ? "db" : fetchedThread.length > 0 ? "fetch" : "none",
    });
  } catch (error) {
    console.error("Error refreshing engagement:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh engagement" },
      { status: 500 }
    );
  }
}
