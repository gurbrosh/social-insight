/**
 * Runs a SearchSourceTask: fetches data from target table by timing, sends to OpenAI, returns result.
 * Used by test endpoint and orchestration executor.
 */

import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import { configService } from "@/lib/config-service";
import {
  ingestWebsiteScraperOutput,
  type IngestBlogPostResult,
  type WebsiteScraperOutputItem,
} from "@/lib/blog-post-ingest";
import {
  fetchPageTextWithLinkUrls,
  getPageTextWithLinkUrlsFromHtml,
  fetchPageHtmlWithBrowser,
  fetchPageText,
  fetchPageTextWithBrowser,
  discoverArticlesFromIndexPage,
  filterArticlesByOpenAI,
  normalizeArticleDateToISO,
  parseDateFromArticleUrl,
  parseDateFromText,
} from "@/lib/blog-news-analysis-service";
import { getAdditionalLinksForBrand } from "@/lib/brand-directory/brand-additional-links-service";
import { getOtherSourceLinksForTaxonomy } from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { BRAND_BLOG_SUMMARY_PROMPT } from "@/lib/brand-blog-summary-prompt";
import type { SearchSourceTask, TaskTimingDefinition } from "@prisma/client";

/** Publications and Blogs: source categories we treat as blog-like index pages. */
const PUBLICATION_BLOG_CATEGORIES = ["BLOG", "NEWS_OUTLET"] as const;

const TARGET_POST = "Post";
const TARGET_DOWNSTREAM_POST = "DownstreamPost";
const TARGET_BRAND_BLOG_NEWS = "BrandBlogNews";
const TARGET_SCRAPER = "Scraper";
/** Handled by `HackerNewsCustomTask`, not this LLM runner. */
const TARGET_HACKER_NEWS = "HackerNews";
/** Handled by `GithubReaderCustomTask`, not this LLM runner. */
const TARGET_GITHUB_READER = "GithubReader";

function logTs(): string {
  return new Date().toLocaleString();
}

export type TaskTarget =
  | typeof TARGET_POST
  | typeof TARGET_DOWNSTREAM_POST
  | typeof TARGET_BRAND_BLOG_NEWS
  | typeof TARGET_SCRAPER;

/** Per-link breakdown for BrandBlogNews target (for test results UI). */
export interface BrandBlogLinkBreakdownItem {
  url: string;
  brandName: string;
  items: Array<{
    title: string | null;
    url: string;
    date: string | null;
    /** Full post content from start to finish (for test output). */
    content: string;
  }>;
}

function timingToMs(timing: TaskTimingDefinition): number {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  switch (timing) {
    case "LAST_HOUR":
      return hour;
    case "LAST_DAY":
      return day;
    case "LAST_7_DAYS":
      return 7 * day;
    case "LAST_WEEK":
      return 7 * day;
    default:
      return day;
  }
}

/** Duration unit to milliseconds (for one unit). */
function unitToMs(unit: string): number {
  const day = 24 * 60 * 60 * 1000;
  const u = (unit || "").toLowerCase();
  if (u === "day" || u === "days") return day;
  if (u === "week" || u === "weeks") return 7 * day;
  if (u === "month" || u === "months") return 30 * day;
  return day;
}

/**
 * Get the start of the lookback window for a task (same rules for blog search and HN ingest).
 * Uses timing_duration_number + timing_duration_unit when both set, else timing_definition.
 */
export function getSinceDate(
  task: Pick<
    SearchSourceTask,
    "timing_definition" | "timing_duration_number" | "timing_duration_unit"
  >
): Date {
  const num = task.timing_duration_number;
  const unit = task.timing_duration_unit?.trim();
  if (num != null && num > 0 && unit) {
    const ms = num * unitToMs(unit);
    return new Date(Date.now() - ms);
  }
  return new Date(Date.now() - timingToMs(task.timing_definition));
}

