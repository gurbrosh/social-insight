import { buildSearchCodeUrl, githubFetchJson } from "./github-client";
import { GITHUB_SEARCH_MAX_PAGES_CAP } from "./search-repositories";
import { normalizeCodeItem } from "./normalize";
import type { Prisma } from "@prisma/client";
import type { GithubCodeSearchResponse } from "./types";

/**
 * Build the search term(s) for legacy `/search/code` only.
 * - Do not use `escapeGithubQueryTerm` from repo search: wrapping a phrase in `"..."` often
 *   triggers ERROR_TYPE_QUERY_PARSING_FATAL on this endpoint.
 * - Multi-word keywords become AND terms: `agent+security` (not `"agent security"`).
 */
function escapeGithubCodeSearchTerms(term: string): string {
  const t = term.trim();
  if (!t) return "";
  const parts = t.split(/\s+/).filter(Boolean);
  const escaped = parts.map((part) => {
    if (/[\s"+:]/.test(part)) {
      return `"${part.replace(/"/g, '\\"')}"`;
    }
    return part;
  });
  return escaped.join("+");
}

/**
 * Build `q` for `GET /search/code` (legacy code search API).
 * Repository qualifiers (`pushed:`, `fork:`, etc.) are not valid here and produce HTTP 422
 * "ERROR_TYPE_QUERY_PARSING_FATAL unable to parse query".
 * @see https://docs.github.com/en/search-github/searching-on-github/searching-code
 *
 * `lookbackDays` is ignored for the query string; GitHub does not expose a pushed-date filter
 * on code search. Callers may still use it for logging or future client-side filtering.
 */
export function buildCodeSearchQuery(variant: string, _lookbackDays?: number): string {
  const core = escapeGithubCodeSearchTerms(variant);
  if (!core) return "";
  return `${core} in:file`;
}

/**
 * Paginate code search. Cursor for code is informational (run timestamp).
 * @param maxPages 1–10 (GitHub caps total results at 1000).
 */
export async function collectCodeSignals(
  keyword: string,
  lookbackDays: number,
  opts?: { maxPages?: number }
): Promise<{ rows: Prisma.GithubSignalCreateManyInput[]; completedAtIso: string }> {
  const pageLimit = Math.min(
    GITHUB_SEARCH_MAX_PAGES_CAP,
    Math.max(1, opts?.maxPages ?? GITHUB_SEARCH_MAX_PAGES_CAP)
  );
  const rows: Prisma.GithubSignalCreateManyInput[] = [];
  const q = buildCodeSearchQuery(keyword, lookbackDays);

  for (let page = 1; page <= pageLimit; page++) {
    console.log(
      `[github-search/code] page ${page}/${pageLimit} keyword=${JSON.stringify(keyword)} (search/code)`
    );
    const path = buildSearchCodeUrl({ q, page });
    const { data } = await githubFetchJson<GithubCodeSearchResponse>(path, {
      keyword,
      page,
      endpoint: "search/code",
    });

    const items = data.items ?? [];
    if (items.length === 0) {
      console.log(
        `[github-search/code] page ${page}/${pageLimit} empty — stop pagination keyword=${JSON.stringify(keyword)}`
      );
      break;
    }

    for (const item of items) {
      rows.push(normalizeCodeItem(item, keyword));
    }

    if (items.length < 100) break;
  }

  console.log(
    `[github-search/code] finished keyword=${JSON.stringify(keyword)} rawRows=${rows.length} (before caller dedupe)`
  );

  return { rows, completedAtIso: new Date().toISOString() };
}
