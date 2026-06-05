/**
 * Script to run news analysis on a project
 * Usage: node scripts/run-news-analysis.js [projectId]
 */

import { PrismaClient } from "@prisma/client";
import { analyzeProjectNews } from "../lib/news-analysis";

const prisma = new PrismaClient();

async function main() {
  try {
    // Get first active project if no projectId provided
    let projectId = process.argv[2];

    if (!projectId) {
      const project = await prisma.project.findFirst({
        where: { deleted_at: null },
        select: { id: true, name: true },
      });

      if (!project) {
        console.error("❌ No projects found in database");
        process.exit(1);
      }

      projectId = project.id;
      console.log(`📊 Using project: ${project.name} (${projectId})`);
    }

    // Check if project exists
    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
    });

    if (!project) {
      console.error(`❌ Project ${projectId} not found`);
      process.exit(1);
    }

    console.log(`\n🔍 Running news analysis on project: ${project.name}`);
    console.log("⏳ This may take a few minutes...\n");

    // Run news analysis
    const results = await analyzeProjectNews(projectId);

    console.log("\n✅ News Analysis Complete!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📝 Posts processed: ${results.processed}`);
    console.log(`📰 News items extracted: ${results.newsItems}`);
    console.log(`⏱️  Duration: ${results.duration.toFixed(1)}s`);
    console.log("\nPlatform breakdown:");
    Object.entries(results.platforms).forEach(([platform, batches]) => {
      console.log(`  - ${platform}: ${batches} batches`);
    });
    console.log("\n💡 View results in Admin Database Viewer: /admin/database → PostNews");
  } catch (error) {
    console.error("\n❌ Error running news analysis:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
