import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkFacebook() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Check Facebook posts
  const fbPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorId: true,
      authorName: true,
      content: true,
      metricsComments: true,
    },
    take: 20,
  });

  console.log(`📊 Facebook posts (sample of ${fbPosts.length}):`);
  fbPosts.forEach((p) => {
    const isRoot = !p.threadRefId;
    console.log(`  ${isRoot ? "ROOT" : "REPLY"} Post ${p.id} (postId: ${p.postId}):`);
    console.log(`    threadRefId: ${p.threadRefId || "null"}`);
    console.log(`    authorId: ${p.authorId || "null"}, authorName: ${p.authorName || "null"}`);
    console.log(`    comments: ${p.metricsComments || 0}`);
  });

  // Count roots vs replies
  const roots = fbPosts.filter((p) => !p.threadRefId);
  const replies = fbPosts.filter((p) => p.threadRefId);
  console.log(`\n📊 Sample summary: ${roots.length} root posts, ${replies.length} replies`);

  // Check if any threads have replies
  const rootIds = roots.map((r) => r.postId);
  const threadsWithReplies = replies.filter((r) => rootIds.includes(r.threadRefId || ""));
  console.log(
    `📊 Threads with replies: ${new Set(threadsWithReplies.map((r) => r.threadRefId)).size} unique threads`
  );

  // Check all Facebook posts
  const allFbRoots = await prisma.post.count({
    where: { project_id: projectId, platform: "facebook", threadRefId: null },
  });
  const allFbReplies = await prisma.post.count({
    where: { project_id: projectId, platform: "facebook", threadRefId: { not: null } },
  });
  console.log(`\n📊 Total Facebook posts: ${allFbRoots} roots, ${allFbReplies} replies`);

  await prisma.$disconnect();
}

checkFacebook().catch(console.error);
