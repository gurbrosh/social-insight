#!/usr/bin/env tsx

import { prisma } from "../lib/prisma";

async function main() {
  console.log("Deleting Twitter DownstreamPost records...\n");

  const before = await prisma.downstreamPost.count({
    where: {
      platform: { in: ["X", "x", "twitter"] },
    },
  });

  console.log(`Current Twitter DownstreamPost records: ${before}`);

  const result = await prisma.downstreamPost.deleteMany({
    where: {
      platform: { in: ["X", "x", "twitter"] },
    },
  });

  console.log(`✅ Deleted ${result.count} Twitter DownstreamPost records`);

  const after = await prisma.downstreamPost.count({
    where: {
      platform: { in: ["X", "x", "twitter"] },
    },
  });

  console.log(`Remaining Twitter DownstreamPost records: ${after}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error deleting Twitter DownstreamPost records:", error);
  process.exit(1);
});
