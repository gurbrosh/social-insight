import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkRootPosts() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  // Check all Facebook posts
  const fbPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      content: true,
      extraJson: true,
    },
    orderBy: { id: "desc" },
  });

  const roots = fbPosts.filter((p) => !p.threadRefId);
  const comments = fbPosts.filter((p) => p.threadRefId);

  console.log(`📊 Facebook posts:`);
  console.log(`  Total: ${fbPosts.length}`);
  console.log(`  Root posts: ${roots.length}`);
  console.log(`  Comments: ${comments.length}`);

  if (roots.length > 0) {
    console.log(`\n  Root posts:`);
    roots.forEach((r) => {
      const extra = r.extraJson || {};
      console.log(
        `    Root ${r.id}: postId=${r.postId?.substring(0, 40)}..., content=${r.content?.substring(0, 50) || "null"}..., facebookUrl=${extra.facebookUrl?.substring(0, 50) || "null"}...`
      );
    });
  }

  if (comments.length > 0) {
    const uniqueThreadRefIds = new Set(comments.map((c) => c.threadRefId).filter(Boolean));
    console.log(`\n  Unique threadRefIds in comments: ${uniqueThreadRefIds.size}`);
    console.log(`  Sample threadRefIds:`);
    Array.from(uniqueThreadRefIds)
      .slice(0, 3)
      .forEach((id) => {
        console.log(`    ${id}`);

        // Check if any root post has this postId
        const matchingRoot = roots.find((r) => r.postId === id);
        if (matchingRoot) {
          console.log(`      ✅ Matches root post ${matchingRoot.id}`);
        } else {
          console.log(`      ❌ No matching root post found`);
        }
      });
  }

  await prisma.$disconnect();
}

checkRootPosts().catch(console.error);
