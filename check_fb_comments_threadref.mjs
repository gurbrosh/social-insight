import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkThreadRefs() {
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
      authorName: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  console.log(`📊 Facebook posts (sample of ${fbPosts.length}):`);
  const roots = fbPosts.filter((p) => !p.threadRefId);
  const comments = fbPosts.filter((p) => p.threadRefId);

  console.log(`  Root posts: ${roots.length}`);
  console.log(`  Comments/replies: ${comments.length}`);

  if (roots.length > 0) {
    console.log(`\n  Sample root posts:`);
    roots.slice(0, 3).forEach((p) => {
      console.log(`    Root ${p.id}: postId=${p.postId}, author=${p.authorName || "null"}`);
    });
  }

  if (comments.length > 0) {
    console.log(`\n  Sample comments:`);
    comments.slice(0, 5).forEach((p) => {
      console.log(
        `    Comment ${p.id}: postId=${p.postId}, threadRefId=${p.threadRefId}, author=${p.authorName || "null"}`
      );
    });

    // Check if threadRefIds match any root postIds
    const rootPostIds = new Set(roots.map((r) => r.postId));
    const linkedComments = comments.filter((c) => rootPostIds.has(c.threadRefId || ""));
    console.log(`\n  Comments linked to root posts: ${linkedComments.length}/${comments.length}`);

    // Check unique threadRefIds
    const uniqueThreadRefIds = new Set(comments.map((c) => c.threadRefId).filter(Boolean));
    console.log(`  Unique threadRefIds: ${uniqueThreadRefIds.size}`);
    console.log(
      `  ThreadRefIds that match root postIds: ${Array.from(uniqueThreadRefIds).filter((id) => rootPostIds.has(id || "")).length}`
    );
  } else {
    console.log(`\n  ❌ NO COMMENTS FOUND - This is the problem!`);
  }

  await prisma.$disconnect();
}

checkThreadRefs().catch(console.error);
