/**
 * Check current analysis status for a project
 *
 * Usage: npx tsx scripts/check-analysis-status.ts <projectId>
 */

import { PrismaClient } from "@prisma/client";
import { getAnalysisLock } from "@/lib/analysis-lock";

const prisma = new PrismaClient();

async function checkAnalysisStatus(projectId: string) {
  console.log("🔍 Analysis Status Check\n");
  console.log("=".repeat(60));

  try {
    // Get project info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });

    if (!project) {
      console.error(`❌ Project ${projectId} not found`);
      return;
    }

    console.log(`📁 Project: ${project.name}`);
    console.log(`   Project ID: ${projectId}\n`);

    // Check analysis lock (in-memory)
    const lock = getAnalysisLock();
    if (lock) {
      const ageSeconds = Math.round((Date.now() - lock.startedAt) / 1000);
      const ageMinutes = Math.round(ageSeconds / 60);
      console.log(`🔒 Analysis Lock Status:`);
      console.log(`   Status: LOCKED (analysis in progress)`);
      console.log(`   Project: ${lock.projectId}`);
      console.log(`   Mode: ${lock.mode || "unknown"}`);
      console.log(`   Started: ${new Date(lock.startedAt).toISOString()}`);
      console.log(`   Age: ${ageSeconds}s (${ageMinutes}m)`);

      if (lock.projectId !== projectId) {
        console.log(`   ⚠️  WARNING: Lock is for different project!`);
      }
    } else {
      console.log(`🔓 Analysis Lock Status: UNLOCKED (no analysis in progress)`);
    }

    // Get analysis progress from database
    const progress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
    });

    if (progress) {
      console.log(`\n📊 Analysis Progress (Database):`);
      console.log(`   Last Sentiment Post ID: ${progress.last_sentiment_post_id}`);
      console.log(`   Last Themes Post ID: ${progress.last_themes_post_id}`);
      console.log(`   Last Chatter Post ID: ${progress.last_chatter_post_id}`);
      console.log(`   Last Network Post ID: ${progress.last_network_post_id}`);
      console.log(`   Last News Post ID: ${progress.last_news_post_id}`);
      console.log(`   Last Brand Post ID: ${progress.last_brand_post_id || "N/A"}`);

      if (progress.last_sanitized_themes_at) {
        console.log(`   Last Sanitized Themes: ${progress.last_sanitized_themes_at.toISOString()}`);
      }
      if (progress.last_sanitized_chatter_at) {
        console.log(
          `   Last Sanitized Chatter: ${progress.last_sanitized_chatter_at.toISOString()}`
        );
      }
    } else {
      console.log(
        `\n📊 Analysis Progress: No progress record found (analysis may not have run yet)`
      );
    }

    // Get counts of analyzed data
    const [sentimentCount, themesCount, chatterCount, networkCount, newsCount] = await Promise.all([
      prisma.post.count({
        where: {
          project_id: projectId,
          sentiment: { not: null },
        },
      }),
      prisma.themesAnalysis.count({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
      }),
      prisma.chatterAnalysis.count({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
      }),
      prisma.networkAnalysis.count({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
      }),
      prisma.postNews.count({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
      }),
    ]);

    console.log(`\n📈 Analysis Results Counts:`);
    console.log(`   Posts with Sentiment: ${sentimentCount.toLocaleString()}`);
    console.log(`   Theme Matches: ${themesCount.toLocaleString()}`);
    console.log(`   Chatter Conversations: ${chatterCount.toLocaleString()}`);
    console.log(`   Network People: ${networkCount.toLocaleString()}`);
    console.log(`   News Items: ${newsCount.toLocaleString()}`);

    // Get total posts
    const totalPosts = await prisma.post.count({
      where: { project_id: projectId },
    });

    const unanalyzedPosts = totalPosts - sentimentCount;
    console.log(`\n📋 Post Analysis Status:`);
    console.log(`   Total Posts: ${totalPosts.toLocaleString()}`);
    console.log(`   Analyzed: ${sentimentCount.toLocaleString()}`);
    console.log(`   Unanalyzed: ${unanalyzedPosts.toLocaleString()}`);

    if (unanalyzedPosts > 0 && progress) {
      const lastPostId = await prisma.post.findFirst({
        where: { project_id: projectId },
        orderBy: { id: "desc" },
        select: { id: true },
      });

      if (lastPostId && lastPostId.id > progress.last_sentiment_post_id) {
        const postsToAnalyze = lastPostId.id - progress.last_sentiment_post_id;
        console.log(`   Posts to analyze (above checkpoint): ~${postsToAnalyze.toLocaleString()}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Status check complete");
  } catch (error) {
    console.error("❌ Error checking analysis status:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const projectId = process.argv[2];

if (!projectId) {
  console.error("Usage: npx tsx scripts/check-analysis-status.ts <projectId>");
  console.error("\nExample:");
  console.error("  npx tsx scripts/check-analysis-status.ts 01K5ZN4CAGXGM9D1HART3Q0A8A");
  process.exit(1);
}

checkAnalysisStatus(projectId).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
