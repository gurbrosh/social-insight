const GITHUB_API = "https://api.github.com";
const MAX_RETRIES = 3;
const PAGE_DELAY_MS = 400;
/** Max sleep when GitHub returns 403/429 (avoid blocking orchestration for e.g. 10+ minutes per request). */
const MAX_RATE_LIMIT_BACKOFF_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getToken(): string {
  const t = process.env.GITHUB_TOKEN?.trim();
  if (!t) {
    throw new Error("GITHUB_TOKEN is required for GitHub ingestion");
  }
  return t;
}

export type GithubFetchContext = {
  keyword: string;
  page: number;
  endpoint: string;
};

export type GithubJsonResult<T> = {
  data: T;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  /** RFC 5988 `Link` header (pagination `rel="last"` / `rel="next"`). */
  link: string | null;
};

/** Parse `rel="last"` from GitHub `Link` header to get total page count (per_page must match requests). */
export function parseGithubLinkLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  for (const segment of linkHeader.split(",")) {
    const m = segment.match(/<([^>]+)>\s*;\s*rel="last"/);
    if (m) {
      try {
        const page = new URL(m[1]).searchParams.get("page");
        if (page) {
          const n = parseInt(page, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

const EMPTY_BODY_AS_EMPTY_LIST_ENDPOINTS = new Set(["contributors", "releases", "deployments"]);

/**
 * GET JSON from GitHub REST with retries, rate-limit handling, and logging.
 */
export async function githubFetchJson<T>(
  pathWithQuery: string,
  ctx: GithubFetchContext
): Promise<GithubJsonResult<T>> {
  const url = pathWithQuery.startsWith("http") ? pathWithQuery : `${GITHUB_API}${pathWithQuery}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${getToken()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "SocialInsight-GithubIngest/1.0",
        },
      });

      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      const rateLimitRemaining = remaining != null ? parseInt(remaining, 10) : null;
      const rateLimitReset = reset != null ? parseInt(reset, 10) : null;

      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const body = await res.text().catch(() => "");
        let waitMs = Math.min(2000 * 2 ** (attempt - 1), 120_000);
        if (retryAfter) {
          waitMs = Math.max(waitMs, parseInt(retryAfter, 10) * 1000);
        } else if (rateLimitReset) {
          const waitSec = Math.max(0, rateLimitReset - Math.floor(Date.now() / 1000));
          waitMs = Math.max(waitMs, Math.min(waitSec * 1000, MAX_RATE_LIMIT_BACKOFF_MS));
        }
        console.warn(
          `[github] ${ctx.endpoint} keyword=${JSON.stringify(ctx.keyword)} page=${ctx.page} attempt=${attempt}/${MAX_RETRIES} status=${res.status} waitMs=${waitMs} body=${body.slice(0, 200)}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
        throw new Error(`GitHub HTTP ${res.status}: ${body.slice(0, 500)}`);
      }

      if (res.status >= 500) {
        const body = await res.text().catch(() => "");
        const waitMs = Math.min(2000 * 2 ** (attempt - 1), 120_000);
        console.warn(
          `[github] ${ctx.endpoint} keyword=${JSON.stringify(ctx.keyword)} page=${ctx.page} attempt=${attempt}/${MAX_RETRIES} status=${res.status} waitMs=${waitMs}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
        throw new Error(`GitHub HTTP ${res.status}: ${body.slice(0, 500)}`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`GitHub HTTP ${res.status}: ${body.slice(0, 500)}`);
      }

      if (rateLimitRemaining != null && rateLimitRemaining < 10) {
        const waitMs = rateLimitRemaining < 3 ? 5000 : 2500;
        console.warn(
          `[github] low rate limit remaining=${rateLimitRemaining} sleeping ${waitMs}ms before parse`
        );
        await sleep(waitMs);
      }

      const linkHeader = res.headers.get("Link");
      const raw = await res.text();
      const trimmed = raw.trim();

      if (trimmed.length === 0) {
        if (res.status === 204 && EMPTY_BODY_AS_EMPTY_LIST_ENDPOINTS.has(ctx.endpoint)) {
          await sleep(PAGE_DELAY_MS);
          return {
            data: [] as T,
            rateLimitRemaining,
            rateLimitReset,
            link: linkHeader,
          };
        }
        console.warn(
          `[github] empty response body ${ctx.endpoint} keyword=${JSON.stringify(ctx.keyword)} page=${ctx.page} attempt=${attempt}/${MAX_RETRIES}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(2000 * 2 ** (attempt - 1), 30_000));
          continue;
        }
        if (EMPTY_BODY_AS_EMPTY_LIST_ENDPOINTS.has(ctx.endpoint)) {
          console.warn(
            `[github] treating empty body as [] after retries (${ctx.endpoint}) keyword=${JSON.stringify(ctx.keyword)}`
          );
          await sleep(PAGE_DELAY_MS);
          return {
            data: [] as T,
            rateLimitRemaining,
            rateLimitReset,
            link: linkHeader,
          };
        }
        throw new Error("GitHub returned empty response body");
      }

      let data: T;
      try {
        data = JSON.parse(trimmed) as T;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        console.warn(
          `[github] invalid JSON ${ctx.endpoint} keyword=${JSON.stringify(ctx.keyword)} page=${ctx.page} attempt=${attempt}/${MAX_RETRIES} len=${trimmed.length} err=${msg}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(2000 * 2 ** (attempt - 1), 30_000));
          continue;
        }
        throw new Error(`GitHub invalid JSON: ${msg}`);
      }

      await sleep(PAGE_DELAY_MS);
      return {
        data,
        rateLimitRemaining,
        rateLimitReset,
        link: linkHeader,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[github] fetch failed ${ctx.endpoint} keyword=${JSON.stringify(ctx.keyword)} page=${ctx.page} attempt=${attempt}/${MAX_RETRIES} error=${lastError.message}`
      );
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1500 * 2 ** (attempt - 1), 30_000));
      }
    }
  }

  throw lastError ?? new Error("GitHub fetch failed");
}

