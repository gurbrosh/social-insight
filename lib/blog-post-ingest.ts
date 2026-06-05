/**
 * Ingest website-url-scraper output into BlogPost table.
 * - Maps scraper fields to BlogPost (company_url → article_url, title → article_title, text → content).
 * - No duplicates: upsert by (project_id, article_url).
 * - Affiliation: COMPANY_OFFICIAL when the post URL is under a project brand's blog_news_url; otherwise
 *   uses item.affiliation when provided (e.g. MEDIA_OUTLET for Publications/Blogs), else UNKNOWN.
 * Analysis (BlogNewsAnalysis) is run later when orchestration completes.
 */

import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import type { PostAffiliation } from "@prisma/client";

/** One item from the website-url-scraper dataset (array of these). */
export interface WebsiteScraperOutputItem {
  company_url?: string | null;
  title?: string | null;
  html?: string | null;
  text?: string | null;
  status?: string | null;
  /** When set, used when the article is not from a brand's blog_news_url (e.g. MEDIA_OUTLET for Publications/Blogs). */
  affiliation?: PostAffiliation | null;
  emails?: unknown;
  phones?: unknown;
  subpages_scraped?: number;
}

/** Result of ingesting a batch. */
export interface IngestBlogPostResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Normalize URL for deduplication: trim, lowercase host, preserve path.
 */
function normalizeArticleUrl(url: string): string {
  const u = url.trim();
  try {
    const parsed = new URL(u);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return u;
  }
}

/**
 * Return base URLs (origin + path without trailing slash, or origin) for each project brand's blog_news_url.
 * Used to detect "post from brand's page" for affiliation.
 */
async function getBrandBlogBaseUrls(
  projectId: string
): Promise<Array<{ baseUrl: string; sourceUrl: string }>> {
  const projectBrands = await prisma.projectBrand.findMany({
    where: { project_id: projectId, deleted_at: null },
    include: { brand: { where: { deleted_at: null } } },
  });
  const out: Array<{ baseUrl: string; sourceUrl: string }> = [];
  const seen = new Set<string>();
  for (const pb of projectBrands) {
    const url = pb.brand?.blog_news_url?.trim();
    if (!url || !url.startsWith("http")) continue;
    try {
      const parsed = new URL(url);
      // Base = origin + path without last segment (e.g. https://example.com/blog from https://example.com/blog/)
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      const baseUrl = `${parsed.origin}${path}`;
      if (!seen.has(baseUrl)) {
        seen.add(baseUrl);
        out.push({ baseUrl, sourceUrl: url });
      }
    } catch {
      // skip invalid URL
    }
  }
  return out;
}

/**
 * True if articleUrl is under any of the brand blog base URLs (post came from brand's page).
 */
function isFromBrandPage(
  articleUrl: string,
  brandBases: Array<{ baseUrl: string; sourceUrl: string }>
): { fromBrand: boolean; sourceUrl?: string } {
  const normalized = articleUrl.trim();
  for (const { baseUrl, sourceUrl } of brandBases) {
    // Same origin + path prefix (e.g. https://example.com/blog/... under base https://example.com/blog)
    if (
      normalized === baseUrl ||
      normalized.startsWith(baseUrl + "/") ||
      normalized.startsWith(baseUrl + "?")
    ) {
      return { fromBrand: true, sourceUrl };
    }
  }
  return { fromBrand: false };
}

/**
 * Try to parse article date from HTML (e.g. <time datetime="2026-02-14">).
 */
function parseArticleDateFromHtml(html: string | null | undefined): Date | null {
  if (!html || typeof html !== "string") return null;
  const match = html.match(/<time[^>]*\bdatetime=["']([^"']+)["']/i);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Ingest an array of website-url-scraper output items into BlogPost for the given project.
 * - Only processes items with status === "ok", company_url, and text.
 * - No duplicates: upserts by (project_id, article_url).
 * - Sets affiliation to COMPANY_OFFICIAL when the article URL is under a project brand's blog_news_url.
 */
export async function ingestWebsiteScraperOutput(
  projectId: string,
  items: WebsiteScraperOutputItem[],
  /** OrchestrationRun.id for task-based analysis; stamped on BlogPost when creating. */
  ingestedRunId?: string | null
): Promise<IngestBlogPostResult> {
  const result: IngestBlogPostResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true },
  });
  if (!project) {
    result.errors.push("Project not found");
    return result;
  }

  const brandBases = await getBrandBlogBaseUrls(projectId);

  for (const item of items) {
    const status = item.status?.toString().toLowerCase();
    if (status !== "ok") {
      result.skipped++;
      continue;
    }
    const rawUrl = item.company_url?.toString().trim();
    const text = item.text?.toString().trim();
    if (!rawUrl || !text) {
      result.skipped++;
      continue;
    }
    const articleUrl = normalizeArticleUrl(rawUrl);
    const articleTitle = item.title?.toString().trim() || null;
    const articleDate = parseArticleDateFromHtml(item.html) ?? null;
    const { fromBrand, sourceUrl } = isFromBrandPage(articleUrl, brandBases);
    // Brand's own blog → COMPANY_OFFICIAL; otherwise use item affiliation (e.g. MEDIA_OUTLET for Publications/Blogs) or UNKNOWN.
    const affiliation: PostAffiliation = fromBrand
      ? "COMPANY_OFFICIAL"
      : (item.affiliation ?? "UNKNOWN");

    try {
      // Same URL already exists (active or soft-deleted) → skip; no upsert, no restore.
      const existing = await prisma.blogPost.findFirst({
        where: { project_id: projectId, article_url: articleUrl },
        select: { id: true },
      });
      if (existing) {
        result.skipped++;
        continue;
      }
      await prisma.blogPost.create({
        data: {
          id: generateId(),
          project_id: projectId,
          article_url: articleUrl,
          article_title: articleTitle ?? undefined,
          article_date: articleDate ?? undefined,
          content: text,
          affiliation,
          source_url: sourceUrl ?? undefined,
          ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
        },
      });
      result.inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${articleUrl}: ${msg}`);
    }
  }

  return result;
}
