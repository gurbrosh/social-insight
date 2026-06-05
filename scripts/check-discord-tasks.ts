#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkStep(stepName: string) {
  // Get the step by checking orchestration name
  const steps = await prisma.orchestrationRecipeStep.findMany({
    where: {
      deleted_at: null,
    },
    include: {
      recipe: true,
      orchestration: true,
    },
  });

  const step = steps.find((s) =>
    s.orchestration.name.toLowerCase().includes(stepName.toLowerCase())
  );

  if (!step) {
    console.log(`❌ ${stepName} step not found`);
    return;
  }

  console.log(`\n📋 ${stepName} Step Configuration:`);
  console.log(`   Step ID: ${step.id}`);
  console.log(`   Sequence: ${step.sequence}`);
  console.log(`   Orchestration: ${step.orchestration.name}`);
  console.log(`   Hourly Interval: ${step.hourly_interval || "Disabled"}`);
  console.log(`   Daily Interval: ${step.daily_interval || "Disabled"}`);
  console.log(`   Initial Enabled: ${step.initial_enabled}`);
  console.log(`   Initial Run Type: ${step.initial_run_type}`);

  // Check all timer tasks for this step
  const allTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipe_step_id: step.id,
      deleted_at: null,
    },
    orderBy: { scheduled_at: "asc" },
  });

  console.log(`\n📊 Timer Tasks for ${stepName} Step: ${allTasks.length} total`);

  if (allTasks.length === 0) {
    console.log(`⚠️  No timer tasks found for ${stepName} step!`);
    console.log(`   This means tasks haven't been generated yet.\n`);
  } else {
    const now = new Date();
    const pendingTasks = allTasks.filter((t) => t.status === "PENDING" && t.scheduled_at >= now);
    const pastTasks = allTasks.filter((t) => t.scheduled_at < now);
    const executedTasks = allTasks.filter((t) => t.status === "EXECUTED");

    console.log(`   PENDING (future): ${pendingTasks.length}`);
    console.log(`   EXECUTED: ${executedTasks.length}`);
    console.log(`   Past/Other: ${pastTasks.length}`);

    if (pendingTasks.length > 0) {
      console.log(`\n⏰ Next 5 PENDING Tasks:`);
      pendingTasks.slice(0, 5).forEach((task, idx) => {
        const pstTime = task.scheduled_at.toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        console.log(`   ${idx + 1}. ${task.task_type} - ${pstTime} PST (${task.status})`);
      });
    } else {
      console.log(`\n⚠️  No pending future tasks found for ${stepName}!`);
    }

    if (executedTasks.length > 0) {
      const lastExecuted = executedTasks[executedTasks.length - 1];
      const pstTime = lastExecuted.scheduled_at.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      console.log(`\n✅ Last Executed: ${pstTime} PST`);
    }
  }
}

async function main() {
  await checkStep("Discord");
  await checkStep("Twitter");

  // Check recipe status
  const recipe = await prisma.orchestrationRecipe.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
    },
  });

  if (recipe) {
    console.log(`\n📅 Recipe Status:`);
    console.log(`   Recipe: ${recipe.name}`);
    console.log(`   Active: ${recipe.is_active}`);
    console.log(`   Timezone: ${recipe.timezone}`);
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
