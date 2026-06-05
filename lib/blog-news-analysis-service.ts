/**
 * Blog / News analysis pipeline: fetch content, OpenAI extraction, save with deduplication.
 * No Apify; input = starting URL(s) + time limit (no items before date).
 */

import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import {
  BLOG_ANALYSIS_SYSTEM_PROMPT,
  buildBlogAnalysisUserPrompt,
  buildBlogAnalysisPreCheckPrompt,
  buildBlogAnalysisPreCheckTitleOnlyPrompt,
  KEY_IDEAS_EXTRACTION_SYSTEM_PROMPT,
  buildKeyIdeasExtractionUserPrompt,
  IDEAS_NEED_REWRITE_SYSTEM,
  buildIdeasNeedRewriteUserPrompt,
  REWRITE_IDEA_STANDALONE_SYSTEM,
  buildRewriteIdeaStandaloneUserPrompt,
  SEMANTIC_META_FRAMING_SYSTEM,
  buildSemanticMetaFramingUserPrompt,
  type BlogAnalysisProjectContext,
} from "@/lib/blog-news-analysis-prompts";
import type { Prisma } from "@prisma/client";
import type { PostAffiliation } from "@prisma/client";

const MAX_ARTICLE_TEXT_LENGTH = 120000; // ~30k tokens headroom
const FETCH_TIMEOUT_MS = 25000;

/** All patterns that indicate meta-framing (article/post/person/author says) or reader framing. Stripped so only substance remains. */
const ARTICLE_FRAMING_PATTERNS = [
  // Article/post/piece as subject — says/notes/reports/etc.
  /\s*The article (?:says?|notes?|reports?|explains?|emphasizes?|adds?|points out|indicates?|suggests?|argues?|continues?|goes on to say|discusses|examines|analyzes|covers|looks at|spotlights|highlights|identifies|points to|describes|outlines|details|reveals|shows)\s+(?:that\s+)?/gi,
  /\s*The post (?:says?|notes?|reports?|explains?|emphasizes?|adds?|discusses|covers|highlights|goes on to say)\s+(?:that\s+)?/gi,
  /\s*The piece (?:says?|notes?|reports?|explains?|discusses|explores|examines|covers|highlights)\s+(?:that\s+)?/gi,
  /\s*This (?:article|post|piece) (?:says?|notes?|reports?|discusses|covers|explores|examines|highlights)\s+(?:that\s+)?/gi,
  /\s*It (?:says?|notes?|reports?|spotlights|discusses|identifies|emphasizes|highlights|points to|reveals|shows)\s+(?:that\s+)?/gi,
  // According to / As the article
  /\s*According to the (?:article|post|piece)\s*,?\s*/gi,
  /\s*As the (?:article|post|piece) (?:notes?|says?|explains?)\s*,?\s*/gi,
  /\s*The (?:article|post|piece) goes on to say\s+(?:that\s+)?/gi,
  // Conclusion / reader framing
  /\s*The article concludes by (?:emphasizing|noting|highlighting|stressing|underlining)\s+/gi,
  /\s*The article concludes with\s+/gi,
  /\s*The piece concludes (?:with|by)\s+/gi,
  /\s*leaving readers to (?:ponder|consider|reflect on)\s+/gi,
  /\s*readers are left to (?:ponder|consider|reflect on)\s+/gi,
  // Author/writer/person — strip framing and keep substance (e.g. "The person also said that X" → "X")
  /\s*The author (?:says?|notes?|argues?|suggests?|explains?|adds?)\s+(?:that\s+)?/gi,
  /\s*The writer (?:says?|notes?|argues?|suggests?)\s+(?:that\s+)?/gi,
  /\s*The person (?:also\s+)?(?:said|says?|adds?|notes?|continued?|argues?|suggests?)\s+(?:that\s+)?/gi,
  /\s*(?:A|One) person (?:also\s+)?(?:said|says?)\s+(?:that\s+)?/gi,
  /\s*Someone (?:also\s+)?(?:said|says?)\s+(?:that\s+)?/gi,
];

/** Strip article/post/person framing via regex. Used only for summary and for DB cleanup script — idea pipeline uses semantic checks instead. */
export function sanitizeArticleFraming(text: string): string {
  if (!text || typeof text !== "string") return text;
  let s = text.trim();
  let prev = "";
  while (prev !== s) {
    prev = s;
    for (const re of ARTICLE_FRAMING_PATTERNS) {
      s = s.replace(re, " ");
    }
    s = s.replace(/\s+/g, " ").trim();
  }
  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}
// Browser-like User-Agent so news sites are less likely to block the request
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface DiscoveredArticle {
  url: string;
  title: string | null;
  date: string | null; // YYYY-MM-DD
  text: string | null;
}

export interface BlogAnalysisRunInput {
  projectId: string;
  sourceUrls: string[];
  noItemsBeforeDate: Date;
  /** If provided, skip discovery and use these article URLs (fetch + analyze each). */
  articleUrls?: string[];
}

export interface BlogAnalysisRunResult {
  runId: string;
  status: "COMPLETED" | "FAILED";
  itemsFound: number;
  itemsNew: number;
  errorMessage?: string;
}

/**
 * Fetch a URL and return plain text (strip HTML).
 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

export async function fetchPageText(url: string): Promise<string> {
  const html = await fetchHtml(url);
  return stripHtmlToText(html);
}

/**
 * Turn raw HTML into plain text with link targets as "link text [absolute_url]".
 * Exported so the runner can use it with browser-fetched HTML when the page is JS-rendered.
 */
export function getPageTextWithLinkUrlsFromHtml(html: string, baseUrl: string): string {
  return htmlToTextWithLinkUrls(html, baseUrl);
}

/**
 * Fetch a page and return plain text with each link's exact href preserved as "link text [absolute_url]".
 * Use this for index pages so article discovery extracts exact URLs from the page instead of inferring from text.
 */
export async function fetchPageTextWithLinkUrls(url: string): Promise<string> {
  const html = await fetchHtml(url);
  return htmlToTextWithLinkUrls(html, url);
}

const BROWSER_FETCH_TIMEOUT_MS = 25_000;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Selectors for main article/post body so we return full content, not just header/nav. */
const MAIN_CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".entry-content",
  ".post-content",
  ".article-body",
  ".article-content",
  ".content",
  ".blog-post",
  ".post-body",
  ".prose",
  ".markdown",
  "[data-content]",
  ".blog-content",
  ".single-post",
  ".page-content",
  ".post",
  ".article",
  ".mdx",
  "[class*='content']",
  "[class*='post']",
  "[class*='article']",
  "[class*='blog']",
  "section",
];

