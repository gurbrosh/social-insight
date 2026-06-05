/**
 * Reset sentiment analysis checkpoint to allow re-analysis of missed posts
 *
 * Usage: npx tsx scripts/reset-sentiment-checkpoint.ts <projectId> [targetPostId]
 *
 * Examples:
 *   npx tsx scripts/reset-sentiment-checkpoint.ts 01K5ZN4CAGXGM9D1HART3Q0A8A
 *   npx tsx scripts/reset-sentiment-checkpoint.ts 01K5ZN4CAGXGM9D1HART3Q0A8A 200000
 *
 * If targetPostId is provided, checkpoint will be set to that ID (posts with id > targetPostId will be analyzed)
 * If not provided, checkpoint will be reset to 0 (all posts will be analyzed)
 */

import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";

const prisma = new PrismaClient();

async function resetSentimentCheckpoint(projectId: string, targetPostId?: number) {
  console.log("🔄 Sentiment Analysis Checkpoint Reset Tool\n");
  console.log("=".repeat(60));

  try {
    // Get current checkpoint
    const progress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
    });

    const currentCheckpoint = progress?.last_sentiment_post_id ?? 0;
    const newCheckpoint = targetPostId ?? 0;

    console.log(`\n📊 Current Status:`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Current checkpoint: ${currentCheckpoint}`);
    console.log(`   New checkpoint: ${newCheckpoint}`);

    // Get project info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    console.log(`   Project name: ${project?.name || "Unknown"}`);

    // Count posts that will be affected
    const postsAboveNewCheckpoint = await prisma.post.count({
      where: {
        project_id: projectId,
        id: { gt: newCheckpoint },
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
    });

    const postsWithSentiment = await prisma.post.count({
      where: {
        project_id: projectId,
        id: { gt: newCheckpoint },
        sentiment: { not: null },
      },
    });

    const totalPostsAboveCheckpoint = await prisma.post.count({
      where: {
        project_id: projectId,
        id: { gt: newCheckpoint },
      },
    });

    console.log(`\n📈 Impact Analysis:`);
    console.log(
      `   Posts above new checkpoint (id > ${newCheckpoint}): ${totalPostsAboveCheckpoint}`
    );
    console.log(`   - Posts without sentiment: ${postsAboveNewCheckpoint}`);
    console.log(`   - Posts with sentiment: ${postsWithSentiment}`);
    console.log(`   - Posts that will be re-analyzed: ${postsWithSentiment}`);
    console.log(`   - Posts that will be analyzed for first time: ${postsAboveNewCheckpoint}`);

    if (newCheckpoint < currentCheckpoint) {
      const postsInGap = await prisma.post.count({
        where: {
          project_id: projectId,
          id: { gt: newCheckpoint, lte: currentCheckpoint },
          sentiment: null,
          content: { not: null },
          NOT: { content: "" },
        },
      });

      console.log(
        `\n   ⚠️  Posts in gap (${newCheckpoint} < id <= ${currentCheckpoint}) without sentiment: ${postsInGap}`
      );
      console.log(`      These posts will now be eligible for analysis.`);
    }

    // Confirm before proceeding
    console.log(`\n⚠️  WARNING: This will reset the sentiment analysis checkpoint.`);
    console.log(`   Posts above the new checkpoint may be re-analyzed in the next analysis run.`);
    console.log(`   This is safe but may consume OpenAI API credits.`);

    // Update the checkpoint
    await prisma.analysisProgress.upsert({
      where: { project_id: projectId },
      update: {
        last_sentiment_post_id: newCheckpoint,
      },
      create: {
        id: ulid(),
        project_id: projectId,
        last_sentiment_post_id: newCheckpoint,
      },
    });

    console.log(`\n✅ Checkpoint reset successfully!`);
    console.log(`   Old checkpoint: ${currentCheckpoint}`);
    console.log(`   New checkpoint: ${newCheckpoint}`);
    console.log(`\n   Next analysis run will process posts with id > ${newCheckpoint}`);
    console.log(`   ${postsAboveNewCheckpoint} posts without sentiment will be analyzed`);
    if (postsWithSentiment > 0) {
      console.log(`   ${postsWithSentiment} posts with existing sentiment may be re-analyzed`);
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Reset complete`);
  } catch (error) {
    console.error("❌ Error resetting checkpoint:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const projectId = process.argv[2];
const targetPostIdArg = process.argv[3];

if (!projectId) {
  console.error("Usage: npx tsx scripts/reset-sentiment-checkpoint.ts <projectId> [targetPostId]");
  console.error("\nExamples:");
  console.error("  # Reset to 0 (analyze all posts)");
  console.error("  npx tsx scripts/reset-sentiment-checkpoint.ts 01K5ZN4CAGXGM9D1HART3Q0A8A");
  console.error("\n  # Reset to specific ID (analyze posts above that ID)");
  console.error(
    "  npx tsx scripts/reset-sentiment-checkpoint.ts 01K5ZN4CAGXGM9D1HART3Q0A8A 200000"
  );
  process.exit(1);
}

const targetPostId = targetPostIdArg ? parseInt(targetPostIdArg, 10) : undefined;

if (targetPostIdArg && isNaN(targetPostId!)) {
  console.error(`Error: Invalid targetPostId "${targetPostIdArg}". Must be a number.`);
  process.exit(1);
}

resetSentimentCheckpoint(projectId, targetPostId).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
