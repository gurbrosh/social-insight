#!/usr/bin/env npx tsx
/**
 * Remove an incorrect theme match for a specific post
 *
 * Usage:
 *   npx tsx scripts/remove-incorrect-theme-match.ts <postId> <themeName> [projectId]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const postId = parseInt(process.argv[2]);
  const themeName = process.argv[3];
  const projectId = process.argv[4];

  if (!postId || !themeName) {
    console.error(
      "Usage: npx tsx scripts/remove-incorrect-theme-match.ts <postId> <themeName> [projectId]"
    );
    process.exit(1);
  }

  console.log(`\n🔍 Removing incorrect theme match:`);
  console.log(`   Post ID: ${postId}`);
  console.log(`   Theme: "${themeName}"`);
  if (projectId) {
    console.log(`   Project ID: ${projectId}`);
  }
  console.log();

  // Find the theme match
  const where: any = {
    post_id: postId,
    deleted_at: null,
  };

  if (projectId) {
    where.project_id = projectId;
  }

  // SQLite doesn't support case-insensitive queries, so we'll filter in memory
  const matches = await prisma.themesAnalysis.findMany({
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Filter by theme name (case-insensitive)
  const match = matches.find((m) => m.theme_name.toLowerCase().includes(themeName.toLowerCase()));

  if (!match) {
    console.log(`❌ No active theme match found for post ${postId} with theme "${themeName}"`);
    await prisma.$disconnect();
    return;
  }

  console.log(`✅ Found theme match:`);
  console.log(`   Match ID: ${match.id}`);
  console.log(`   Project: ${match.project.name} (${match.project.id})`);
  console.log(`   Theme: "${match.theme_name}"`);
  console.log(`   Relevance: ${match.relevance_score || "N/A"}`);
  console.log(`   Post content preview: ${(match.post_content || "").substring(0, 150)}...`);
  console.log();

  // Soft delete the match
  await prisma.themesAnalysis.update({
    where: { id: match.id },
    data: { deleted_at: new Date() },
  });

  console.log(`✅ Successfully removed incorrect theme match`);
  console.log(
    `   The match has been soft-deleted and will no longer appear in theme analysis results.`
  );
  console.log();

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
