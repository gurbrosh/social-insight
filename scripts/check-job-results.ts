#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Get the latest execution
  const latest = await prisma.orchestrationExecution.findFirst({
    where: { deleted_at: null },
    orderBy: { created_at: "desc" },
  });

  if (!latest) {
    console.log("❌ No executions found");
    return;
  }

  // Get ScrapeJobs created around that time
  const jobs = await prisma.scrapeJob.findMany({
    where: {
      created_at: {
        gte: new Date(latest.created_at.getTime() - 5 * 60 * 1000),
        lte: new Date(latest.created_at.getTime() + 30 * 60 * 1000),
      },
      deleted_at: null,
    },
    include: {
      scraper: true,
    },
    orderBy: { created_at: "desc" },
  });

  console.log(`📊 ScrapeJobs from latest execution: ${jobs.length}\n`);

  if (jobs.length === 0) {
    console.log("❌ No scrape jobs found!");
    return;
  }

  jobs.forEach((job, idx) => {
    const pstTime = job.created_at.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(`${idx + 1}. ${job.scraper.name}`);
    console.log(`   Status: ${job.status}`);
    console.log(`   Created: ${pstTime} PST`);
    console.log(`   Apify Run ID: ${job.apify_run_id || "N/A"}`);
    console.log(`   Posts Count: ${job.posts_count}`);
    console.log(`   Discarded: ${job.discarded_count}`);
    console.log();
  });

  // Check if posts were actually collected
  const totalPosts = jobs.reduce((sum, job) => sum + job.posts_count, 0);
  console.log(`\n📈 Total posts collected: ${totalPosts}`);

  if (totalPosts === 0) {
    console.log("\n⚠️  WARNING: No posts were collected from any scraper!");
    console.log("   This suggests the scrapers ran but didn't find/collect any data.");
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
