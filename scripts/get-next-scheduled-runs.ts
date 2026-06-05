#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { previewRecipeSchedule } from "../lib/orchestration-recipe-service";

const prisma = new PrismaClient();

async function main() {
  // Get the active recipe
  const activeRecipe = await prisma.orchestrationRecipe.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
    },
    include: {
      steps: {
        where: { deleted_at: null },
        include: {
          orchestration: true,
        },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (!activeRecipe) {
    console.log("❌ No active recipe found");
    return;
  }

  console.log(`📅 Recipe: ${activeRecipe.name}`);
  console.log(`🕐 Timezone: ${activeRecipe.timezone}\n`);

  // Get the schedule preview with extended limit to catch hourly tasks
  const scheduleData = await previewRecipeSchedule(activeRecipe.id, { limit: 100 });

  if (!scheduleData || scheduleData.runs.length === 0) {
    console.log("❌ No scheduled runs found");
    return;
  }

  // Filter to only PENDING tasks, convert to PST and sort chronologically
  const runs = scheduleData.runs
    .filter((run) => run.status === "PENDING")
    .map((run) => {
      const scheduledAt = new Date(run.scheduledAtUtc);
      // Convert to PST (UTC-8) or PDT (UTC-7) - using America/Los_Angeles
      const pstString = scheduledAt.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short",
      });

      return {
        ...run,
        scheduledAtPST: pstString,
        scheduledAtDate: scheduledAt,
      };
    })
    .sort((a, b) => a.scheduledAtDate.getTime() - b.scheduledAtDate.getTime())
    .slice(0, 10);

  // Also check if there are hourly tasks beyond the horizon
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const hourlySteps = activeRecipe.steps.filter(
    (step) => step.hourly_interval && step.hourly_interval > 0
  );

  if (hourlySteps.length > 0 && runs.length < 10) {
    console.log(
      `\n⚠️  Note: Some hourly tasks (Discord, Twitter) may be beyond the 7-day horizon.`
    );
    console.log(
      `   Current horizon ends: ${horizon.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PST\n`
    );
  }

  console.log("📋 Next 10 Scheduled Runs (PST):\n");

  if (runs.length === 0) {
    console.log("❌ No pending scheduled runs found");
    return;
  }

  runs.forEach((run, index) => {
    console.log(`${index + 1}. Step ${run.stepSequence} - ${run.orchestrationName}`);
    console.log(`   Type: ${run.taskType}`);
    console.log(`   Scheduled: ${run.scheduledAtPST}`);
    console.log();
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
