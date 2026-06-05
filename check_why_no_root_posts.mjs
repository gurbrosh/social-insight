import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkWhyNoRootPosts() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Get a comment with threadRefId
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
      url: true,
      extraJson: true,
    },
  });

  if (!comment) {
    console.log("No comments found");
    await prisma.$disconnect();
    return;
  }

  console.log(`Sample comment:`);
  console.log(`  postId: ${comment.postId}`);
  console.log(`  threadRefId: ${comment.threadRefId}`);
  console.log(`  url: ${comment.url || "null"}`);
  const extra = comment.extraJson || {};
  console.log(
    `  extraJson.postTitle: ${extra.postTitle ? extra.postTitle.substring(0, 50) + "..." : "null"}`
  );
  console.log(`  extraJson.facebookUrl: ${extra.facebookUrl || "null"}`);

  // Check if root post exists
  const rootPost = await prisma.post.findUnique({
    where: {
      project_id_platform_postId: {
        project_id: projectId,
        platform: "facebook",
        postId: comment.threadRefId || "",
      },
    },
  });

  if (!rootPost) {
    console.log(`\n❌ Root post does NOT exist with postId=${comment.threadRefId}`);
    console.log(`   This is why threads can't be constructed!`);
  } else {
    console.log(`\n✅ Root post exists`);
  }

  await prisma.$disconnect();
}

checkWhyNoRootPosts().catch(console.error);
