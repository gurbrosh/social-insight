/**
 * Data transformation utilities for different social media platforms
 * Converts platform-specific data to our standardized Post format
 */

export interface StandardPostData {
  platform: string;
  postId: string;
  authorId?: string;
  authorName?: string;
  authorProfileUrl?: string | null;
  authorHeadline?: string | null;
  authorImageUrl?: string | null;
  content?: string;
  createdAt: string;
  editedAt?: string;
  url?: string;
  channelId?: string;
  threadRefId?: string;
  media?: any;
  metricsLikes?: number;
  metricsComments?: number;
  metricsShares?: number;
  extraJson?: any;
  searchQuery?: string | null;
}

/**
 * Transform Twitter/X post data to standard format
 * Supports multiple Twitter/X scraper formats
 */
export function transformTwitterPost(twitterData: any): StandardPostData {
  // Twitter/X Replies scraper format (new format) - CHECK FIRST
  if (twitterData.replyId && twitterData.replyUrl && twitterData.timestamp) {
    // Root tweet id: postId = post we're scraping replies FROM; fallback inReplyTo / conversationId
    const rootTweetId = twitterData.postId ?? twitterData.inReplyTo ?? twitterData.conversationId;
    const threadRefId =
      rootTweetId != null && rootTweetId !== twitterData.replyId ? String(rootTweetId) : undefined;
    return {
      platform: "x",
      postId: String(twitterData.replyId),
      authorId: twitterData.author?.screenName,
      authorName: twitterData.author?.screenName || twitterData.author?.name,
      content: twitterData.replyText,
      createdAt: new Date(twitterData.timestamp).toISOString(),
      url: twitterData.replyUrl,
      channelId: twitterData.author?.screenName, // Use author as channel
      threadRefId, // Original tweet being replied to (must match root postId in Post table)
      media: twitterData.media || [],
      metricsLikes: twitterData.favouriteCount || 0,
      metricsComments: twitterData.replyCount || 0,
      metricsShares: (twitterData.quoteCount || 0) + (twitterData.repostCount || 0),
      extraJson: {
        ...twitterData,
        viewsCount: twitterData.viewsCount,
        conversationId: twitterData.conversationId,
        inReplyTo: twitterData.inReplyTo,
        author: twitterData.author,
      },
    };
  }

  // X Profile Posts Scraper format (new format)
  if (twitterData.postId && twitterData.postUrl && twitterData.timestamp && twitterData.author) {
    return {
      platform: "x",
      postId: twitterData.postId,
      authorId: twitterData.author.screenName,
      authorName: twitterData.author.name,
      content: twitterData.postText,
      createdAt: new Date(twitterData.timestamp).toISOString(),
      url: twitterData.postUrl,
      channelId: twitterData.author.screenName,
      threadRefId:
        twitterData.conversationId !== twitterData.postId ? twitterData.conversationId : null,
      media: twitterData.media || [],
      metricsLikes: twitterData.favouriteCount || 0,
      metricsComments: twitterData.replyCount || 0,
      metricsShares: twitterData.quoteCount || 0,
      extraJson: {
        ...twitterData,
        author: twitterData.author,
        profileUrl: twitterData.profileUrl,
      },
    };
  }

  // New X.com scraper format (Apify Twitter/X scraper)
  if (twitterData.id && twitterData.username && twitterData.timestamp) {
    // IMPORTANT:
    // - twitterData.id is the ID of *this* tweet (postId)
    // - twitterData.conversationId (when present) represents the root tweet of the thread
    //
    // We MUST NOT set threadRefId to this tweet's own ID, or we will create
    // self-referential chains (postId === threadRefId), which break
    // conversation-thread analysis.
    const postId = twitterData.id;
    const conversationId =
      typeof twitterData.conversationId === "string" ||
      typeof twitterData.conversationId === "number"
        ? twitterData.conversationId.toString()
        : undefined;

    const safeThreadRefId =
      conversationId && conversationId !== postId.toString() ? conversationId : null;

    const handle =
      typeof twitterData.username === "string"
        ? twitterData.username.replace(/^@/, "").trim()
        : "";
    return {
      platform: "x",
      postId: typeof postId === "number" ? String(postId) : postId,
      authorId: twitterData.tweetUserId || twitterData.user?.userId,
      authorName: twitterData.username || twitterData.fullname,
      authorProfileUrl: handle ? `https://x.com/${handle}` : null,
      content: twitterData.text,
      createdAt: twitterData.timestamp,
      url: twitterData.url,
      channelId: twitterData.username, // Use username as channel
      // Use conversationId as the root reference when it differs from this tweet's ID.
      // Never point threadRefId to self.
      threadRefId: safeThreadRefId,
      media: {
        images: twitterData.images || [],
        media: twitterData.media || [],
        user: twitterData.user,
        links: twitterData.links || [],
        searchQuery: twitterData.searchQuery,
      },
      metricsLikes: twitterData.likes || 0,
      metricsComments: twitterData.replies || 0,
      metricsShares: twitterData.retweets || 0,
      extraJson: {
        ...twitterData,
        isQuote: twitterData.isQuote,
        isRetweet: twitterData.isRetweet,
        isReply: twitterData.isReply,
        quotes: twitterData.quotes,
        verified: twitterData.verified,
        avatar: twitterData.avatar,
      },
    };
  }

  // Legacy Twitter API format (backwards compatibility)
  const legacyScreen =
    typeof twitterData.user?.screen_name === "string"
      ? twitterData.user.screen_name.replace(/^@/, "").trim()
      : "";
  return {
    platform: "x",
    postId: twitterData.id_str || twitterData.id?.toString(),
    authorId: twitterData.user?.id_str || twitterData.user?.id?.toString(),
    authorName: twitterData.user?.screen_name || twitterData.user?.name,
    authorProfileUrl: legacyScreen ? `https://x.com/${legacyScreen}` : null,
    content: twitterData.full_text || twitterData.text,
    createdAt: twitterData.created_at,
    url:
      twitterData.url ||
      `https://twitter.com/${twitterData.user?.screen_name}/status/${twitterData.id_str}`,
    channelId: twitterData.user?.screen_name,
    threadRefId: twitterData.in_reply_to_status_id_str,
    media: twitterData.extended_entities?.media || twitterData.entities?.media,
    metricsLikes: twitterData.favorite_count,
    metricsComments: twitterData.reply_count,
    metricsShares: twitterData.retweet_count,
    extraJson: twitterData,
  };
}

/**
 * Transform Reddit post data to standard format
 * Supports both new Reddit scraper format and legacy Reddit API format
 * Handles both posts and comments
 */
