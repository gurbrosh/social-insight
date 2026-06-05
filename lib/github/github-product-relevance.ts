import { prisma } from "@/lib/prisma";
import {
  buildProductDescriptionForEmailReport,
  scoreGithubReposAgainstProduct,
  type GithubRepoForScoring,
} from "@/lib/email-report-github-relevance";
import type { GithubRepoStructuredExtraJson } from "@/lib/github/repo-structured-summary";

/** Parse `Post.extraJson.github` from Prisma JSON. */
export function parseGithubExtraFromPostJson(raw: unknown): GithubRepoStructuredExtraJson | null {
  if (!raw || typeof raw !== "object") return null;
  const g = (raw as { github?: unknown }).github;
  if (!g || typeof g !== "object") return null;
  const o = g as GithubRepoStructuredExtraJson;
  if (o.source !== "github_repo") return null;
  return o;
}

export function buildGithubRepoForScoring(
  postId: number,
  extra: GithubRepoStructuredExtraJson
): GithubRepoForScoring {
  const titleLine = extra.readme_title || extra.repo_full_name;
  const summaryLine = [extra.readme_description_excerpt, extra.about].filter(Boolean).join(" — ");
  const topicsLine = extra.topics?.length ? extra.topics.join(", ") : "";
  return {
    postId,
    repoFullName: extra.repo_full_name,
    titleLine,
    summaryLine: summaryLine.slice(0, 2000),
    topicsLine,
  };
}

/**
 * After a GitHub repo `Post` is upserted, score it against the project's My Product / description
 * and persist `github_product_relevance_score` on the Post row.
 */
export async function persistGithubPostProductRelevance(args: {
  projectId: string;
  postId: number;
  extra: GithubRepoStructuredExtraJson;
}): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, deleted_at: null },
    select: {
      id: true,
      name: true,
      description: true,
      monitoring_focus: true,
      my_product_name: true,
      my_product_focus_text: true,
      my_product_summary_json: true,
    },
  });

  if (!project) {
    console.warn(
      `[github-product-relevance] project ${args.projectId} not found; skipping relevance for post ${args.postId}`
    );
    return;
  }

  const productText = buildProductDescriptionForEmailReport(project);
  const repo = buildGithubRepoForScoring(args.postId, args.extra);
  const scores = await scoreGithubReposAgainstProduct(productText, [repo]);
  const score = scores.get(args.postId);

  await prisma.post.update({
    where: { id: args.postId },
    data: { github_product_relevance_score: score ?? null },
  });
}
