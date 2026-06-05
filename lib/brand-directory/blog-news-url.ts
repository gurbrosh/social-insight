/**
 * Blog/News URL discovery and validation.
 * - Validates URLs by fetching (follow redirects; use final URL so e.g. news.example.com → news.example.com/news).
 * - SerpAPI fallback when OpenAI returns a wrong or broken URL.
 * Use findBlogNewsUrl() for the full pipeline: OpenAI → validate → SerpAPI fallback → validate.
 */

import { findBlogNewsUrlWithOpenAI } from "./openai-service";

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Validate a newsroom URL by fetching it. Follows redirects.
 * @returns { ok: true, finalUrl } when status 200 (finalUrl is the resolved URL after redirects, so we use the real path).
 * @returns { ok: false } when 4xx, 5xx, timeout, or non-HTML.
 */
export async function validateNewsroomUrl(
  url: string
): Promise<{ ok: boolean; finalUrl?: string }> {
  if (!url || !url.startsWith("http")) return { ok: false };
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const finalUrl = res.url?.trim();
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return { ok: false };
    return { ok: true, finalUrl: finalUrl || url };
  } catch {
    return { ok: false };
  }
}

/**
 * Build SerpAPI Google search URL.
 */
function buildSerpAPIUrl(query: string, apiKey: string): string {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: "10",
    gl: "us",
    hl: "en",
  });
  return `https://serpapi.com/search.json?${params.toString()}`;
}

/**
 * Find the brand's newsroom URL using SerpAPI (search for official newsroom).
 * Prefer site:domain when websiteUrl is available so we get the real path (e.g. news.example.com/news).
 */
export async function findBlogNewsUrlWithSerpAPI(
  brandName: string,
  websiteUrl?: string
): Promise<string | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  let query: string;
  if (websiteUrl) {
    try {
      const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");
      query = `site:${domain} newsroom OR site:${domain} news OR site:${domain} press`;
    } catch {
      query = `"${brandName}" official newsroom`;
    }
  } else {
    query = `"${brandName}" official newsroom`;
  }

  try {
    const res = await fetch(buildSerpAPIUrl(query, apiKey), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { organic_results?: Array<{ link?: string }> };
    const results = data.organic_results ?? [];
    for (const r of results) {
      const link = typeof r.link === "string" ? r.link.trim() : "";
      if (link && link.startsWith("http")) return link;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find the brand's blog/news URL with validation and SerpAPI fallback.
 * 1. Get URL from OpenAI.
 * 2. Validate by fetching (follow redirects); use final URL if it differs (e.g. base domain redirects to /news).
 * 3. If validation fails, try SerpAPI and validate that URL.
 * Returns the validated final URL (after redirects) when possible, so we store the real path.
 */
export async function findBlogNewsUrl(
  brandName: string,
  companyName?: string,
  websiteUrl?: string
): Promise<string | null> {
  const fromOpenAI = await findBlogNewsUrlWithOpenAI(brandName, companyName, websiteUrl);
  if (fromOpenAI) {
    const validated = await validateNewsroomUrl(fromOpenAI);
    if (validated.ok) {
      return validated.finalUrl ?? fromOpenAI;
    }
  }

  const fromSerp = await findBlogNewsUrlWithSerpAPI(brandName, websiteUrl);
  if (fromSerp) {
    const validated = await validateNewsroomUrl(fromSerp);
    if (validated.ok) {
      return validated.finalUrl ?? fromSerp;
    }
    return fromSerp;
  }

  return fromOpenAI ?? null;
}

/**
 * Given a candidate blog/news URL (e.g. from OpenAI or user), validate it and return the URL to store.
 * Uses final URL after redirects (e.g. base domain → resolved path like /news).
 * If validation fails, tries SerpAPI and returns that if it validates.
 * Use this when saving a brand so we always store a working, resolved URL.
 */
export async function ensureValidBlogNewsUrl(
  candidateUrl: string | null | undefined,
  brandName: string,
  websiteUrl?: string
): Promise<string | null> {
  const candidate = typeof candidateUrl === "string" ? candidateUrl.trim() : "";
  if (candidate && candidate.startsWith("http")) {
    const validated = await validateNewsroomUrl(candidate);
    if (validated.ok) return validated.finalUrl ?? candidate;
  }
  const fromSerp = await findBlogNewsUrlWithSerpAPI(brandName, websiteUrl);
  if (fromSerp) {
    const validated = await validateNewsroomUrl(fromSerp);
    if (validated.ok) return validated.finalUrl ?? fromSerp;
    return fromSerp;
  }
  return candidate || null;
}
