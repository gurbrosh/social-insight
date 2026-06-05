/**
 * Check why a specific Post (by postId) did or didn't make it into News.
 * Usage: npx tsx scripts/check-news-eligibility.ts <postId> [projectId]
 * Example: npx tsx scripts/check-news-eligibility.ts "0532ea0499dd402e1012f8a3--idea-1"
 *
 * If projectId is omitted, the script finds the post by postId (platform=blogs) and uses its project_id.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const postId = process.argv[2];
  const projectIdArg = process.argv[3];

  if (!postId) {
    console.error("Usage: npx tsx scripts/check-news-eligibility.ts <postId> [projectId]");
    process.exit(1);
  }

  const post = await prisma.post.findFirst({
    where: {
      postId,
      platform: "blogs",
      ...(projectIdArg ? { project_id: projectIdArg } : {}),
    },
    select: {
      id: true,
      postId: true,
      project_id: true,
      createdAt: true,
      content: true,
    },
  });

  if (!post) {
    console.error(`No Post found with postId="${postId}" and platform=blogs.`);
    process.exit(1);
  }

  const projectId = post.project_id;
  if (!projectId) {
    console.error("Post has no project_id.");
    process.exit(1);
  }

  const progress = await prisma.analysisProgress.findUnique({
    where: { project_id: projectId },
    select: { last_news_post_id: true },
  });

  const lastNewsPostId = progress?.last_news_post_id ?? 0;

  const maxPostIdRow = await prisma.post.findFirst({
    where: { project_id: projectId },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  const maxPostId = maxPostIdRow?.id ?? 0;

  console.log("\n--- Post ---");
  console.log("  id:", post.id);
  console.log("  postId:", post.postId);
  console.log("  project_id:", projectId);
  console.log("  createdAt:", post.createdAt);
  console.log("  content (first 100 chars):", (post.content ?? "").slice(0, 100) + "...");

  console.log("\n--- AnalysisProgress (News cursor) ---");
  console.log("  last_news_post_id:", lastNewsPostId);

  console.log("\n--- Eligibility ---");

  const excludedByRange = post.id <= lastNewsPostId;
  console.log(
    "  (2) Excluded by id range (id <= last_news_post_id)?",
    excludedByRange ? "YES" : "NO",
    excludedByRange ? `  (post id ${post.id} <= ${lastNewsPostId})` : ""
  );

  if (excludedByRange) {
    console.log("\n  => This post was behind the News cursor and was never considered for News.");
    return;
  }

  const inRangeCount = await prisma.post.count({
    where: {
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
      id: { gt: lastNewsPostId, lte: maxPostId },
    },
  });

  const newerByCreatedAtCount = await prisma.post.count({
    where: {
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
      id: { gt: lastNewsPostId, lte: maxPostId },
      createdAt: { gte: post.createdAt },
    },
  });

  const excludedBy500 = newerByCreatedAtCount > 500;
  console.log(
    "  (1) Excluded by 500-post cap (not in top 500 by createdAt)?",
    excludedBy500 ? "YES" : "NO",
    excludedBy500
      ? `  (${newerByCreatedAtCount} posts in range have createdAt >= this post; only 500 are sent to News)`
      : `  (this post is in the top ${newerByCreatedAtCount} by createdAt within ${inRangeCount} posts in range)`
  );

  if (excludedBy500) {
    console.log(
      "\n  => This post was in the id range but older than the 500 newest posts, so it was not sent to News."
    );
  } else {
    console.log(
      "\n  => This post was in range and within the 500; something else (e.g. platform cap or LLM) prevented it from becoming a News item."
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
