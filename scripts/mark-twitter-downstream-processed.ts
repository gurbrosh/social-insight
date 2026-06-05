#!/usr/bin/env tsx

import { prisma } from "../lib/prisma";

async function main() {
  console.log("Marking Twitter DownstreamPost records as PROCESSED...\n");

  const result = await prisma.downstreamPost.updateMany({
    where: {
      platform: { in: ["X", "x", "twitter"] },
    },
    data: {
      status: "PROCESSED",
      processed_at: new Date(),
    },
  });

  console.log(`✅ Updated ${result.count} Twitter DownstreamPost records to PROCESSED`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error marking Twitter DownstreamPost records as PROCESSED:", error);
  process.exit(1);
});
