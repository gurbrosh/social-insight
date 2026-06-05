import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkSentiment() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Check Facebook posts with sentiment
  const fbPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
    },
    select: {
      id: true,
      postId: true,
      sentiment: true,
      threadRefId: true,
    },
    orderBy: { id: "desc" },
    take: 20,
  });

  const withSentiment = fbPosts.filter((p) => p.sentiment !== null);
  const withoutSentiment = fbPosts.filter((p) => p.sentiment === null);
  const rootPosts = fbPosts.filter((p) => !p.threadRefId);
  const comments = fbPosts.filter((p) => p.threadRefId);

  console.log(`📊 Facebook posts (sample of ${fbPosts.length}):`);
  console.log(`  Total: ${fbPosts.length}`);
  console.log(`  With sentiment: ${withSentiment.length}`);
  console.log(`  Without sentiment: ${withoutSentiment.length}`);
  console.log(`  Root posts: ${rootPosts.length}`);
  console.log(`  Comments: ${comments.length}`);

  if (rootPosts.length > 0) {
    const rootsWithSentiment = rootPosts.filter((p) => p.sentiment !== null);
    console.log(`\n  Root posts with sentiment: ${rootsWithSentiment.length}/${rootPosts.length}`);
    if (rootsWithSentiment.length > 0) {
      console.log(`  Sample root posts with sentiment:`);
      rootsWithSentiment.slice(0, 3).forEach((p) => {
        console.log(
          `    Root ${p.id}: postId=${p.postId?.substring(0, 30)}..., sentiment=${p.sentiment}`
        );
      });
    }
  }

  if (comments.length > 0) {
    const commentsWithSentiment = comments.filter((p) => p.sentiment !== null);
    console.log(`\n  Comments with sentiment: ${commentsWithSentiment.length}/${comments.length}`);
    if (commentsWithSentiment.length > 0) {
      console.log(`  Sample comments with sentiment:`);
      commentsWithSentiment.slice(0, 3).forEach((p) => {
        console.log(
          `    Comment ${p.id}: postId=${p.postId?.substring(0, 30)}..., sentiment=${p.sentiment}, threadRefId=${p.threadRefId?.substring(0, 30)}...`
        );
      });
    }
  }

  await prisma.$disconnect();
}

checkSentiment().catch(console.error);
