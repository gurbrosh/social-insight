#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Check recent orchestration executions
  const recentExecutions = await prisma.orchestrationExecution.findMany({
    where: {
      deleted_at: null,
    },
    include: {
      orchestration: true,
    },
    orderBy: { created_at: "desc" },
    take: 5,
  });

  console.log(`📊 Recent Orchestration Executions: ${recentExecutions.length}\n`);

  if (recentExecutions.length === 0) {
    console.log("❌ No orchestration executions found!");
    return;
  }

  recentExecutions.forEach((exec, idx) => {
    const pstTime = exec.created_at.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(`${idx + 1}. ${exec.orchestration.name}`);
    console.log(`   Status: ${exec.status}`);
    console.log(`   Started: ${pstTime} PST`);
    console.log(`   Execution ID: ${exec.id}`);
    if (exec.error_message) {
      console.log(`   Error: ${exec.error_message}`);
    }
    console.log();
  });

  // Check recent timer task executions
  const recentTimerTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      status: "EXECUTED",
      deleted_at: null,
    },
    include: {
      recipeStep: {
        include: {
          orchestration: true,
        },
      },
    },
    orderBy: { executed_at: "desc" },
    take: 5,
  });

  console.log(`\n⏰ Recent Timer Task Executions: ${recentTimerTasks.length}\n`);

  if (recentTimerTasks.length === 0) {
    console.log("⚠️  No timer tasks have been executed recently!");
  } else {
    recentTimerTasks.forEach((task, idx) => {
      const pstTime = task.executed_at?.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      console.log(
        `${idx + 1}. ${task.task_type} - ${task.recipeStep?.orchestration?.name || "Unknown"}`
      );
      console.log(`   Executed: ${pstTime || "N/A"} PST`);
    });
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