/** Fetch recent rows from target table for project within time window. */
async function fetchTargetData(
  target: string,
  projectId: string,
  since: Date,
  limit: number = 100
): Promise<{ text: string; count: number; linkBreakdown?: BrandBlogLinkBreakdownItem[] }> {
  if (target === TARGET_POST) {
    const posts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        platform: true,
        postId: true,
        authorName: true,
        content: true,
        createdAt: true,
        url: true,
      },
    });
    const text = posts
      .map(
        (p) =>
          `[${p.createdAt.toISOString()}] ${p.platform} | ${p.authorName ?? "?"} | ${(p.content ?? "").slice(0, 500)}`
      )
      .join("\n\n");
    return { text: text || "(no posts in window)", count: posts.length };
  }

  if (target === TARGET_DOWNSTREAM_POST) {
    const posts = await prisma.downstreamPost.findMany({
      where: {
        project_id: projectId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        platform: true,
        postId: true,
        authorName: true,
        content: true,
        createdAt: true,
        url: true,
      },
    });
    const text = posts
      .map(
        (p) =>
          `[${p.createdAt.toISOString()}] ${p.platform} | ${p.authorName ?? "?"} | ${(p.content ?? "").slice(0, 500)}`
      )
      .join("\n\n");
    return { text: text || "(no posts in window)", count: posts.length };
  }

  if (target === TARGET_BRAND_BLOG_NEWS) {
    return fetchBrandBlogNewsData(projectId, since, limit);
  }

  if (target === TARGET_SCRAPER) {
    return {
      text: "(Scraper target: task output can be sent to a scraper; configure in task options.)",
      count: 0,
    };
  }

  return { text: "(unknown target)", count: 0 };
}

const BRAND_BLOG_MAX_COMBINED_LENGTH = 80000;

/** Max number of article URLs to fetch in parallel in step 2 (avoids 10+ min sequential fetches). */
const STEP2_FETCH_CONCURRENCY = 6;

/** Normalize URL for deduplication (must match blog-post-ingest logic). */
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

/** Return set of article_urls already in BlogPost for this project (deleted_at null). Used to skip fetch in step 2. */
async function getExistingBlogPostUrls(
  projectId: string,
  normalizedUrls: string[]
): Promise<Set<string>> {
  if (normalizedUrls.length === 0) return new Set();
  const unique = [...new Set(normalizedUrls)];
  const rows = await prisma.blogPost.findMany({
    where: {
      project_id: projectId,
      article_url: { in: unique },
      deleted_at: null,
    },
    select: { article_url: true },
  });
  return new Set(rows.map((r) => r.article_url));
}

/**
 * When true, failed fetches fall back to Playwright (headless browser). When false or unset, only plain HTTP fetch is used.
 * Set to "true" only in environments where Playwright + Chromium are installed (e.g. a worker with browser); leave unset for typical backend.
 */
function isBrowserFetchEnabled(): boolean {
  return (
    process.env.BLOG_FETCH_USE_BROWSER === "true" || process.env.BLOG_FETCH_USE_BROWSER === "1"
  );
}

/**
 * Fetch one article's full text: try fetchPageText (plain HTTP). If that fails and BLOG_FETCH_USE_BROWSER is set, try fetchPageTextWithBrowser.
 * In backend environments with no browser, only the first path runs; no Playwright dependency required.
 */
async function fetchArticleContent(url: string): Promise<string> {
  try {
    return await fetchPageText(url);
  } catch {
    if (!isBrowserFetchEnabled()) {
      return "(fetch failed)";
    }
    try {
      return await fetchPageTextWithBrowser(url);
    } catch {
      return "(fetch failed)";
    }
  }
}

/**
 * Run items in parallel with a concurrency limit.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      if (i >= items.length) break;
      const value = await fn(items[i]);
      results[i] = value;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Get all Publications and Blogs URLs for a project (brand additional links + taxonomy other source links).
 * Returns deduplicated { url, label } for BLOG and NEWS_OUTLET only.
 */
