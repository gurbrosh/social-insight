#!/usr/bin/env npx tsx
/**
 * Check if a post has replies and how they're linked
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const postUrl = process.argv[2];
  if (!postUrl) {
    console.error("Usage: npx tsx scripts/check-post-replies.ts <postUrl>");
    process.exit(1);
  }

  const activityMatch = postUrl.match(/activity:(\d+)/);
  const activityId = activityMatch ? activityMatch[1] : null;

  console.log(`\n🔍 Checking replies for post: ${postUrl}\n`);

  // Find the post
  const post = await prisma.post.findFirst({
    where: {
      OR: [
        { url: { contains: postUrl.split("?")[0] } },
        { url: { contains: activityId || "" } },
        ...(activityId ? [{ postId: { contains: activityId } }] : []),
      ],
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      url: true,
      authorName: true,
      content: true,
      platform: true,
      project_id: true,
    },
  });

  if (!post) {
    console.log(`❌ Post not found`);
    await prisma.$disconnect();
    return;
  }

  console.log(`✅ Found post:`);
  console.log(`   Post ID (database): ${post.id}`);
  console.log(`   Post ID (platform): ${post.postId}`);
  console.log(`   ThreadRefId: ${post.threadRefId || "null (root post)"}`);
  console.log(`   Author: ${post.authorName}`);
  console.log(`   URL: ${post.url}`);
  console.log(`   Project ID: ${post.project_id}\n`);

  // Check for replies using different methods
  console.log(`🔍 Checking for replies...\n`);

  // Method 1: Replies that reference this post's database ID
  const repliesByDbId = await prisma.post.findMany({
    where: {
      project_id: post.project_id,
      threadRefId: post.id.toString(),
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorName: true,
      content: true,
      url: true,
    },
  });

  console.log(`1. Replies with threadRefId = post.id (${post.id}): ${repliesByDbId.length}`);
  repliesByDbId.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.authorName}: ${(r.content || "").substring(0, 100)}...`);
    console.log(`      Post ID: ${r.postId}, ThreadRefId: ${r.threadRefId}`);
  });

  // Method 2: Replies that reference this post's platform postId
  const repliesByPostId = await prisma.post.findMany({
    where: {
      project_id: post.project_id,
      threadRefId: post.postId,
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorName: true,
      content: true,
      url: true,
    },
  });

  console.log(
    `\n2. Replies with threadRefId = post.postId (${post.postId}): ${repliesByPostId.length}`
  );
  repliesByPostId.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.authorName}: ${(r.content || "").substring(0, 100)}...`);
    console.log(`      Post ID: ${r.postId}, ThreadRefId: ${r.threadRefId}`);
  });

  // Method 3: Check DownstreamPost for replies
  const downstreamPost = await prisma.downstreamPost.findFirst({
    where: {
      project_id: post.project_id,
      OR: [{ url: { contains: postUrl.split("?")[0] } }, { postId: post.postId }],
    },
  });

  if (downstreamPost) {
    const downstreamReplies = await prisma.downstreamPost.findMany({
      where: {
        project_id: post.project_id,
        threadRefId: downstreamPost.id.toString(),
      },
      select: {
        id: true,
        postId: true,
        threadRefId: true,
        authorName: true,
        content: true,
        url: true,
      },
    });

    console.log(
      `\n3. Replies in DownstreamPost (threadRefId = downstreamPost.id): ${downstreamReplies.length}`
    );
    downstreamReplies.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.authorName}: ${(r.content || "").substring(0, 100)}...`);
      console.log(`      Post ID: ${r.postId}, ThreadRefId: ${r.threadRefId}`);
    });
  }

  // Method 4: Check all posts in project with similar URLs (might be comments)
  if (activityId) {
    const relatedPosts = await prisma.post.findMany({
      where: {
        project_id: post.project_id,
        platform: post.platform,
        url: { contains: activityId },
      },
      select: {
        id: true,
        postId: true,
        threadRefId: true,
        authorName: true,
        content: true,
        url: true,
      },
    });

    console.log(
      `\n4. All posts in project with same activity ID (${activityId}): ${relatedPosts.length}`
    );
    relatedPosts.forEach((r, i) => {
      const isRoot = !r.threadRefId;
      console.log(
        `   ${i + 1}. ${isRoot ? "ROOT" : "REPLY"} - ${r.authorName}: ${(r.content || "").substring(0, 100)}...`
      );
      console.log(`      Post ID: ${r.postId}, ThreadRefId: ${r.threadRefId || "null"}`);
      console.log(`      URL: ${r.url}`);
    });
  }

  // Summary
  const allReplies = [...new Set([...repliesByDbId, ...repliesByPostId].map((r) => r.id))];
  const participants = new Set(
    [
      post.authorName,
      ...repliesByDbId.map((r) => r.authorName),
      ...repliesByPostId.map((r) => r.authorName),
    ].filter(Boolean)
  );

  console.log(`\n📊 Summary:`);
  console.log(`   Total unique replies found: ${allReplies.length}`);
  console.log(`   Total participants: ${participants.size}`);
  console.log(`   Participants: ${Array.from(participants).join(", ")}`);

  if (allReplies.length === 0) {
    console.log(`\n   ⚠️  No replies found in database. Possible reasons:`);
    console.log(`      - Reply wasn't scraped`);
    console.log(`      - Reply was scraped but threadRefId wasn't set correctly`);
    console.log(`      - Reply is in DownstreamPost but not processed to Post table yet`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
