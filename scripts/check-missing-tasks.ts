#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Check tasks that should have run after 7:50 PM PST on Nov 19
  const restartTime = new Date("2025-11-20T03:50:00Z"); // 7:50 PM PST = 3:50 AM UTC Nov 20
  const now = new Date();

  console.log(`🔍 Checking tasks after recipe restart at ${restartTime.toISOString()}`);
  console.log(`   Current time: ${now.toISOString()}\n`);

  // Get all timer tasks for Discord and Twitter steps
  const discordStep = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      orchestration: {
        name: {
          contains: "Discord",
        },
      },
      deleted_at: null,
    },
  });

  const twitterStep = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      orchestration: {
        name: {
          contains: "Twitter",
        },
      },
      deleted_at: null,
    },
  });

  if (!discordStep || !twitterStep) {
    console.log("❌ Could not find Discord or Twitter steps");
    return;
  }

  // Check Discord tasks
  const discordTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipe_step_id: discordStep.id,
      deleted_at: null,
      scheduled_at: {
        gte: restartTime,
        lte: now,
      },
    },
    orderBy: { scheduled_at: "asc" },
  });

  console.log(`📊 Discord Tasks (should have run after restart): ${discordTasks.length}`);
  discordTasks.forEach((task) => {
    const pstTime = task.scheduled_at.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const executedTime = task.executed_at?.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(
      `   ${task.status} - ${pstTime} PST - ${task.task_type} ${executedTime ? `(Executed: ${executedTime})` : ""}`
    );
    if (task.error_message) {
      console.log(`      Error: ${task.error_message}`);
    }
  });

  // Check Twitter tasks
  const twitterTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipe_step_id: twitterStep.id,
      deleted_at: null,
      scheduled_at: {
        gte: restartTime,
        lte: now,
      },
    },
    orderBy: { scheduled_at: "asc" },
  });

  console.log(`\n📊 Twitter Tasks (should have run after restart): ${twitterTasks.length}`);
  twitterTasks.forEach((task) => {
    const pstTime = task.scheduled_at.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const executedTime = task.executed_at?.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(
      `   ${task.status} - ${pstTime} PST - ${task.task_type} ${executedTime ? `(Executed: ${executedTime})` : ""}`
    );
    if (task.error_message) {
      console.log(`      Error: ${task.error_message}`);
    }
  });

  // Summary
  const discordPending = discordTasks.filter((t) => t.status === "PENDING").length;
  const discordExecuted = discordTasks.filter((t) => t.status === "EXECUTED").length;
  const discordSkipped = discordTasks.filter((t) => t.status === "SKIPPED").length;

  const twitterPending = twitterTasks.filter((t) => t.status === "PENDING").length;
  const twitterExecuted = twitterTasks.filter((t) => t.status === "EXECUTED").length;
  const twitterSkipped = twitterTasks.filter((t) => t.status === "SKIPPED").length;

  console.log(`\n📈 Summary:`);
  console.log(
    `   Discord: ${discordExecuted} executed, ${discordSkipped} skipped, ${discordPending} pending`
  );
  console.log(
    `   Twitter: ${twitterExecuted} executed, ${twitterSkipped} skipped, ${twitterPending} pending`
  );

  if (discordPending > 0 || twitterPending > 0) {
    console.log(
      `\n⚠️  WARNING: There are ${discordPending + twitterPending} pending tasks that should have run!`
    );
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
