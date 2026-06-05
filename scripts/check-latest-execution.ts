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
            include: {
              scrape_job: true,
            },
          },
        },
      },
    },
  });

  if (!latest) {
    console.log("❌ No executions found");
    return;
  }

  const pstTime = latest.created_at.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  console.log(`📊 Latest Execution:`);
  console.log(`   Orchestration: ${latest.orchestration.name}`);
  console.log(`   Status: ${latest.status}`);
  console.log(`   Started: ${pstTime} PST`);
  console.log(`   ID: ${latest.id}`);
  if (latest.error_message) {
    console.log(`   Error: ${latest.error_message}`);
  }
  console.log();

  console.log(`📋 Thread Executions: ${latest.thread_executions.length}`);
  latest.thread_executions.forEach((thread, idx) => {
    console.log(`\n   Thread ${idx + 1}: ${thread.thread_name}`);
    console.log(`      Status: ${thread.status}`);
    if (thread.error_message) {
      console.log(`      Error: ${thread.error_message}`);
    }
    console.log(`      Steps: ${thread.step_executions.length}`);
    thread.step_executions.forEach((step, sIdx) => {
      console.log(`         Step ${sIdx + 1}: ${step.scraper_name}`);
      console.log(`            Status: ${step.status}`);
      if (step.scrape_job) {
        console.log(`            Job ID: ${step.scrape_job.id}`);
        console.log(`            Job Status: ${step.scrape_job.status}`);
      } else {
        console.log(`            ⚠️  No scrape job created!`);
      }
      if (step.error_message) {
        console.log(`            Error: ${step.error_message}`);
      }
    });
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
