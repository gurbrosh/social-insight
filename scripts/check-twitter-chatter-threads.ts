#!/usr/bin/env npx tsx
/**
 * Verify Twitter/X thread construction for chatter: roots in Post, replies with threadRefId
 * pointing to root postId, and that they would be grouped correctly.
 *
 * Usage: npx tsx scripts/check-twitter-chatter-threads.ts <projectId>
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: npx tsx scripts/check-twitter-chatter-threads.ts <projectId>");
    process.exit(1);
  }

  console.log(`\n🔍 Checking Twitter/X thread construction for project: ${projectId}\n`);

  const posts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: { in: ["x", "X", "twitter"] },
      content: { not: null },
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorName: true,
      content: true,
      createdAt: true,
      url: true,
    },
    orderBy: { id: "asc" },
  });

  const rootPosts = posts.filter((p) => !p.threadRefId);
  const replies = posts.filter((p) => p.threadRefId);

  console.log("📊 Summary:");
  console.log(`   Total X/Twitter posts: ${posts.length}`);
  console.log(`   Root posts (threadRefId null): ${rootPosts.length}`);
  console.log(`   Replies (threadRefId set): ${replies.length}\n`);

  const postMap = new Map(posts.map((p) => [String(p.postId), p]));

  let orphanReplies = 0;
  const threadsWithReplies: Array<{ root: (typeof posts)[0]; replyCount: number }> = [];

  for (const root of rootPosts) {
    const rootKey = String(root.postId);
    const directReplies = replies.filter(
      (r) => r.threadRefId != null && String(r.threadRefId) === rootKey
    );
    if (directReplies.length > 0) {
      threadsWithReplies.push({ root, replyCount: directReplies.length });
    }
  }

  for (const r of replies) {
    const refKey = r.threadRefId != null ? String(r.threadRefId) : null;
    if (!refKey || !postMap.has(refKey)) {
      orphanReplies++;
      if (orphanReplies <= 5) {
        console.log(
          `   ⚠️ Orphan reply: postId=${r.postId}, threadRefId=${r.threadRefId} (no matching root in Post table)`
        );
      }
    }
  }

  if (orphanReplies > 5) {
    console.log(`   ... and ${orphanReplies - 5} more orphan replies.\n`);
  } else if (orphanReplies > 0) {
    console.log("");
  }

  console.log(`✅ Threads with ≥1 reply (would qualify for chatter): ${threadsWithReplies.length}`);
  console.log(`⚠️ Orphan replies (threadRefId not found in Post): ${orphanReplies}\n`);

  if (threadsWithReplies.length > 0) {
    console.log("Sample threads (root + reply count):");
    threadsWithReplies
      .sort((a, b) => b.replyCount - a.replyCount)
      .slice(0, 10)
      .forEach((t, i) => {
        console.log(
          `   ${i + 1}. root postId=${t.root.postId}, replies=${t.replyCount} (${t.root.authorName || "?"})`
        );
      });
  }

  if (
    rootPosts.length > 0 &&
    replies.length > 0 &&
    threadsWithReplies.length === 0 &&
    orphanReplies === replies.length
  ) {
    console.log(
      "\n💡 Likely cause: reply threadRefId does not match root postId (e.g. type mismatch or different ID source)."
    );
    console.log(
      "   Root postIds (first 3):",
      rootPosts.slice(0, 3).map((p) => `${p.postId} (${typeof p.postId})`)
    );
    console.log(
      "   Reply threadRefIds (first 3):",
      replies.slice(0, 3).map((r) => `${r.threadRefId} (${typeof r.threadRefId})`)
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
