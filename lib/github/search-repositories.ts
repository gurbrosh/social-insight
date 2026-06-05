import { buildSearchRepositoriesUrl, githubFetchJson } from "./github-client";
import { normalizeRepoItem } from "./normalize";
import type { Prisma } from "@prisma/client";
import type { GithubRepoSearchResponse } from "./types";

/** GitHub Search API allows at most 1000 results per query (10 pages × 100). */
export const GITHUB_SEARCH_MAX_PAGES_CAP = 10;

/** Escape / quote a user keyword for GitHub `q` syntax. */
export function escapeGithubQueryTerm(term: string): string {
  const t = term.trim();
  if (!t) return "";
  if (/[\s"+:]/.test(t)) return `"${t.replace(/"/g, '\\"')}"`;
  return t;
}

export function buildRepositorySearchQuery(variant: string): string {
  const core = escapeGithubQueryTerm(variant);
  return `${core} in:name,description,topics fork:false`;
}

/**
 * Paginate repository search (sort=updated desc), keep items with updated_at newer than cursor floor.
 * @param maxPages 1–10 (GitHub caps total results at 1000).
 */
export async function collectRepositorySignals(
  keyword: string,
  cursorIso: string,
  opts?: { maxPages?: number }
): Promise<{ rows: Prisma.GithubSignalCreateManyInput[]; maxUpdatedIso: string }> {
  const pageLimit = Math.min(
    GITHUB_SEARCH_MAX_PAGES_CAP,
    Math.max(1, opts?.maxPages ?? GITHUB_SEARCH_MAX_PAGES_CAP)
  );
  let floorMs = cursorIso.trim() ? new Date(cursorIso).getTime() : 0;
  if (Number.isNaN(floorMs)) floorMs = 0;
  const rows: Prisma.GithubSignalCreateManyInput[] = [];
  let maxUpdatedMs = floorMs;

  const q = buildRepositorySearchQuery(keyword);

  for (let page = 1; page <= pageLimit; page++) {
    console.log(
      `[github-search/repo] page ${page}/${pageLimit} keyword=${JSON.stringify(keyword)} (search/repositories)`
    );
    const path = buildSearchRepositoriesUrl({ q, page });
    const { data } = await githubFetchJson<GithubRepoSearchResponse>(path, {
      keyword,
      page,
      endpoint: "search/repositories",
    });

    const items = data.items ?? [];
    if (items.length === 0) {
      console.log(
        `[github-search/repo] page ${page}/${pageLimit} empty — stop pagination keyword=${JSON.stringify(keyword)}`
      );
      break;
    }

    if (new Date(items[0].updated_at).getTime() <= floorMs) {
      break;
    }

    for (const item of items) {
      const t = new Date(item.updated_at).getTime();
      if (t <= floorMs) continue;
      rows.push(normalizeRepoItem(item, keyword));
      if (t > maxUpdatedMs) maxUpdatedMs = t;
    }

    const oldest = items[items.length - 1];
    const oldestMs = new Date(oldest.updated_at).getTime();
    if (oldestMs <= floorMs) break;

    if (items.length < 100) break;
  }

  console.log(
    `[github-search/repo] finished keyword=${JSON.stringify(keyword)} rawRows=${rows.length} (before caller dedupe)`
  );

  const maxUpdatedIso =
    maxUpdatedMs > floorMs
      ? new Date(maxUpdatedMs).toISOString()
      : cursorIso.trim() || new Date().toISOString();

  return { rows, maxUpdatedIso };
}
