/**
 * Normalize YouTube URLs - REMOVED automatic conversion
 *
 * We DON'T convert /c/channelname to @channelname because:
 * - The /c/ custom URL doesn't always match the @handle
 * - Converting incorrectly breaks valid URLs
 * - YouTube redirects /c/ URLs automatically, so they still work
 *
 * This function now only ensures consistent formatting (protocol, www, trailing slashes)
 */
export function normalizeYouTubeUrl(url: string): string {
  if (!url || typeof url !== "string") {
    return url;
  }

  try {
    const urlObj = new URL(url.trim());

    // Only process youtube.com URLs
    if (!urlObj.hostname.toLowerCase().includes("youtube.com")) {
      return url;
    }

    // Ensure www. prefix for consistency
    if (!urlObj.hostname.toLowerCase().startsWith("www.")) {
      urlObj.hostname = `www.${urlObj.hostname}`;
    }

    // Ensure https protocol
    urlObj.protocol = "https:";

    // Remove trailing slashes from pathname (except root)
    if (urlObj.pathname !== "/" && urlObj.pathname.endsWith("/")) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove query params and hash (clean URL)
    urlObj.search = "";
    urlObj.hash = "";

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}
