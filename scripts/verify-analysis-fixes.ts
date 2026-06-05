import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verifyAnalysisFixes() {
  const projectId = process.argv[2] || "01K5ZN4CAGXGM9D1HART3Q0A8A";

  console.log("🔍 Verifying Analysis Fixes");
  console.log("=".repeat(70));
  console.log(`Project ID: ${projectId}\n`);

  // Get current checkpoint
  const progress = await prisma.analysisProgress.findUnique({
    where: { project_id: projectId },
    select: {
      last_sentiment_post_id: true,
      updated_at: true,
    },
  });

  if (!progress) {
    console.log("❌ No analysis progress found for this project");
    await prisma.$disconnect();
    return;
  }

  console.log(`📊 Current Checkpoint: ${progress.last_sentiment_post_id}`);
  console.log(`   Last Updated: ${progress.updated_at.toISOString()}\n`);

  // Find posts without sentiment that should have been analyzed
  const unanalyzedPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      id: { lte: progress.last_sentiment_post_id },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
    select: {
      id: true,
      platform: true,
      content: true,
      threadRefId: true,
      createdAt: true,
    },
    orderBy: { id: "desc" },
    take: 20,
  });

  console.log(`⚠️  Unanalyzed Posts (ID <= checkpoint ${progress.last_sentiment_post_id}):`);
  if (unanalyzedPosts.length === 0) {
    console.log("   ✅ None found - all posts before checkpoint have sentiment!\n");
  } else {
    console.log(`   Found ${unanalyzedPosts.length} posts (showing up to 20):\n`);
    unanalyzedPosts.forEach((post) => {
      const isComment = post.threadRefId !== null;
      const contentPreview = (post.content || "").substring(0, 60);
      console.log(
        `   - ID: ${post.id} | ${post.platform} | ${isComment ? "Comment" : "Post"} | Created: ${post.createdAt.toISOString()}`
      );
      console.log(`     Content: ${contentPreview}...`);
    });
    console.log("");
  }

  // Find posts created in the last 24 hours without sentiment
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentUnanalyzed = await prisma.post.findMany({
    where: {
      project_id: projectId,
      createdAt: { gte: last24Hours },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
    select: {
      id: true,
      platform: true,
      threadRefId: true,
      createdAt: true,
    },
    orderBy: { id: "desc" },
  });

  console.log(`📅 Recent Unanalyzed Posts (Last 24 Hours):`);
  if (recentUnanalyzed.length === 0) {
    console.log("   ✅ None found - all recent posts have sentiment!\n");
  } else {
    console.log(`   Found ${recentUnanalyzed.length} posts:\n`);

    // Group by platform
    const byPlatform = recentUnanalyzed.reduce(
      (acc, post) => {
        const key = post.platform;
        if (!acc[key]) acc[key] = [];
        acc[key].push(post);
        return acc;
      },
      {} as Record<string, typeof recentUnanalyzed>
    );

    Object.entries(byPlatform).forEach(([platform, posts]) => {
      const comments = posts.filter((p) => p.threadRefId !== null).length;
      const rootPosts = posts.length - comments;
      console.log(
        `   ${platform}: ${posts.length} total (${rootPosts} posts, ${comments} comments)`
      );
    });
    console.log("");
  }

  // Find posts that are ABOVE the checkpoint (should be analyzed next)
  const postsAboveCheckpoint = await prisma.post.count({
    where: {
      project_id: projectId,
      id: { gt: progress.last_sentiment_post_id },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
  });

  console.log(`🔮 Posts Above Checkpoint (Will be analyzed next):`);
  console.log(`   ${postsAboveCheckpoint} posts waiting for analysis\n`);

  // Check for posts that might have been created during analysis
  // (posts created in the last hour that are above checkpoint)
  const lastHour = new Date(Date.now() - 60 * 60 * 1000);
  const recentAboveCheckpoint = await prisma.post.count({
    where: {
      project_id: projectId,
      id: { gt: progress.last_sentiment_post_id },
      createdAt: { gte: lastHour },
      sentiment: null,
      content: { not: null },
      NOT: { content: "" },
    },
  });

  if (recentAboveCheckpoint > 0) {
    console.log(`⏰ Posts Created in Last Hour (Above Checkpoint):`);
    console.log(
      `   ${recentAboveCheckpoint} posts - these should be caught by re-query mechanism\n`
    );
  }

  // Summary
  console.log("📋 Summary:");
  console.log("=".repeat(70));
  if (unanalyzedPosts.length === 0 && recentUnanalyzed.length === 0) {
    console.log("✅ EXCELLENT: No unanalyzed posts found!");
    console.log("   All fixes appear to be working correctly.");
  } else if (unanalyzedPosts.length === 0) {
    console.log("⚠️  WARNING: Found recent unanalyzed posts");
    console.log("   These posts are above the checkpoint and should be analyzed in the next run.");
    console.log("   If they persist, check logs for re-query messages.");
  } else {
    console.log("❌ ISSUE: Found unanalyzed posts below checkpoint");
    console.log("   These posts should have been analyzed but were skipped.");
    console.log("   This indicates a problem with the checkpoint logic.");
  }
  console.log("");

  await prisma.$disconnect();
}

verifyAnalysisFixes().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
