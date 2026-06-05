/**
 * Shared platform normalization for filtering and display.
 * UI and DB use different values for the same source (e.g. "blog" vs "blogs").
 * Use these helpers everywhere we filter or compare by platform so all features behave consistently.
 */

/** Keys used in ProjectAnalysisTabs global source filter — keep in sync with that UI. */
export const PROJECT_SOURCE_FILTER_ALL_KEYS: readonly string[] = [
  "facebook",
  "linkedin",
  "x",
  "reddit",
  "discord",
  "youtube",
  "blog",
  "hackernews",
  "github",
];

/** True when the user has every source selected (same as default); then we skip narrowing filters. */
export function isFullSourceFilterSelection(keys: string[] | undefined | null): boolean {
  if (!keys || keys.length === 0) return false;
  const lower = new Set(keys.map((k) => (k || "").toLowerCase()));
  if (lower.size !== PROJECT_SOURCE_FILTER_ALL_KEYS.length) return false;
  return PROJECT_SOURCE_FILTER_ALL_KEYS.every((k) => lower.has(k));
}

/** Canonical platform values that mean "blog" (UI uses "blog", Post/ThemesAnalysis can store "blogs"). */
const BLOG_PLATFORM_ALIASES = ["blog", "blogs"] as const;

/** X (Twitter) can be stored as "x" or "twitter" depending on ingest. */
const X_PLATFORM_ALIASES = ["x", "twitter"] as const;

/**
 * LinkedIn: ingest and legacy rows may not be normalized to lowercase. JS comparisons
 * should always use `isLinkedInPlatform`. For Prisma `where` on SQLite, use
 * `LINKEDIN_DB_PLATFORM_IN` so SQL matches without relying on a single spelling.
 */
export const LINKEDIN_DB_PLATFORM_IN: readonly string[] = [
  "linkedin",
  "LinkedIn",
  "LINKEDIN",
  "Linkedin",
];

const HN_PLATFORM_ALIASES = ["hackernews", "hacker_news", "hn"] as const;

/**
 * Return DB/source values to match when the user selects a given filter key (e.g. for News sourceFilter).
 * For "blog" returns ["blog", "blogs"]; for "x"/"twitter" returns ["x", "twitter"].
 */
export function getSourceFilterDbValues(filterKey: string): string[] {
  const key = (filterKey || "").toLowerCase();
  if (key === "blog" || key === "blogs") return ["blog", "blogs"];
  if (key === "x" || key === "twitter") return ["x", "twitter"];
  if (HN_PLATFORM_ALIASES.includes(key as (typeof HN_PLATFORM_ALIASES)[number])) {
    return [...HN_PLATFORM_ALIASES];
  }
  return [key];
}

/**
 * Build a set of normalized platform values for filtering.
 * Blog/blogs and x/twitter are treated as equivalent so records with either value match.
 */
export function getNormalizedPlatformFilter(platforms: string[]): Set<string> {
  const set = new Set<string>();
  for (const p of platforms) {
    const lower = (p || "").toLowerCase();
    set.add(lower);
    if (lower === "blog" || lower === "blogs") {
      set.add("blog");
      set.add("blogs");
    }
    if (X_PLATFORM_ALIASES.includes(lower as (typeof X_PLATFORM_ALIASES)[number])) {
      for (const a of X_PLATFORM_ALIASES) set.add(a);
    }
    if (HN_PLATFORM_ALIASES.includes(lower as (typeof HN_PLATFORM_ALIASES)[number])) {
      for (const a of HN_PLATFORM_ALIASES) set.add(a);
    }
  }
  return set;
}

/**
 * Return true if a record's platform matches the allowed filter set (from getNormalizedPlatformFilter).
 */
export function recordPlatformMatches(
  recordPlatform: string | null | undefined,
  allowedNormalized: Set<string>
): boolean {
  const key = (recordPlatform || "").toLowerCase();
  return allowedNormalized.has(key);
}

/**
 * Return true if the given platform is a blog source (blog or blogs).
 */
export function isBlogPlatform(platform: string | null | undefined): boolean {
  const key = (platform || "").toLowerCase();
  return BLOG_PLATFORM_ALIASES.includes(key as (typeof BLOG_PLATFORM_ALIASES)[number]);
}

/**
 * Normalize platform for display lookups (e.g. platformLabels, platformColors).
 * Maps "blogs" -> "blog", "twitter" -> "x", so both use the same label/color key.
 */
export function normalizePlatformForDisplay(platform: string | null | undefined): string {
  const key = (platform || "").toLowerCase();
  if (key === "blogs") return "blog";
  if (key === "twitter") return "x";
  return key;
}

/**
 * Normalize a source value for display (e.g. News sources array).
 * Maps "blogs" -> "blog"; other values unchanged.
 */
export function normalizeSourceForDisplay(source: string | null | undefined): string {
  if (isBlogPlatform(source)) return "blog";
  return String(source ?? "");
}

/** True when Post.platform is GitHub search/ingest (code + repo signals). */
export function isGithubPlatform(platform: string | null | undefined): boolean {
  return (platform || "").toLowerCase() === "github";
}

/** True for ThemesAnalysis/Post `platform` when the source is LinkedIn (any common casing). */
export function isLinkedInPlatform(platform: string | null | undefined): boolean {
  return (platform ?? "").trim().toLowerCase() === "linkedin";
}

/**
 * X / Twitter: treat "x" and "twitter" (any casing) as the same for comparisons.
 */
export function isXPlatform(platform: string | null | undefined): boolean {
  const k = (platform ?? "").trim().toLowerCase();
  return k === "x" || k === "twitter";
}

/**
 * True for HN story/comment posts: platform aliases or Post linked to HnStoryAnalysis.
 */
export function isHackerNewsPlatform(
  platform: string | null | undefined,
  hnStoryAnalysisId?: string | null
): boolean {
  if (hnStoryAnalysisId) return true;
  const k = (platform || "").toLowerCase();
  return k === "hackernews" || k === "hacker_news" || k === "hn";
}