export function transformRedditPost(redditData: any): StandardPostData {
  // New Reddit scraper format (Apify Reddit scraper)
  if (
    (redditData.parsedId || redditData.id) &&
    (redditData.createdAt || redditData.commentCreatedAt)
  ) {
    const isPost = redditData.dataType === "post";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isComment = redditData.dataType === "comment";

    // Handle both posts and comments
    const postId = redditData.parsedId || redditData.id; // Use parsedId for posts, id for comments
    const authorId = redditData.parsedAuthorId || redditData.authorId; // Use parsedAuthorId for posts, authorId for comments
    const createdAt = redditData.createdAt || redditData.commentCreatedAt; // Use appropriate timestamp field
    const content = redditData.body || redditData.title; // Prefer body, fallback to title
    const url = redditData.postUrl || redditData.contentUrl || redditData.url; // Use appropriate URL field
    const channelId = redditData.parsedCommunityName || redditData.subredditName; // Use appropriate subreddit field
    const upVotes = redditData.upVotes || redditData.commentUpVotes || 0; // Use appropriate upvotes field

    return {
      platform: "reddit",
      postId: postId,
      authorId: authorId,
      authorName: redditData.authorName,
      content: content,
      createdAt: createdAt,
      url: url,
      channelId: channelId,
      threadRefId: isPost ? null : redditData.parsedParentId || redditData.parentId, // For comments, use parent ID
      media: redditData.media || null,
      metricsLikes: upVotes,
      metricsComments: redditData.commentsCount || 0,
      metricsShares: 0, // Not available in new format
      extraJson: redditData,
    };
  }

  // Legacy Reddit API format (backwards compatibility)
  return {
    platform: "reddit",
    postId: redditData.id,
    authorId: redditData.author,
    authorName: redditData.author,
    content: redditData.selftext || redditData.title,
    createdAt: (() => {
      try {
        const timestamp = redditData.created_utc * 1000;
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) {
          console.warn(`Invalid Reddit timestamp: ${redditData.created_utc}, using current time`);
          return new Date().toISOString();
        }
        return date.toISOString();
      } catch {
        console.warn(
          `Error parsing Reddit timestamp: ${redditData.created_utc}, using current time`
        );
        return new Date().toISOString();
      }
    })(),
    url: `https://reddit.com${redditData.permalink}`,
    channelId: redditData.subreddit,
    threadRefId: redditData.parent_id,
    media: redditData.media || redditData.preview?.images,
    metricsLikes: redditData.ups,
    metricsComments: redditData.num_comments,
    metricsShares: redditData.num_crossposts,
    extraJson: redditData,
  };
}

/**
 * Transform Discord message data to standard format
 */
export function transformDiscordMessage(discordData: any): StandardPostData {
  // Build best-effort text content
  const embedText = Array.isArray(discordData.embeds)
    ? discordData.embeds
        .map((e: any) => {
          const parts: string[] = [];
          if (e?.title) parts.push(String(e.title));
          if (e?.description) parts.push(String(e.description));
          if (e?.footer?.text) parts.push(String(e.footer.text));
          return parts.filter(Boolean).join(" - ");
        })
        .filter((s: string) => s && s.trim() !== "")
        .join("\n")
    : undefined;

  const attachmentText = Array.isArray(discordData.attachments)
    ? discordData.attachments
        .map((a: any) => a?.description || a?.filename)
        .filter((s: string) => s && s.trim() !== "")
        .join(", ")
    : undefined;

  const derivedContent =
    (typeof discordData.content === "string" && discordData.content.trim() !== ""
      ? discordData.content
      : undefined) ||
    (typeof discordData.cleanContent === "string" && discordData.cleanContent.trim() !== ""
      ? discordData.cleanContent
      : undefined) ||
    (typeof embedText === "string" && embedText.trim() !== "" ? embedText : undefined) ||
    (typeof attachmentText === "string" && attachmentText.trim() !== ""
      ? attachmentText
      : undefined) ||
    (typeof discordData.message?.content === "string" && discordData.message.content.trim() !== ""
      ? discordData.message.content
      : undefined);

  return {
    platform: "discord",
    postId: discordData.id,
    authorId: discordData.author?.id,
    authorName: discordData.author?.username || discordData.author?.global_name,
    content: derivedContent,
    createdAt: discordData.timestamp,
    editedAt: discordData.edited_timestamp,
    url: `https://discord.com/channels/${discordData.guild_id}/${discordData.channel_id}/${discordData.id}`,
    channelId: discordData.channel_id,
    threadRefId: discordData.message_reference?.message_id,
    media: discordData.attachments || discordData.embeds,
    metricsLikes: discordData.reactions?.reduce((sum: number, r: any) => sum + r.count, 0),
    metricsComments: 0, // Discord doesn't have comment counts
    metricsShares: 0, // Discord doesn't have share counts
    extraJson: discordData,
  };
}

/**
 * Transform LinkedIn post data to standard format
 */
