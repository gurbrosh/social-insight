import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GITHUB_SIGNAL_KEYWORD_GLOBAL } from "./constants";

/**
 * Fields refreshed when the same GitHub search result is seen again (stars, forks, description, enrichment, etc.).
 * `deleted_at` is cleared so a soft-deleted row becomes active again if the repo reappears in search.
 */
function upsertUpdateFromRow(
  row: Prisma.GithubSignalCreateManyInput
): Prisma.GithubSignalUncheckedUpdateInput {
  return {
    deleted_at: null,
    keyword: GITHUB_SIGNAL_KEYWORD_GLOBAL,
    repo_full_name: row.repo_full_name,
    repo_id: row.repo_id,
    repo_url: row.repo_url,
    title: row.title,
    body: row.body,
    file_path: row.file_path,
    file_url: row.file_url,
    author: row.author,
    stars: row.stars,
    forks: row.forks,
    language: row.language,
    event_type: row.event_type,
    published_at: row.published_at,
    published_at_unix: row.published_at_unix,
    license: row.license,
    default_branch: row.default_branch,
    open_issues_count: row.open_issues_count,
    topics_json: row.topics_json,
    raw_payload: row.raw_payload as Prisma.InputJsonValue,
  };
}

/**
 * Insert new `GithubSignal` rows or update existing ones keyed by
 * `(source, signal_type, external_id)` so metrics and payloads stay current across runs and keywords.
 */
export async function upsertGithubSignals(
  rows: Prisma.GithubSignalCreateManyInput[],
  chunkSize: number
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    if (slice.length === 0) continue;

    await prisma.$transaction(
      slice.map((row) =>
        prisma.githubSignal.upsert({
          where: {
            source_signal_type_external_id: {
              source: row.source ?? "github",
              signal_type: row.signal_type,
              external_id: row.external_id,
            },
          },
          create: row as Prisma.GithubSignalUncheckedCreateInput,
          update: upsertUpdateFromRow(row),
        })
      )
    );
  }
}
