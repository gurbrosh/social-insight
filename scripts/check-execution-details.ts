#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const latest = await prisma.orchestrationExecution.findFirst({
    where: { deleted_at: null },
    orderBy: { created_at: "desc" },
    include: {
      orchestration: true,
      thread_executions: {
        include: {
          step_executions: {
            orderBy: { step_sequence: "asc" },
          },
        },
      },
    },
  });

  if (!latest) {
    console.log("❌ No executions found");
    return;
  }

  console.log(`📊 Latest Execution: ${latest.orchestration.name}`);
  console.log(`   Status: ${latest.status}`);
  console.log(`   Created: ${latest.created_at.toISOString()}\n`);

  for (const thread of latest.thread_executions) {
    console.log(`📋 Thread: ${thread.thread_name}`);
    console.log(`   Status: ${thread.status}`);
    if (thread.error_message) {
      console.log(`   Error: ${thread.error_message}`);
    }
    console.log();

    for (const step of thread.step_executions) {
      console.log(`   Step ${step.step_sequence}: ${step.scraper_name}`);
      console.log(`      Status: ${step.status}`);
      if (step.error_message) {
        console.log(`      Error: ${step.error_message}`);
      }
      if (step.scrape_job_id) {
        const job = await prisma.scrapeJob.findUnique({
          where: { id: step.scrape_job_id },
        });
        if (job) {
          console.log(`      Job ID: ${job.id}`);
          console.log(`      Job Status: ${job.status}`);
          console.log(`      Apify Run ID: ${job.apify_run_id || "N/A"}`);
        }
      } else {
        console.log(`      ⚠️  No scrape job ID linked`);
      }
      console.log();
    }
  }

  // Check for ScrapeJobs created around the same time
  const jobsAroundExecution = await prisma.scrapeJob.findMany({
    where: {
      created_at: {
        gte: new Date(latest.created_at.getTime() - 5 * 60 * 1000), // 5 minutes before
        lte: new Date(latest.created_at.getTime() + 30 * 60 * 1000), // 30 minutes after
      },
      deleted_at: null,
    },
    include: {
      scraper: true,
    },
    orderBy: { created_at: "desc" },
    take: 10,
  });

  console.log(`\n🔍 ScrapeJobs created around execution time: ${jobsAroundExecution.length}`);
  jobsAroundExecution.forEach((job) => {
    console.log(`   - ${job.scraper.name}: ${job.status} (${job.apify_run_id || "no run ID"})`);
  });
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