export function transformLinkedInPost(linkedinData: any): StandardPostData {
  // Handle LinkedIn comment payloads (comment scraper)
  if (linkedinData.comment_id) {
    const commentTimestamp =
      typeof linkedinData.posted_at?.timestamp === "number"
        ? new Date(linkedinData.posted_at.timestamp).toISOString()
        : typeof linkedinData.posted_at?.date === "string"
          ? new Date(linkedinData.posted_at.date).toISOString()
          : new Date().toISOString();
    const authorProfileUrl = linkedinData.author?.profile_url ?? linkedinData.author?.url ?? null;
    const authorHeadline = linkedinData.author?.headline ?? null;
    const authorImageUrl = linkedinData.author?.profile_picture ?? null;
    const searchInput = linkedinData.search_input ?? linkedinData.searchInput ?? null;

    const totalReactions = Number(
      linkedinData.stats?.total_reactions ?? linkedinData.stats?.total_reactions_count ?? 0
    );
    const totalComments = Number(
      linkedinData.stats?.comments ?? linkedinData.stats?.totalComments ?? 0
    );
    const totalShares = Number(linkedinData.stats?.shares ?? 0);

    return {
      platform: "linkedin",
      postId: String(linkedinData.comment_id),
      authorId: linkedinData.author?.profile_id ?? null,
      authorName: linkedinData.author?.name ?? null,
      authorProfileUrl,
      authorHeadline,
      authorImageUrl,
      content: linkedinData.text ?? "",
      createdAt: commentTimestamp,
      editedAt:
        linkedinData.is_edited && linkedinData.posted_at?.timestamp
          ? new Date(linkedinData.posted_at.timestamp).toISOString()
          : undefined,
      url: linkedinData.comment_url ?? undefined,
      channelId: undefined,
      threadRefId: linkedinData.post_input ? String(linkedinData.post_input) : undefined,
      media: linkedinData.media ?? null,
      metricsLikes: Number.isFinite(totalReactions) ? totalReactions : 0,
      metricsComments: Number.isFinite(totalComments) ? totalComments : 0,
      metricsShares: Number.isFinite(totalShares) ? totalShares : 0,
      searchQuery: searchInput,
      extraJson: {
        ...linkedinData,
        authorProfileUrl,
        authorHeadline,
        authorImageUrl,
        searchInput,
      },
    };
  }

  // Extract post ID from URN (e.g., "urn:li:activity:7376993960893960193" -> "7376993960893960193")
  const postId =
    linkedinData.activity_id ||
    (linkedinData.urn && linkedinData.urn.includes(":activity:")
      ? linkedinData.urn.split(":activity:")[1]
      : linkedinData.urn);

  // Try multiple URL sources and construct fallback URL
  let url = linkedinData.url || linkedinData.post_url;

  // If no URL found, try to construct one from the URN
  if (!url && linkedinData.urn && linkedinData.urn.includes(":activity:")) {
    const activityId = linkedinData.urn.split(":activity:")[1];
    const authorName = linkedinData.author?.universalName || linkedinData.author?.name;
    if (activityId && authorName) {
      // Construct LinkedIn post URL: https://www.linkedin.com/posts/[author]/[post-title]-activity-[id]
      url = `https://www.linkedin.com/posts/${authorName}/activity-${activityId}`;
    }
  }

  const authorProfileUrl =
    linkedinData.author?.profile_url ??
    linkedinData.author?.url ??
    linkedinData.authorProfileUrl ??
    null;
  const authorHeadline = linkedinData.author?.headline ?? null;
  const authorImageUrl =
    linkedinData.author?.image_url ?? linkedinData.authorProfilePicture ?? null;
  const searchInput =
    linkedinData.search_input ?? linkedinData.searchInput ?? linkedinData.inputUrl ?? null;

  // Handle multiple timestamp formats
  let postedTimestamp: number | undefined;
  let postedDate: string | undefined;

  // New format: postedAtTimestamp (number) or postedAtISO (string)
  if (typeof linkedinData.postedAtTimestamp === "number") {
    postedTimestamp = linkedinData.postedAtTimestamp;
  } else if (typeof linkedinData.postedAtISO === "string") {
    postedDate = linkedinData.postedAtISO;
  }

  // Legacy format: posted_at.timestamp or posted_at.date
  if (!postedTimestamp && !postedDate) {
    if (typeof linkedinData.posted_at?.timestamp === "number") {
      postedTimestamp = linkedinData.posted_at.timestamp;
    } else if (typeof linkedinData.posted_at?.date === "string") {
      postedDate = linkedinData.posted_at.date;
    }
  }

  const createdAtIso = postedTimestamp
    ? new Date(postedTimestamp).toISOString()
    : postedDate
      ? new Date(postedDate).toISOString()
      : new Date().toISOString();
  const editedAtIso =
    linkedinData.posted_at?.edited && (postedTimestamp || postedDate)
      ? postedTimestamp
        ? new Date(postedTimestamp).toISOString()
        : new Date(postedDate!).toISOString()
      : undefined;

  const rawParentUrn =
    linkedinData.parent_urn ??
    linkedinData.parentUrn ??
    linkedinData.parent?.urn ??
    linkedinData.parent_activity ??
    linkedinData.shareUrn ??
    null;

  let threadRefId: string | null = null;
  if (typeof rawParentUrn === "string" && rawParentUrn.trim() !== "") {
    threadRefId = rawParentUrn.includes(":activity:")
      ? rawParentUrn.split(":activity:")[1] || null
      : rawParentUrn.includes(":ugcPost:")
        ? rawParentUrn.split(":ugcPost:")[1] || null
        : rawParentUrn;
  }

  // Handle metrics from multiple formats
  // New format: numLikes, numComments, numShares
  // Legacy format: stats.total_reactions, stats.comments, stats.shares
  const metricsLikes =
    linkedinData.numLikes !== undefined
      ? Number(linkedinData.numLikes)
      : linkedinData.stats?.total_reactions || 0;
  const metricsComments =
    linkedinData.numComments !== undefined
      ? Number(linkedinData.numComments)
      : linkedinData.stats?.comments || 0;
  const metricsShares =
    linkedinData.numShares !== undefined
      ? Number(linkedinData.numShares)
      : linkedinData.stats?.shares || 0;

  // Handle author name from multiple sources
  const authorName = linkedinData.author?.name ?? linkedinData.authorName ?? null;
  const authorId =
    linkedinData.author?.profile_id ??
    linkedinData.author?.trackingId ??
    linkedinData.authorProfileId ??
    null;

  return {
    platform: "linkedin",
    postId: postId,
    authorId: authorId,
    authorName: authorName,
    authorProfileUrl,
    authorHeadline,
    authorImageUrl,
    content: linkedinData.text,
    createdAt: createdAtIso,
    editedAt: editedAtIso,
    url: url,
    channelId: authorName, // Use author name as channelId for LinkedIn
    threadRefId: threadRefId ?? undefined,
    media: linkedinData.content ?? linkedinData.images ?? null,
    metricsLikes: Number.isFinite(metricsLikes) ? metricsLikes : 0,
    metricsComments: Number.isFinite(metricsComments) ? metricsComments : 0,
    metricsShares: Number.isFinite(metricsShares) ? metricsShares : 0,
    searchQuery: searchInput,
    extraJson: {
      ...linkedinData,
      hashtags: linkedinData.hashtags,
      authorHeadline,
      authorProfileUrl,
      authorImageUrl,
      isReshare: linkedinData.is_reshare ?? linkedinData.isActivity ?? false,
      metadata: linkedinData.metadata,
      searchInput,
      originalUrl: linkedinData.url || linkedinData.post_url, // Keep original for debugging
      constructedUrl: url, // Keep constructed URL for debugging
    },
  };
}

/**
 * Transform Facebook post data to standard format
 */
export function transformFacebookPost(facebookData: any): StandardPostData {
  // Extract author profile fields (available in all formats)
  const authorProfileUrl = facebookData.author?.profileUrl || facebookData.from?.link || null;
  const authorImageUrl =
    facebookData.author?.profilePicture || facebookData.from?.picture?.data?.url || null;
  const authorHeadline = null; // Facebook doesn't provide headline/headline field
  const searchQuery =
    facebookData.searchQuery || facebookData.search_query || facebookData.query || null;

  // Handle Apify Facebook scraper data structure (direct fields)
  if (facebookData.postText || facebookData.postId) {
    return {
      platform: "facebook",
      postId: facebookData.postId || facebookData.id,
      authorId: facebookData.author?.id?.toString(),
      authorName: facebookData.author?.name,
      authorProfileUrl,
      authorHeadline,
      authorImageUrl,
      content: facebookData.postText || facebookData.message || facebookData.story,
      createdAt: facebookData.timestamp
        ? new Date(facebookData.timestamp).toISOString()
        : facebookData.created_time,
      url: facebookData.url || facebookData.permalink_url,
      channelId: facebookData.author?.name,
      threadRefId: facebookData.parent_id,
      media: facebookData.attachments,
      metricsLikes: facebookData.reactionsCount || facebookData.likes?.summary?.total_count,
      metricsComments: facebookData.commentsCount || facebookData.comments?.summary?.total_count,
      metricsShares: facebookData.shares?.count,
      searchQuery,
      extraJson: facebookData,
    };
  }

  // Handle Apify Facebook scraper data structure (nested in extraJson)
  if (facebookData.extraJson) {
    const extra = facebookData.extraJson;
    return {
      platform: "facebook",
      postId: extra.postId || facebookData.id,
      authorId: extra.author?.id?.toString(),
      authorName: extra.author?.name,
      authorProfileUrl: extra.author?.profileUrl || authorProfileUrl,
      authorHeadline,
      authorImageUrl: extra.author?.profilePicture || authorImageUrl,
      content: extra.postText || facebookData.message || facebookData.story,
      createdAt: extra.timestamp
        ? new Date(extra.timestamp).toISOString()
        : facebookData.created_time,
      url: extra.url || facebookData.permalink_url,
      channelId: extra.author?.name,
      threadRefId: facebookData.parent_id,
      media: facebookData.attachments?.data,
      metricsLikes: extra.reactionsCount || facebookData.likes?.summary?.total_count,
      metricsComments: extra.commentsCount || facebookData.comments?.summary?.total_count,
      metricsShares: facebookData.shares?.count,
      searchQuery: extra.searchQuery || searchQuery,
      extraJson: facebookData,
    };
  }

  // Handle standard Facebook API data structure
  return {
    platform: "facebook",
    postId: facebookData.id,
    authorId: facebookData.from?.id?.toString(),
    authorName: facebookData.from?.name,
    authorProfileUrl: facebookData.from?.link || authorProfileUrl,
    authorHeadline,
    authorImageUrl: facebookData.from?.picture?.data?.url || authorImageUrl,
    content: facebookData.message || facebookData.story,
    createdAt: facebookData.created_time,
    url: facebookData.permalink_url,
    channelId: facebookData.from?.name,
    threadRefId: facebookData.parent_id,
    media: facebookData.attachments?.data,
    metricsLikes: facebookData.likes?.summary?.total_count,
    metricsComments: facebookData.comments?.summary?.total_count,
    metricsShares: facebookData.shares?.count,
    searchQuery,
    extraJson: facebookData,
  };
}

