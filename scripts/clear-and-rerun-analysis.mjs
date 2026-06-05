import { PrismaClient } from "@prisma/client";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ulid } from "ulid";

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

async function clearAnalysisTables() {
  console.log(`\n🧹 Clearing analysis tables for project ${projectId}...`);

  // Soft delete all analysis records
  const [chatter, network, news, themes] = await Promise.all([
    prisma.chatterAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    }),
    prisma.networkAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    }),
    prisma.postNews.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    }),
    prisma.themesAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    }),
  ]);

  console.log(`✅ Cleared:`);
  console.log(`   - ChatterAnalysis: ${chatter.count} records`);
  console.log(`   - NetworkAnalysis: ${network.count} records`);
  console.log(`   - PostNews: ${news.count} records`);
  console.log(`   - ThemesAnalysis: ${themes.count} records`);

  // Also clear post sentiments to force re-analysis
  await prisma.post.updateMany({
    where: { project_id: projectId, sentiment: { not: null } },
    data: { sentiment: null },
  });

  console.log(`✅ Cleared post sentiments to force re-analysis\n`);
}

async function main() {
  try {
    await clearAnalysisTables();
    console.log("✅ Analysis tables cleared successfully!");
    console.log("\n📝 Next steps:");
    console.log("   1. Go to your project page: http://localhost:3000/projects/" + projectId);
    console.log("   2. Click the 'Run Analysis' button");
    console.log("   3. The new semantic relevance logic will be applied\n");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