function getBrowserContextOptions(): {
  userAgent: string;
  viewport: { width: number; height: number };
} {
  return {
    userAgent: BROWSER_USER_AGENT,
    viewport: { width: 1920, height: 1080 },
  };
}

/**
 * Fetch a page using a headless browser so JS-rendered content (e.g. newsroom article lists) is present.
 * Use when normal fetch yields no article links. Returns raw HTML or null on failure.
 */
export async function fetchPageHtmlWithBrowser(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    try {
      const context = await browser.newContext(getBrowserContextOptions());
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_FETCH_TIMEOUT_MS,
      });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const html = await page.content();
      await context.close();
      return html;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

/**
 * Fetch a single page's full text using a headless browser.
 * Extracts main article body (full blog post) when possible; otherwise full page text.
 * Uses a real-looking browser profile to reduce blocking.
 */
export async function fetchPageTextWithBrowser(url: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    try {
      const context = await browser.newContext(getBrowserContextOptions());
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_FETCH_TIMEOUT_MS,
      });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page
        .waitForSelector("article, main, [role='main'], .post-content, .entry-content, .prose, p", {
          timeout: 5000,
        })
        .catch(() => {});

      const text = await page.evaluate((selectors: string[]) => {
        const bodyText = document.body?.innerText ?? "";
        let best = bodyText;
        let bestScore = 0;

        function isNavOrChrome(el: HTMLElement): boolean {
          const tag = el.tagName?.toLowerCase();
          const role = el.getAttribute?.("role")?.toLowerCase();
          const cls = el.className?.toString().toLowerCase() ?? "";
          return !!(
            tag === "nav" ||
            tag === "header" ||
            tag === "footer" ||
            role === "navigation" ||
            cls.includes("nav") ||
            cls.includes("header") ||
            cls.includes("footer") ||
            cls.includes("sidebar") ||
            cls.includes("menu")
          );
        }

        function score(len: number, pCount: number): number {
          if (len < 800) return 0;
          return pCount * 2000 + len;
        }

        for (const sel of selectors) {
          try {
            const nodes = document.querySelectorAll(sel);
            for (let i = 0; i < nodes.length; i++) {
              const el = nodes[i] as HTMLElement;
              if (isNavOrChrome(el)) continue;
              const t = el.innerText?.trim() ?? "";
              const pCount = el.querySelectorAll?.("p")?.length ?? 0;
              const s = score(t.length, pCount);
              if (s > bestScore) {
                best = t;
                bestScore = s;
              }
            }
          } catch {
            // continue
          }
        }

        const fallbacks = document.querySelectorAll("article, main, [role='main'], section, div");
        for (let i = 0; i < fallbacks.length; i++) {
          const el = fallbacks[i] as HTMLElement;
          if (isNavOrChrome(el)) continue;
          const t = el.innerText?.trim() ?? "";
          const pCount = el.querySelectorAll?.("p")?.length ?? 0;
          const s = score(t.length, pCount);
          if (s > bestScore) {
            best = t;
            bestScore = s;
          }
        }

        return bestScore > 0 ? best : bodyText;
      }, MAIN_CONTENT_SELECTORS);

      await context.close();
      const cleaned = (text ?? "").trim().replace(/\n{3,}/g, "\n\n");
      return cleaned || "";
    } finally {
      await browser.close();
    }
  } catch {
    return "";
  }
}

function htmlToTextWithLinkUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  let out = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  const linkRe = /<a\s[^>]*\bhref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  out = out.replace(linkRe, (_, href: string, inner: string) => {
    const t = inner
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let u = (href ?? "").trim();
    if (u && !u.startsWith("http")) {
      try {
        u = new URL(u, base).href;
      } catch {
        // keep u
      }
    }
    return u ? (t ? `${t} [${u}]` : u) : t || "";
  });
  return stripHtmlToText(out);
}

/** Strip HTML to plain text; exported for HN comment bodies and other callers. */
export function stripHtmlToPlainText(html: string): string {
  return stripHtmlToText(html);
}

function stripHtmlToText(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
  if (text.length > MAX_ARTICLE_TEXT_LENGTH) text = text.slice(0, MAX_ARTICLE_TEXT_LENGTH);
  return text;
}

/**
 * Call OpenAI to extract a list of articles from an index page.
 */
export async function discoverArticlesFromIndexPage(
  pageText: string,
  baseUrl: string
): Promise<DiscoveredArticle[]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const truncated =
    pageText.length > 50000 ? pageText.slice(0, 50000) + "\n...[truncated]" : pageText;

  const userPrompt = `This is the HTML content (as plain text) of a blog or newsroom index page. Link targets are shown as "link text [exact_url]" — the exact URL is inside the square brackets.

Extract a list of all distinct articles/posts/news items. For each item return:
- url: use the EXACT URL that appears in square brackets [...] for that link. Copy it character-for-character. Do not infer or rewrite the URL from the link text.
- title: article title if visible
- date: Extract the publication date when it appears in byline, under title, same row as the link, or URL path. Accept: explicit dates ("Feb 16, 2026", "16th February 2026", "2026-02-16"); relative times ("5 hours ago", "3 days ago"); or ordinals ("13th January 2026"). Prefer YYYY-MM-DD for calendar dates; for relative times return the exact phrase. If the page is a "latest news" or "recent articles" list and no date is visible for an item, use today's date in YYYY-MM-DD so it can be time-filtered. Use null only when there is genuinely no date and the item is not in a clear "latest/recent" list.
- text: if the full article text or a long excerpt is on this page, include it; otherwise null

Return only a JSON array of objects with keys: url, title, date, text. No other text or markdown.

--- Page text ---
${truncated}
--- End ---`;

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You extract structured data from web pages. Use the exact URL from square brackets; do not infer or rewrite URLs. The publication date is almost always at the very beginning of each item (byline, first line, or same row as the link). Extract it in any format you see; we will normalize it. Return only valid JSON arrays. No markdown, no explanation.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI discovery failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  let arr: unknown[];
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const base = new URL(baseUrl);
  return arr
    .filter((o): o is Record<string, unknown> => o != null && typeof o === "object")
    .map((o) => {
      let url = typeof o.url === "string" ? o.url.trim() : "";
      if (url && !url.startsWith("http")) {
        try {
          url = new URL(url, base).href;
        } catch {
          url = "";
        }
      }
      return {
        url: url || "",
        title: typeof o.title === "string" ? o.title.trim() : null,
        date: typeof o.date === "string" ? o.date.trim() : null,
        text: typeof o.text === "string" ? o.text.trim().slice(0, MAX_ARTICLE_TEXT_LENGTH) : null,
      };
    })
    .filter((a) => a.url);
}

