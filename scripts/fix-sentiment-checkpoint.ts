/**
 * Fix sentiment checkpoint by finding the minimum unanalyzed post ID
 * and setting the checkpoint to (minUnanalyzed - 1)
 *
 * Usage: npx tsx scripts/fix-sentiment-checkpoint.ts <projectId>
 */

import { PrismaClient } from "@prisma/client";
import { updateAnalysisProgress } from "@/lib/analysis-progress";

const prisma = new PrismaClient();

async function fixCheckpoint(projectId: string) {
  console.log("🔧 Fixing Sentiment Checkpoint\n");
  console.log("=".repeat(60));

  try {
    // Get current checkpoint
    const progress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
    });

    const oldCheckpoint = progress?.last_sentiment_post_id || 0;
    console.log(`📊 Current checkpoint: ${oldCheckpoint}`);

    // Find the minimum post ID with NULL sentiment
    const minUnanalyzed = await prisma.post.findFirst({
      where: {
        project_id: projectId,
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });

    if (!minUnanalyzed) {
      console.log("✅ No unanalyzed posts found! Checkpoint is correct.");
      return;
    }

    console.log(`📋 Minimum unanalyzed post ID: ${minUnanalyzed.id}`);

    // Count unanalyzed posts
    const unanalyzedCount = await prisma.post.count({
      where: {
        project_id: projectId,
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
    });

    console.log(`📊 Total unanalyzed posts: ${unanalyzedCount.toLocaleString()}`);

    // Set checkpoint to (minUnanalyzed - 1) to ensure all posts are analyzed
    const newCheckpoint = minUnanalyzed.id - 1;

    if (newCheckpoint === oldCheckpoint) {
      console.log("✅ Checkpoint is already correct!");
      return;
    }

    console.log(`\n🔧 Setting checkpoint to: ${newCheckpoint} (minUnanalyzed - 1)`);
    console.log(
      `   This will ensure all ${unanalyzedCount.toLocaleString()} unanalyzed posts are analyzed in the next run.`
    );

    await updateAnalysisProgress(projectId, {
      last_sentiment_post_id: newCheckpoint,
    });

    console.log("\n✅ Checkpoint updated successfully!");
    console.log(`   Old checkpoint: ${oldCheckpoint}`);
    console.log(`   New checkpoint: ${newCheckpoint}`);
    console.log(`   Difference: ${oldCheckpoint - newCheckpoint} posts will be re-analyzed`);

    console.log("\n" + "=".repeat(60));
    console.log("✅ Fix complete");
  } catch (error) {
    console.error("❌ Error fixing checkpoint:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const projectId = process.argv[2];

if (!projectId) {
  console.error("Usage: npx tsx scripts/fix-sentiment-checkpoint.ts <projectId>");
  console.error("\nExample:");
  console.error("  npx tsx scripts/fix-sentiment-checkpoint.ts 01K5ZN4CAGXGM9D1HART3Q0A8A");
  process.exit(1);
}

fixCheckpoint(projectId).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
