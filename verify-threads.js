import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

(async () => {
  try {
    const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

    console.log("🔍 Verifying thread structure for chatter analysis...\n");

    // Get all posts with content
    const allPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        id: { gt: 96190 },
        content: { not: null },
      },
      select: {
        id: true,
        postId: true,
        threadRefId: true,
        content: true,
        platform: true,
        createdAt: true,
        job: {
          select: {
            scraper: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const rootPosts = allPosts.filter((p) => !p.threadRefId);
    const replies = allPosts.filter((p) => p.threadRefId);

    console.log("📊 Summary:");
    console.log(`  - Total posts: ${allPosts.length}`);
    console.log(`  - Root posts: ${rootPosts.length}`);
    console.log(`  - Replies: ${replies.length}`);

    // Build a map of root posts
    const rootPostMap = new Map();
    for (const root of rootPosts) {
      const replyCount = replies.filter((r) => r.threadRefId === root.postId).length;
      rootPostMap.set(root.postId, { root, replyCount });
    }

    // Check for orphaned replies
    const orphanedReplies = replies.filter((r) => !rootPostMap.has(r.threadRefId));

    console.log("\n✅ Root posts with replies:");
    const threadsWithReplies = Array.from(rootPostMap.values())
      .filter((t) => t.replyCount > 0)
      .sort((a, b) => b.replyCount - a.replyCount);

    threadsWithReplies.forEach((t, i) => {
      const scraperName = t.root.job?.scraper?.name || "N/A";
      console.log(
        `  ${i + 1}. Root ID: ${t.root.id}, PostId: ${t.root.postId.substring(0, 40)}...`
      );
      console.log(
        `     => ${t.replyCount} replies (Platform: ${t.root.platform}, Scraper: ${scraperName})`
      );
      console.log(`     Content: ${t.root.content?.substring(0, 60)}...`);
    });

    // Show root posts without replies
    const rootsWithoutReplies = Array.from(rootPostMap.values()).filter((t) => t.replyCount === 0);

    if (rootsWithoutReplies.length > 0) {
      console.log(`\n⚠️  Root posts without replies: ${rootsWithoutReplies.length}`);
      rootsWithoutReplies.slice(0, 5).forEach((t, i) => {
        const scraperName = t.root.job?.scraper?.name || "N/A";
        console.log(
          `  ${i + 1}. Root ID: ${t.root.id}, PostId: ${t.root.postId.substring(0, 40)}... (Scraper: ${scraperName})`
        );
      });
    }

    if (orphanedReplies.length > 0) {
      console.log(`\n❌ Orphaned replies (linked to non-existent root): ${orphanedReplies.length}`);
      orphanedReplies.slice(0, 5).forEach((r, i) => {
        console.log(
          `  ${i + 1}. Reply ID: ${r.id}, threadRefId: ${r.threadRefId?.substring(0, 40)}...`
        );
      });
    } else {
      console.log("\n✅ All replies are properly linked to existing root posts");
    }

    console.log(`\n📈 Threads ready for chatter analysis: ${threadsWithReplies.length}`);
    console.log(
      `   Total replies in threads: ${threadsWithReplies.reduce((sum, t) => sum + t.replyCount, 0)}`
    );

    // Verify thread structure matches what identifyConversationThreads expects
    console.log("\n🔍 Verifying structure matches identifyConversationThreads requirements...");

    // Check that all root posts have content
    const rootsWithoutContent = rootPosts.filter((r) => !r.content || r.content.trim() === "");
    if (rootsWithoutContent.length > 0) {
      console.log(`  ⚠️  ${rootsWithoutContent.length} root posts without content`);
    } else {
      console.log("  ✅ All root posts have content");
    }

    // Check that all replies have content
    const repliesWithoutContent = replies.filter((r) => !r.content || r.content.trim() === "");
    if (repliesWithoutContent.length > 0) {
      console.log(`  ⚠️  ${repliesWithoutContent.length} replies without content`);
    } else {
      console.log("  ✅ All replies have content");
    }

    // Check that threadRefId values are valid postIds
    const invalidThreadRefs = replies.filter((r) => {
      if (!r.threadRefId) return false;
      return !rootPostMap.has(r.threadRefId);
    });

    if (invalidThreadRefs.length > 0) {
      console.log(`  ❌ ${invalidThreadRefs.length} replies with invalid threadRefId`);
    } else {
      console.log("  ✅ All threadRefId values point to valid root posts");
    }

    // Sample a few threads to show structure
    console.log("\n📋 Sample thread structure:");
    if (threadsWithReplies.length > 0) {
      const sampleThread = threadsWithReplies[0];
      const sampleReplies = replies
        .filter((r) => r.threadRefId === sampleThread.root.postId)
        .slice(0, 3);

      console.log(`\n  Root Post (ID: ${sampleThread.root.id}):`);
      console.log(`    Content: ${sampleThread.root.content?.substring(0, 100)}...`);
      console.log(`    Replies: ${sampleThread.replyCount}`);

      if (sampleReplies.length > 0) {
        console.log(`\n  Sample Replies:`);
        sampleReplies.forEach((reply, i) => {
          console.log(
            `    ${i + 1}. Reply ID: ${reply.id}, threadRefId: ${reply.threadRefId?.substring(0, 30)}...`
          );
          console.log(`       Content: ${reply.content?.substring(0, 60)}...`);
        });
      }
    }

    await prisma.$disconnect();
  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
    await prisma.$disconnect();
  }
})();