/**
 * Ask OpenAI which of the extracted items look like actual news articles or blog posts.
 * Excludes subscribe pages, media galleries, category indexes, navigation, etc.
 * Returns only the subset of articles that are real news/blog content.
 * Date filtering by task window is done by the caller.
 */
export async function filterArticlesByOpenAI(
  articles: DiscoveredArticle[]
): Promise<DiscoveredArticle[]> {
  if (articles.length === 0) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return articles;

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  const list = articles
    .slice(0, 100)
    .map((a) => ({ title: a.title ?? "(no title)", url: a.url, date: a.date ?? "(no date)" }));
  const userPrompt = `Below is a list of items extracted from a newsroom or blog index page. Each has title, url, and date (or "no date").

Which of these are actual news articles or blog posts? EXCLUDE: Subscribe/signup pages, media galleries (photos/videos), category or topic index pages, navigation links, logos, "About us", fact sheets, or similar non-article pages. INCLUDE: Press releases, news stories, blog posts, announcements.

Return ONLY a JSON array of the URLs that are real articles or blog posts. No other text. Example: ["https://example.com/news/item1", "https://example.com/news/item2"]

--- Items ---
${JSON.stringify(list, null, 2)}
--- End ---`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You identify which items in a list are actual news articles or blog posts. Return only a valid JSON array of URLs. No markdown, no explanation.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) return articles;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return articles;
    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    let urls: string[];
    try {
      const arr = JSON.parse(cleaned);
      urls = Array.isArray(arr)
        ? arr
            .filter((u): u is string => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean)
        : [];
    } catch {
      return articles;
    }
    const allowed = new Set(urls);
    return articles.filter((a) => allowed.has(a.url));
  } catch {
    return articles;
  }
}

const SERPAPI_TIMEOUT_MS = 18_000;

/**
 * Build a narrow site: query. Google site: uses domain (no protocol); path can narrow results.
 * - If blog URL is a hub (e.g. /overview/) we search inurl:news-details so we get article pages.
 * - Otherwise we search under the blog path (e.g. site:example.com/newsroom).
 */
function buildSerpSiteQuery(blogUrl: string): string | null {
  try {
    const u = new URL(blogUrl);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    const firstSegment = path.split("/").filter(Boolean)[0] ?? "";

    const isHub =
      !firstSegment ||
      firstSegment === "overview" ||
      firstSegment === "default.aspx" ||
      path === "" ||
      path === "/";

    if (isHub) {
      return `site:${host} inurl:news-details`;
    }
    return `site:${host}/${firstSegment}`;
  } catch {
    return null;
  }
}

/**
 * Only keep URLs that belong to the blog's article area (same origin + under article path).
 * Rejects anything outside (e.g. charters, destinations, sweepstakes on same domain).
 */
function isUnderBlogArticleArea(resultUrl: string, blogUrl: string): boolean {
  try {
    const result = new URL(resultUrl);
    const blog = new URL(blogUrl);
    if (result.origin !== blog.origin) return false;

    const path = result.pathname.toLowerCase();
    const blogPath = blog.pathname.toLowerCase().replace(/\/+$/, "");
    const blogPrefix = blogPath.split("/").filter(Boolean)[0] ?? "";

    if (!blogPrefix) return path.includes("/news/news-details");
    if (path.includes("/news/news-details")) return true;
    const prefixWithSlash = `/${blogPrefix}/`;
    return path === `/${blogPrefix}` || path.startsWith(prefixWithSlash);
  } catch {
    return false;
  }
}

/**
 * Exclude the index/hub URL and obvious non-article pages (subscribe, logos, media galleries, category indexes).
 */
function isNonArticlePage(url: string, blogIndexUrl: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const blogPath = new URL(blogIndexUrl).pathname.toLowerCase();
    if (path === blogPath) return true;
    if (path.includes("/subscribe") || path.includes("/overview")) return true;
    if (path.includes("/multimedia/logos") || path.includes("/logos/default")) return true;
    if (path.includes("/media/")) return true;
    if (path.endsWith("/esg") || path.endsWith("/esg/")) return true;
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    if (["operations", "customer-experience", "culture", "sustainability"].some((s) => last === s))
      return true;
    if (
      /\/news\/(operations|culture|customer-experience|sustainability)\/20\d{2}\/default\.aspx$/i.test(
        path
      )
    )
      return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Discover article URLs using SerpAPI with a narrow site: query.
 * No date filter here; the runner filters by the task's configured window (sinceDateStr).
 * Only returns URLs under the blog's article area; rejects rest-of-site pages (charters, sweepstakes, etc.).
 */
export async function discoverArticleUrlsWithSerpAPI(
  blogUrl: string,
  maxResults: number = 25
): Promise<DiscoveredArticle[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];
  const query = buildSerpSiteQuery(blogUrl);
  if (!query) return [];
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: String(Math.min(25, maxResults)),
    gl: "us",
    hl: "en",
  });
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SERPAPI_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic_results?: Array<{ link?: string; title?: string; snippet?: string; date?: string }>;
    };
    const results = data.organic_results ?? [];
    return results
      .filter((r) => typeof r.link === "string" && r.link.startsWith("http"))
      .map((r) => (r.link as string).trim())
      .filter((url) => isUnderBlogArticleArea(url, blogUrl) && !isNonArticlePage(url, blogUrl))
      .slice(0, maxResults)
      .map((url) => {
        const r = results.find((x) => (x.link as string).trim() === url);
        return {
          url,
          title: r && typeof r.title === "string" ? r.title.trim() : null,
          date: r && typeof r.date === "string" ? r.date.trim() : null,
          text: r && typeof r.snippet === "string" ? r.snippet.trim() : null,
        };
      });
  } catch {
    return [];
  }
}

/** Raw extraction shape returned by OpenAI (nested). */
export interface BlogAnalysisExtraction {
  summary?: string | null;
  article_date?: string | null;
  /** Up to 7 main themes (one per paragraph/section); unused slots null. */
  ideas?: (string | null)[] | null;
  audience?: {
    primary_persona?: string | null;
    secondary_personas?: string[] | null;
    seniority_level?: string | null;
    audience_domain?: string | null;
    audience_targeting?: string | null;
  } | null;
  offering_context?: {
    offering_content_type?: string | null;
    lifecycle_stage?: string | null;
    offering_notes?: string | null;
  } | null;
  intent?: {
    primary_intent?: string | null;
    secondary_intents?: string[] | null;
  } | null;
  evidence?: {
    evidence_types_used?: string[] | null;
    evidence_strength?: string | null;
  } | null;
  specificity?: {
    specificity_level?: string | null;
    actionability_level?: string | null;
  } | null;
  competitive?: {
    competitive_posture?: string | null;
    competitive_direction?: string | null;
    explicit_competitors?: string | null;
    category_framing?: string | null;
  } | null;
  sensitivity?: {
    sensitivity_level?: string | null;
    sensitivity_tone?: string | null;
    trust_building_elements?: string | null;
  } | null;
  temporal?: {
    timing_nature?: string | null;
    urgency_level?: string | null;
  } | null;
  strategic?: {
    implied_strategic_direction?: string | null;
    confidence_posture?: string | null;
  } | null;
  cta?: {
    explicit_cta?: string | null;
    implicit_cta?: string | null;
  } | null;
  meta?: {
    content_archetype?: string | null;
    signal_strength_score?: number | null;
    affiliation?: string | null;
    relevance_score?: number | null;
    is_ad?: boolean | null;
  } | null;
}

