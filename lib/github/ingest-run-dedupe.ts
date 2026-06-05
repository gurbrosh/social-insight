import type { Prisma } from "@prisma/client";

/**
 * Drops rows whose `repo_id` was already seen in an earlier keyword/mode step in this run.
 * Does not dedupe within `rows` — multiple files from the same repo in one search stay.
 */
export function filterGithubRowsAgainstSeenRepos(
  rows: Prisma.GithubSignalCreateManyInput[],
  seenGithubRepoIdsInRun: Set<string> | undefined
): Prisma.GithubSignalCreateManyInput[] {
  if (!seenGithubRepoIdsInRun || seenGithubRepoIdsInRun.size === 0) {
    return rows;
  }
  return rows.filter((row) => !seenGithubRepoIdsInRun.has(String(row.repo_id)));
}

/**
 * After processing a search step, record every repo id GitHub returned so later keywords skip it.
 */
export function recordGithubRepoIdsFromRawRows(
  rawRows: Prisma.GithubSignalCreateManyInput[],
  seenGithubRepoIdsInRun: Set<string> | undefined
): void {
  if (!seenGithubRepoIdsInRun) return;
  for (const row of rawRows) {
    seenGithubRepoIdsInRun.add(String(row.repo_id));
  }
}
