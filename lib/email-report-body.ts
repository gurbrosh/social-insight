import { formatDistanceToNowStrict } from "date-fns";
import { getStoredChatterAnalysisForUser } from "@/app/actions/chatter-analysis";
import type { ChatterConversation } from "@/app/actions/chatter-analysis";
import { getStoredThemesAnalysisForUser } from "@/app/actions/themes-analysis";
import type { ThemeMatch } from "@/app/actions/themes-analysis";
import { prisma } from "@/lib/prisma";
import { deduplicateByTitle, excerptForDedupe } from "@/lib/email-report-dedupe";
import { parseGithubExtraFromPostJson } from "@/lib/github/github-product-relevance";
import type { GithubRepoStructuredExtraJson } from "@/lib/github/repo-structured-summary";
import { GITHUB_POST_PLATFORM } from "@/lib/github/upsert-github-repo-post";

/** Shared with app/actions/email-report-settings.ts */
export const EMAIL_FONT =
  "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const EMAIL_SIZE = "14px";
export const EMAIL_LINK = `font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};font-weight:400;color:#2563eb;text-decoration:underline;`;

const CELL = `font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};padding:8px;border-bottom:1px solid #eee;vertical-align:top;color:#111;`;
const TH = `font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};font-weight:600;text-align:left;padding:8px;border-bottom:2px solid #ccc;color:#111;`;