export interface BlogAnalysisPreCheckResult {
  is_ad: boolean;
  relevance_score: number;
}

/**
 * Build a short semantic description of what this project's user is curious about,
 * from keywords, brands, and monitoring focus. Used for relevance scoring by meaning, not word matching.
 * Returns empty string if project has no scope (no keywords/brands/focus) or LLM fails.
 */
export async function buildSemanticProjectScope(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    select: {
      name: true,
      description: true,
      monitoring_focus: true,
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });
  const keywords = project?.keywords?.map((k) => k.keyword).filter(Boolean) ?? [];
  const brands = project?.brands?.map((b) => b.brand_name).filter(Boolean) ?? [];
  const hasScope =
    (keywords.length > 0 || brands.length > 0 || (project?.monitoring_focus?.trim() ?? "")) !== "";
  if (!project || !hasScope) return "";

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "";

  const monitoringFocus = (project.monitoring_focus?.trim() ?? "") || "(none)";
  const prompt = `Given this project configuration, write a short paragraph (2–4 sentences) that describes what this user is curious about — the themes, topics, and interests in plain language. Do NOT just list the keywords; interpret their meaning (e.g. turn keyword phrases into the actual domain or theme they represent). Include that they have specific interest in the listed brands when present. Output ONLY the paragraph, no preamble or labels.

Project name: ${project.name}
${project.description ? `Description: ${project.description}` : ""}
Monitoring focus: ${monitoringFocus}
Keywords: ${keywords.join(", ") || "(none)"}
Brands: ${brands.join(", ") || "(none)"}`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You output only the requested paragraph. No bullet points, no labels, no JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content ?? "";
  } catch {
    return "";
  }
}

/** Strip hollow tail words models often append to theme labels (safety net after LLM). */
function sanitizeKeywordBroaderScopeLine(line: string): string {
  if (!line.trim()) return line;
  const hollow =
    /\s+(options|offerings|solutions|opportunities|initiatives|strategies|aspects|considerations|comparisons|compare|versus|vs)\b/gi;
  let cur = line;
  let prev = "";
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(hollow, "");
  }
  return cur.replace(/\s{2,}/g, " ").trim();
}

/**
 * Build the broad OR-mode project scope from keywords.
 * Returns one sentence: fixed opening + exactly three short theme labels (1)(2)(3).
 * Returns empty string if no keywords or LLM fails.
 */
export async function buildKeywordBroaderDefinition(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    select: {
      monitoring_focus: true,
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
    },
  });
  const keywords = project?.keywords?.map((k) => k.keyword).filter(Boolean) ?? [];
  if (keywords.length === 0) return "";

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "";

  const monitoringFocus = (project?.monitoring_focus?.trim() ?? "") || "";
  const prompt = `From the keywords below, produce ONE project scope line for relevance matching. Do not define each keyword separately and do not chain one keyword to another.

Follow this structure EXACTLY (same opening sentence; then exactly three items):
Stories, discussions, insights, updates, or news covering one or more of the following ideas: (1) ... (2) ... (3) ...

Rules for each numbered item:
- Keep it SHORT: a compact noun phrase or a single plain clause (roughly 6–18 words per item). Think "topic label", not explanation.
- State the theme using the keyword ideas themselves, close synonyms, or short adjacent terms only. Do not add vague filler words that do not change meaning.
- NEVER tack empty tail nouns onto a theme. Forbidden anywhere in the numbered items (including as the last word of a phrase): options, offerings, solutions, opportunities, initiatives, strategies, aspects, considerations, comparisons, compare, versus, vs, space (as in "the X space"), ecosystem, landscape, dynamics, and similar generic business filler unless that exact word appears in the keywords.
- Do NOT add analyst, marketing, or causal framing. Do NOT use: trends, developments, impact, evolving, operational effects, strategic shifts, experiences (as a framing device), or similar unless those exact ideas appear in the keywords.
- Do NOT narrow scope beyond what the keywords reasonably imply. Do not invent subplots, industries, or outcomes the keywords do not suggest.
- Group keywords into exactly three distinct themes, one per number. Keep the opening sentence unchanged.

Keywords: ${keywords.join(", ")}${monitoringFocus ? `\nMonitoring focus (context only, do not copy verbatim unless it tightens grouping): ${monitoringFocus}` : ""}

Output ONLY that single line (the full sentence with numbered items). No preamble, section headers, bullets, or JSON.`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You output exactly one sentence: fixed opening plus exactly (1) (2) (3). Each item names the topic plainly—no options, offerings, solutions, comparisons/compare/vs/versus, trends, impact, dynamics, landscape, or other hollow filler. No other text.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 280,
      }),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    return raw ? sanitizeKeywordBroaderScopeLine(raw) : "";
  } catch {
    return "";
  }
}

/**
 * Lightweight pre-check: only is_ad and relevance_score. Use before full analysis;
 * if is_ad or relevance_score < 2, skip full extraction and create a minimal row.
 */
export async function analyzeArticlePreCheck(params: {
  articleTitle: string | null;
  articleText: string;
  projectContext?: BlogAnalysisProjectContext | null;
}): Promise<BlogAnalysisPreCheckResult> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const userPrompt = buildBlogAnalysisPreCheckPrompt({
    articleTitle: params.articleTitle,
    articleText: params.articleText,
    projectContext: params.projectContext ?? undefined,
  });

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You return only valid JSON. No markdown, no explanation.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI pre-check failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return { is_ad: false, relevance_score: 3 };

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { meta?: { is_ad?: boolean; relevance_score?: number } };
    const meta = parsed?.meta;
    const is_ad = typeof meta?.is_ad === "boolean" ? meta.is_ad : false;
    const relevance_score =
      typeof meta?.relevance_score === "number" &&
      meta.relevance_score >= 1 &&
      meta.relevance_score <= 5
        ? meta.relevance_score
        : 3;
    return { is_ad, relevance_score };
  } catch {
    return { is_ad: false, relevance_score: 3 };
  }
}