export function buildSearchRepositoriesUrl(params: {
  q: string;
  page: number;
  perPage?: number;
}): string {
  const perPage = params.perPage ?? 100;
  const q = new URLSearchParams();
  q.set("q", params.q);
  q.set("sort", "updated");
  q.set("order", "desc");
  q.set("per_page", String(perPage));
  q.set("page", String(params.page));
  return `/search/repositories?${q.toString()}`;
}

export function buildSearchCodeUrl(params: { q: string; page: number; perPage?: number }): string {
  const perPage = params.perPage ?? 100;
  const q = new URLSearchParams();
  q.set("q", params.q);
  q.set("per_page", String(perPage));
  q.set("page", String(params.page));
  return `/search/code?${q.toString()}`;
}

export function buildRepoDetailUrl(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function buildRepoReadmeUrl(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
}

const RAW_USERCONTENT = "https://raw.githubusercontent.com";
/** Tried in order; most repos use README.md on the default branch. */
const README_FILENAME_CANDIDATES = ["README.md", "readme.md", "Readme.md"] as const;
const README_RAW_TIMEOUT_MS = 45_000;
const README_CACHE_MAX_ENTRIES = 500;
const README_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type ReadmeCacheEntry = { text: string; expiresAt: number };
const readmeMarkdownCache = new Map<string, ReadmeCacheEntry>();

function readmeCacheKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}@${branch}`;
}

function readmeCacheGet(key: string): string | null {
  const e = readmeMarkdownCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    readmeMarkdownCache.delete(key);
    return null;
  }
  readmeMarkdownCache.delete(key);
  readmeMarkdownCache.set(key, e);
  return e.text;
}

function readmeCacheSet(key: string, text: string): void {
  if (readmeMarkdownCache.size >= README_CACHE_MAX_ENTRIES) {
    const first = readmeMarkdownCache.keys().next().value as string | undefined;
    if (first) readmeMarkdownCache.delete(first);
  }
  readmeMarkdownCache.set(key, {
    text,
    expiresAt: Date.now() + README_CACHE_TTL_MS,
  });
}

/**
 * Fetch README from raw.githubusercontent.com (no REST quota). Uses the same PAT as API calls
 * so private repos work. Tries common filenames on the default branch.
 */
async function fetchReadmeFromRawUserContent(
  owner: string,
  repo: string,
  ref: string,
  ctx: GithubFetchContext
): Promise<string | null> {
  const token = getToken();
  for (const file of README_FILENAME_CANDIDATES) {
    const url = `${RAW_USERCONTENT}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${file}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(README_RAW_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/plain,*/*",
          "User-Agent": "SocialInsight-GithubIngest/1.0",
        },
      });
      if (res.status === 200) {
        const text = await res.text();
        if (text.trim().length > 0) {
          return text;
        }
      }
      if (res.status === 404) {
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        console.warn(
          `[github] readme raw ${file} keyword=${JSON.stringify(ctx.keyword)} status=${res.status} (will try other paths or REST)`
        );
      }
    } catch (err) {
      console.warn(
        `[github] readme raw fetch error ${file} keyword=${JSON.stringify(ctx.keyword)}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}

export type FetchReadmeMarkdownArgs = {
  owner: string;
  repo: string;
  /** From GET /repos — default branch name (e.g. main). */
  defaultBranch: string;
  ctx: GithubFetchContext;
};