/**
 * Identify if a Facebook comment is likely a reply based on content patterns
 */
function isFacebookReply(commentText: string): {
  isReply: boolean;
  confidence: "high" | "medium" | "low";
  mentionedPerson?: string;
} {
  const text = commentText?.trim() || "";
  if (!text) {
    return { isReply: false, confidence: "low" };
  }

  // High confidence: Starts with a person's name (e.g., "Nam Dang...", "Huy Tran...")
  const namePattern = /^([A-Z][a-z]+ [A-Z][a-z]+)/;
  const nameMatch = text.match(namePattern);
  if (nameMatch) {
    return {
      isReply: true,
      confidence: "high",
      mentionedPerson: nameMatch[1],
    };
  }

  // High confidence: Mentions person name + addressing terms
  const addressingTerms = /\b(bác|anh|em|bro|sếp|you|your)\b/i;
  const personMention = /([A-Z][a-z]+ [A-Z][a-z]+)/;
  if (personMention.test(text) && addressingTerms.test(text)) {
    const personMatch = text.match(personMention);
    return {
      isReply: true,
      confidence: "high",
      mentionedPerson: personMatch?.[1],
    };
  }

  // Medium confidence: Very short context-dependent comments
  if (text.length < 10 && (text === "." || text.length < 5)) {
    return { isReply: true, confidence: "medium" };
  }

  // Medium confidence: Mentions person name without addressing
  if (personMention.test(text)) {
    const personMatch = text.match(personMention);
    return {
      isReply: true,
      confidence: "medium",
      mentionedPerson: personMatch?.[1],
    };
  }

  // Low confidence: Has addressing terms and is short
  if (addressingTerms.test(text) && text.length < 50) {
    return { isReply: true, confidence: "low" };
  }

  return { isReply: false, confidence: "low" };
}

/**
 * Try to find parent comment ID for a reply based on content matching
 * This attempts to link replies to their parent comments when possible
 */
function findParentCommentId(
  reply: { text: string; mentionedPerson?: string },
  allComments: Array<{ text: string; generatedId: string }>,
  currentIndex: number
): string | null {
  // If reply mentions a person, try to find a comment by that person
  if (reply.mentionedPerson) {
    // Look backwards through comments to find one that might be the parent
    // (replies usually come after the comment they're replying to)
    for (let i = currentIndex - 1; i >= 0; i--) {
      const comment = allComments[i];
      // Check if this comment's text might be from the mentioned person
      // (we can't know for sure, but this is a heuristic)
      if (comment && comment.text.length > 20) {
        // Return the first substantial comment before this one
        // This is a best-guess approach
        return comment.generatedId;
      }
    }
  }

  // Fallback: Link to the most recent substantial comment before this one
  for (let i = currentIndex - 1; i >= 0; i--) {
    const comment = allComments[i];
    if (comment && comment.text.length > 10) {
      return comment.generatedId;
    }
  }

  return null;
}

/**
 * Generate a unique ID for a Facebook comment
 * Since comments don't have IDs in this scraper format, we generate one
 */
function generateFacebookCommentId(text: string, facebookUrl: string, index: number): string {
  // Try to create a hash-like ID from text + URL + index
  // This ensures uniqueness while being deterministic
  const combined = `${facebookUrl}-${text.substring(0, 50)}-${index}`;
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `fb_comment_${Math.abs(hash)}_${index}`;
}

/**
 * Transform Facebook comment data to standard format
 * Handles the flat array structure where replies are mixed with top-level comments
 */