/**
 * Title-only pre-check: is_ad and relevance_score from article title.
 * When semanticScope is provided, relevance is judged by "is this what the user is curious about?" (semantic).
 */
export async function analyzeArticlePreCheckTitleOnly(params: {
  articleTitle: string | null;
  projectContext?: BlogAnalysisProjectContext | null;
  semanticScope?: string | null;
}): Promise<BlogAnalysisPreCheckResult> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const userPrompt = buildBlogAnalysisPreCheckTitleOnlyPrompt({
    articleTitle: params.articleTitle,
    projectContext: params.projectContext ?? undefined,
    semanticScope: params.semanticScope ?? undefined,
  });

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You return only valid JSON. No markdown, no explanation.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI pre-check (title-only) failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return { is_ad: false, relevance_score: 3 };

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { meta?: { is_ad?: boolean; relevance_score?: number } };
    const meta = parsed?.meta;
    const is_ad = typeof meta?.is_ad === "boolean" ? meta.is_ad : false;
    const relevance_score =
      typeof meta?.relevance_score === "number" &&
      meta.relevance_score >= 1 &&
      meta.relevance_score <= 5
        ? meta.relevance_score
        : 3;
    return { is_ad, relevance_score };
  } catch {
    return { is_ad: false, relevance_score: 3 };
  }
}

/**
 * Call OpenAI to analyze one article and return structured extraction.
 * When projectContext is provided, the model will set relevance_score 1–5 against project brands/focus.
 */
export async function analyzeArticleWithOpenAI(params: {
  articleUrl: string;
  articleTitle: string | null;
  articleDate: string | null;
  articleText: string;
  projectContext?: BlogAnalysisProjectContext | null;
}): Promise<BlogAnalysisExtraction> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const userPrompt = buildBlogAnalysisUserPrompt({
    articleUrl: params.articleUrl,
    articleTitle: params.articleTitle,
    articleDate: params.articleDate,
    articleText:
      params.articleText.length > MAX_ARTICLE_TEXT_LENGTH
        ? params.articleText.slice(0, MAX_ARTICLE_TEXT_LENGTH) + "\n...[truncated]"
        : params.articleText,
    projectContext: params.projectContext ?? undefined,
  });

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: BLOG_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI analysis failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return {};

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as BlogAnalysisExtraction;
  } catch {
    return {};
  }
}

/**
 * Extract key ideas from article text (one per paragraph/section, up to 7).
 * Each idea is a standalone sentence (reader did not read previous ideas).
 * Used after a record has been qualified (not ad, project-relevant).
 */
export async function extractKeyIdeasFromArticle(articleText: string): Promise<string[]> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const userPrompt = buildKeyIdeasExtractionUserPrompt(articleText);

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: KEY_IDEAS_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.warn(`[extractKeyIdeasFromArticle] OpenAI error: ${response.status} ${err}`);
    return [];
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const arrayMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr) as { ideas?: unknown };
    const ideas = parsed.ideas;
    if (!Array.isArray(ideas)) return [];
    const raw = ideas
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 7);
    if (raw.length === 0) return [];
    // Gate: semantic check — which ideas need rewriting (unresolved referents, or meta-framing by meaning).
    const needsRewrite = await ideasNeedRewrite(raw);
    const rewritten: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (needsRewrite[i]) {
        const one = await rewriteIdeaToStandalone(raw[i], articleText);
        rewritten.push(one.length > 0 ? one : raw[i]);
      } else {
        rewritten.push(raw[i]);
      }
    }
    // Semantic verification: does any sentence still treat the article as source or use unnamed attribution? Re-rewrite those.
    const stillHasMeta = await sentencesStillHaveMetaFraming(rewritten);
    for (let i = 0; i < rewritten.length; i++) {
      if (stillHasMeta[i]) {
        const one = await rewriteIdeaToStandalone(rewritten[i], articleText);
        if (one.length > 0) rewritten[i] = one;
      }
    }
    // Final format validation (code-only): review each idea; rewrite if and only if format is unacceptable.
    // Enforce standalone rule in code: reject sentences that start with "The " + an unidentified common noun.
    for (let i = 0; i < rewritten.length; i++) {
      for (let attempt = 0; attempt < 2 && isUnacceptableIdeaFormat(rewritten[i]); attempt++) {
        const one = await rewriteIdeaToStandalone(rewritten[i], articleText);
        if (one.length > 0) rewritten[i] = one;
      }
    }
    return rewritten;
  } catch {
    return [];
  }
}

/**
 * Batched gate: one API call to decide which ideas need rewriting (reader with zero context — are all referents explicit?).
 * Returns boolean[] in same order as sentences; on parse error or missing entry we default to true (rewrite to be safe).
 */
async function ideasNeedRewrite(sentences: string[]): Promise<boolean[]> {
  if (sentences.length === 0) return [];
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sentences.map(() => true);

  const userPrompt = buildIdeasNeedRewriteUserPrompt(sentences);
  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: IDEAS_NEED_REWRITE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) return sentences.map(() => true);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return sentences.map(() => true);

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonStr = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr) as Array<{ index?: number; needs_rewrite?: boolean }>;
    if (!Array.isArray(parsed)) return sentences.map(() => true);
    const byIndex = new Map<number, boolean>();
    for (const o of parsed) {
      const idx = typeof o.index === "number" ? o.index : undefined;
      if (idx != null && idx >= 1 && idx <= sentences.length) {
        byIndex.set(idx, Boolean(o.needs_rewrite));
      }
    }
    return sentences.map((_, i) => byIndex.get(i + 1) ?? true);
  } catch {
    return sentences.map(() => true);
  }
}

/**
 * Semantic check: do any of these sentences still treat the article/post as source or attribute to an unnamed person/source?
 * Returns boolean[] in same order. No word lists — LLM judges by meaning. On parse error or empty, returns all true (re-rewrite to be safe).
 */
async function sentencesStillHaveMetaFraming(sentences: string[]): Promise<boolean[]> {
  if (sentences.length === 0) return [];
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sentences.map(() => true);

  const userPrompt = buildSemanticMetaFramingUserPrompt(sentences);
  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SEMANTIC_META_FRAMING_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) return sentences.map(() => true);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return sentences.map(() => true);

  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonStr = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr) as Array<{ index?: number; has_meta?: boolean }>;
    if (!Array.isArray(parsed)) return sentences.map(() => true);
    const byIndex = new Map<number, boolean>();
    for (const o of parsed) {
      const idx = typeof o.index === "number" ? o.index : undefined;
      if (idx != null && idx >= 1 && idx <= sentences.length) {
        byIndex.set(idx, Boolean(o.has_meta));
      }
    }
    return sentences.map((_, i) => byIndex.get(i + 1) ?? true);
  } catch {
    return sentences.map(() => true);
  }
}

