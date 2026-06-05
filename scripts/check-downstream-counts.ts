#!/usr/bin/env ts-node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("📊 DownstreamPost Table Statistics\n");

  // Total counts (DownstreamPost doesn't have deleted_at - it uses hard deletes)
  const total = await prisma.downstreamPost.count();

  // Count by status
  const pending = await prisma.downstreamPost.count({
    where: { status: "PENDING" },
  });

  const processing = await prisma.downstreamPost.count({
    where: { status: "PROCESSING" },
  });

  const processed = await prisma.downstreamPost.count({
    where: { status: "PROCESSED" },
  });

  const failed = await prisma.downstreamPost.count({
    where: { status: "FAILED" },
  });

  // Count by origin
  const searchResult = await prisma.downstreamPost.count({
    where: { origin: "SEARCH_RESULT" },
  });

  const conversation = await prisma.downstreamPost.count({
    where: { origin: "CONVERSATION" },
  });

  // Count by platform
  const platforms = await prisma.downstreamPost.groupBy({
    by: ["platform"],
    _count: true,
  });

  // Count by scraper
  const scrapers = await prisma.downstreamPost.groupBy({
    by: ["origScraper"],
    _count: true,
    orderBy: { _count: { origScraper: "desc" } },
  });

  // Count with orchestration_execution_id
  const withExecutionId = await prisma.downstreamPost.count({
    where: {
      orchestration_execution_id: { not: null },
    },
  });

  console.log("📈 Overall Statistics:");
  console.log(`  Total records: ${total}`);
  console.log(`  With orchestration_execution_id: ${withExecutionId}\n`);

  console.log("📋 By Status:");
  console.log(`  PENDING: ${pending}`);
  console.log(`  PROCESSING: ${processing}`);
  console.log(`  PROCESSED: ${processed}`);
  console.log(`  FAILED: ${failed}\n`);

  console.log("🔍 By Origin:");
  console.log(`  SEARCH_RESULT: ${searchResult}`);
  console.log(`  CONVERSATION: ${conversation}\n`);

  console.log("🌐 By Platform:");
  platforms.forEach((p) => {
    console.log(`  ${p.platform}: ${p._count}`);
  });
  console.log();

  console.log("🤖 By Scraper (top 10):");
  scrapers.slice(0, 10).forEach((s) => {
    console.log(`  ${s.origScraper}: ${s._count}`);
  });
  if (scrapers.length > 10) {
    console.log(`  ... and ${scrapers.length - 10} more scrapers`);
  }
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
