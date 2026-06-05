#!/usr/bin/env tsx

/**
 * Update mention_count on all BlogNewsAnalysis rows (per project or all projects).
 * Counts how many rows share the same main theme (idea_1, normalized) within each project.
 *
 * Usage:
 *   npx tsx scripts/update-blog-news-mention-counts.ts           # all projects
 *   npx tsx scripts/update-blog-news-mention-counts.ts <projectId>  # one project
 */

import { updateBlogNewsMentionCounts } from "../lib/blog-post-analysis-pipeline";
import { prisma } from "../lib/prisma";

async function main() {
  const projectId = process.argv[2];
  if (projectId) {
    const result = await updateBlogNewsMentionCounts(projectId);
    console.log(`Updated mention_count for ${result.updated} row(s) in project ${projectId}.`);
  } else {
    const projects = await prisma.project.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true },
    });
    let total = 0;
    for (const p of projects) {
      const result = await updateBlogNewsMentionCounts(p.id);
      if (result.updated > 0) {
        console.log(`${p.name ?? p.id}: ${result.updated} row(s) updated.`);
        total += result.updated;
      }
    }
    console.log(`Done. Total rows updated: ${total}.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
