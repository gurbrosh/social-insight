/**
 * Diagnostic script to investigate why posts are being skipped in sentiment analysis
 *
 * Usage: npx tsx scripts/diagnose-sentiment-skip.ts <projectId> [searchTerm]
 *
 * Example: npx tsx scripts/diagnose-sentiment-skip.ts 01K5ZN4CAGXGM9D1HART3Q0A8A "vibe coding"
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function diagnoseSentimentSkip(projectId: string, searchTerm?: string) {
  console.log("🔍 Sentiment Analysis Diagnostic Tool\n");
  console.log("=".repeat(60));

  try {
    // 1. Get analysis progress checkpoint
    const progress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
    });

    const lastSentimentPostId = progress?.last_sentiment_post_id ?? 0;
    console.log(`\n📊 Analysis Progress Checkpoint:`);
    console.log(`   last_sentiment_post_id: ${lastSentimentPostId}`);

    // 2. Get project info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    console.log(`\n📁 Project: ${project?.name || projectId}`);

    // 3. Find the specific post if search term provided
    if (searchTerm) {
      console.log(`\n🔎 Searching for post with content containing: "${searchTerm}"`);

      // SQLite doesn't support case-insensitive mode, so we'll search and filter in memory
      const allMatchingPosts = await prisma.post.findMany({
        where: {
          project_id: projectId,
          content: { not: null },
        },
        select: {
          id: true,
          platform: true,
          postId: true,
          content: true,
          sentiment: true,
          createdAt: true,
          authorName: true,
          url: true,
        },
        orderBy: { id: "desc" },
        take: 100, // Get more to filter in memory
      });

      // Filter case-insensitively in memory (SQLite limitation)
      const matchingPosts = allMatchingPosts
        .filter(
          (post) => post.content && post.content.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .slice(0, 10);

      if (matchingPosts.length === 0) {
        console.log(`   ❌ No posts found matching "${searchTerm}"`);
      } else {
        console.log(`   ✅ Found ${matchingPosts.length} matching post(s):\n`);

        for (const post of matchingPosts) {
          const contentPreview = post.content
            ? post.content.length > 150
              ? post.content.substring(0, 150) + "..."
              : post.content
            : "(no content)";

          console.log(`   Post ID: ${post.id}`);
          console.log(`   Platform: ${post.platform}`);
          console.log(`   Platform Post ID: ${post.postId}`);
          console.log(`   Author: ${post.authorName || "unknown"}`);
          console.log(`   Created: ${post.createdAt.toISOString()}`);
          console.log(`   Sentiment: ${post.sentiment || "NULL (not analyzed)"}`);
          console.log(`   Content: ${contentPreview}`);
          console.log(`   URL: ${post.url || "N/A"}`);
          console.log(`   ──────────────────────────────────────────────────────`);

          // Check if this post should have been analyzed
          if (post.id <= lastSentimentPostId) {
            console.log(
              `   ⚠️  WARNING: Post ID ${post.id} is BELOW checkpoint ${lastSentimentPostId}`
            );
            console.log(`      This post was created BEFORE the last analysis checkpoint!`);
            console.log(`      It should have been analyzed in a previous run.`);
          } else if (post.sentiment === null) {
            console.log(
              `   ⚠️  WARNING: Post ID ${post.id} is ABOVE checkpoint ${lastSentimentPostId} but has no sentiment!`
            );
            console.log(`      This post SHOULD have been analyzed but wasn't.`);
            console.log(`      Possible reasons:`);
            console.log(
              `      - Post was filtered out before batching (empty content, prefilter, etc.)`
            );
            console.log(
              `      - Batch failed but checkpoint advanced anyway (bug - should be fixed now)`
            );
            console.log(
              `      - Post was created after analysis query but before checkpoint update (race condition)`
            );
          }
          console.log("");
        }
      }
    }

    // 4. Get statistics about posts around the checkpoint
    console.log(`\n📈 Statistics Around Checkpoint:`);

    const postsBelowCheckpoint = await prisma.post.count({
      where: {
        project_id: projectId,
        id: { lte: lastSentimentPostId },
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
    });

    const postsAboveCheckpoint = await prisma.post.count({
      where: {
        project_id: projectId,
        id: { gt: lastSentimentPostId },
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
    });

    const postsWithSentiment = await prisma.post.count({
      where: {
        project_id: projectId,
        sentiment: { not: null },
      },
    });

    const totalPosts = await prisma.post.count({
      where: {
        project_id: projectId,
      },
    });

    console.log(`   Total posts: ${totalPosts}`);
    console.log(`   Posts with sentiment: ${postsWithSentiment}`);
    console.log(`   Posts without sentiment: ${totalPosts - postsWithSentiment}`);
    console.log(`   ──────────────────────────────────────────────────────`);
    console.log(
      `   Posts BELOW checkpoint (id <= ${lastSentimentPostId}) without sentiment: ${postsBelowCheckpoint}`
    );
    console.log(
      `   Posts ABOVE checkpoint (id > ${lastSentimentPostId}) without sentiment: ${postsAboveCheckpoint}`
    );

    if (postsBelowCheckpoint > 0) {
      console.log(
        `\n   ⚠️  WARNING: ${postsBelowCheckpoint} posts below checkpoint don't have sentiment!`
      );
      console.log(`      These posts were created before the checkpoint but weren't analyzed.`);
      console.log(`      This suggests the checkpoint was set incorrectly or posts were skipped.`);
    }

    // 5. Get recent posts to see the ID range
    console.log(`\n📋 Recent Posts (last 10):`);
    const recentPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
      },
      select: {
        id: true,
        platform: true,
        sentiment: true,
        createdAt: true,
        content: true,
      },
      orderBy: { id: "desc" },
      take: 10,
    });

    if (recentPosts.length > 0) {
      const maxPostId = Math.max(...recentPosts.map((p) => p.id));
      const minPostId = Math.min(...recentPosts.map((p) => p.id));
      console.log(`   Post ID range: ${minPostId} - ${maxPostId}`);
      console.log(`   Checkpoint: ${lastSentimentPostId}`);
      console.log(`   Gap: ${maxPostId - lastSentimentPostId} posts above checkpoint`);

      console.log(`\n   Recent posts:`);
      for (const post of recentPosts) {
        const hasContent = post.content && post.content.trim() !== "";
        const hasSentiment = post.sentiment !== null;
        const status = hasSentiment ? "✅" : hasContent ? "❌" : "⚠️ ";
        console.log(
          `   ${status} ID ${post.id.toString().padStart(8)} | ${post.platform.padEnd(10)} | ${hasSentiment ? post.sentiment : "NULL"} | ${post.createdAt.toISOString().substring(0, 19)}`
        );
      }
    }

    // 6. Check for posts that should be analyzed but weren't
    console.log(
      `\n🔬 Posts That Should Be Analyzed (id > ${lastSentimentPostId}, sentiment = null, has content):`
    );
    const unanalyzedPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        id: { gt: lastSentimentPostId },
        sentiment: null,
        content: { not: null },
        NOT: { content: "" },
      },
      select: {
        id: true,
        platform: true,
        createdAt: true,
        content: true,
      },
      orderBy: { id: "asc" },
      take: 20,
    });

    if (unanalyzedPosts.length === 0) {
      console.log(`   ✅ No unanalyzed posts found above checkpoint`);
    } else {
      console.log(`   ⚠️  Found ${unanalyzedPosts.length} unanalyzed post(s) above checkpoint:`);
      for (const post of unanalyzedPosts.slice(0, 10)) {
        const contentPreview = post.content
          ? post.content.length > 100
            ? post.content.substring(0, 100) + "..."
            : post.content
          : "(no content)";
        console.log(
          `   - ID ${post.id} | ${post.platform} | ${post.createdAt.toISOString().substring(0, 19)}`
        );
        console.log(`     Content: ${contentPreview}`);
      }
      if (unanalyzedPosts.length > 10) {
        console.log(`   ... and ${unanalyzedPosts.length - 10} more`);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Diagnostic complete`);
  } catch (error) {
    console.error("❌ Error running diagnostic:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const projectId = process.argv[2];
const searchTerm = process.argv[3];

if (!projectId) {
  console.error("Usage: npx tsx scripts/diagnose-sentiment-skip.ts <projectId> [searchTerm]");
  console.error(
    'Example: npx tsx scripts/diagnose-sentiment-skip.ts 01K5ZN4CAGXGM9D1HART3Q0A8A "vibe coding"'
  );
  process.exit(1);
}

diagnoseSentimentSkip(projectId, searchTerm).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