function thW(extra: string): string {
  return `${TH}${extra}`;
}
function tdW(extra: string): string {
  return `${CELL}${extra}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string | null | undefined, max: number): string {
  const t = (text || "").trim();
  if (!t) return "—";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/** Calendar days spanned from the report window start to now (minimum 1). */
function formatReportWindowDaysLabel(windowStart: Date): string {
  const ms = Math.max(0, Date.now() - windowStart.getTime());
  const days = Math.max(1, Math.round(ms / 86_400_000));
  return days === 1 ? "1 day" : `${days} days`;
}

/** Truncate to at most `maxWords` words; if truncated, append "...". */
function truncateToWords(text: string | null | undefined, maxWords: number): string {
  const raw = (text || "").trim();
  if (!raw) return "";
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

/**
 * Drops leading response objective bracket and addressee (e.g. Reddit u/name); leads with "...".
 */
function stripPreparedResponseLeadForEmail(text: string): string {
  let t = (text || "").trim();
  t = t.replace(/^\[[^\]]+\]\s*/, "");
  t = t.replace(/^(u\/[\w-]+|@[\w.-]+)\s*,\s*/i, "");
  t = t.trim();
  if (!t) return "—";
  if (t.startsWith("...")) return t;
  return t.startsWith("…") ? `...${t.slice(1).trim()}` : `...${t}`;
}

function formatRepoCreatedAge(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** GitHub owner/repo, case-insensitive; strips `.git` and trailing slashes. */
function normalizeGithubRepoFullName(name: string | null | undefined): string {
  if (!name?.trim()) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

/** Parse `owner/repo` from a GitHub https URL if present. */
function parseGithubOwnerRepoFromUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  try {
    const u = new URL(url.trim());
    if (!/github\.com$/i.test(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return normalizeGithubRepoFullName(`${parts[0]}/${parts[1]}`);
  } catch {
    return "";
  }
}

/**
 * One key per repository: prefer GitHub `repo_id`, then normalized `repo_full_name`, then URL, then post id.
 */
function githubCanonicalRepoKey(
  extra: GithubRepoStructuredExtraJson,
  post: { url: string | null; postId: string }
): string {
  if (typeof extra.repo_id === "number" && Number.isFinite(extra.repo_id)) {
    return `rid:${extra.repo_id}`;
  }
  const fromExtra = normalizeGithubRepoFullName(extra.repo_full_name);
  if (fromExtra) return `fn:${fromExtra}`;
  const fromUrl = parseGithubOwnerRepoFromUrl(post.url);
  if (fromUrl) return `fn:${fromUrl}`;
  return `pid:${post.postId}`;
}

function normalizeGithubProjectDisplayKey(name: string | null | undefined): string {
  if (!name?.trim()) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function humanizeSourcesJson(sourcesJson: string | null | undefined): string {
  if (!sourcesJson?.trim()) return "—";
  try {
    const arr = JSON.parse(sourcesJson) as unknown;
    if (!Array.isArray(arr)) return "—";
    return arr
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(", ");
  } catch {
    return "—";
  }
}

function humanizePlatform(p: string): string {
  const x = (p || "").toLowerCase();
  const map: Record<string, string> = {
    reddit: "Reddit",
    discord: "Discord",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    twitter: "X",
    x: "X",
    youtube: "YouTube",
    blog: "Blog",
    blogs: "Blog",
    hackernews: "Hacker News",
    github: "GitHub",
  };
  return map[x] ?? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function formatInProjectTimezone(d: Date | null | undefined, timeZone: string | undefined): string {
  if (!d) return "—";
  const tz = timeZone?.trim() || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

type NewsRow = {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  sentiment: string | null;
  importance_score: number | null;
  source_url: string | null;
  sources: string | null;
};

async function loadNewsSection(projectId: string, windowStart: Date): Promise<NewsRow[]> {
  const rows = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      importance_score: { gt: 70 },
      OR: [
        { date_range_start: { gte: windowStart } },
        { AND: [{ date_range_start: null }, { created_at: { gte: windowStart } }] },
      ],
    },
    orderBy: [{ importance_score: "desc" }, { created_at: "desc" }],
    take: 40,
  });

  const mapped: NewsRow[] = rows.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    content: n.content,
    sentiment: n.sentiment,
    importance_score: n.importance_score,
    source_url: n.source_url,
    sources: n.sources,
  }));

  const top15 = mapped.slice(0, 15);
  const withTitles = top15.map((n) => ({
    id: n.id,
    title: n.title || "—",
    raw: n,
  }));
  const deduped = deduplicateByTitle(withTitles, 0.6);
  return deduped.map((x) => x.raw).slice(0, 10);
}

function renderNewsHtml(rows: NewsRow[]): string {
  if (rows.length === 0) {
    return `<p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};color:#666;margin:8px 0 0 0;">No items for this section</p>`;
  }
  const head = `<tr>
<th style="${thW("width:14%;")}">Source</th>
<th style="${thW("width:12%;")}">Sentiment</th>
<th style="${thW("width:18%;")}">Headline</th>
<th style="${thW("width:56%;")}">Summary</th>
</tr>`;
  const body = rows
    .map((n) => {
      const link = n.source_url?.trim();
      const headlineInner = escapeHtml(n.title);
      const headline =
        link && /^https?:\/\//i.test(link)
          ? `<a href="${escapeHtml(link)}" style="${EMAIL_LINK}"><strong style="font-family:${EMAIL_FONT};font-weight:600;">${headlineInner}</strong></a>`
          : `<strong style="font-family:${EMAIL_FONT};font-weight:600;">${headlineInner}</strong>`;
      return `<tr>
<td style="${tdW("width:14%;")}">${escapeHtml(humanizeSourcesJson(n.sources))}</td>
<td style="${tdW("width:12%;")}">${escapeHtml(n.sentiment || "—")}</td>
<td style="${tdW("width:18%;")}">${headline}</td>
<td style="${tdW("width:56%;")}">${escapeHtml(truncate(n.summary, 1200))}</td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0;font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};">${head}${body}</table>`;
}

function renderNewsText(rows: NewsRow[]): string[] {
  if (rows.length === 0) return ["No items for this section"];
  return rows.map((n, i) => {
    const link = n.source_url?.trim() || "";
    const head = link ? `${n.title} (${link})` : n.title;
    return `  ${i + 1}. [${humanizeSourcesJson(n.sources)}] ${head}\n     Sentiment: ${n.sentiment || "—"}\n     ${truncate(n.summary, 900)}`;
  });
}

async function loadChatterSection(
  projectId: string,
  userId: string,
  windowStart: Date
): Promise<ChatterConversation[]> {
  const res = await getStoredChatterAnalysisForUser(projectId, userId, {
    lastPostAfter: windowStart,
    limit: 80,
    minImportance: 41,
    dateRange: "all",
  });
  if (!res.success || !res.conversations) return [];

  const sorted = [...res.conversations].sort(
    (a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0)
  );
  const top15 = sorted.slice(0, 15);
  const forDedupe = top15.map((c) => ({
    id: c.id,
    title: c.discussion_title || "—",
    raw: c,
  }));
  const deduped = deduplicateByTitle(forDedupe, 0.6);
  return deduped.map((x) => x.raw).slice(0, 10);
}

function renderChatterHtml(rows: ChatterConversation[], timeZone: string | undefined): string {
  if (rows.length === 0) {
    return `<p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};color:#666;margin:8px 0 0 0;">No items for this section</p>`;
  }
  const head = `<tr>
<th style="${thW("width:11%;")}">Source</th>
<th style="${thW("width:17%;")}">Headline</th>
<th style="${thW("width:55%;")}">Summary</th>
<th style="${thW("width:11%;")}">Engagement</th>
<th style="${thW("width:6%;")}">When (local)</th>
</tr>`;
  const body = rows
    .map((c) => {
      const platforms = (c.platforms || []).map(humanizePlatform).join(", ") || "—";
      const link = c.link_url?.trim();
      const titleEsc = escapeHtml(c.discussion_title);
      const headline =
        link && /^https?:\/\//i.test(link)
          ? `<a href="${escapeHtml(link)}" style="${EMAIL_LINK}"><strong style="font-family:${EMAIL_FONT};font-weight:600;">${titleEsc}</strong></a>`
          : `<strong style="font-family:${EMAIL_FONT};font-weight:600;">${titleEsc}</strong>`;
      const when = formatInProjectTimezone(c.last_post_at ?? c.first_post_at, timeZone);
      const pc = c.participant_count ?? 0;
      const tm = c.total_messages ?? 0;
      const te = c.total_engagement ?? 0;
      const engagement = `${pc} people, ${tm} messages, ${te} reactions`;
      return `<tr>
<td style="${tdW("width:11%;")}">${escapeHtml(platforms)}</td>
<td style="${tdW("width:17%;")}">${headline}</td>
<td style="${tdW("width:55%;")}">${escapeHtml(truncate(c.summary, 2000))}</td>
<td style="${tdW("width:11%;")}">${escapeHtml(engagement)}</td>
<td style="${tdW("width:6%;")}">${escapeHtml(when)}</td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0;font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};">${head}${body}</table>`;
}

function renderChatterText(rows: ChatterConversation[], timeZone: string | undefined): string[] {
  if (rows.length === 0) return ["No items for this section"];
  return rows.map((c, i) => {
    const when = formatInProjectTimezone(c.last_post_at ?? c.first_post_at, timeZone);
    const link = c.link_url?.trim() || "";
    const head = link ? `${c.discussion_title} (${link})` : c.discussion_title;
    const eng = `${c.participant_count ?? 0} people, ${c.total_messages ?? 0} messages, ${c.total_engagement ?? 0} reactions`;
    return `  ${i + 1}. ${head}\n     Sources: ${(c.platforms || []).join(", ")}\n     ${truncate(c.summary, 1500)}\n     Engagement: ${eng}\n     When: ${when}`;
  });
}

function dedupeThemeMatches(matches: ThemeMatch[]): ThemeMatch[] {
  const sorted = [...matches].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
  const top30 = sorted.slice(0, 30);
  const titled = top30.map((m) => ({
    id: m.id,
    title:
      excerptForDedupe(m.post_content || m.link_url || m.post_url || "", 200) ||
      m.theme_name ||
      m.id,
    raw: m,
  }));
  const deduped = deduplicateByTitle(titled, 0.6);
  return deduped.map((x) => x.raw).slice(0, 20);
}

async function loadThemesSection(
  projectId: string,
  userId: string,
  windowStart: Date
): Promise<ThemeMatch[]> {
  const res = await getStoredThemesAnalysisForUser(projectId, userId, {
    postedAfter: windowStart,
    minRelevance: 81,
    limit: 10000,
    dateRange: "all",
  });
  if (!res.success || !res.matches) return [];

  const withResponse = res.matches.filter((m) => m.has_response && (m.relevance_score ?? 0) > 80);
  return dedupeThemeMatches(withResponse);
}

function themePreparedResponseForEmail(m: ThemeMatch): string {
  const entries = m.response_entries || [];
  if (entries.length === 0) return "—";
  return entries
    .map((e) => stripPreparedResponseLeadForEmail(`[${e.objective_name}] ${e.response_text}`))
    .join("\n\n");
}

function renderThemesHtml(rows: ThemeMatch[], timeZone: string | undefined): string {
  if (rows.length === 0) {
    return `<p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};color:#666;margin:8px 0 0 0;">No items for this section</p>`;
  }
  const head = `<tr>
<th style="${thW("width:9%;")}">Source</th>
<th style="${thW("width:22%;")}">Content summary</th>
<th style="${thW("width:46%;")}">Prepared response</th>
<th style="${thW("width:14%;")}">Engagement</th>
<th style="${thW("width:9%;")}">When (local)</th>
</tr>`;
  const body = rows
    .map((m) => {
      const src = humanizePlatform(m.platform);
      const link = (m.link_url || m.post_url || "").trim();
      const themeHeader = `Theme: ${m.theme_name} (${m.relevance_score ?? "—"}% match)`;
      const excerpt20 = truncateToWords(m.post_content, 20);
      const excerptDisplay = excerpt20 || "—";
      const boldBody =
        link && /^https?:\/\//i.test(link)
          ? `<a href="${escapeHtml(link)}" style="${EMAIL_LINK}"><strong style="font-family:${EMAIL_FONT};font-weight:700;">${escapeHtml(excerptDisplay)}</strong></a>`
          : `<strong style="font-family:${EMAIL_FONT};font-weight:700;">${escapeHtml(excerptDisplay)}</strong>`;
      const contentSummary = `${escapeHtml(themeHeader)}<br/><br/>${boldBody}`;
      const participants = Array.isArray(m.participant_names) ? m.participant_names.length : 0;
      const msgs = m.comments ?? 0;
      const react = m.total_reactions ?? 0;
      const engagement = `${participants} people, ${msgs} messages, ${react} reactions`;
      const when = formatInProjectTimezone(m.posted_at ?? null, timeZone);
      return `<tr>
<td style="${tdW("width:9%;")}">${escapeHtml(src)}</td>
<td style="${tdW("width:22%;")}">${contentSummary}</td>
<td style="${tdW("width:46%;")}">${escapeHtml(truncate(themePreparedResponseForEmail(m), 3600))}</td>
<td style="${tdW("width:14%;")}">${escapeHtml(engagement)}</td>
<td style="${tdW("width:9%;")}">${escapeHtml(when)}</td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0;font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};">${head}${body}</table>`;
}

function renderThemesText(rows: ThemeMatch[], timeZone: string | undefined): string[] {
  if (rows.length === 0) return ["No items for this section"];
  return rows.map((m, i) => {
    const when = formatInProjectTimezone(m.posted_at ?? null, timeZone);
    const link = (m.link_url || m.post_url || "").trim();
    const participants = Array.isArray(m.participant_names) ? m.participant_names.length : 0;
    const eng = `${participants} people, ${m.comments ?? 0} messages, ${m.total_reactions ?? 0} reactions`;
    const themeHeader = `Theme: ${m.theme_name} (${m.relevance_score ?? "—"}% match)`;
    const excerpt20 = truncateToWords(m.post_content, 20);
    const contentLine = link
      ? `${themeHeader}\n\n${excerpt20} (${link})`
      : `${themeHeader}\n\n${excerpt20}`;
    return `  ${i + 1}. [${m.platform}]\n     ${contentLine}\n     Response: ${truncate(themePreparedResponseForEmail(m), 1800)}\n     Engagement: ${eng}\n     When: ${when}`;
  });
}

export type GithubEmailRow = {
  postId: number;
  repoFullName: string;
  projectName: string;
  titleSummary: string;
  keywords: string;
  stars: number;
  forks: number;
  releases: number;
  contributors: number;
  /** Repo `created_at` from GitHub (ISO), for “repo age” in the Since column at send time. */
  sinceIso: string | null;
  url: string;
  relevancePct: number | null;
};

const GITHUB_EMAIL_MAX_ROWS = 10;
/** Fetch more than we show so duplicate repos / titles can be skipped and we still fill the table. */
const GITHUB_EMAIL_FETCH = 100;

function githubRowRelevanceScore(r: GithubEmailRow): number {
  return r.relevancePct ?? -1;
}

/** True if `a` should win over `b` (higher relevance, then higher internal post id). */
function betterGithubRow(a: GithubEmailRow, b: GithubEmailRow): boolean {
  const da = githubRowRelevanceScore(a);
  const db = githubRowRelevanceScore(b);
  if (da !== db) return da > db;
  return a.postId > b.postId;
}

async function loadGithubSection(projectId: string, windowStart: Date): Promise<GithubEmailRow[]> {
  const posts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: GITHUB_POST_PLATFORM,
      isTest: false,
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "desc" },
    take: GITHUB_EMAIL_FETCH,
  });

  const byRepoKey = new Map<string, GithubEmailRow>();

  for (const p of posts) {
    const extra = parseGithubExtraFromPostJson(p.extraJson);
    if (!extra) continue;

    const rel = p.github_product_relevance_score;
    if (rel != null && rel <= 20) continue;

    const repoKey = githubCanonicalRepoKey(extra, p);
    const row: GithubEmailRow = {
      postId: p.id,
      repoFullName: extra.repo_full_name,
      projectName: extra.readme_title || extra.repo_full_name,
      titleSummary: [extra.readme_title, extra.readme_description_excerpt || extra.about]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 1200),
      keywords: extra.topics?.length ? extra.topics.join(", ") : "—",
      stars: p.metricsLikes ?? 0,
      forks: p.metricsShares ?? 0,
      releases: extra.releases_count,
      contributors: extra.contributors_count,
      sinceIso: extra.since_iso?.trim() || null,
      url: p.url?.trim() || `https://github.com/${extra.repo_full_name}`,
      relevancePct: rel ?? null,
    };

    const existing = byRepoKey.get(repoKey);
    if (!existing || betterGithubRow(row, existing)) {
      byRepoKey.set(repoKey, row);
    }
  }

  const sorted = [...byRepoKey.values()].sort(
    (a, b) => githubRowRelevanceScore(b) - githubRowRelevanceScore(a)
  );

  const seenTitle = new Set<string>();
  const out: GithubEmailRow[] = [];
  for (const r of sorted) {
    const displayKey =
      normalizeGithubProjectDisplayKey(r.projectName) ||
      normalizeGithubRepoFullName(r.repoFullName) ||
      `post:${r.postId}`;
    if (seenTitle.has(displayKey)) continue;
    seenTitle.add(displayKey);
    out.push(r);
    if (out.length >= GITHUB_EMAIL_MAX_ROWS) break;
  }

  return out;
}

function renderGithubHtml(rows: GithubEmailRow[]): string {
  if (rows.length === 0) {
    return `<p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};color:#666;margin:8px 0 0 0;">No items for this section</p>`;
  }
  const head = `<tr>
<th style="${thW("width:18%;")}">Project</th>
<th style="${thW("width:48%;")}">Title / Summary</th>
<th style="${thW("width:10%;")}">Keywords</th>
<th style="${thW("width:14%;")}">Engagement</th>
<th style="${thW("width:5%;")}">Since</th>
<th style="${thW("width:5%;")}">Relevance</th>
</tr>`;
  const body = rows
    .map((r) => {
      const u = r.url.trim();
      const nameEsc = escapeHtml(r.projectName);
      const projectCell =
        u && /^https?:\/\//i.test(u)
          ? `<a href="${escapeHtml(u)}" style="${EMAIL_LINK}"><strong style="font-family:${EMAIL_FONT};font-weight:600;">${nameEsc}</strong></a>`
          : `<strong style="font-family:${EMAIL_FONT};font-weight:600;">${nameEsc}</strong>`;
      const rel = r.relevancePct != null ? `${r.relevancePct}%` : "—";
      const engagement = `${r.stars} stars, ${r.forks} forks, ${r.releases} releases, ${r.contributors} contributors`;
      const sinceLabel = formatRepoCreatedAge(r.sinceIso);
      return `<tr>
<td style="${tdW("width:18%;")}">${projectCell}</td>
<td style="${tdW("width:48%;")}">${escapeHtml(truncate(r.titleSummary, 1200))}</td>
<td style="${tdW("width:10%;")}">${escapeHtml(r.keywords)}</td>
<td style="${tdW("width:14%;")}">${escapeHtml(engagement)}</td>
<td style="${tdW("width:5%;")}">${escapeHtml(sinceLabel)}</td>
<td style="${tdW("width:5%;")}">${escapeHtml(rel)}</td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0;font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};">${head}${body}</table>`;
}

function renderGithubText(rows: GithubEmailRow[]): string[] {
  if (rows.length === 0) return ["No items for this section"];
  return rows.map((r, i) => {
    const rel = r.relevancePct != null ? `${r.relevancePct}%` : "—";
    const eng = `${r.stars} stars, ${r.forks} forks, ${r.releases} releases, ${r.contributors} contributors`;
    return `  ${i + 1}. ${r.projectName} (${r.url}) — relevance ${rel}\n     ${truncate(r.titleSummary, 1200)}\n     keywords: ${r.keywords}\n     Engagement: ${eng}\n     since=${formatRepoCreatedAge(r.sinceIso)}`;
  });
}

export async function buildEmailReportDetailSections(params: {
  projectId: string;
  userId: string;
  windowStart: Date;
  project: {
    id: string;
    name: string;
    description: string | null;
    monitoring_focus: string | null;
    my_product_name: string | null;
    my_product_focus_text: string | null;
    my_product_summary_json: string | null;
    schedule_timezone: string | null;
  };
}): Promise<{ html: string; text: string }> {
  const { projectId, userId, windowStart, project } = params;
  const tz = project.schedule_timezone ?? undefined;

  const [newsRows, chatterRows, themeRows, githubRows] = await Promise.all([
    loadNewsSection(projectId, windowStart),
    loadChatterSection(projectId, userId, windowStart),
    loadThemesSection(projectId, userId, windowStart),
    loadGithubSection(projectId, windowStart),
  ]);

  const subStyle = `font-family:${EMAIL_FONT};font-size:13px;color:#444;line-height:1.45;margin:0 0 12px 0;`;
  const windowDays = formatReportWindowDaysLabel(windowStart);

  const html = `
<h3 style="font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1.25;color:#111;margin:24px 0 8px 0;">News Items</h3>
<p style="${subStyle}">Review the leading news and announcements from multiple sources in the last ${windowDays}.</p>
${renderNewsHtml(newsRows)}
<h3 style="font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1.25;color:#111;margin:24px 0 8px 0;">Leading Conversations</h3>
<p style="${subStyle}">Jump in to the most relevant and active conversations in the last ${windowDays}.</p>
${renderChatterHtml(chatterRows, tz)}
<h3 style="font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1.25;color:#111;margin:24px 0 8px 0;">Themes and Responses</h3>
<p style="${subStyle}">Engage in to the most relevant discussions to your brand, and consider using the ready-made response.</p>
${renderThemesHtml(themeRows, tz)}
<h3 style="font-family:${EMAIL_FONT};font-size:16px;font-weight:600;line-height:1.25;color:#111;margin:24px 0 8px 0;">Github Projects</h3>
<p style="${subStyle}">Review the latest projects in GitHub. Always consider potential competitors, features and partnerships.</p>
${renderGithubHtml(githubRows)}
`.trim();

  const text = [
    `News Items`,
    `Review the leading news and announcements from multiple sources in the last ${windowDays}.`,
    ...renderNewsText(newsRows),
    ``,
    `Leading Conversations`,
    `Jump in to the most relevant and active conversations in the last ${windowDays}.`,
    ...renderChatterText(chatterRows, tz),
    ``,
    `Themes and Responses`,
    `Engage in to the most relevant discussions to your brand, and consider using the ready-made response.`,
    ...renderThemesText(themeRows, tz),
    ``,
    `Github Projects`,
    `Review the latest projects in GitHub. Always consider potential competitors, features and partnerships.`,
    ...renderGithubText(githubRows),
  ].join("\n");

  return { html, text };
}
