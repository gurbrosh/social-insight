/**
 * Normalized URL key for theme "read" grouping (same open destination = same key).
 * Keep in sync with usage in engagement `/api/engagement/open` `dest` and theme list links.
 *
 * Social networks often differ only by query (commentUrn, utm_*, fbclid). Those must not
 * split read state across engagement links vs stored post_url.
 */
export function normalizeThemeReadUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    const base = `${u.protocol}//${host}${path}`;

    // Same resource, different tracking / comment deep-links — ignore query & hash
    if (
      host.includes("linkedin.com") ||
      host.includes("facebook.com") ||
      host === "x.com" ||
      host === "twitter.com" ||
      host.includes("reddit.com") ||
      host.includes("discord.com") ||
      host.includes("youtube.com") ||
      host === "youtu.be"
    ) {
      return base;
    }

    // Default: strip common tracking params; keep meaningful query if any
    const sp = new URLSearchParams(u.search);
    for (const key of [...sp.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_") ||
        lower === "fbclid" ||
        lower === "gclid" ||
        lower === "_ga" ||
        lower === "_gl" ||
        lower === "mc_cid" ||
        lower === "mc_eid"
      ) {
        sp.delete(key);
      }
    }
    const search = sp.toString();
    const qs = search ? `?${search}` : "";
    return `${base}${qs}${u.hash}`;
  } catch {
    return t.toLowerCase();
  }
}

/** Same destination rule as `getThemeMatchDestinationUrl`: prefer direct link, else post URL. */
export function themeDestinationKey(
  linkUrl?: string | null,
  postUrl?: string | null
): string | null {
  const u = (linkUrl || postUrl || "").trim();
  if (!u) return null;
  const k = normalizeThemeReadUrl(u);
  return k || null;
}
