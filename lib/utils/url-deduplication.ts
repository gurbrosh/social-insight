/**
 * Shared utilities for URL normalization and deduplication
 */

/**
 * Normalize URL for deduplication comparison
 */
export function normalizeUrlForDedup(url: string): string {
  let normalized = url.toLowerCase().trim().replace(/\/+$/, ""); // Remove trailing slashes

  // Normalize protocol
  normalized = normalized.replace(/^https?:\/\//, "");

  // Remove www. prefix
  normalized = normalized.replace(/^www\./, "");

  // Normalize Twitter/X URLs - treat x.com and twitter.com as the same
  normalized = normalized.replace(/^twitter\.com/, "x.com");

  // Remove query params and hash for comparison
  normalized = normalized.split("?")[0].split("#")[0];

  return normalized;
}

/**
 * Create a unique key for deduplication based on link type
 * IMPORTANT: Always includes linkType in the key to prevent collisions between different link types
 */
export function createDedupKey(
  url: string,
  linkType: string,
  platform?: string,
  sourceCategory?: string
): string {
  const normalizedUrl = normalizeUrlForDedup(url.trim());

  // Always prefix with linkType to prevent collisions between different types
  if (linkType === "INFLUENCER") {
    // For influencers, platform is REQUIRED - if missing, include index to prevent collisions
    if (platform) {
      return `INFLUENCER:${platform}:${normalizedUrl}`;
    } else {
      // Platform missing - use a hash of the full URL to create unique keys
      // This prevents all missing-platform links from colliding
      const urlHash = Buffer.from(url.trim()).toString("base64").substring(0, 8);
      console.warn(
        `[createDedupKey] Missing platform for INFLUENCER link: ${url} - using hash to prevent collision`
      );
      return `INFLUENCER:NO_PLATFORM:${urlHash}:${normalizedUrl}`;
    }
  } else if (linkType === "OTHER_SOURCE") {
    // For other sources, source_category is REQUIRED
    if (sourceCategory) {
      return `OTHER_SOURCE:${sourceCategory}:${normalizedUrl}`;
    } else {
      // Source category missing - use hash to prevent collisions
      const urlHash = Buffer.from(url.trim()).toString("base64").substring(0, 8);
      console.warn(
        `[createDedupKey] Missing sourceCategory for OTHER_SOURCE link: ${url} - using hash to prevent collision`
      );
      return `OTHER_SOURCE:NO_CATEGORY:${urlHash}:${normalizedUrl}`;
    }
  } else {
    // For Reddit/Discord, use linkType:URL to distinguish from other types
    return `${linkType}:${normalizedUrl}`;
  }
}
