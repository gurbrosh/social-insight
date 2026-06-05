import type { AlgoliaSearchByDateResponse } from "./types";

const ALGOLIA_SEARCH_BY_DATE = "https://hn.algolia.com/api/v1/search_by_date";

const PAGE_DELAY_MS = 300;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(
  url: string,
  context: { keyword: string; page: number }
): Promise<AlgoliaSearchByDateResponse> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        const wait = Math.min(2000 * 2 ** (attempt - 1), 30_000);
        console.warn(
          `[hn-algolia] retry keyword=${JSON.stringify(context.keyword)} page=${context.page} attempt=${attempt}/${MAX_RETRIES} status=${res.status} waitMs=${wait} body=${body.slice(0, 200)}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(wait);
          continue;
        }
        throw new Error(`Algolia HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Algolia HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      return (await res.json()) as AlgoliaSearchByDateResponse;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[hn-algolia] fetch failed keyword=${JSON.stringify(context.keyword)} page=${context.page} attempt=${attempt}/${MAX_RETRIES} error=${lastError.message}`
      );
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1500 * 2 ** (attempt - 1), 20_000));
      }
    }
  }
  throw lastError ?? new Error("Algolia fetch failed");
}

export type FetchSearchByDatePageParams = {
  keyword: string;
  createdAfterUnix: number;
  page: number;
};

/**
 * Single page of search_by_date results (newest first), stories and comments.
 */
export async function fetchSearchByDatePage(
  params: FetchSearchByDatePageParams
): Promise<AlgoliaSearchByDateResponse> {
  const q = new URLSearchParams();
  q.set("query", params.keyword);
  q.set("tags", "(story,comment)");
  q.set("numericFilters", `created_at_i>${params.createdAfterUnix}`);
  q.set("hitsPerPage", "100");
  q.set("page", String(params.page));

  const url = `${ALGOLIA_SEARCH_BY_DATE}?${q.toString()}`;
  const data = await fetchJsonWithRetry(url, { keyword: params.keyword, page: params.page });
  await sleep(PAGE_DELAY_MS);
  return data;
}

/**
 * Iterate all pages until nbPages; stop early if a page’s oldest hit is not newer than the floor (defensive).
 */
const MAX_PAGES = 1000;

export async function* iterateSearchByDate(params: {
  keyword: string;
  createdAfterUnix: number;
  /** When aborted, stop paging (e.g. admin test cancelled). */
  signal?: AbortSignal;
}): AsyncGenerator<AlgoliaSearchByDateResponse, void, undefined> {
  let page = 0;
  let nbPages = 1;

  while (page < nbPages && page < MAX_PAGES) {
    if (params.signal?.aborted) {
      return;
    }
    const batch = await fetchSearchByDatePage({
      keyword: params.keyword,
      createdAfterUnix: params.createdAfterUnix,
      page,
    });
    nbPages = batch.nbPages;

    const times = batch.hits
      .map((h) => h.created_at_i)
      .filter((x): x is number => typeof x === "number");
    if (times.length > 0) {
      const oldest = Math.min(...times);
      if (oldest <= params.createdAfterUnix) {
        break;
      }
    }

    yield batch;
    page += 1;
  }
}