async function getProjectPublicationAndBlogUrls(
  projectId: string
): Promise<Array<{ url: string; label: string }>> {
  const projectBrands = await prisma.projectBrand.findMany({
    where: {
      project_id: projectId,
      brand_id: { not: null },
      deleted_at: null,
      brand: { deleted_at: null },
    },
    include: {
      brand: {
        select: {
          id: true,
          business_taxonomy_id: true,
          brand_name: true,
          company_name: true,
        },
      },
    },
  });
  const seen = new Set<string>();
  const out: Array<{ url: string; label: string }> = [];

  for (const pb of projectBrands) {
    const brand = pb.brand;
    if (!brand) continue;
    const label = brand.brand_name || brand.company_name || "Publication/Blog";

    const additionalLinks = await getAdditionalLinksForBrand(brand.id, "OTHER_SOURCE");
    for (const link of additionalLinks) {
      const cat = link.source_category?.toUpperCase();
      if (
        !cat ||
        !PUBLICATION_BLOG_CATEGORIES.includes(cat as (typeof PUBLICATION_BLOG_CATEGORIES)[number])
      )
        continue;
      const url = link.url?.trim();
      if (!url || !url.startsWith("http")) continue;
      const key = url.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, label: link.channel_name?.trim() || label });
    }

    if (brand.business_taxonomy_id) {
      const taxonomyLinks = await getOtherSourceLinksForTaxonomy(brand.business_taxonomy_id);
      for (const link of taxonomyLinks) {
        const cat = link.source_category?.toUpperCase();
        if (
          !cat ||
          !PUBLICATION_BLOG_CATEGORIES.includes(cat as (typeof PUBLICATION_BLOG_CATEGORIES)[number])
        )
          continue;
        const url = link.url?.trim();
        if (!url || !url.startsWith("http")) continue;
        const key = url.toLowerCase().replace(/\/+$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url, label: link.channel_name?.trim() || label });
      }
    }
  }

  console.log(
    `[${logTs()}] Brand Blog: ${out.length} publication/blog index URL(s) for project (BLOG/NEWS_OUTLET only; taxonomy may log more links that are filtered by category).`
  );
  return out;
}

/**
 * Fetch blog/news content from each project brand's Blog/News URL for the time window.
 * Discovers articles from each index page, filters by date, and concatenates post text for the prompt.
 * Also returns linkBreakdown for test UI (per-link items).
 */
