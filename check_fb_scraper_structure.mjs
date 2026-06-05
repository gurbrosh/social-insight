import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkStructure() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Get recent Facebook posts
  const fbPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
    },
    select: {
      id: true,
      postId: true,
      channelId: true,
      url: true,
      extraJson: true,
    },
    orderBy: { id: "desc" },
    take: 10,
  });

  console.log(`📊 Sample Facebook posts structure:`);
  fbPosts.forEach((post, i) => {
    const extra = post.extraJson || {};
    console.log(`\nPost ${i + 1} (ID: ${post.id}):`);
    console.log(`  postId: ${post.postId}`);
    console.log(`  channelId: ${post.channelId}`);
    console.log(`  url: ${post.url}`);
    console.log(`  extraJson.postTitle: ${extra.postTitle || "null"}`);
    console.log(`  extraJson.facebookUrl: ${extra.facebookUrl || "null"}`);
    console.log(`  extraJson.id: ${extra.id || "null"}`);
    console.log(`  extraJson.feedbackId: ${extra.feedbackId || "null"}`);
  });

  // Check if there are any posts with the same channelId (should be same root post)
  const channelGroups = fbPosts.reduce((acc, post) => {
    const key = post.channelId || "no-channel";
    if (!acc[key]) acc[key] = [];
    acc[key].push(post);
    return acc;
  }, {});

  console.log(`\n📊 Posts grouped by channelId (same root post):`);
  Object.entries(channelGroups)
    .slice(0, 3)
    .forEach(([channelId, posts]) => {
      console.log(`  Channel "${channelId}": ${posts.length} posts`);
    });

  await prisma.$disconnect();
}

checkStructure().catch(console.error);