/**
 * README markdown for parsing (title/description). Order: **cache** → **raw.githubusercontent.com**
 * (no REST API quota) → **GET /repos/.../readme** (REST fallback for symlinks, odd paths, or raw miss).
 */
export async function fetchReadmeMarkdown(args: FetchReadmeMarkdownArgs): Promise<string | null> {
  const { owner, repo, defaultBranch, ctx } = args;
  const ref = defaultBranch.trim() || "main";
  const key = readmeCacheKey(owner, repo, ref);
  const hit = readmeCacheGet(key);
  if (hit !== null) {
    return hit;
  }

  const fromRaw = await fetchReadmeFromRawUserContent(owner, repo, ref, ctx);
  if (fromRaw !== null) {
    readmeCacheSet(key, fromRaw);
    return fromRaw;
  }

  console.warn(
    `[github] readme: raw.githubusercontent.com miss for ${owner}/${repo}@${ref} — using REST /readme`
  );
  const fromApi = await githubFetchReadmeRaw(owner, repo, ctx);
  if (fromApi !== null) {
    readmeCacheSet(key, fromApi);
  }
  return fromApi;
}

/**
 * Raw README via GitHub REST only (`GET /repos/{owner}/{repo}/readme`). Prefer {@link fetchReadmeMarkdown}
 * for enrichment to avoid REST quota when raw.githubusercontent.com works.
 */
export async function githubFetchReadmeRaw(
  owner: string,
  repo: string,
  ctx: GithubFetchContext
): Promise<string | null> {
  const url = `${GITHUB_API}${buildRepoReadmeUrl(owner, repo)}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        headers: {
          Accept: "application/vnd.github.raw+json",
          Authorization: `Bearer ${getToken()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "SocialInsight-GithubIngest/1.0",
        },
      });

      if (res.status === 404) {
        return null;
      }

      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const reset = res.headers.get("x-ratelimit-reset");
        let waitMs = Math.min(2000 * 2 ** (attempt - 1), 120_000);
        if (retryAfter) {
          waitMs = Math.max(waitMs, parseInt(retryAfter, 10) * 1000);
        } else if (reset) {
          const rateLimitReset = parseInt(reset, 10);
          const waitSec = Math.max(0, rateLimitReset - Math.floor(Date.now() / 1000));
          waitMs = Math.max(waitMs, Math.min(waitSec * 1000, MAX_RATE_LIMIT_BACKOFF_MS));
        }
        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
        return null;
      }

      if (!res.ok) {
        return null;
      }

      const text = await res.text();
      await sleep(PAGE_DELAY_MS);
      return text;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1500 * 2 ** (attempt - 1), 30_000));
      }
    }
  }

  console.warn(
    `[github] readme fetch failed keyword=${JSON.stringify(ctx.keyword)} ${owner}/${repo}: ${lastError?.message ?? "unknown"}`
  );
  return null;
}