/**
 * Deterministic format check: is this idea in unacceptable form (not standalone)?
 * Used to decide if we must rewrite; no LLM — rules enforced in code.
 * Returns true if the idea should be rewritten.
 */
function isUnacceptableIdeaFormat(idea: string): boolean {
  const t = idea.trim();
  if (!/^The\s+\S/.test(t)) return false;

  const afterThe = t.slice(4); // after "The "
  const firstWordMatch = afterThe.match(/^([a-zA-Z]+)/);
  if (!firstWordMatch) return false;
  const firstWord = firstWordMatch[1];
  const firstWordLower = firstWord.toLowerCase();

  // Allow well-known entities that need no prior context (no industry-specific names)
  const ALLOWED_AFTER_THE = new Set(["eu", "dot", "fda", "sec", "ftc", "ceo", "cio", "cto"]);

  if (ALLOWED_AFTER_THE.has(firstWordLower)) return false;

  // Unacceptable: "The " + common noun (unidentified referent)
  if (/^[a-z]/.test(firstWord)) return true;

  // Common nouns that make "The X" ambiguous when the referent is not identified (case-insensitive)
  const FORBIDDEN_AFTER_THE = new Set([
    "funding",
    "traveler",
    "traveller",
    "design",
    "passenger",
    "husband",
    "wife",
    "report",
    "information",
    "company",
    "leaked",
    "document",
    "agreement",
    "woman",
    "man",
    "person",
    "source",
    "author",
    "writer",
    "article",
    "post",
    "piece",
    "conclusion",
    "reader",
    "attendant",
    "fund",
    "investment",
    "order",
    "deal",
    "carrier",
    "hub",
    "route",
    "program",
    "plan",
    "change",
    "vehicle",
    "transport",
    "trip",
    "announcement",
    "statement",
    "update",
    "release",
  ]);

  if (FORBIDDEN_AFTER_THE.has(firstWordLower)) return true;

  // Multi-word forbidden starts (after "The ")
  if (/^leaked\s+information\b/i.test(afterThe)) return true;
  if (/^new\s+(design|plan|product|report)\b/i.test(afterThe)) return true;

  return false;
}

/**
 * Second-pass rewrite: make one idea sentence standalone by naming all referents from the article.
 * Enforces the rule in code instead of relying on the extraction step.
 */
async function rewriteIdeaToStandalone(sentence: string, articleContext: string): Promise<string> {
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sentence;

  const userPrompt = buildRewriteIdeaStandaloneUserPrompt(sentence, articleContext);
  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: REWRITE_IDEA_STANDALONE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });

  if (!response.ok) return sentence;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return sentence;
  return content.split("\n")[0]?.trim() ?? content.trim();
}

/** Prisma enum sets for validation (allow only known values). */
const ENUMS = {
  ContentPersona: new Set([
    "DEVELOPER_ENGINEER",
    "CTO_VP_ENGINEERING",
    "CISO_SECURITY_LEADER",
    "BUSINESS_BUYER",
    "END_USER_CUSTOMER",
    "INVESTOR_ANALYST",
    "PARTNER_ECOSYSTEM",
    "GENERAL_PUBLIC_PRESS",
  ]),
  SeniorityLevel: new Set(["IC", "MANAGER", "EXECUTIVE", "MIXED"]),
  AudienceDomain: new Set(["TECHNICAL", "BUSINESS", "COMPLIANCE_LEGAL", "MIXED"]),
  AudienceTargeting: new Set(["EXPLICITLY_TARGETED", "BROAD_MULTI_PERSONA"]),
  OfferingContentType: new Set([
    "NEW_PRODUCT",
    "NEW_FEATURE",
    "EXISTING_PRODUCT_ENHANCEMENT",
    "REPOSITIONING_EXISTING_CAPABILITY",
    "PACKAGING_PRICING_CHANGE",
    "NO_PRODUCT_MENTIONED",
  ]),
  LifecycleStage: new Set([
    "ANNOUNCEMENT",
    "EARLY_ACCESS_BETA",
    "GA_LAUNCH",
    "ITERATION_IMPROVEMENT",
    "DEPRECATION_SUNSET",
  ]),
  PrimaryIntent: new Set([
    "PRODUCT_FEATURE_ANNOUNCEMENT",
    "COMPETITIVE_DIFFERENTIATION",
    "CUSTOMER_PARTNER_ANNOUNCEMENT",
    "TECHNICAL_EDUCATION_THOUGHT_LEADERSHIP",
    "TRUST_RISK_REDUCTION",
    "MARKET_POSITIONING_NARRATIVE_SHAPING",
    "EVENT_PROMOTION_OR_RECAP",
    "BRAND_CREDIBILITY",
    "VISION_ROADMAP_SIGNALING",
  ]),
  SecondaryIntent: new Set([
    "RECRUITING",
    "INVESTOR_SIGNALING",
    "SEO_DISCOVERABILITY",
    "COMMUNITY_BUILDING",
  ]),
  EvidenceType: new Set([
    "CLAIMS_ONLY",
    "METRICS_NUMBERS",
    "CUSTOMER_QUOTES",
    "LOGOS_NAMED_BRANDS",
    "BENCHMARKS_COMPARISONS",
    "THIRD_PARTY_VALIDATION",
  ]),
  EvidenceStrength: new Set(["WEAK", "MODERATE", "STRONG"]),
  SpecificityLevel: new Set([
    "HIGH_LEVEL_CONCEPTUAL",
    "SEMI_TECHNICAL",
    "DEEP_TECHNICAL",
    "OPERATIONAL_TACTICAL",
  ]),
  ActionabilityLevel: new Set(["INFORMATIONAL_ONLY", "EXPLAINS_HOW", "INVITES_ACTION"]),
  CompetitivePosture: new Set([
    "EXPLICIT_COMPETITOR_COMPARISON",
    "IMPLICIT_DIFFERENTIATION",
    "CATEGORY_DEFINITION_REFRAMING",
    "NO_COMPETITIVE_SIGNAL",
  ]),
  CompetitiveDirection: new Set(["OFFENSIVE", "DEFENSIVE"]),
  SensitivityLevel: new Set(["LOW", "MEDIUM", "HIGH"]),
  SensitivityTone: new Set(["REASSURING", "DEFENSIVE", "CONFIDENT", "TRANSPARENT_POST_INCIDENT"]),
  TimingNature: new Set(["PROACTIVE", "REACTIVE", "SEASONAL_CYCLICAL"]),
  UrgencyLevel: new Set(["IMMEDIATE", "NEAR_TERM", "LONG_TERM"]),
  ConfidencePosture: new Set(["EXPLORATORY", "ASSERTIVE", "DEFENSIVE", "EVANGELICAL"]),
  ContentArchetype: new Set([
    "ANNOUNCEMENT",
    "PROOF_POINT",
    "NARRATIVE_SHAPING",
    "DAMAGE_CONTROL",
    "EVANGELISM",
  ]),
  PostAffiliation: new Set([
    "COMPANY_OFFICIAL",
    "AFFILIATED",
    "INDEPENDENT",
    "MEDIA_OUTLET",
    "UNKNOWN",
  ]),
};

