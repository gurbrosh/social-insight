#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { ensureRecipeScheduleHorizon } from "../lib/orchestration-recipe-service";

const prisma = new PrismaClient();

async function main() {
  // Get the active recipe
  const activeRecipe = await prisma.orchestrationRecipe.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
    },
  });

  if (!activeRecipe) {
    console.log("❌ No active recipe found");
    return;
  }

  console.log(`📅 Regenerating schedule horizon for recipe: ${activeRecipe.name}`);
  console.log(`🕐 Timezone: ${activeRecipe.timezone}`);
  console.log(`⏰ Reference time: ${new Date().toISOString()}\n`);

  // Regenerate the schedule horizon
  await ensureRecipeScheduleHorizon(activeRecipe.id, new Date());

  console.log("✅ Schedule horizon regenerated!\n");

  // Check the results
  const steps = await prisma.orchestrationRecipeStep.findMany({
    where: {
      recipe_id: activeRecipe.id,
      deleted_at: null,
    },
    include: {
      orchestration: true,
    },
    orderBy: { sequence: "asc" },
  });

  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  console.log("📊 Pending tasks within 7-day horizon:\n");

  for (const step of steps) {
    const pendingTasks = await prisma.orchestrationTimerTask.findMany({
      where: {
        recipe_step_id: step.id,
        deleted_at: null,
        status: "PENDING",
        scheduled_at: {
          gte: now,
          lte: horizon,
        },
      },
      orderBy: { scheduled_at: "asc" },
      take: 3,
    });

    if (pendingTasks.length > 0) {
      console.log(`Step ${step.sequence} - ${step.orchestration.name}:`);
      pendingTasks.forEach((task) => {
        const pstTime = task.scheduled_at.toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        console.log(`   ${task.task_type}: ${pstTime} PST`);
      });
      console.log();
    } else {
      console.log(
        `Step ${step.sequence} - ${step.orchestration.name}: No pending tasks in horizon\n`
      );
    }
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
