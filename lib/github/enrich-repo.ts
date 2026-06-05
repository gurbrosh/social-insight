import { prisma } from "@/lib/prisma";
import { buildRepoDetailUrl, githubFetchJson } from "./github-client";
import {
  buildGithubRepoStructuredSummaryWithMeta,
  type GithubRepoStructuredExtraJson,
} from "./repo-structured-summary";
import type { GithubRepoDetailResponse } from "./types";
import {
  isGithubRepoNotFoundError,
  markGithubRepoPostsUnavailable,
  softDeleteGithubSignalsForRepoFullName,
} from "./mark-repo-gone";
import { upsertPostForGithubRepo } from "./upsert-github-repo-post";

/** Sequential mode only: small gap between repos after each finishes. */
const REPO_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How many repos to enrich **in parallel** (default 4). Major wall-clock win vs strict serial.
 * Set `GITHUB_ENRICH_CONCURRENCY=1` to restore old behavior (one repo at a time + delay).
 * Capped at 16 to avoid hammering GitHub and tripping abuse limits.
 */
function resolveEnrichConcurrency(): number {
  const raw = parseInt(process.env.GITHUB_ENRICH_CONCURRENCY ?? "4", 10);
  if (Number.isNaN(raw) || raw < 1) return 4;
  return Math.min(16, Math.max(1, raw));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.min(concurrency, items.length);
  let index = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/** When set, each enriched repo also upserts a Post row for the project (non-test ingestion). */
export type GithubEnrichPostContext = {
  projectId: string;
  jobId?: string | null;
  ingestedRunId?: string | null;
};

/**
 * GET /repos/{owner}/{repo} for each unique full name; update repo signals with metadata.
 */
export async function enrichRepoMetadataForFullNames(
  repoFullNames: string[],
  postContext?: GithubEnrichPostContext
): Promise<void> {
  const unique = [...new Set(repoFullNames.map((s) => s.trim()).filter(Boolean))];

  const concurrency = resolveEnrichConcurrency();
  if (concurrency > 1 && unique.length > 0) {
    console.log(
      `[github-enrich] enriching ${unique.length} repo(s) with concurrency=${concurrency} (GITHUB_ENRICH_CONCURRENCY)`
    );
  }

  let enrichDispatchOrder = 0;
  const enrichOne = async (full: string): Promise<void> => {
    const slash = full.indexOf("/");
    if (slash <= 0) return;
    const owner = full.slice(0, slash);
    const repo = full.slice(slash + 1);
    if (!repo) return;

    const seq = ++enrichDispatchOrder;
    console.log(`[github-enrich] ${seq}/${unique.length} start ${full}`);

    try {
      const path = buildRepoDetailUrl(owner, repo);
      const { data } = await githubFetchJson<GithubRepoDetailResponse>(path, {
        keyword: full,
        page: 0,
        endpoint: "repos",
      });

      const license =
        data.license?.spdx_id && data.license.spdx_id !== "NOASSERTION"
          ? data.license.spdx_id
          : (data.license?.name ?? null);
      const topicsJson = data.topics?.length ? JSON.stringify(data.topics) : null;

      let structuredBody: string | null = null;
      let structuredExtra: GithubRepoStructuredExtraJson | null = null;
      try {
        const built = await buildGithubRepoStructuredSummaryWithMeta({
          owner,
          repo,
          keyword: full,
          detail: data,
        });
        structuredBody = built.text;
        structuredExtra = built.extra;
      } catch (e) {
        console.warn(
          `[github-enrich] structured summary failed for ${full}:`,
          e instanceof Error ? e.message : e
        );
      }

      await prisma.githubSignal.updateMany({
        where: {
          repo_full_name: full,
          signal_type: "repo",
          deleted_at: null,
        },
        data: {
          license,
          default_branch: data.default_branch ?? null,
          open_issues_count: data.open_issues_count ?? null,
          topics_json: topicsJson,
          ...(structuredBody ? { body: structuredBody } : {}),
        },
      });

      if (postContext && structuredBody && structuredExtra) {
        try {
          const ownerLogin = data.owner?.login ?? owner;
          await upsertPostForGithubRepo({
            projectId: postContext.projectId,
            jobId: postContext.jobId,
            ingestedRunId: postContext.ingestedRunId,
            detail: data,
            ownerLogin,
            structuredText: structuredBody,
            extra: structuredExtra,
          });
        } catch (e) {
          console.warn(
            `[github-enrich] Post upsert failed for ${full}:`,
            e instanceof Error ? e.message : e
          );
        }
      }
    } catch (e) {
      if (isGithubRepoNotFoundError(e)) {
        const removed = await softDeleteGithubSignalsForRepoFullName(full);
        console.warn(
          `[github-enrich] repo not found on GitHub (404/410); soft-deleted ${removed} GithubSignal row(s) for ${full}. Ephemeral or deleted repos often appear in search but vanish before enrichment.`
        );
        if (postContext?.projectId) {
          const posts = await markGithubRepoPostsUnavailable({
            repoFullName: full,
            projectId: postContext.projectId,
          });
          if (posts > 0) {
            console.warn(
              `[github-enrich] marked ${posts} github Post(s) as unavailable for project ${postContext.projectId}`
            );
          }
        }
      } else {
        console.warn(`[github-enrich] failed for ${full}:`, e instanceof Error ? e.message : e);
      }
    }

    console.log(`[github-enrich] ${seq}/${unique.length} done ${full}`);

    if (concurrency === 1) {
      await sleep(REPO_DELAY_MS);
    }
  };

  if (concurrency === 1) {
    for (const full of unique) {
      await enrichOne(full);
    }
    return;
  }

  await runWithConcurrency(unique, concurrency, enrichOne);
}