function safeEnum<T extends string>(set: Set<string>, value: unknown): T | null {
  if (typeof value !== "string") return null;
  const u = value.toUpperCase().replace(/-/g, "_");
  return set.has(u) ? (u as T) : null;
}

/** Cast validated string to Prisma enum for create input. */
function asEnum<T>(s: string | null): T | undefined {
  return (s ?? undefined) as T | undefined;
}

function safeEnumArray(set: Set<string>, arr: unknown): string[] | null {
  if (!Array.isArray(arr)) return null;
  const out = arr
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toUpperCase().replace(/-/g, "_"))
    .filter((v) => set.has(v));
  return out.length ? out : null;
}

/**
 * Map OpenAI extraction to Prisma BlogNewsAnalysis create input (flat).
 */
export function extractionToPrismaCreate(
  extraction: BlogAnalysisExtraction,
  projectId: string,
  analysisRunId: string | null,
  sourceUrl: string,
  articleUrl: string,
  articleTitle: string | null,
  articleDate: Date | null
): Prisma.BlogNewsAnalysisCreateInput {
  const meta = extraction.meta;

  const data: Prisma.BlogNewsAnalysisCreateInput = {
    project: { connect: { id: projectId } },
    source_url: sourceUrl,
    article_url: articleUrl,
    article_title: articleTitle ?? undefined,
    article_date: articleDate ?? undefined,
    summary: extraction.summary != null ? sanitizeArticleFraming(extraction.summary) : undefined,
    idea_1: undefined,
    idea_2: undefined,
    idea_3: undefined,
    idea_4: undefined,
    idea_5: undefined,
    idea_6: undefined,
    idea_7: undefined,
    signal_strength_score:
      typeof meta?.signal_strength_score === "number" &&
      meta.signal_strength_score >= 1 &&
      meta.signal_strength_score <= 5
        ? meta.signal_strength_score
        : undefined,
    affiliation: asEnum<PostAffiliation>(safeEnum(ENUMS.PostAffiliation, meta?.affiliation)),
    relevance_score:
      typeof meta?.relevance_score === "number" &&
      meta.relevance_score >= 1 &&
      meta.relevance_score <= 5
        ? meta.relevance_score
        : undefined,
    is_ad: typeof meta?.is_ad === "boolean" ? meta.is_ad : undefined,
    mention_count: 1,
    raw_extraction_json: extraction as Prisma.InputJsonValue,
  };
  if (analysisRunId) {
    data.analysis_run = { connect: { id: analysisRunId } };
  }
  return data;
}

function parseArticleDate(s: string | null): Date | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Try to extract a date from an article URL path (e.g. /2026/02/16/, /2026-02-16/, 20260216).
 * Returns YYYY-MM-DD or null. Used when the model doesn't return a date.
 */
