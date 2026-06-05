#!/usr/bin/env tsx

import { prisma } from "../lib/prisma";

async function main() {
  console.log("🔧 Fixing malformed Twitter/X threadRefId values (threadRefId = postId)...");

  const affectedBefore = await prisma.post.count({
    where: {
      platform: { in: ["x", "X", "twitter"] },
      threadRefId: { not: null },
    },
  });

  console.log(`Found ${affectedBefore} Twitter/X posts with self-referential threadRefId.`);

  if (affectedBefore === 0) {
    console.log("✅ No malformed Twitter/X threadRefId values found. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Prisma does not support direct "field equals field" comparison in a portable way,
  // so we perform the update in two steps:
  // 1. Fetch the IDs of affected posts.
  // 2. Update them by ID, setting threadRefId to null.

  const badPosts = await prisma.post.findMany({
    where: {
      platform: { in: ["x", "X", "twitter"] },
      threadRefId: { not: null },
    },
    select: { id: true, postId: true, threadRefId: true },
  });

  const toFix = badPosts.filter((p) => p.threadRefId === p.postId);

  console.log(`Will fix ${toFix.length} posts where threadRefId === postId.`);

  if (toFix.length === 0) {
    console.log("✅ After filtering, no posts require updates.");
    await prisma.$disconnect();
    return;
  }

  const batchSize = 500;
  let updatedCount = 0;

  for (let i = 0; i < toFix.length; i += batchSize) {
    const batch = toFix.slice(i, i + batchSize);
    const ids = batch.map((p) => p.id);

    const result = await prisma.post.updateMany({
      where: { id: { in: ids } },
      data: { threadRefId: null },
    });

    updatedCount += result.count;
    console.log(
      `   ↳ Updated batch ${i / batchSize + 1}: ${result.count} rows (total updated so far: ${updatedCount})`
    );
  }

  console.log(
    `✅ Finished fixing Twitter/X posts. Total updated rows with threadRefId cleared: ${updatedCount}`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("❌ Error while fixing Twitter/X threadRefId values:", error);
  process.exit(1);
});
