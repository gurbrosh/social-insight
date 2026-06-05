/**
 * Best-effort labels from Discord message payload stored on Post.extraJson (Apify / Gateway shapes).
 * Used when ProjectProfile URL→name mapping is missing or incomplete.
 *
 * Note: Raw Discord API messages usually only include channel_id (no name). Some actors add
 * channelName / guild metadata; we also recurse shallowly into message/data/meta wrappers.
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Snowflake IDs may appear as JSON numbers in SQLite/Apify output. */
function pickSnowflake(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const s = String(Math.trunc(v));
    return /^\d{17,22}$/.test(s) ? s : undefined;
  }
  return pickString(v);
}

function tryChannelGuildFromRecord(e: Record<string, unknown>): {
  channelName?: string;
  guildName?: string;
} {
  const channelName =
    pickString(e.channelName) ||
    pickString(e.channel_name) ||
    pickString(e.channelTitle) ||
    (typeof e.channel === "object" && e.channel !== null
      ? pickString((e.channel as Record<string, unknown>).name)
      : undefined);

  const guildName =
    pickString(e.guildName) ||
    pickString(e.guild_name) ||
    pickString(e.serverName) ||
    pickString(e.server_name) ||
    pickString(e.server) ||
    (typeof e.guild === "object" && e.guild !== null
      ? pickString((e.guild as Record<string, unknown>).name)
      : undefined);

  return { channelName, guildName };
}

function deepFindChannelGuildNames(
  obj: unknown,
  depth = 0
): { channelName?: string; guildName?: string } {
  if (depth > 5 || obj == null || typeof obj !== "object") {
    return {};
  }
  const e = obj as Record<string, unknown>;
  const direct = tryChannelGuildFromRecord(e);
  if (direct.channelName || direct.guildName) {
    return direct;
  }
  for (const k of ["message", "data", "payload", "meta", "body", "result", "item"]) {
    const inner = e[k];
    if (inner && typeof inner === "object") {
      const nested = deepFindChannelGuildNames(inner, depth + 1);
      if (nested.channelName || nested.guildName) {
        return nested;
      }
    }
  }
  return {};
}

export function extractDiscordLabelsFromExtraJson(extraJson: unknown): {
  channelName?: string;
  guildName?: string;
  messageUrl?: string;
} {
  if (extraJson == null || typeof extraJson !== "object") {
    return {};
  }
  const e = extraJson as Record<string, unknown>;

  const fromDirect = tryChannelGuildFromRecord(e);
  const fromDeep = deepFindChannelGuildNames(extraJson);
  const channelName = fromDirect.channelName || fromDeep.channelName;
  const guildName = fromDirect.guildName || fromDeep.guildName;

  let messageUrl: string | undefined;
  if (typeof e.url === "string" && e.url.includes("discord.com")) {
    messageUrl = e.url.trim();
  } else {
    const gid = pickSnowflake(e.guild_id);
    const cid = pickSnowflake(e.channel_id);
    const mid = pickSnowflake(e.id);
    if (gid && cid && mid) {
      messageUrl = `https://discord.com/channels/${gid}/${cid}/${mid}`;
    }
  }

  return { channelName, guildName, messageUrl };
}
