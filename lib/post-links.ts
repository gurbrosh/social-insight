/**
 * Utility functions for generating platform-specific links for posts
 */

export interface PostLinkData {
  url?: string;
  channelId?: string;
  platform: string;
  postId: string;
}

/**
 * Generate the appropriate link for a post based on its platform.
 * Uses stored url when available; otherwise builds a best-effort link from platform + postId.
 */
export function generatePostLink(postData: PostLinkData): string | null {
  const { url, channelId, platform, postId } = postData;
  const plat = platform?.toLowerCase() ?? "";

  // If we have a direct URL, use it for most platforms
  if (url && plat !== "discord") {
    return url;
  }

  // Must have a postId to build a fallback link
  if (!postId || String(postId).trim() === "") {
    if (plat === "discord" && channelId) {
      return `https://discord.com/channels/@me/${channelId}`;
    }
    return url || null;
  }

  const id = String(postId).trim();

  switch (plat) {
    case "discord":
      if (channelId) {
        return `https://discord.com/channels/@me/${channelId}`;
      }
      return url || null;

    case "twitter":
    case "x":
      if (url) return url;
      // X/Twitter status link from status ID (numeric or string)
      return `https://twitter.com/i/status/${id}`;

    case "reddit":
      if (url) return url;
      // Reddit post comments page (post id is in URL)
      return `https://www.reddit.com/comments/${id}`;

    case "linkedin":
      if (url) return url;
      // LinkedIn activity URN: postId may be full URN or just the numeric part
      const urn = id.startsWith("urn:li:activity:") ? id : `urn:li:activity:${id}`;
      return `https://www.linkedin.com/feed/update/${urn}/`;

    case "facebook":
      if (url) return url;
      // Facebook post URLs are not reliably buildable from post ID alone
      return null;

    case "youtube":
      if (url) return url;
      // Video ID in watch URL
      return `https://www.youtube.com/watch?v=${id}`;

    case "blogs":
      if (url) return url;
      // If postId was stored as the article URL (e.g. from some ingest paths), use it
      if (id.startsWith("http://") || id.startsWith("https://")) return id;
      return null;

    default:
      return url || null;
  }
}

/**
 * Check if a post has a valid link that can be displayed
 */
export function hasValidLink(postData: PostLinkData): boolean {
  return generatePostLink(postData) !== null;
}
