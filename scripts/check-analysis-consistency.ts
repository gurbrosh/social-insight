import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkConsistency() {
  const projectId = process.argv[2] || "01K5ZN4CAGXGM9D1HART3Q0A8A";
  const baselinePostId = parseInt(process.argv[3] || "251738", 10);

  console.log("🔍 Analysis Consistency Check");
  console.log("=".repeat(70));
  console.log(`Project ID: ${projectId}`);
  console.log(`Baseline Post ID: ${baselinePostId}`);
  console.log("(All posts with ID > baseline should be analyzed)\n");

  // Get current checkpoint
  const progress = await prisma.analysisProgress.findUnique({
    where: { project_id: projectId },
    select: {
      last_sentiment_post_id: true,
      updated_at: true,
    },
  });

  console.log(`📊 Current Checkpoint: ${progress?.last_sentiment_post_id || "N/A"}`);
  console.log(`   Last Updated: ${progress?.updated_at.toISOString()}\n`);

  // Find highest unanalyzed post
  const highestUnanalyzed = await prisma.post.findFirst({
    where: {
      project_id: projectId,
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
    select: {
      id: true,
      platform: true,
      createdAt: true,
    },
    orderBy: { id: "desc" },
  });

  if (!highestUnanalyzed) {
    console.log("✅ All posts have sentiment!");
    await prisma.$disconnect();
    return;
  }

  console.log(`⚠️  Highest Unanalyzed Post ID: ${highestUnanalyzed.id}`);
  console.log(`   Platform: ${highestUnanalyzed.platform}`);
  console.log(`   Created: ${highestUnanalyzed.createdAt.toISOString()}\n`);

  // Check consistency above baseline
  const unanalyzedAboveBaseline = await prisma.post.count({
    where: {
      project_id: projectId,
      id: { gt: baselinePostId },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
  });

  console.log("📈 Consistency Check (Posts Above Baseline):");
  console.log("=".repeat(70));
  if (unanalyzedAboveBaseline === 0) {
    console.log(`✅ PERFECT: All posts with ID > ${baselinePostId} are analyzed!`);
    console.log("   Analysis is consistent going forward.");
  } else {
    console.log(
      `❌ ISSUE: Found ${unanalyzedAboveBaseline} unanalyzed posts above baseline ${baselinePostId}`
    );
    console.log("   This indicates a problem - posts should be analyzed consistently.");

    // Show sample of unanalyzed posts above baseline
    const sample = await prisma.post.findMany({
      where: {
        project_id: projectId,
        id: { gt: baselinePostId },
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
      select: {
        id: true,
        platform: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      take: 10,
    });

    console.log("\n   Sample unanalyzed posts above baseline:");
    sample.forEach((p) => {
      console.log(`   - ID: ${p.id} | ${p.platform} | Created: ${p.createdAt.toISOString()}`);
    });
  }

  // Count backlog below baseline
  const backlogBelowBaseline = await prisma.post.count({
    where: {
      project_id: projectId,
      id: { lte: baselinePostId },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
  });

  console.log("\n📦 Backlog (Posts Below Baseline):");
  console.log("=".repeat(70));
  console.log(`Posts with ID <= ${baselinePostId} that are unanalyzed: ${backlogBelowBaseline}`);
  if (backlogBelowBaseline > 0) {
    console.log("   These can be backfilled gradually (200 per run).");
    console.log("   They do not affect consistency going forward.");
  }

  console.log("\n📋 Summary:");
  console.log("=".repeat(70));
  if (unanalyzedAboveBaseline === 0) {
    console.log("✅ Analysis is CONSISTENT above baseline");
    console.log(`   All posts with ID > ${baselinePostId} are analyzed`);
    console.log(
      `   Backlog below baseline: ${backlogBelowBaseline} posts (can be backfilled gradually)`
    );
  } else {
    console.log("❌ Analysis is INCONSISTENT above baseline");
    console.log(
      `   ${unanalyzedAboveBaseline} posts above baseline ${baselinePostId} are unanalyzed`
    );
    console.log("   This needs to be fixed!");
  }
  console.log("");

  await prisma.$disconnect();
}

checkConsistency().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
