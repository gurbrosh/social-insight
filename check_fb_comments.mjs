import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkFBComments() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Check if any Facebook comments exist in Post table with threadRefId
  const fbComments = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
      threadRefId: { not: null },
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorName: true,
    },
    take: 10,
  });

  console.log(`📊 Facebook comments in Post table: ${fbComments.length}`);
  fbComments.forEach((c) => {
    console.log(
      `  Comment ${c.id}: postId=${c.postId}, threadRefId=${c.threadRefId}, author=${c.authorName || "null"}`
    );
  });

  // Check DownstreamPost for Facebook comments
  const downstreamComments = await prisma.downstreamPost.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
      origScraper: "Facebook Comments Scraper",
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
    },
    take: 10,
  });

  console.log(`\n📊 Facebook comments in DownstreamPost: ${downstreamComments.length}`);
  downstreamComments.forEach((c) => {
    console.log(`  Comment ${c.id}: postId=${c.postId}, threadRefId=${c.threadRefId || "null"}`);
  });

  await prisma.$disconnect();
}

checkFBComments().catch(console.error);