export function transformFacebookComment(
  commentData: any,
  allComments: Array<{ text: string; generatedId: string }> = [],
  currentIndex: number = 0
): StandardPostData {
  // Extract text from multiple possible fields, with fallbacks
  const text = (
    commentData.text?.trim() ||
    commentData.commentText?.trim() ||
    commentData.content?.trim() ||
    commentData.message?.trim() ||
    ""
  ).trim();
  const facebookUrl = commentData.facebookUrl || "";
  const postTitle = commentData.postTitle || "";

  // Generate unique ID for this comment
  const generatedId = generateFacebookCommentId(text, facebookUrl, currentIndex);

  // Identify if this is a reply
  const replyInfo = isFacebookReply(text);

  // Extract root post ID from URL if possible
  // All comments from the same root post have the same facebookUrl
  let rootPostId: string | undefined = undefined;
  if (facebookUrl) {
    try {
      const url = new URL(facebookUrl);
      // First try query params (story_fbid or fbid)
      const storyFbid = url.searchParams.get("story_fbid") || url.searchParams.get("fbid");
      if (storyFbid) {
        rootPostId = storyFbid;
      } else {
        // Try to extract from /groups/{group}/permalink/{postId}/ path (group permalinks)
        const groupPermalinkMatch = facebookUrl.match(/\/groups\/[^\/]+\/permalink\/([^\/]+)\//);
        if (groupPermalinkMatch) {
          rootPostId = groupPermalinkMatch[1];
        } else {
          // Try to extract from /posts/pfbid... path (most common)
          const postsMatch = facebookUrl.match(/\/posts\/(pfbid[a-zA-Z0-9]+)/);
          if (postsMatch) {
            rootPostId = postsMatch[1];
          } else {
            // Try to extract from /reel/ path
            const reelMatch = facebookUrl.match(/\/reel\/([^/?]+)/);
            if (reelMatch) {
              rootPostId = reelMatch[1];
            } else {
              // Try to extract from permalink query params
              const permalinkMatch = facebookUrl.match(/[?&]story_fbid=([^&]+)/);
              if (permalinkMatch) {
                rootPostId = permalinkMatch[1];
              } else {
                // Try to extract from any /posts/ path
                const postsPathMatch = facebookUrl.match(/\/posts\/([^/?]+)/);
                if (postsPathMatch) {
                  rootPostId = postsPathMatch[1];
                }
              }
            }
          }
        }
      }
    } catch {
      // URL parsing failed, try regex extraction directly
      // Try /groups/{group}/permalink/{postId}/ pattern (group permalinks)
      const groupPermalinkMatch = facebookUrl.match(/\/groups\/[^\/]+\/permalink\/([^\/]+)\//);
      if (groupPermalinkMatch) {
        rootPostId = groupPermalinkMatch[1];
      } else {
        // Try /posts/pfbid... pattern
        const postsMatch = facebookUrl.match(/\/posts\/(pfbid[a-zA-Z0-9]+)/);
        if (postsMatch) {
          rootPostId = postsMatch[1];
        } else {
          // Try /reel/ pattern
          const reelMatch = facebookUrl.match(/\/reel\/([^/?]+)/);
          if (reelMatch) {
            rootPostId = reelMatch[1];
          } else {
            // Fallback: generate ID from URL hash
            let hash = 0;
            for (let i = 0; i < facebookUrl.length; i++) {
              const char = facebookUrl.charCodeAt(i);
              hash = (hash << 5) - hash + char;
              hash = hash & hash;
            }
            rootPostId = `fb_post_${Math.abs(hash)}`;
          }
        }
      }
    }
  }

  // Try to find parent comment ID if this is a reply to another comment
  let threadRefId: string | undefined = undefined;
  if (replyInfo.isReply && allComments.length > 0) {
    const parentId = findParentCommentId(
      { text, mentionedPerson: replyInfo.mentionedPerson },
      allComments,
      currentIndex
    );
    if (parentId) {
      threadRefId = parentId;
    }
  }

  // If this is a top-level comment (not a reply to another comment),
  // link it to the root post using the root post ID extracted from URL
  if (!threadRefId && rootPostId) {
    threadRefId = rootPostId;
  }

  // Generate unique comment ID using commentData.id or feedbackId if available
  // Otherwise use generated ID combined with root post ID if available
  let commentPostId: string;
  if (commentData.id) {
    commentPostId = commentData.id;
  } else if (commentData.feedbackId) {
    commentPostId = commentData.feedbackId;
  } else if (rootPostId) {
    commentPostId = `${rootPostId}_comment_${currentIndex}_${generatedId}`;
  } else {
    commentPostId = generatedId;
  }

  // Ensure createdAt is always set - use current time as fallback
  const createdAt = new Date().toISOString();

  return {
    platform: "facebook",
    postId: commentPostId,
    authorId: undefined, // Not available in this scraper format
    authorName: undefined, // Not available in this scraper format
    authorProfileUrl: null,
    authorHeadline: null,
    authorImageUrl: null,
    content: text,
    createdAt: createdAt, // Timestamp not available, use current time
    url: facebookUrl,
    channelId: postTitle.substring(0, 100), // Use post title as channel identifier
    threadRefId: threadRefId,
    media: null,
    metricsLikes: parseInt(commentData.likesCount || "0", 10) || 0,
    metricsComments: 0, // Comments don't have nested comment counts
    metricsShares: 0,
    searchQuery: null,
    extraJson: {
      ...commentData,
      isReply: replyInfo.isReply,
      replyConfidence: replyInfo.confidence,
      mentionedPerson: replyInfo.mentionedPerson,
      generatedCommentId: generatedId,
      postTitle: postTitle,
    },
  };
}

/**
 * Extract the root post from Facebook comments data
 * The postTitle field contains the original post content
 */
function extractFacebookRootPost(commentsArray: any[]): StandardPostData | null {
  if (!commentsArray || commentsArray.length === 0) {
    return null;
  }

  // Get postTitle and URL from first comment (all comments have same postTitle)
  const firstComment = commentsArray[0];
  const postTitle = firstComment.postTitle || "";
  const facebookUrl = firstComment.facebookUrl || "";

  if (!postTitle || !facebookUrl) {
    return null;
  }

  // Extract post ID from URL (must match the logic in transformFacebookComment)
  let rootPostId: string | undefined = undefined;
  try {
    const url = new URL(facebookUrl);
    // First try query params (story_fbid or fbid)
    const storyFbid = url.searchParams.get("story_fbid") || url.searchParams.get("fbid");
    if (storyFbid) {
      rootPostId = storyFbid;
    } else {
      // Try to extract from /groups/{group}/permalink/{postId}/ path (group permalinks)
      const groupPermalinkMatch = facebookUrl.match(/\/groups\/[^\/]+\/permalink\/([^\/]+)\//);
      if (groupPermalinkMatch) {
        rootPostId = groupPermalinkMatch[1];
      } else {
        // Try to extract from /posts/pfbid... path (most common)
        const postsMatch = facebookUrl.match(/\/posts\/(pfbid[a-zA-Z0-9]+)/);
        if (postsMatch) {
          rootPostId = postsMatch[1];
        } else {
          // Try to extract from /reel/ path
          const reelMatch = facebookUrl.match(/\/reel\/([^/?]+)/);
          if (reelMatch) {
            rootPostId = reelMatch[1];
          } else {
            // Try to extract from permalink query params
            const permalinkMatch = facebookUrl.match(/[?&]story_fbid=([^&]+)/);
            if (permalinkMatch) {
              rootPostId = permalinkMatch[1];
            } else {
              // Try to extract from any /posts/ path
              const postsPathMatch = facebookUrl.match(/\/posts\/([^/?]+)/);
              if (postsPathMatch) {
                rootPostId = postsPathMatch[1];
              }
            }
          }
        }
      }
    }
  } catch {
    // URL parsing failed, try regex extraction directly
    // Try /groups/{group}/permalink/{postId}/ pattern (group permalinks)
    const groupPermalinkMatch = facebookUrl.match(/\/groups\/[^\/]+\/permalink\/([^\/]+)\//);
    if (groupPermalinkMatch) {
      rootPostId = groupPermalinkMatch[1];
    } else {
      // Try /posts/pfbid... pattern
      const postsMatch = facebookUrl.match(/\/posts\/(pfbid[a-zA-Z0-9]+)/);
      if (postsMatch) {
        rootPostId = postsMatch[1];
      } else {
        // Try /reel/ pattern
        const reelMatch = facebookUrl.match(/\/reel\/([^/?]+)/);
        if (reelMatch) {
          rootPostId = reelMatch[1];
        } else {
          // Fallback: generate ID from URL hash
          let hash = 0;
          for (let i = 0; i < facebookUrl.length; i++) {
            const char = facebookUrl.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
          }
          rootPostId = `fb_post_${Math.abs(hash)}`;
        }
      }
    }
  }

  // If we still don't have a postId, generate one from URL hash
  if (!rootPostId) {
    let hash = 0;
    for (let i = 0; i < facebookUrl.length; i++) {
      const char = facebookUrl.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    rootPostId = `fb_post_${Math.abs(hash)}`;
  }

  // Extract channel/group ID from URL if possible
  let channelId: string | undefined = undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const url = new URL(facebookUrl);
    // Facebook group URLs often have /groups/{group_id}/
    const groupsMatch = facebookUrl.match(/\/groups\/([^\/]+)\//);
    if (groupsMatch) {
      channelId = groupsMatch[1];
    } else {
      // Use post title as channel identifier fallback
      channelId = postTitle.substring(0, 100);
    }
  } catch {
    channelId = postTitle.substring(0, 100);
  }

  // Count total comments and likes from the comments array
  const totalComments = commentsArray.length;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const totalLikes = commentsArray.reduce((sum, comment) => {
    return sum + (parseInt(comment.likesCount || "0", 10) || 0);
  }, 0);

  // Ensure createdAt is always set - use current time as fallback
  const createdAt = new Date().toISOString();

  return {
    platform: "facebook",
    postId: rootPostId,
    authorId: undefined, // Not available in this scraper format
    authorName: undefined, // Not available in this scraper format
    authorProfileUrl: null,
    authorHeadline: null,
    authorImageUrl: null,
    content: postTitle, // The original post content
    createdAt: createdAt, // Timestamp not available, use current time
    url: facebookUrl,
    channelId: channelId,
    threadRefId: undefined, // Root post has no parent
    media: null,
    metricsLikes: 0, // Original post likes not available in comments scraper
    metricsComments: totalComments, // Total number of comments
    metricsShares: 0, // Shares not available
    searchQuery: null,
    extraJson: {
      postTitle: postTitle,
      facebookUrl: facebookUrl,
      isRootPost: true,
      extractedFromComments: true,
    },
  };
}

/**
 * Transform an array of Facebook comments, identifying hierarchy
 * This processes all comments together to establish parent-child relationships
 * Returns both the root post and all comments
 */
export function transformFacebookComments(
  commentsArray: any[],
  rootPostId?: string
): { rootPost: StandardPostData | null; comments: StandardPostData[] } {
  // Extract root post from postTitle if not provided
  const rootPost = rootPostId
    ? null // Root post already exists, don't extract
    : extractFacebookRootPost(commentsArray);

  // Use provided rootPostId or extract from root post
  const finalRootPostId = rootPostId || rootPost?.postId;

  // First pass: Generate IDs for all comments
  const commentsWithIds = commentsArray.map((comment, index) => {
    const text = comment.text?.trim() || "";
    const facebookUrl = comment.facebookUrl || "";
    const generatedId = generateFacebookCommentId(text, facebookUrl, index);
    return {
      text,
      generatedId,
      originalData: comment,
      index,
    };
  });

  // Second pass: Transform each comment with knowledge of all comments
  const transformedComments = commentsWithIds.map((commentWithId, index) => {
    const allComments = commentsWithIds.slice(0, index).map((c) => ({
      text: c.text,
      generatedId: c.generatedId,
    }));

    const transformed = transformFacebookComment(commentWithId.originalData, allComments, index);

    // If this is a top-level comment (not a reply), link it to the root post
    if (!transformed.threadRefId && finalRootPostId) {
      transformed.threadRefId = finalRootPostId;
    }

    return transformed;
  });

  return {
    rootPost: rootPost,
    comments: transformedComments,
  };
}

/**
 * Extract the root post from LinkedIn comments data
 * The LinkedIn Comments scraper returns root post data at the top level
 * We use shareUrn as the postId so comments can link to it
 */
function extractLinkedInRootPost(linkedinData: any): StandardPostData | null {
  if (!linkedinData || !linkedinData.shareUrn) {
    return null;
  }

  // Use shareUrn as the postId (comments link via shareUrn)
  const rootPostId = linkedinData.shareUrn;

  // Extract text content
  const content = linkedinData.text || "";

  // Extract URL
  const url = linkedinData.url || "";

  // Extract author info
  const author = linkedinData.author || linkedinData.activityOfCompany || null;
  const authorName = author?.name || null;
  const authorId = author?.profile_id || author?.trackingId || author?.id || null;
  const authorProfileUrl = author?.profile_url || author?.url || null;
  const authorHeadline = author?.headline || author?.occupation || null;
  const authorImageUrl = author?.picture || author?.logoUrl || null;

  // Extract timestamp
  let createdAt: string;
  if (linkedinData.timeSincePosted) {
    // Parse relative time (e.g., "1h", "2d") - use current time as fallback
    createdAt = new Date().toISOString();
  } else if (linkedinData.postedAtTimestamp) {
    createdAt = new Date(linkedinData.postedAtTimestamp).toISOString();
  } else if (linkedinData.postedAtISO) {
    createdAt = new Date(linkedinData.postedAtISO).toISOString();
  } else {
    createdAt = new Date().toISOString();
  }

  // Extract metrics
  // Priority: numLikes/numComments/numShares (new format) > stats (legacy) > array lengths (fallback)
  const metricsLikes =
    linkedinData.numLikes !== undefined
      ? Number(linkedinData.numLikes)
      : linkedinData.stats?.total_reactions ||
        (Array.isArray(linkedinData.reactions) ? linkedinData.reactions.length : 0) ||
        0;
  const metricsComments =
    linkedinData.numComments !== undefined
      ? Number(linkedinData.numComments)
      : linkedinData.stats?.comments ||
        (Array.isArray(linkedinData.comments) ? linkedinData.comments.length : 0) ||
        0;
  const metricsShares =
    linkedinData.numShares !== undefined
      ? Number(linkedinData.numShares)
      : linkedinData.stats?.shares || 0;

  return {
    platform: "linkedin",
    postId: rootPostId, // Use shareUrn as postId
    authorId: authorId,
    authorName: authorName,
    authorProfileUrl: authorProfileUrl,
    authorHeadline: authorHeadline,
    authorImageUrl: authorImageUrl,
    content: content,
    createdAt: createdAt,
    url: url,
    channelId: undefined,
    threadRefId: undefined, // Root post has no parent
    media: linkedinData.media || null,
    metricsLikes: Number.isFinite(metricsLikes) ? Number(metricsLikes) : 0,
    metricsComments: Number.isFinite(metricsComments) ? Number(metricsComments) : 0,
    metricsShares: Number.isFinite(metricsShares) ? Number(metricsShares) : 0,
    searchQuery: linkedinData.search_input || linkedinData.searchInput || null,
    extraJson: {
      ...linkedinData,
      isRootPost: true,
      extractedFromComments: true,
      urn: linkedinData.urn,
      shareUrn: linkedinData.shareUrn,
    },
  };
}

/**
 * Transform LinkedIn comments data
 * The LinkedIn Comments scraper returns root post data at top level with a comments array
 * Returns both the root post and all comments
 */
export function transformLinkedInComments(linkedinData: any): {
  rootPost: StandardPostData | null;
  comments: StandardPostData[];
} {
  // Extract root post from top-level data
  const rootPost = extractLinkedInRootPost(linkedinData);
  const rootPostId = rootPost?.postId || linkedinData.shareUrn;

  // Process comments array
  const commentsArray = Array.isArray(linkedinData.comments) ? linkedinData.comments : [];
  const transformedComments: StandardPostData[] = [];

  for (let i = 0; i < commentsArray.length; i++) {
    const comment = commentsArray[i];

    // Extract comment ID from link URL if available
    // Link format: https://www.linkedin.com/feed/update/urn:li:ugcPost:...?commentUrn=urn%3Ali%3Acomment%3A%28ugcPost%3A...%2C7396653741174648832%29
    // We need to extract the comment ID (the number after the comma in the commentUrn)
    let commentId: string | undefined = undefined;
    if (comment.link) {
      try {
        const url = new URL(comment.link);
        const commentUrn = url.searchParams.get("commentUrn");
        if (commentUrn) {
          // Decode the URN: urn:li:comment:(ugcPost:...,COMMENT_ID)
          const decoded = decodeURIComponent(commentUrn);
          const match = decoded.match(/urn:li:comment:\([^,]+,\s*(\d+)\)/);
          if (match && match[1]) {
            commentId = match[1];
          }
        }
      } catch {
        // URL parsing failed, fall back to generated ID
      }
    }

    // Fallback: generate ID from comment text + index if no ID found
    if (!commentId) {
      commentId = `linkedin_comment_${i}_${comment.text?.substring(0, 20)?.replace(/[^a-zA-Z0-9]/g, "") || i}`;
    }

    // Transform comment using existing transformLinkedInPost
    // CRITICAL: Set post_input to rootPostId (shareUrn) so threadRefId links correctly
    // Also ensure author name is properly formatted (firstName + lastName)
    const authorName = comment.author
      ? `${comment.author.firstName || ""} ${comment.author.lastName || ""}`.trim() ||
        comment.author.name
      : undefined;

    const commentData = {
      ...comment,
      comment_id: commentId,
      post_input: rootPostId, // Link to root post via shareUrn
      shareUrn: rootPostId, // Also set shareUrn for consistency
      // Ensure timestamp is properly formatted for transformLinkedInPost
      posted_at: comment.time
        ? {
            timestamp: comment.time,
            date: new Date(comment.time).toISOString(),
          }
        : undefined,
      // Ensure author name is available (transformLinkedInPost expects author.name)
      author: comment.author
        ? {
            ...comment.author,
            name: authorName || comment.author.name,
            profile_id: comment.author.id || comment.author.profileId || comment.author.trackingId,
          }
        : undefined,
      // Map comment.link to comment_url for transformLinkedInPost
      comment_url: comment.link,
    };

    const transformed = transformLinkedInPost(commentData);

    // CRITICAL: Override threadRefId to use root post's shareUrn (not URL)
    // The root post uses shareUrn as postId, so comments must link via shareUrn
    // This ensures comments.link to root posts correctly
    if (rootPostId) {
      transformed.threadRefId = rootPostId;
    }

    // Ensure createdAt is set from comment.time if available
    if (comment.time && typeof comment.time === "number") {
      transformed.createdAt = new Date(comment.time).toISOString();
    }

    transformedComments.push(transformed);
  }

  return {
    rootPost: rootPost,
    comments: transformedComments,
  };
}

/**
 * Generic transformer that tries to detect platform and apply appropriate transformation
 */
export function transformGenericPost(data: any, platform?: string): StandardPostData {
  // If platform is specified, use appropriate transformer
  if (platform) {
    switch (platform.toLowerCase()) {
      case "twitter":
      case "x":
      case "X":
        return transformTwitterPost(data);
      case "reddit":
        return transformRedditPost(data);
      case "discord":
        return transformDiscordMessage(data);
      case "linkedin":
        return transformLinkedInPost(data);
      case "facebook":
        // CRITICAL: Check if this is a Facebook comment format BEFORE using transformFacebookPost
        // Facebook Comments Scraper returns items with postTitle, text, likesCount, facebookUrl
        if (
          data.postTitle &&
          data.text !== undefined &&
          data.likesCount !== undefined &&
          data.facebookUrl &&
          !data.postId &&
          !data.postText
        ) {
          // This is a Facebook comment, use the comment transformer
          return transformFacebookComment(data, [], 0);
        }
        // Otherwise, it's a regular Facebook post
        return transformFacebookPost(data);
      case "youtube": {
        // YouTube: treat comments and replies the same — both link to the video for conversation analysis (Influencers, Chatter, Themes).
        // CRITICAL: Check type field first (Comments scraper returns both videos and comments in same dataset).
        const itemType = data.type?.toLowerCase();
        if (itemType === "comment" || itemType === "reply") {
          return transformYouTubeCommentOrReply(data);
        }
        if (itemType === "video" || itemType === "shorts") {
          return transformYouTubeVideo(data);
        }
        // Fallback: detect by structure
        // CRITICAL: Always use comment transformer for comment-shaped items so they get threadRefId (or null for fallback).
        // Requiring hasVideoId caused comments to be treated as videos (roots), so threads had 0 replies.
        const isCommentOrReply =
          data.comment_id != null ||
          data.comment_text != null ||
          data.comment != null ||
          data.reply_id != null ||
          data.reply_text != null ||
          data.parent_comment_id != null ||
          (data.text != null &&
            data.title == null &&
            !data.channelName &&
            !Array.isArray(data.subtitles)) ||
          (data.snippet?.textDisplay != null && data.snippet?.parentId != null);
        if (isCommentOrReply) {
          return transformYouTubeCommentOrReply(data);
        }
        return transformYouTubeVideo(data);
      }
      default:
        return transformUnknownPlatform(data, platform);
    }
  }

  // YouTube: treat comments and replies the same — both link to the video for conversation analysis.
  // Check type field first (Comments scraper returns both videos and comments in same dataset).
  const ytItemType = data.type?.toLowerCase();
  if (ytItemType === "comment" || ytItemType === "reply") {
    return transformYouTubeCommentOrReply(data);
  }
  if (ytItemType === "video" || ytItemType === "shorts") {
    return transformYouTubeVideo(data);
  }
  const ytVideoId =
    data.videoId ?? data.video_id ?? extractYouTubeVideoIdFromUrl(data.url ?? data.video_url);
  const ytCommentOrReply =
    data.comment_id != null ||
    data.comment_text != null ||
    data.comment != null ||
    data.reply_id != null ||
    data.reply_text != null ||
    data.parent_comment_id != null ||
    (data.text != null &&
      data.title == null &&
      !data.channelName &&
      !Array.isArray(data.subtitles)) ||
    (data.snippet?.textDisplay != null && data.snippet?.parentId != null);
  if (ytVideoId && ytCommentOrReply) {
    return transformYouTubeCommentOrReply(data);
  }

  // Detect YouTube scraper format (id, url, channelName, subtitles, etc.)
  if (
    data.id != null &&
    data.url &&
    (data.channelName != null || data.channelId != null) &&
    (Array.isArray(data.subtitles) || data.date)
  ) {
    return transformYouTubeVideo(data);
  }

  // Try to auto-detect platform based on data structure
  if (data.id_str || data.user?.screen_name) {
    return transformTwitterPost(data);
  }
  if (data.subreddit || data.permalink) {
    return transformRedditPost(data);
  }
  if (data.guild_id || data.channel_id) {
    return transformDiscordMessage(data);
  }
  if (data.activity_id && data.post_url && data.author?.profile_id) {
    return transformLinkedInPost(data);
  }
  if (data.from?.id || data.created_time) {
    return transformFacebookPost(data);
  }
  // Detect Apify Facebook scraper data structure (direct fields)
  if (data.postText && data.postId) {
    return transformFacebookPost(data);
  }
  // Detect Apify Facebook scraper data structure (nested in extraJson)
  if (data.extraJson?.postId && data.extraJson?.author?.id) {
    return transformFacebookPost(data);
  }

  // Detect Facebook comments scraper format (has postTitle, text, likesCount, facebookUrl)
  // This is the flat array format where comments and replies are mixed
  if (
    data.postTitle &&
    data.text !== undefined &&
    data.likesCount !== undefined &&
    data.facebookUrl
  ) {
    // This is a Facebook comment, use the comment transformer
    // Note: For full hierarchy detection, use transformFacebookComments() on the full array
    // This single-item transformer will still work but won't have full context
    return transformFacebookComment(data, [], 0);
  }

  // Fallback to unknown platform
  return transformUnknownPlatform(data, "unknown");
}

/**
 * Extract YouTube video ID from a URL (e.g. watch?v=ID or youtu.be/ID).
 * Used to link comments to the root video for chatter thread construction.
 */
export function extractYouTubeVideoIdFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be" && u.pathname.slice(1)) return u.pathname.slice(1).split("/")[0];
    return u.searchParams.get("v");
  } catch {
    const m = url.match(/(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
}

/**
 * YouTube Comments/Replies → StandardPostData.
 * Comments and replies are treated the same: both attach to the video root (threadRefId = video ID)
 * so the full conversation is analyzed for Influencers, Chatter, and Themes.
 * Accepts comment-shaped (comment_id, comment_text) and reply-shaped (reply_id, reply_text, parent_comment_id) items.
 */
export function transformYouTubeCommentOrReply(data: any): StandardPostData {
  // Derive video ID from any common scraper field so comments link to the video root (threadRefId) for chatter.
  // Comments scraper uses pageUrl field for the video URL.
  const videoId =
    data.videoId ??
    data.video_id ??
    (typeof data.videoUrl === "string" && /^[a-zA-Z0-9_-]{11}$/.test(data.videoUrl.trim())
      ? data.videoUrl.trim()
      : null) ??
    extractYouTubeVideoIdFromUrl(
      data.pageUrl ??
        data.url ??
        data.video_url ??
        data.comment_url ??
        data.videoUrl ??
        data.sourceUrl
    ) ??
    null;
  const content =
    data.comment_text ??
    data.reply_text ??
    data.comment ??
    data.text ??
    data.content ??
    data.snippet?.textDisplay ??
    "";
  const createdAt =
    (data.published_at ?? data.publishedAt ?? data.date ?? data.created_at ?? data.timestamp)
      ? new Date(
          typeof data.published_at === "string"
            ? data.published_at
            : typeof data.published_at === "number"
              ? data.published_at
              : (data.publishedAt ?? data.date ?? data.created_at ?? data.timestamp ?? Date.now())
        ).toISOString()
      : new Date().toISOString();
  const author = data.author ?? data.snippet?.authorDisplayName ?? data.channel;
  const authorName =
    typeof author === "string"
      ? author
      : (author?.display_name ?? author?.displayName ?? author?.name);
  const authorId =
    typeof author === "object" && author != null
      ? (author.channel_id ?? author.channelId ?? author.id)
      : undefined;
  // Profile URL: object channel_url/channelUrl, or derive from author handle (e.g. "@carriedistefano3871" → https://www.youtube.com/@carriedistefano3871)
  const authorProfileUrlFromObject =
    typeof author === "object" && author != null
      ? ((author as { channel_url?: string; channelUrl?: string }).channel_url ??
        (author as { channel_url?: string; channelUrl?: string }).channelUrl)
      : undefined;
  const authorHandle =
    typeof author === "string" && author.trim() !== ""
      ? author.trim().replace(/^@/, "")
      : undefined;
  const channelIdForUrl =
    typeof authorId === "string" && authorId.trim() !== "" && /^UC[\w-]{22}$/.test(authorId.trim())
      ? authorId.trim()
      : undefined;
  const authorProfileUrl =
    authorProfileUrlFromObject ??
    (authorHandle ? `https://www.youtube.com/@${authorHandle}` : undefined) ??
    (channelIdForUrl ? `https://www.youtube.com/channel/${channelIdForUrl}` : undefined);

  const postId = (
    data.comment_id ??
    data.reply_id ??
    data.id ??
    data.commentId ??
    `yt_${videoId ?? "unknown"}_${createdAt}`
  ).toString();

  return {
    platform: "youtube",
    postId,
    authorId: authorId ?? undefined,
    authorName: authorName ?? undefined,
    authorProfileUrl,
    content: content?.trim() || undefined,
    createdAt,
    url:
      data.url ??
      data.comment_url ??
      (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined),
    channelId: authorId ?? undefined,
    threadRefId: videoId ?? undefined,
    media: undefined,
    metricsLikes:
      typeof (data.like_count ?? data.likes ?? data.likeCount) === "number"
        ? (data.like_count ?? data.likes ?? data.likeCount)
        : undefined,
    metricsComments:
      typeof (data.reply_count ?? data.replies ?? data.replyCount) === "number"
        ? (data.reply_count ?? data.replies ?? data.replyCount)
        : undefined,
    metricsShares: undefined,
    extraJson: data,
    searchQuery: undefined,
  };
}

/** @deprecated Use transformYouTubeCommentOrReply. Comments and replies are treated the same. */
export const transformYouTubeComment = transformYouTubeCommentOrReply;

function parseYoutubeDateish(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.$date === "string" || typeof o.$date === "number") {
      return parseYoutubeDateish(o.$date);
    }
  }
  return null;
}

/**
 * Best-effort publish time from Apify / YouTube-shaped scraper payloads.
 * Used so Post.createdAt reflects when the video was published (not ingest time), which fixes project "last N days" filters.
 */
export function extractYouTubePublishTimestamp(data: any): Date | null {
  if (!data || typeof data !== "object") return null;
  const candidates: unknown[] = [
    data.date,
    data.publishedAt,
    data.published_at,
    data.publishedTime,
    data.uploadDate,
    data.upload_date,
    data.publishDate,
    data.publishedDate,
    data.timePublished,
    data.timestamp,
    data.snippet?.publishedAt,
    data.snippet?.published_at,
    data.video?.publishedAt,
    data.videoDetails?.publishDate,
    data.videoDetails?.publishedAt,
    data.details?.publishedAt,
  ];
  for (const c of candidates) {
    const d = parseYoutubeDateish(c);
    if (d) return d;
  }
  const ca = data.createdAt ?? data.created_at;
  if (ca !== undefined && ca !== null) {
    return parseYoutubeDateish(ca);
  }
  return null;
}

/**
 * YouTube Scraper output → DownstreamPost mapping
 *
 * Scraper field          → DownstreamPost / StandardPostData
 * ─────────────────────────────────────────────────────────
 * id                     → postId
 * url                    → url
 * title                  → content (combined with text)
 * text                   → content (description)
 * date / publishedAt / … → createdAt (see extractYouTubePublishTimestamp)
 * channelId              → authorId, channelId
 * channelName            → authorName
 * channelUrl             → authorProfileUrl
 * likes                  → metricsLikes
 * commentsCount          → metricsComments
 * thumbnailUrl           → media[0].url
 * input                  → search_query
 * (full item)            → extraJson
 *
 * Transcript: subtitles[0].srt → extracted to plain text → DownstreamPost.transcript
 * Summary: OpenAI summarizes transcript → DownstreamPost.summary, ai_processed_at set
 */
export function transformYouTubeVideo(data: any): StandardPostData {
  const extracted = extractYouTubePublishTimestamp(data);
  const createdAt = extracted != null ? extracted.toISOString() : new Date().toISOString();
  const content = [data.title, data.text].filter(Boolean).join("\n\n");
  return {
    platform: "youtube",
    postId: (data.id ?? data.videoId ?? "unknown").toString(),
    authorId: data.channelId ?? undefined,
    authorName: data.channelName ?? undefined,
    authorProfileUrl: data.channelUrl ?? undefined,
    content: content || undefined,
    createdAt,
    url: data.url ?? undefined,
    channelId: data.channelId ?? undefined,
    media: data.thumbnailUrl ? [{ url: data.thumbnailUrl, type: "thumbnail" }] : undefined,
    metricsLikes: typeof data.likes === "number" ? data.likes : undefined,
    metricsComments: typeof data.commentsCount === "number" ? data.commentsCount : undefined,
    metricsShares: undefined,
    extraJson: data,
    searchQuery: data.input ?? undefined,
  };
}

/**
 * Transform data from unknown platform to standard format
 */
function transformUnknownPlatform(data: any, platform: string): StandardPostData {
  // Ensure createdAt is always set - use current time as fallback
  const createdAt = data.createdAt || data.created_at || data.timestamp || new Date().toISOString();

  return {
    platform,
    postId: data.id?.toString() || data.postId || data.message_id || "unknown",
    authorId: data.authorId || data.author?.id || data.user_id,
    authorName: data.authorName || data.author?.name || data.username,
    content: data.content || data.text || data.message || data.body || "",
    createdAt: createdAt,
    editedAt: data.editedAt || data.edited_at || data.edited_timestamp,
    url: data.url || data.permalink || data.link,
    channelId: data.channelId || data.channel_id || data.subreddit || data.group_id,
    threadRefId: data.threadRefId || data.thread_ref_id || data.parent_id,
    media: data.media || data.attachments || data.images,
    metricsLikes: data.metricsLikes || data.likes || data.upvotes || data.favorites,
    metricsComments: data.metricsComments || data.comments || data.replies,
    metricsShares: data.metricsShares || data.shares || data.retweets,
    extraJson: data,
  };
}

/**
 * Validate that transformed data has required fields
 */
export function validatePostData(postData: StandardPostData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!postData.platform) {
    errors.push("Platform is required");
  }

  if (!postData.postId) {
    errors.push("Post ID is required");
  }

  if (!postData.createdAt) {
    errors.push("Created date is required");
  } else {
    // Validate date format
    const date = new Date(postData.createdAt);
    if (isNaN(date.getTime())) {
      errors.push("Invalid created date format");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
