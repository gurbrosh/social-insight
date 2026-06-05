#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { getPendingTimerTasks } from "../lib/orchestration-recipe-service";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  console.log(`⏰ Current time: ${now.toISOString()}\n`);

  const pendingTasks = await getPendingTimerTasks(20);

  console.log(`📋 Pending Timer Tasks: ${pendingTasks.length}\n`);

  if (pendingTasks.length === 0) {
    console.log("⚠️  No pending tasks found!");
    console.log("\nChecking all PENDING tasks in database...\n");

    const allPending = await prisma.orchestrationTimerTask.findMany({
      where: {
        status: "PENDING",
        deleted_at: null,
      },
      include: {
        recipeStep: {
          include: {
            orchestration: true,
            recipe: true,
          },
        },
      },
      orderBy: { scheduled_at: "asc" },
      take: 10,
    });

    console.log(`Total PENDING tasks in DB: ${allPending.length}`);
    allPending.forEach((task) => {
      const pstTime = task.scheduled_at.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const isPast = task.scheduled_at <= now;
      console.log(
        `  ${isPast ? "⏰ PAST" : "⏳ FUTURE"} - ${task.task_type} - ${pstTime} PST - ${task.recipeStep?.orchestration?.name || "Unknown"}`
      );
    });
  } else {
    pendingTasks.forEach((task, idx) => {
      const pstTime = task.scheduled_at.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      console.log(`${idx + 1}. ${task.task_type} - ${pstTime} PST - Step ${task.recipe_step_id}`);
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
