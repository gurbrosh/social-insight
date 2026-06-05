import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkRecords() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  const [chatter, themes, network, news] = await Promise.all([
    prisma.chatterAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.themesAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.networkAnalysis.count({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.postNews.count({
      where: { project_id: projectId, deleted_at: null },
    }),
  ]);

  console.log(`📊 Current DB counts for project ${projectId}:`);
  console.log(`  Chatter: ${chatter}`);
  console.log(`  Themes: ${themes}`);
  console.log(`  Network: ${network}`);
  console.log(`  News: ${news}`);

  // Also check deleted records
  const [deletedChatter, deletedThemes, deletedNetwork] = await Promise.all([
    prisma.chatterAnalysis.count({
      where: { project_id: projectId, deleted_at: { not: null } },
    }),
    prisma.themesAnalysis.count({
      where: { project_id: projectId, deleted_at: { not: null } },
    }),
    prisma.networkAnalysis.count({
      where: { project_id: projectId, deleted_at: { not: null } },
    }),
  ]);

  console.log(`\n🗑️  Deleted records:`);
  console.log(`  Chatter (deleted): ${deletedChatter}`);
  console.log(`  Themes (deleted): ${deletedThemes}`);
  console.log(`  Network (deleted): ${deletedNetwork}`);

  await prisma.$disconnect();
}

checkRecords().catch(console.error);
