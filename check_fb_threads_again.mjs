import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkThreads() {
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
    },
    orderBy: { id: "desc" },
    take: 50,
  });

  const roots = fbPosts.filter((p) => !p.threadRefId);
  const comments = fbPosts.filter((p) => p.threadRefId);

  console.log(`📊 Facebook posts (sample of ${fbPosts.length}):`);
  console.log(`  Root posts: ${roots.length}`);
  console.log(`  Comments/replies: ${comments.length}`);

  if (comments.length > 0) {
    console.log(`\n  Sample comments with threadRefId:`);
    comments.slice(0, 5).forEach((p) => {
      console.log(
        `    Comment ${p.id}: postId=${p.postId?.substring(0, 30)}..., threadRefId=${p.threadRefId?.substring(0, 30)}...`
      );
    });

    // Check if threadRefIds match any root postIds
    const rootPostIds = new Set(roots.map((r) => r.postId));
    const linkedComments = comments.filter((c) => rootPostIds.has(c.threadRefId || ""));
    console.log(`\n  Comments linked to root posts: ${linkedComments.length}/${comments.length}`);

    if (linkedComments.length === 0) {
      console.log(`\n  ❌ PROBLEM: No comments are linked to root posts!`);
      console.log(`  Sample root postIds:`, Array.from(rootPostIds).slice(0, 3));
      console.log(
        `  Sample comment threadRefIds:`,
        Array.from(new Set(comments.map((c) => c.threadRefId).filter(Boolean))).slice(0, 3)
      );
    }
  } else {
    console.log(`\n  ❌ PROBLEM: No comments found (all posts are root posts)!`);
  }

  await prisma.$disconnect();
}

checkThreads().catch(console.error);