async function fetchBrandBlogNewsData(
  projectId: string,
  since: Date,
  limit: number
): Promise<{
  text: string;
  count: number;
  linkBreakdown: BrandBlogLinkBreakdownItem[];
}> {
  const sinceDateStr = since.toISOString().slice(0, 10); // YYYY-MM-DD

  const projectBrands = await prisma.projectBrand.findMany({
    where: {
      project_id: projectId,
      brand_id: { not: null },
      deleted_at: null,
      brand: { deleted_at: null },
    },
    include: {
      brand: {
        select: {
          company_name: true,
          brand_name: true,
          blog_news_url: true,
        },
      },
    },
  });

  const brandsWithUrl = projectBrands
    .map((pb) => pb.brand)
    .filter(
      (b): b is NonNullable<typeof b> =>
        b != null && b.blog_news_url != null && b.blog_news_url.trim() !== ""
    );

  console.log(
    `[${logTs()}] Brand Blog: project ${projectId}: ${brandsWithUrl.length} brand(s) with blog_news_url; loading taxonomy/additional publication URLs next.`
  );

  const parts: string[] = [];
  let totalArticles = 0;
  const linkBreakdown: BrandBlogLinkBreakdownItem[] = [];
  /** Dedupe by normalized URL across all sources in this run (same article can appear from multiple index pages). */
  const seenArticleUrlsInRun = new Set<string>();

  const FALLBACK_PATHS = ["/news", "/newsroom", "/press"];

  for (const brand of brandsWithUrl) {
    const blogUrl = brand.blog_news_url!.trim();
    const label = brand.brand_name || brand.company_name || "Unknown brand";
    const items: BrandBlogLinkBreakdownItem["items"] = [];
    try {
      const pageText = await fetchPageTextWithLinkUrls(blogUrl);
      let articles = await discoverArticlesFromIndexPage(pageText, blogUrl);
      let baseUrl = blogUrl;
      if (articles.length === 0) {
        try {
          const origin = new URL(blogUrl).origin;
          for (const path of FALLBACK_PATHS) {
            const candidate = path.startsWith("http") ? path : `${origin}${path}`;
            if (candidate === blogUrl) continue;
            const candidateText = await fetchPageTextWithLinkUrls(candidate);
            const discovered = await discoverArticlesFromIndexPage(candidateText, candidate);
            if (discovered.length > 0) {
              articles = discovered;
              baseUrl = candidate;
              break;
            }
          }
        } catch {
          // keep articles []
        }
      }

      if (articles.length === 0 && isBrowserFetchEnabled()) {
        const browserHtml = await fetchPageHtmlWithBrowser(blogUrl);
        if (browserHtml) {
          const browserPageText = getPageTextWithLinkUrlsFromHtml(browserHtml, blogUrl);
          const discovered = await discoverArticlesFromIndexPage(browserPageText, blogUrl);
          if (discovered.length > 0) articles = discovered;
        }
      }

      articles = await filterArticlesByOpenAI(articles);
      // Date fallbacks: most blogs put the date at the start of the snippet; else try URL
      for (const a of articles) {
        if (!a.date && a.text) a.date = parseDateFromText(a.text);
        if (!a.date) a.date = parseDateFromArticleUrl(a.url);
      }
      const inWindow = articles.filter((a) => {
        const iso = normalizeArticleDateToISO(a.date);
        if (iso === null) return false; // exclude when date unknown; only include articles with parseable date in window
        return iso >= sinceDateStr;
      });

      for (const a of inWindow.slice(0, 50)) {
        const norm = normalizeArticleUrl(a.url);
        if (seenArticleUrlsInRun.has(norm)) continue;
        seenArticleUrlsInRun.add(norm);
        totalArticles++;
        const excerptFromIndex = a.text?.trim() || "";
        const content = excerptFromIndex
          ? excerptFromIndex
          : "(qualifying URL only; fetch content via your scraper)";
        items.push({ title: a.title, url: a.url, date: a.date, content });
        parts.push(
          `[Brand: ${label}] ${a.url}\nTitle: ${a.title ?? "—"}\nDate: ${a.date ?? "—"}\n\n---`
        );
      }
      linkBreakdown.push({ url: blogUrl, brandName: label, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parts.push(
        `[Brand: ${label}] ${blogUrl}\n(Failed to fetch or discover articles: ${msg})\n\n---`
      );
      linkBreakdown.push({ url: blogUrl, brandName: label, items: [] });
    }
  }

  // Step 1: scan Publications and Blogs URLs for posts matching the configured date; add to linkBreakdown for step 2.
  const publicationBlogUrls = await getProjectPublicationAndBlogUrls(projectId);
  for (const { url: blogUrl, label } of publicationBlogUrls) {
    const items: BrandBlogLinkBreakdownItem["items"] = [];
    const displayLabel = `Publication/Blog: ${label}`;
    try {
      const pageText = await fetchPageTextWithLinkUrls(blogUrl);
      let articles = await discoverArticlesFromIndexPage(pageText, blogUrl);
      let baseUrl = blogUrl;
      if (articles.length === 0) {
        try {
          const origin = new URL(blogUrl).origin;
          for (const path of FALLBACK_PATHS) {
            const candidate = path.startsWith("http") ? path : `${origin}${path}`;
            if (candidate === blogUrl) continue;
            const candidateText = await fetchPageTextWithLinkUrls(candidate);
            const discovered = await discoverArticlesFromIndexPage(candidateText, candidate);
            if (discovered.length > 0) {
              articles = discovered;
              baseUrl = candidate;
              break;
            }
          }
        } catch {
          // keep articles []
        }
      }
      if (articles.length === 0 && isBrowserFetchEnabled()) {
        const browserHtml = await fetchPageHtmlWithBrowser(blogUrl);
        if (browserHtml) {
          const browserPageText = getPageTextWithLinkUrlsFromHtml(browserHtml, blogUrl);
          const discovered = await discoverArticlesFromIndexPage(browserPageText, blogUrl);
          if (discovered.length > 0) articles = discovered;
        }
      }
      articles = await filterArticlesByOpenAI(articles);
      for (const a of articles) {
        if (!a.date && a.text) a.date = parseDateFromText(a.text);
        if (!a.date) a.date = parseDateFromArticleUrl(a.url);
      }
      const inWindow = articles.filter((a) => {
        const iso = normalizeArticleDateToISO(a.date);
        if (iso === null) return false;
        return iso >= sinceDateStr;
      });
      for (const a of inWindow.slice(0, 50)) {
        const norm = normalizeArticleUrl(a.url);
        if (seenArticleUrlsInRun.has(norm)) continue;
        seenArticleUrlsInRun.add(norm);
        totalArticles++;
        const excerptFromIndex = a.text?.trim() || "";
        const content = excerptFromIndex
          ? excerptFromIndex
          : "(qualifying URL only; fetch content via your scraper)";
        items.push({ title: a.title, url: a.url, date: a.date, content });
        parts.push(
          `[${displayLabel}] ${a.url}\nTitle: ${a.title ?? "—"}\nDate: ${a.date ?? "—"}\n\n---`
        );
      }
      linkBreakdown.push({ url: blogUrl, brandName: displayLabel, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parts.push(
        `[${displayLabel}] ${blogUrl}\n(Failed to fetch or discover articles: ${msg})\n\n---`
      );
      linkBreakdown.push({ url: blogUrl, brandName: displayLabel, items: [] });
    }
  }

  let combined = parts.join("\n\n");
  if (combined.length > BRAND_BLOG_MAX_COMBINED_LENGTH) {
    combined = combined.slice(0, BRAND_BLOG_MAX_COMBINED_LENGTH) + "\n\n...[truncated]";
  }

  const articlesInBreakdown = linkBreakdown.reduce((s, e) => s + e.items.length, 0);
  console.log(
    `[${logTs()}] Brand Blog fetch summary: project=${projectId} articlesInWindow=${articlesInBreakdown} indexPagesScanned=${linkBreakdown.length} windowStart=${sinceDateStr}`
  );
  if (articlesInBreakdown === 0 && linkBreakdown.length > 0) {
    console.warn(
      `[${logTs()}] Brand Blog: 0 articles in window — scanned ${linkBreakdown.length} index page(s) but every candidate was excluded. Common causes: (1) post dates are outside the window or not parseable (unknown dates are excluded), (2) OpenAI relevance filter removed all links, (3) index pages returned no article links. Try a wider time window on the task or check TaskRun / logs above.`
    );
  }
  if (articlesInBreakdown === 0 && linkBreakdown.length === 0) {
    console.warn(
      `[${logTs()}] Brand Blog: no index URLs — add a brand Blog/News URL or taxonomy/other-source links with category BLOG or NEWS_OUTLET.`
    );
  }

  return {
    text: combined || "(no blog/news posts found for the configured timeframe)",
    count: totalArticles,
    linkBreakdown,
  };
}

const DEFAULT_PROMPT = "Summarize or analyze the following data:\n\n{{DATA}}";

/** Build user message: optionally inject target data into prompt. */
function buildUserMessage(
  promptText: string | null | undefined,
  targetPreview: string,
  since: Date,
  target: string
): string {
  const resolvedPrompt =
    promptText?.trim() ||
    (target === TARGET_BRAND_BLOG_NEWS ? BRAND_BLOG_SUMMARY_PROMPT : DEFAULT_PROMPT);
  const text = resolvedPrompt;
  const injected = text.replace(
    /{{DATA}}|{{TARGET_DATA}}|{{CONTENT}}/gi,
    targetPreview.slice(0, 30000)
  );
  if (injected === text && targetPreview !== "(no posts in window)") {
    return `${text}\n\n--- Data (since ${since.toISOString()}) ---\n${targetPreview.slice(0, 25000)}\n--- End ---`;
  }
  return injected;
}

export interface RunTaskResult {
  success: boolean;
  resultPreview: string | null;
  errorMessage: string | null;
  rowCount: number;
  /** Per-link breakdown for BrandBlogNews target (for test UI). */
  linkBreakdown?: BrandBlogLinkBreakdownItem[];
  /** When URLs were sent to Apify scraper: Apify run ID. */
  scraperRunId?: string;
  /** When scraper start failed. */
  scraperError?: string;
  /** When content was fetched and ingested into BlogPost. */
  ingestResult?: IngestBlogPostResult;
}

/**
 * Run a SearchSourceTask for one project: fetch target data, call OpenAI, return result.
 */
export async function runSearchSourceTask(
  task: SearchSourceTask,
  projectId: string,
  options?: {
    persistTaskRun?: boolean;
    executionId?: string;
    stepExecutionId?: string;
    /** When true (e.g. run-test / test UI): do not fetch blog post content or ingest; discovery + OpenAI only. */
    testMode?: boolean;
    /** OrchestrationRun.id for task-based analysis; stamped on BlogPost when ingesting. */
    ingestedRunId?: string | null;
  }
): Promise<RunTaskResult> {
  if (task.target === TARGET_HACKER_NEWS) {
    return {
      success: false,
      resultPreview: null,
      errorMessage:
        "This task uses the Hacker News runner. Use the custom task path for Hacker News, not the search-source LLM runner.",
      rowCount: 0,
    };
  }
  if (task.target === TARGET_GITHUB_READER) {
    return {
      success: false,
      resultPreview: null,
      errorMessage:
        "This task uses the Github Reader runner. Use the custom task path for GitHub search, not the search-source LLM runner.",
      rowCount: 0,
    };
  }
  const since = getSinceDate(task);
  const windowLabel =
    task.timing_duration_number != null && task.timing_duration_unit
      ? `last ${task.timing_duration_number} ${task.timing_duration_unit}(s)`
      : task.timing_definition;
  if (task.target === TARGET_BRAND_BLOG_NEWS) {
    console.log(`[${logTs()}] Brand Blog: discovering articles (time window: ${windowLabel})...`);
  }
  const targetResult = await fetchTargetData(task.target, projectId, since);
  const targetPreview = targetResult.text;
  const rowCount = targetResult.count;
  const linkBreakdown = targetResult.linkBreakdown;
  if (task.target === TARGET_BRAND_BLOG_NEWS) {
    const totalArticles = linkBreakdown
      ? linkBreakdown.reduce((s, e) => s + e.items.length, 0)
      : rowCount;
    const sourceCount = linkBreakdown?.length ?? 0;
    console.log(
      `[${logTs()}] Brand Blog: discovery complete, ${totalArticles} article(s) in window from ${sourceCount} index source(s).`
    );
  }

  // Test mode: Step 1 (find relevant blog posts) already ran in fetchTargetData above, including filterArticlesByOpenAI (OpenAI).
  // Step 2: skip URLs already in BlogPost, then retrieve each new post's content in parallel.
  if (options?.testMode === true && linkBreakdown && linkBreakdown.length > 0) {
    const flat: Array<{
      entry: BrandBlogLinkBreakdownItem;
      item: BrandBlogLinkBreakdownItem["items"][number];
      normalizedUrl: string;
    }> = [];
    for (const entry of linkBreakdown) {
      for (const item of entry.items) {
        const url = item.url?.trim();
        if (url) flat.push({ entry, item, normalizedUrl: normalizeArticleUrl(url) });
      }
    }
    const existingUrls = await getExistingBlogPostUrls(
      projectId,
      flat.map((x) => x.normalizedUrl)
    );
    const toFetch = flat.filter((x) => !existingUrls.has(x.normalizedUrl));
    const fetched = await runWithConcurrency(toFetch, STEP2_FETCH_CONCURRENCY, async ({ item }) => {
      const url = item.url!.trim();
      const content = await fetchArticleContent(url);
      return { url, text: (content ?? "").trim() || "(no content)" };
    });
    const toFetchIndexByUrl = new Map(toFetch.map((x, i) => [x.normalizedUrl, i]));
    const scrapedItems: WebsiteScraperOutputItem[] = [];
    for (const x of flat) {
      const url = x.item.url!.trim();
      if (existingUrls.has(x.normalizedUrl)) {
        x.item.content = "(already in database)";
        console.log(url);
        console.log("(already in database)");
        console.log("");
        continue;
      }
      const idx = toFetchIndexByUrl.get(x.normalizedUrl)!;
      const { text } = fetched[idx];
      x.item.content = text;
      console.log(url);
      console.log(text);
      console.log("");
      if (text !== "(fetch failed)" && text !== "(no content)" && text.length >= 50) {
        const fromPublicationOrBlog = x.entry.brandName.startsWith("Publication/Blog:");
        scrapedItems.push({
          company_url: url,
          title: x.item.title ?? null,
          text,
          status: "ok",
          ...(fromPublicationOrBlog && { affiliation: "MEDIA_OUTLET" as const }),
        });
      }
    }
    let ingestResult: IngestBlogPostResult | undefined;
    if (scrapedItems.length > 0) {
      try {
        ingestResult = await ingestWebsiteScraperOutput(
          projectId,
          scrapedItems,
          options?.ingestedRunId
        );
        console.log(
          `[SearchSourceTask] Test mode: ingested to BlogPost: ${ingestResult.inserted} inserted, ${ingestResult.updated} updated, ${ingestResult.skipped} skipped`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[SearchSourceTask] Test mode ingest failed:", msg);
        ingestResult = { inserted: 0, updated: 0, skipped: 0, errors: [msg] };
      }
    }
    return {
      success: true,
      resultPreview: null,
      errorMessage: null,
      rowCount,
      linkBreakdown,
      ...(ingestResult && { ingestResult }),
    };
  }

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      resultPreview: null,
      errorMessage: "OPENAI_API_KEY is not set",
      rowCount,
    };
  }

  const userMessage = buildUserMessage(
    task.openai_prompt_text ?? null,
    targetPreview,
    since,
    task.target
  );
  if (task.target === TARGET_BRAND_BLOG_NEWS && linkBreakdown?.length) {
    console.log(`[${logTs()}] Brand Blog: sending to OpenAI for summary...`);
  }
  let config: { model?: string; temperature?: number; max_tokens?: number } = {};
  if (task.config_json) {
    try {
      config = JSON.parse(task.config_json) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  const model = (config.model as string) || "gpt-4o-mini";
  const temperature = typeof config.temperature === "number" ? config.temperature : 0.2;
  const max_tokens = typeof config.max_tokens === "number" ? config.max_tokens : 2048;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userMessage }],
        temperature,
        max_tokens,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        resultPreview: null,
        errorMessage: `OpenAI API error: ${response.status} ${errText.slice(0, 500)}`,
        rowCount,
        linkBreakdown,
      };
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const resultPreview = content.slice(0, 10000);

    if (options?.persistTaskRun) {
      await prisma.taskRun.create({
        data: {
          id: generateId(),
          task_id: task.id,
          project_id: projectId,
          execution_id: options.executionId ?? null,
          step_execution_id: options.stepExecutionId ?? null,
          status: "COMPLETED",
          started_at: new Date(),
          completed_at: new Date(),
          result_preview: resultPreview,
        },
      });
    }

    let scraperRunId: string | undefined;
    let scraperError: string | undefined;
    let ingestResult: IngestBlogPostResult | undefined;
    const skipFetchAndIngest = options?.testMode === true;

    // For BrandBlogNews target: automatically fetch blog post content and ingest into BlogPost table
    // Step 1 (discovery) already done above, now do Step 2 (fetch content and ingest)
    if (skipFetchAndIngest && linkBreakdown && linkBreakdown.length > 0) {
      console.log("[SearchSourceTask] Test mode: skipping fetch and ingest of blog post content.");
    }
    // Automatically fetch and ingest for BrandBlogNews target (unless test mode)
    if (
      !skipFetchAndIngest &&
      task.target === TARGET_BRAND_BLOG_NEWS &&
      linkBreakdown &&
      linkBreakdown.length > 0
    ) {
      const flatCount = linkBreakdown.reduce((s, e) => s + e.items.length, 0);
      console.log(`[${logTs()}] Brand Blog: fetching full content for ${flatCount} article(s)...`);
      const flat: Array<{
        entry: BrandBlogLinkBreakdownItem;
        item: BrandBlogLinkBreakdownItem["items"][number];
        normalizedUrl: string;
      }> = [];
      for (const entry of linkBreakdown) {
        for (const item of entry.items) {
          const url = item.url && typeof item.url === "string" ? item.url.trim() : "";
          if (url) flat.push({ entry, item, normalizedUrl: normalizeArticleUrl(url) });
        }
      }
      const existingUrls = await getExistingBlogPostUrls(
        projectId,
        flat.map((x) => x.normalizedUrl)
      );
      const toFetch = flat.filter((x) => !existingUrls.has(x.normalizedUrl));
      const fetched = await runWithConcurrency(
        toFetch,
        STEP2_FETCH_CONCURRENCY,
        async ({ item }) => {
          const url = item.url!.trim();
          const title = item.title && typeof item.title === "string" ? item.title.trim() : null;
          const content = await fetchArticleContent(url);
          const cleaned = (content ?? "").trim();
          return { url, title, cleaned };
        }
      );
      const toFetchIndexByUrl = new Map(toFetch.map((x, i) => [x.normalizedUrl, i]));
      const scrapedItems: WebsiteScraperOutputItem[] = [];
      for (const x of flat) {
        if (existingUrls.has(x.normalizedUrl)) continue;
        const idx = toFetchIndexByUrl.get(x.normalizedUrl)!;
        const { url, title, cleaned } = fetched[idx];
        if (cleaned.length < 50) {
          console.warn(`[SearchSourceTask] Too little content for ${url}, skipping`);
          continue;
        }
        const fromPublicationOrBlog = x.entry.brandName.startsWith("Publication/Blog:");
        scrapedItems.push({
          company_url: url,
          title,
          text: cleaned,
          status: "ok",
          ...(fromPublicationOrBlog && { affiliation: "MEDIA_OUTLET" as const }),
        });
      }
      if (scrapedItems.length > 0) {
        try {
          ingestResult = await ingestWebsiteScraperOutput(
            projectId,
            scrapedItems,
            options?.ingestedRunId
          );
          console.log(
            `[${logTs()}] Brand Blog: ingest complete. BlogPost: ${ingestResult.inserted} inserted, ${ingestResult.updated} updated, ${ingestResult.skipped} skipped.`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[SearchSourceTask] Ingest to BlogPost failed:", msg);
          scraperError = msg;
          ingestResult = {
            inserted: 0,
            updated: 0,
            skipped: 0,
            errors: [msg],
          };
        }
      }
    }

    return {
      success: true,
      resultPreview,
      errorMessage: null,
      rowCount,
      linkBreakdown,
      ...(scraperRunId && { scraperRunId }),
      ...(scraperError && { scraperError }),
      ...(ingestResult && { ingestResult }),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (options?.persistTaskRun) {
      await prisma.taskRun.create({
        data: {
          id: generateId(),
          task_id: task.id,
          project_id: projectId,
          execution_id: options.executionId ?? null,
          step_execution_id: options.stepExecutionId ?? null,
          status: "FAILED",
          started_at: new Date(),
          completed_at: new Date(),
          error_message: errorMessage,
        },
      });
    }
    return {
      success: false,
      resultPreview: null,
      errorMessage,
      rowCount,
      linkBreakdown,
    };
  }
}
