#!/usr/bin/env npx tsx
/**
 * Check which influencers were lost and why
 *
 * Usage:
 *   npx tsx scripts/check-lost-influencers.ts <projectId>
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projectId = process.argv[2];

  if (!projectId) {
    console.error("Usage: npx tsx scripts/check-lost-influencers.ts <projectId>");
    process.exit(1);
  }

  console.log(`\n🔍 Checking lost influencers for project: ${projectId}\n`);

  // Get all network analysis records (including soft-deleted)
  const allRecords = await prisma.networkAnalysis.findMany({
    where: {
      project_id: projectId,
    },
    select: {
      id: true,
      author_name: true,
      platform: true,
      total_reactions: true,
      deleted_at: true,
      ideas_json: true,
      created_at: true,
    },
    orderBy: { total_reactions: "desc" },
  });

  const active = allRecords.filter((r) => !r.deleted_at);
  const deleted = allRecords.filter((r) => r.deleted_at);

  console.log(`📊 Network Analysis Records:`);
  console.log(`   Total: ${allRecords.length}`);
  console.log(`   Active: ${active.length}`);
  console.log(`   Deleted (soft): ${deleted.length}\n`);

  if (deleted.length > 0) {
    console.log(`❌ DELETED INFLUENCERS (removed by sanitization):\n`);
    deleted.forEach((r, i) => {
      const ideas = r.ideas_json ? JSON.parse(r.ideas_json) : [];
      console.log(`   ${i + 1}. ${r.author_name} (${r.platform})`);
      console.log(`      Reactions: ${r.total_reactions}`);
      console.log(`      Deleted at: ${r.deleted_at}`);
      console.log(`      Ideas: ${ideas.slice(0, 2).join(" • ")}`);
      console.log();
    });
  }

  console.log(`✅ ACTIVE INFLUENCERS:\n`);
  active.forEach((r, i) => {
    const ideas = r.ideas_json ? JSON.parse(r.ideas_json) : [];
    console.log(`   ${i + 1}. ${r.author_name} (${r.platform}) - ${r.total_reactions} reactions`);
    if (ideas.length > 0) {
      console.log(`      Ideas: ${ideas.slice(0, 2).join(" • ")}`);
    }
  });

  console.log(`\n💡 Note: Influencers can be lost due to:`);
  console.log(`   1. Relevance scoring (score < 20) - filtered out before storage`);
  console.log(`   2. Sanitization (marked as off-topic) - soft-deleted after storage`);
  console.log(`   3. Top 10 per platform limit - only top 10 per platform are analyzed\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
