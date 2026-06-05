/**
 * Export a set of non-blog posts for a project with relevance evaluation, so you can
 * review why social posts are deemed irrelevant for News (same logic as news synthesis).
 * Samples evenly across platforms (facebook, linkedin, x, reddit, youtube, discord) so
 * the export is not dominated by a single source.
 *
 * Usage:
 *   npx tsx scripts/export-news-deemed-irrelevant-posts.ts <projectId> [--limit N] [--out file.json] [--all]
 *
 * Default: writes only posts deemed OFF-TOPIC to news-deemed-irrelevant-<projectId>.json
 * --all: include both relevant and irrelevant posts
 * --limit N: max total non-blog posts to evaluate (default 150); per-platform cap = ceil(limit / 5). YouTube is skipped.
 * --out path: output JSON path (default: news-deemed-irrelevant-<projectId>.json)
 *
 * Example:
 *   npx tsx scripts/export-news-deemed-irrelevant-posts.ts 01KEDS2SD1X3MVN76DV58CMNJD --limit 200
 */
import { prisma } from "../lib/prisma";
import {
  getProjectContextForRelevance,
  isPostRelevantToProjectContext,
} from "../lib/comprehensive-analysis";
import * as fs from "fs";

const NON_BLOG_PLATFORMS = ["facebook", "linkedin", "x", "reddit", "discord"] as const;

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error(
      "Usage: npx tsx scripts/export-news-deemed-irrelevant-posts.ts <projectId> [--limit N] [--out file.json] [--all]"
    );
    process.exit(1);
  }

  const limitIdx = process.argv.indexOf("--limit");
  const limit =
    limitIdx !== -1 && process.argv[limitIdx + 1]
      ? Math.max(1, parseInt(process.argv[limitIdx + 1], 10) || 150)
      : 150;

  const outIdx = process.argv.indexOf("--out");
  const outPath =
    outIdx !== -1 && process.argv[outIdx + 1]
      ? process.argv[outIdx + 1]
      : `news-deemed-irrelevant-${projectId}.json`;

  const includeAll = process.argv.includes("--all");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error("Project not found:", projectId);
    process.exit(1);
  }

  const perPlatform = Math.max(1, Math.ceil(limit / NON_BLOG_PLATFORMS.length));
  const posts: Array<{
    id: number;
    postId: string | null;
    platform: string | null;
    authorName: string | null;
    content: string | null;
    url: string | null;
    createdAt: Date | null;
  }> = [];

  for (const platform of NON_BLOG_PLATFORMS) {
    const chunk = await prisma.post.findMany({
      where: {
        project_id: projectId,
        platform: { in: [platform, platform === "x" ? "twitter" : platform] },
        content: { not: null },
        NOT: { content: "" },
      },
      select: {
        id: true,
        postId: true,
        platform: true,
        authorName: true,
        content: true,
        url: true,
        createdAt: true,
      },
      orderBy: { id: "desc" },
      take: perPlatform,
    });
    posts.push(...chunk);
  }

  // Sort by id desc so order is consistent
  posts.sort((a, b) => b.id - a.id);

  console.log(`Project: ${project.name ?? projectId}`);
  console.log(
    `Evaluating ${posts.length} non-blog posts (up to ${perPlatform} per platform: ${NON_BLOG_PLATFORMS.join(", ")})...`
  );

  const projectContext = await getProjectContextForRelevance(projectId);

  const results: Array<{
    id: number;
    postId: string | null;
    platform: string | null;
    authorName: string | null;
    url: string | null;
    createdAt: string;
    contentSnippet: string;
    relevant: boolean;
    reason?: string;
  }> = [];

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const contentSnippet = [p.content, p.url, p.authorName]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);
    const relevance = await isPostRelevantToProjectContext(projectContext, contentSnippet, {
      platform: p.platform ?? undefined,
      authorName: p.authorName ?? undefined,
    });
    results.push({
      id: p.id,
      postId: p.postId,
      platform: p.platform,
      authorName: p.authorName,
      url: p.url,
      createdAt: p.createdAt?.toISOString() ?? "",
      contentSnippet,
      relevant: relevance.relevant,
      reason: relevance.reason,
    });
    if ((i + 1) % 20 === 0) {
      console.log(`  ${i + 1}/${posts.length}...`);
    }
  }

  const toWrite = includeAll
    ? results
    : results.filter((r) => !r.relevant);

  const payload = {
    projectId,
    projectName: project.name ?? null,
    generatedAt: new Date().toISOString(),
    totalEvaluated: results.length,
    deemedIrrelevantCount: results.filter((r) => !r.relevant).length,
    filter: includeAll ? "all" : "irrelevant_only",
    posts: toWrite,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log(
    `Wrote ${toWrite.length} post(s) to ${outPath} (${payload.deemedIrrelevantCount} deemed irrelevant of ${payload.totalEvaluated} evaluated).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
