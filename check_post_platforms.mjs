import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkPlatforms() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Check what platform values are in Post table
  const posts = await prisma.post.groupBy({
    by: ["platform"],
    where: { project_id: projectId },
    _count: { platform: true },
  });

  console.log(`📊 Platform values in Post table for project ${projectId}:`);
  posts.forEach((p) => {
    console.log(`  Platform: "${p.platform}" (count: ${p._count.platform})`);
  });

  // Check recent posts
  const recentPosts = await prisma.post.findMany({
    where: { project_id: projectId },
    select: { id: true, platform: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log(`\n📊 Most recent 5 posts:`);
  recentPosts.forEach((p) => {
    console.log(`  Post ${p.id}: platform="${p.platform}", createdAt=${p.createdAt}`);
  });

  await prisma.$disconnect();
}

checkPlatforms().catch(console.error);
