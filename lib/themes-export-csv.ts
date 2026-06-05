import { format as formatDate } from "date-fns";
import type { ThemeMatch } from "@/app/actions/themes-analysis";
import { isBlogPlatform, normalizePlatformForDisplay } from "@/lib/utils/platform";

/** CSV column headers — must stay aligned with row order in `buildThemesCsvRows`. */
export const THEME_EXPORT_CSV_HEADERS = [
  "Theme",
  "Relevance Score (%)",
  "Platform",
  "Author",
  "Discord Server",
  "Discord Channel",
  "Content",
  "Sentiment",
  "Engagement",
  "Posted",
  "Link",
] as const;

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  reddit: "Reddit",
  discord: "Discord",
  blog: "Blogs",
  youtube: "YouTube",
  hackernews: "Hacker News",
  hacker_news: "Hacker News",
  hn: "Hacker News",
  github: "GitHub",
};

/** Prefer link_url (e.g. Discord channel URL); else post_url. Matches Themes tab export. */
export function getThemeMatchDestinationUrl(match: ThemeMatch): string | null {
  const u = (match.link_url || match.post_url || "").trim();
  return u || null;
}

export function escapeCsvCell(str: string): string {
  if (!str) return "";
  const escaped = String(str).replace(/"/g, '""');
  if (
    escaped.includes(",") ||
    escaped.includes('"') ||
    escaped.includes("\n") ||
    escaped.includes("\r")
  ) {
    return `"${escaped}"`;
  }
  return escaped;
}

/**
 * Same dedupe as ThemesAnalysis export: social = one row per theme + post_id (highest relevance);
 * blog = one row per theme + analysis row id.
 */
export function dedupeThemeMatchesForExport(matches: ThemeMatch[]): ThemeMatch[] {
  const deduped = new Map<string, ThemeMatch>();
  for (const match of matches) {
    const key = isBlogPlatform(match.platform)
      ? `${match.theme_id}:blog:${match.id}`
      : `${match.theme_id}:${match.post_id}`;
    const existing = deduped.get(key);
    if (!existing || (match.relevance_score || 0) > (existing.relevance_score || 0)) {
      deduped.set(key, match);
    }
  }
  return Array.from(deduped.values());
}

export function buildThemesCsvRows(matches: ThemeMatch[]): string[][] {
  return matches.map((match) => {
    const totalEngagement = (match.likes || 0) + (match.comments || 0) + (match.shares || 0);
    const dateStr = match.posted_at
      ? formatDate(new Date(match.posted_at), "yyyy-MM-dd HH:mm:ss")
      : "";
    const linkUrl = getThemeMatchDestinationUrl(match) || "";
    const themeStr = match.relevance_score
      ? `${match.theme_name} (${match.relevance_score}%)`
      : match.theme_name;
    const authorStr = match.author_name || "Unknown";
    const contentStr = match.post_content || "No content available";
    const platformLabel =
      PLATFORM_LABELS[normalizePlatformForDisplay(match.platform)] || match.platform;

    return [
      escapeCsvCell(themeStr),
      match.relevance_score?.toString() || "",
      escapeCsvCell(platformLabel),
      escapeCsvCell(authorStr),
      escapeCsvCell(match.discord_server || ""),
      escapeCsvCell(match.discord_channel || ""),
      escapeCsvCell(contentStr),
      escapeCsvCell(match.sentiment || ""),
      totalEngagement.toString(),
      escapeCsvCell(dateStr),
      escapeCsvCell(linkUrl),
    ];
  });
}

/** Full CSV string including header row (Themes tab format). */
export function buildThemesCsvContent(matches: ThemeMatch[]): string {
  const rows = buildThemesCsvRows(matches);
  const headerLine = THEME_EXPORT_CSV_HEADERS.join(",");
  const bodyLines = rows.map((row) => row.join(","));
  return [headerLine, ...bodyLines].join("\n");
}
