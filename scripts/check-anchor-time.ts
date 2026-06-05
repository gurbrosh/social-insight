#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Get the active recipe
  const recipe = await prisma.orchestrationRecipe.findFirst({
    where: {
      is_active: true,
      deleted_at: null,
    },
  });

  if (!recipe) {
    console.log("❌ No active recipe found");
    return;
  }

  // Get Step 1 (primary anchor step)
  const step1 = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      recipe_id: recipe.id,
      sequence: 1,
      deleted_at: null,
    },
    include: {
      orchestration: true,
    },
  });

  if (!step1) {
    console.log("❌ Step 1 not found");
    return;
  }

  console.log(`📋 Step 1 (Anchor): ${step1.orchestration.name}\n`);

  // Get the anchor task (most recent PENDING or EXECUTED task from Step 1)
  const referenceTime = new Date();
  const horizon = new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000);

  const anchorTask = await prisma.orchestrationTimerTask.findFirst({
    where: {
      deleted_at: null,
      recipe_step_id: step1.id,
      status: {
        in: ["PENDING", "EXECUTED"],
      },
      scheduled_at: {
        lte: horizon,
      },
    },
    orderBy: { scheduled_at: "desc" },
  });

  if (anchorTask) {
    const pstTime = anchorTask.scheduled_at.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(`⏰ Anchor Time: ${pstTime} PST`);
    console.log(`   Status: ${anchorTask.status}`);
    console.log(`   Task Type: ${anchorTask.task_type}`);
    console.log(`   Scheduled At: ${anchorTask.scheduled_at.toISOString()}\n`);
  } else {
    console.log("⚠️  No anchor task found for Step 1\n");
  }

  // Check Discord and Twitter steps
  const discordStep = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      recipe_id: recipe.id,
      orchestration: {
        name: {
          contains: "Discord",
        },
      },
      deleted_at: null,
    },
    include: {
      orchestration: true,
    },
  });

  const twitterStep = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      recipe_id: recipe.id,
      orchestration: {
        name: {
          contains: "Twitter",
        },
      },
      deleted_at: null,
    },
    include: {
      orchestration: true,
    },
  });

  if (anchorTask && discordStep) {
    console.log(`\n🔍 Discord (6-hour interval) alignment:`);
    const intervalMs = 6 * 60 * 60 * 1000;
    let nextTime = new Date(anchorTask.scheduled_at.getTime() + intervalMs);

    // Align to anchor
    const delta = nextTime.getTime() - anchorTask.scheduled_at.getTime();
    const remainder = ((delta % intervalMs) + intervalMs) % intervalMs;
    if (remainder !== 0) {
      nextTime = new Date(nextTime.getTime() + (intervalMs - remainder));
    }

    // Advance until future
    while (nextTime <= referenceTime) {
      nextTime = new Date(nextTime.getTime() + intervalMs);
    }

    const pstTime = nextTime.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(`   Next calculated time: ${pstTime} PST`);
    console.log(
      `   This is ${Math.round((nextTime.getTime() - referenceTime.getTime()) / (60 * 60 * 1000))} hours from now`
    );
  }

  if (anchorTask && twitterStep) {
    console.log(`\n🔍 Twitter (8-hour interval) alignment:`);
    const intervalMs = 8 * 60 * 60 * 1000;
    let nextTime = new Date(anchorTask.scheduled_at.getTime() + intervalMs);

    // Align to anchor
    const delta = nextTime.getTime() - anchorTask.scheduled_at.getTime();
    const remainder = ((delta % intervalMs) + intervalMs) % intervalMs;
    if (remainder !== 0) {
      nextTime = new Date(nextTime.getTime() + (intervalMs - remainder));
    }

    // Advance until future
    while (nextTime <= referenceTime) {
      nextTime = new Date(nextTime.getTime() + intervalMs);
    }

    const pstTime = nextTime.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    console.log(`   Next calculated time: ${pstTime} PST`);
    console.log(
      `   This is ${Math.round((nextTime.getTime() - referenceTime.getTime()) / (60 * 60 * 1000))} hours from now`
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
