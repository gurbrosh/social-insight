/**
 * Hard-delete all rows in HN-specific tables so you can re-run ingest / story analysis without using the admin UI.
 *
 * Tables:
 * - HnStoryAnalysis — clears Post.hn_story_analysis_id first (FK)
 * - HnStoryCommentTheme — global per-story comment-theme rows (not project-scoped)
 *
 * Usage:
 *   npx tsx scripts/clear-hn-tables.ts
 *
 * Scope to one project’s analyses only (does not delete HnStoryCommentTheme):
 *   npx tsx scripts/clear-hn-tables.ts --project-id <projectUlid>
 */

import { prisma } from "../lib/prisma";

async function main() {
  const idx = process.argv.indexOf("--project-id");
  const projectId =
    idx !== -1 && process.argv[idx + 1] ? String(process.argv[idx + 1]).trim() : null;

  if (projectId) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.post.updateMany({
        where: { project_id: projectId, hn_story_analysis_id: { not: null } },
        data: { hn_story_analysis_id: null },
      });
      const del = await tx.hnStoryAnalysis.deleteMany({ where: { project_id: projectId } });
      return del.count;
    });
    console.log(
      `Removed ${result} HnStoryAnalysis row(s) for project ${projectId}. HnStoryCommentTheme unchanged (run without --project-id to clear it).`
    );
    return;
  }

  const { analysisCount, commentThemeCount } = await prisma.$transaction(async (tx) => {
    await tx.post.updateMany({
      where: { hn_story_analysis_id: { not: null } },
      data: { hn_story_analysis_id: null },
    });
    const a = await tx.hnStoryAnalysis.deleteMany({});
    const c = await tx.hnStoryCommentTheme.deleteMany({});
    return { analysisCount: a.count, commentThemeCount: c.count };
  });

  console.log(
    `Cleared HN tables: HnStoryAnalysis=${analysisCount}, HnStoryCommentTheme=${commentThemeCount}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
