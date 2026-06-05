import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkRootPostCreation() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Get a sample comment with threadRefId
  const comment = await prisma.post.findFirst({
    where: {
      project_id: projectId,
      platform: "facebook",
      threadRefId: { not: null },
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      extraJson: true,
    },
  });

  if (!comment) {
    console.log("No comments with threadRefId found");
    await prisma.$disconnect();
    return;
  }

  console.log(`Sample comment:`);
  console.log(`  Comment postId: ${comment.postId}`);
  console.log(`  Comment threadRefId: ${comment.threadRefId}`);

  // Check if root post exists with threadRefId as postId
  const rootPost = await prisma.post.findUnique({
    where: {
      project_id_platform_postId: {
        project_id: projectId,
        platform: "facebook",
        postId: comment.threadRefId || "",
      },
    },
    select: {
      id: true,
      postId: true,
      content: true,
      extraJson: true,
    },
  });

  if (rootPost) {
    console.log(`\n✅ Root post found with matching postId:`);
    console.log(`  Root post postId: ${rootPost.postId}`);
    console.log(`  Root post content: ${rootPost.content?.substring(0, 50) || "null"}...`);
  } else {
    console.log(`\n❌ Root post NOT found with postId=${comment.threadRefId}`);
    console.log(`  This is why threads cannot be constructed correctly!`);
  }

  await prisma.$disconnect();
}

checkRootPostCreation().catch(console.error);
