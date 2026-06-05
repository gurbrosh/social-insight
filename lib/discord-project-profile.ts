/**
 * Derives the Discord channel snowflake ID from a ProjectProfile.url for configured Discord channels.
 * Handles https://discord.com/channels/... , discordapp.com, path-only URLs, and raw numeric IDs.
 */
export function extractDiscordChannelIdFromProjectProfileUrl(url: string): string | null {
  const raw = (url || "").trim();
  if (!raw) return null;

  const fromDiscordHost = raw.match(/discord(?:app)?\.com\/channels\/[^/]+\/(\d+)/i);
  if (fromDiscordHost?.[1]) return fromDiscordHost[1];

  const fromPath = raw.match(/\/channels\/\d+\/(\d+)/);
  if (fromPath?.[1]) return fromPath[1];

  if (/^\d{17,22}$/.test(raw)) return raw;

  try {
    const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
    const u = new URL(withProto);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^\d{17,22}$/.test(last)) return last;
  } catch {
    return null;
  }

  return null;
}

/**
 * Guild + channel snowflakes from a discord.com channel or message URL.
 * Message URLs include a third path segment (message id); we only need the first two after /channels/.
 */
export function extractGuildAndChannelFromDiscordUrl(
  url: string
): { guild: string; channel: string } | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  const m = raw.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/i);
  if (m?.[1] && m?.[2]) {
    return { guild: m[1], channel: m[2] };
  }
  return null;
}

/** Stable map key for matching configured channel URLs to post permalinks. */
export function discordChannelPairKey(url: string): string | null {
  const p = extractGuildAndChannelFromDiscordUrl(url);
  if (!p) return null;
  return `${p.guild}/${p.channel}`;
}