export function parseDateFromArticleUrl(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const path = u.pathname;
    // /2026/02/16/ or /2026/02/16 or .../2026/02/16/slug
    const fullMatch = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
    if (fullMatch) {
      const [, y, m, d] = fullMatch;
      const date = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
      if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
    }
    // /2026/02/ or .../2026/02/slug
    const monthMatch = path.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
    if (monthMatch) {
      const [, y, m] = monthMatch;
      const date = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, 1);
      if (!isNaN(date.getTime())) return `${y}-${m}-01`;
    }
    // YYYY-MM-DD anywhere in path (e.g. .../2026-02-16/... or 2026-02-16)
    const hyphenMatch = path.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (hyphenMatch) {
      const [, y, m, d] = hyphenMatch;
      const date = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
      if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
    }
    // YYYYMMDD (8 digits) e.g. /news/20260216/slug or .../20260216
    const compactMatch = path.match(/(\d{4})(\d{2})(\d{2})/);
    if (compactMatch) {
      const [, y, m, d] = compactMatch;
      const date = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
      if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Month name to 1–12. */
const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parse relative date strings like "5 hours ago", "3 days ago", "2 weeks ago" (e.g. Skift, many news sites).
 * Returns YYYY-MM-DD for the date that many units ago from now.
 */
function parseRelativeDateToISO(text: string): string | null {
  const t = text.trim().toLowerCase();
  const numMatch = t.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (!numMatch) return null;
  const n = parseInt(numMatch[1]!, 10);
  if (n < 0 || n > 9999) return null;
  const now = new Date();
  const unit = numMatch[2]!;
  let d: Date;
  switch (unit) {
    case "minute":
      d = new Date(now.getTime() - n * 60 * 1000);
      break;
    case "hour":
      d = new Date(now.getTime() - n * 60 * 60 * 1000);
      break;
    case "day":
      d = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      break;
    case "week":
      d = new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      d = new Date(now);
      d.setMonth(d.getMonth() - n);
      break;
    case "year":
      d = new Date(now);
      d.setFullYear(d.getFullYear() - n);
      break;
    default:
      return null;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Try to extract a date from the beginning of article/snippet text (byline, "Posted on ...", "5 hours ago", etc.).
 * Scans the first maxChars. Returns YYYY-MM-DD or null. No OpenAI — pure regex so any blog format can be parsed.
 */
export function parseDateFromText(text: string | null | undefined, maxChars = 2000): string | null {
  if (!text || typeof text !== "string") return null;
  const slice = text.slice(0, maxChars);
  // Relative dates first (e.g. Skift: "5 hours ago", "3 days ago")
  const relative = slice.match(/\b(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i);
  if (relative) {
    const iso = parseRelativeDateToISO(relative[0]!);
    if (iso) return iso;
  }
  // Already YYYY-MM-DD
  const iso = slice.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const d_ = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
    if (!isNaN(d_.getTime())) return `${y}-${m}-${d}`;
  }
  // Month DD(st|nd|rd|th), YYYY or Month DD YYYY (e.g. February 16th, 2026 or Feb 16, 2026)
  const monthName = slice.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (monthName) {
    const num = MONTH_MAP[monthName[1]!.toLowerCase()];
    if (num !== undefined) {
      const day = parseInt(monthName[2]!, 10);
      const year = parseInt(monthName[3]!, 10);
      const d_ = new Date(year, num - 1, day);
      if (!isNaN(d_.getTime()))
        return `${year}-${String(num).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // DD(st|nd|rd|th) Month YYYY or DD Month YYYY (e.g. 16th February 2026, 16 Feb 2026)
  const dayFirst = slice.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b/i
  );
  if (dayFirst) {
    const num = MONTH_MAP[dayFirst[2]!.toLowerCase()];
    if (num !== undefined) {
      const day = parseInt(dayFirst[1]!, 10);
      const year = parseInt(dayFirst[3]!, 10);
      const d_ = new Date(year, num - 1, day);
      if (!isNaN(d_.getTime()))
        return `${year}-${String(num).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // MM/DD/YYYY or MM-DD-YYYY
  const us = slice.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (us) {
    const m = parseInt(us[1]!, 10);
    const d = parseInt(us[2]!, 10);
    const y = parseInt(us[3]!, 10);
    const d_ = new Date(y, m - 1, d);
    if (!isNaN(d_.getTime()))
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // DD.MM.YYYY or DD/MM/YYYY (day first)
  const eu = slice.match(/\b(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})\b/);
  if (eu) {
    const d = parseInt(eu[1]!, 10);
    const m = parseInt(eu[2]!, 10);
    const y = parseInt(eu[3]!, 10);
    const d_ = new Date(y, m - 1, d);
    if (!isNaN(d_.getTime()))
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // YYYY/MM/DD
  const slash = slice.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) {
    const [, y, m, d] = slash;
    const d_ = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10));
    if (!isNaN(d_.getTime())) return `${y}-${m}-${d}`;
  }
  // "today" or "yesterday" (e.g. when index has no date but is a "latest" list)
  if (/\btoday\b/i.test(slice)) {
    const d_ = new Date();
    return `${d_.getFullYear()}-${String(d_.getMonth() + 1).padStart(2, "0")}-${String(d_.getDate()).padStart(2, "0")}`;
  }
  if (/\byesterday\b/i.test(slice)) {
    const d_ = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return `${d_.getFullYear()}-${String(d_.getMonth() + 1).padStart(2, "0")}-${String(d_.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Normalize a date string from the model (any common format) to YYYY-MM-DD for filtering.
 * Handles relative strings like "5 hours ago", "3 days ago" (e.g. from Skift and similar sites).
 */
export function normalizeArticleDateToISO(dateStr: string | null): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
    return isNaN(d.getTime()) ? null : `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const relative = parseRelativeDateToISO(trimmed);
  if (relative) return relative;
  if (/^\s*today\s*$/i.test(trimmed)) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (/^\s*yesterday\s*$/i.test(trimmed)) {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const fromText = parseDateFromText(trimmed, trimmed.length);
  if (fromText) return fromText;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Run the full pipeline: create run record, discover or use provided URLs, fetch + analyze, save with deduplication.
 */
export async function runBlogAnalysis(input: BlogAnalysisRunInput): Promise<BlogAnalysisRunResult> {
  const { projectId, sourceUrls, noItemsBeforeDate, articleUrls } = input;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
  });
  if (!project) throw new Error("Project not found");

  const sourceUrl = sourceUrls[0] ?? "";
  if (!sourceUrl && !(articleUrls && articleUrls.length > 0)) {
    throw new Error("Either sourceUrls or articleUrls must be provided");
  }

  const run = await prisma.blogAnalysisRun.create({
    data: {
      project_id: projectId,
      source_url: sourceUrl || (articleUrls?.[0] ?? ""),
      no_items_before_date: noItemsBeforeDate,
      status: "RUNNING",
    },
  });
  const runId = run.id;

  let articles: DiscoveredArticle[] = [];
  try {
    if (articleUrls && articleUrls.length > 0) {
      articles = articleUrls.map((url) => ({ url, title: null, date: null, text: null }));
    } else {
      for (const url of sourceUrls) {
        const text = await fetchPageText(url);
        const base = new URL(url).origin + "/";
        const discovered = await discoverArticlesFromIndexPage(text, base);
        articles.push(...discovered);
      }
      const seen = new Set<string>();
      articles = articles.filter((a) => {
        const n = a.url.toLowerCase().trim();
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      });
    }

    const cutoff = noItemsBeforeDate.getTime();
    const filtered = articles.filter((a) => {
      const d = parseArticleDate(a.date);
      if (!d) return true;
      return d.getTime() >= cutoff;
    });

    let itemsNew = 0;
    for (const art of filtered) {
      let text = art.text;
      if (!text) {
        try {
          text = await fetchPageText(art.url);
        } catch {
          continue;
        }
      }
      if (!text || text.length < 50) continue;

      const extraction = await analyzeArticleWithOpenAI({
        articleUrl: art.url,
        articleTitle: art.title,
        articleDate: art.date,
        articleText: text,
      });

      const articleDate = parseArticleDate(extraction.article_date ?? art.date);
      const createInput = extractionToPrismaCreate(
        extraction,
        projectId,
        runId,
        sourceUrl || art.url,
        art.url,
        art.title,
        articleDate
      );

      try {
        await prisma.blogNewsAnalysis.create({
          data: createInput as Prisma.BlogNewsAnalysisCreateInput,
        });
        itemsNew++;
      } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
          continue;
        }
        throw err;
      }
    }

    await prisma.blogAnalysisRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", items_found_count: filtered.length },
    });

    return {
      runId,
      status: "COMPLETED",
      itemsFound: filtered.length,
      itemsNew,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.blogAnalysisRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error_message: errorMessage },
      })
      .catch(() => {});
    return {
      runId,
      status: "FAILED",
      itemsFound: 0,
      itemsNew: 0,
      errorMessage,
    };
  }
}

/**
 * Blog highlights: high-relevance items from BlogNewsAnalysis (relevance 4 or 5),
 * prioritized by mention_count (higher first). No re-analysis — reads existing records only.
 * Use for a "blog analysis run" view of items that came from blogs.
 */
export async function getBlogHighlights(
  projectId: string,
  options?: { limit?: number }
): Promise<
  Array<{
    id: string;
    article_url: string;
    article_title: string | null;
    article_date: Date | null;
    summary: string | null;
    relevance_score: number | null;
    mention_count: number;
    signal_strength_score: number | null;
    content_archetype: string | null;
    created_at: Date;
  }>
> {
  const rows = await prisma.blogNewsAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      relevance_score: { in: [4, 5] },
    },
    orderBy: [{ mention_count: "desc" }, { article_date: "desc" }, { created_at: "desc" }],
    take: options?.limit ?? 100,
    select: {
      id: true,
      article_url: true,
      article_title: true,
      article_date: true,
      summary: true,
      relevance_score: true,
      mention_count: true,
      signal_strength_score: true,
      content_archetype: true,
      created_at: true,
    },
  });
  return rows;
}
