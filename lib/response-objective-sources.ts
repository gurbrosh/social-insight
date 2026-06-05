import {
  PROJECT_SOURCE_FILTER_ALL_KEYS,
  getNormalizedPlatformFilter,
  recordPlatformMatches,
} from "@/lib/utils/platform";

/** Display order: Social → Forums & code → News (same sequence as before, single flat table). */
export const SOURCE_TABLE_ROWS: { key: string; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X (Twitter)" },
  { key: "youtube", label: "YouTube" },
  { key: "reddit", label: "Reddit" },
  { key: "discord", label: "Discord" },
  { key: "hackernews", label: "Hacker News" },
  { key: "github", label: "GitHub" },
  { key: "blog", label: "Blogs" },
];

export type SourceReplyRowState = {
  include: boolean;
  /** UI: “Identify as Org” — insider voice when true; outsider when false. */
  belongToOrg: boolean;
};

export type SourceReplyTableState = Record<string, SourceReplyRowState>;

function parseJsonStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function defaultRow(include: boolean): SourceReplyRowState {
  return {
    include,
    belongToOrg: true,
  };
}

export function defaultSourceReplyTableState(): SourceReplyTableState {
  const out: SourceReplyTableState = {};
  for (const { key } of SOURCE_TABLE_ROWS) {
    out[key] = defaultRow(true);
  }
  return out;
}

function isSourceReplySettings(
  raw: unknown
): raw is Record<string, { include?: boolean; belongToOrg?: boolean; orgIdentifiedInReply?: boolean }> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Load table state from DB: prefer source_reply_settings; else derive from allowed/excluded + is_org_identified.
 */
export function sourceReplyTableFromObjective(o: {
  source_reply_settings: unknown;
  allowed_sources: unknown;
  excluded_sources: unknown;
  is_org_identified: boolean;
}): SourceReplyTableState {
  if (isSourceReplySettings(o.source_reply_settings)) {
    const out: SourceReplyTableState = {};
    for (const { key } of SOURCE_TABLE_ROWS) {
      const row = o.source_reply_settings[key];
      if (row && typeof row === "object" && !Array.isArray(row)) {
        const inc = Boolean(row.include);
        const legacyOid = Boolean(
          (row as { orgIdentifiedInReply?: boolean }).orgIdentifiedInReply
        );
        let belongToOrg = Boolean((row as { belongToOrg?: boolean }).belongToOrg);
        if (legacyOid) {
          belongToOrg = false;
        } else if (inc && !("belongToOrg" in row)) {
          belongToOrg = true;
        }
        out[key] = { include: inc, belongToOrg: inc ? belongToOrg : false };
      } else {
        out[key] = defaultRow(true);
      }
    }
    return normalizeSourceRows(out);
  }

  const allowed = parseJsonStringArray(o.allowed_sources);
  const excluded = parseJsonStringArray(o.excluded_sources);
  const legacyOrgInReply = o.is_org_identified;

  const includeMap: Record<string, boolean> = {};
  for (const { key } of SOURCE_TABLE_ROWS) {
    includeMap[key] = true;
  }
  if (allowed.length > 0) {
    const norm = getNormalizedPlatformFilter(allowed);
    for (const { key } of SOURCE_TABLE_ROWS) {
      includeMap[key] = recordPlatformMatches(key, norm);
    }
  } else if (excluded.length > 0) {
    const exNorm = getNormalizedPlatformFilter(excluded);
    for (const { key } of SOURCE_TABLE_ROWS) {
      includeMap[key] = !recordPlatformMatches(key, exNorm);
    }
  }

  const out: SourceReplyTableState = {};
  for (const { key } of SOURCE_TABLE_ROWS) {
    const inc = includeMap[key];
    out[key] = {
      include: inc,
      belongToOrg: inc ? !legacyOrgInReply : false,
    };
  }
  return normalizeSourceRows(out);
}

function normalizeSourceRows(state: SourceReplyTableState): SourceReplyTableState {
  const out: SourceReplyTableState = { ...state };
  for (const { key } of SOURCE_TABLE_ROWS) {
    const row = out[key];
    if (!row?.include) {
      out[key] = { include: false, belongToOrg: false };
    } else {
      out[key] = { include: true, belongToOrg: Boolean(row.belongToOrg) };
    }
  }
  return out;
}

export function serializeSourceReplyTable(
  state: SourceReplyTableState
): Record<string, SourceReplyRowState> {
  const out: SourceReplyTableState = {};
  for (const { key } of SOURCE_TABLE_ROWS) {
    out[key] = state[key] ?? defaultRow(false);
  }
  return normalizeSourceRows(out);
}

/** Map DB platform string to canonical source key (facebook … blog). */
export function canonicalSourceKeyForPlatform(platform: string | null | undefined): string | null {
  for (const key of PROJECT_SOURCE_FILTER_ALL_KEYS) {
    const set = getNormalizedPlatformFilter([key]);
    if (recordPlatformMatches(platform, set)) return key;
  }
  return null;
}
