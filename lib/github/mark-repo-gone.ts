import { prisma } from "@/lib/prisma";
import { GITHUB_POST_PLATFORM } from "./upsert-github-repo-post";

/**
 * True when GitHub REST returned 404/410 for GET /repos (repo removed, renamed, or gone).
 */
export function isGithubRepoNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /\bHTTP 404\b/i.test(msg) ||
    /\b404\b/.test(msg) ||
    /\bHTTP 410\b/i.test(msg) ||
    /\b410\b/.test(msg)
  );
}

/**
 * Soft-delete all GithubSignal rows for this repo (repo + code hits share repo_full_name).
 * Idempotent.
 */
export async function softDeleteGithubSignalsForRepoFullName(
  repoFullName: string
): Promise<number> {
  const name = repoFullName.trim();
  if (!name) return 0;
  const r = await prisma.githubSignal.updateMany({
    where: { repo_full_name: name, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  return r.count;
}

/**
 * When a repo disappears from GitHub, mark matching synthetic Posts for this project so
 * analysis does not keep stale README-style content. Scoped by project_id only.
 */
export async function markGithubRepoPostsUnavailable(args: {
  repoFullName: string;
  projectId: string;
}): Promise<number> {
  const full = args.repoFullName.trim();
  if (!full) return 0;
  const canonical = `https://github.com/${full}`;
  const pid = args.projectId.trim();
  if (!pid) return 0;

  const r = await prisma.post.updateMany({
    where: {
      project_id: pid,
      platform: GITHUB_POST_PLATFORM,
      OR: [{ url: canonical }, { url: `${canonical}/` }],
    },
    data: {
      content:
        "Repository unavailable: GitHub returned 404/410 (removed, renamed, made private, or never existed at this URL).",
      summary: null,
    },
  });
  return r.count;
}
