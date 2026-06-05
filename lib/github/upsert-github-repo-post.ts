import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { persistGithubPostProductRelevance } from "@/lib/github/github-product-relevance";
import type { GithubRepoDetailResponse } from "./types";
import type { GithubRepoStructuredExtraJson } from "./repo-structured-summary";

/** Post.platform for GitHub repository snapshots (one Post per GitHub repo id per project). */
export const GITHUB_POST_PLATFORM = "github";

const CONTENT_MAX = 50_000;

/**
 * Upserts a Post for a GitHub repo using the same structured text as GithubSignal.body.
 * `metricsComments` stores `open_issues_count` (GitHub has no comment count on repos).
 */
export async function upsertPostForGithubRepo(args: {
  projectId: string;
  jobId?: string | null;
  ingestedRunId?: string | null;
  detail: GithubRepoDetailResponse;
  ownerLogin: string;
  structuredText: string;
  extra: GithubRepoStructuredExtraJson;
}): Promise<void> {
  const postId = String(args.detail.id);
  const content = args.structuredText.slice(0, CONTENT_MAX);
  const authorId = args.detail.owner?.id != null ? String(args.detail.owner.id) : null;

  const extraJson = { github: args.extra } as Prisma.InputJsonValue;

  const row = await prisma.post.upsert({
    where: {
      project_id_platform_postId: {
        project_id: args.projectId,
        platform: GITHUB_POST_PLATFORM,
        postId,
      },
    },
    create: {
      platform: GITHUB_POST_PLATFORM,
      postId,
      project_id: args.projectId,
      content,
      createdAt: new Date(args.detail.created_at),
      url: args.detail.html_url,
      authorName: args.ownerLogin,
      authorId,
      metricsLikes: args.detail.stargazers_count ?? null,
      metricsShares: args.detail.forks_count ?? null,
      metricsComments: args.detail.open_issues_count ?? null,
      extraJson,
      isTest: false,
      /** Skip legacy "sentiment=null means pending" backfills; sentiment LLM is not applicable. */
      ai_processed_at: new Date(),
      ...(args.jobId != null && args.jobId !== "" ? { job_id: args.jobId } : {}),
      ...(args.ingestedRunId != null && args.ingestedRunId !== ""
        ? { ingested_run_id: args.ingestedRunId }
        : {}),
    },
    update: {
      content,
      createdAt: new Date(args.detail.created_at),
      url: args.detail.html_url,
      authorName: args.ownerLogin,
      authorId,
      metricsLikes: args.detail.stargazers_count ?? null,
      metricsShares: args.detail.forks_count ?? null,
      metricsComments: args.detail.open_issues_count ?? null,
      extraJson,
      ai_processed_at: new Date(),
      ...(args.jobId != null && args.jobId !== "" ? { job_id: args.jobId } : {}),
    },
    select: { id: true },
  });

  try {
    await persistGithubPostProductRelevance({
      projectId: args.projectId,
      postId: row.id,
      extra: args.extra,
    });
  } catch (e) {
    console.warn(
      `[github] product relevance scoring failed for post ${row.id}:`,
      e instanceof Error ? e.message : e
    );
  }
}
