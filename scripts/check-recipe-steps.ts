#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

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
          orchestration: {
            select: {
              id: true,
              name: true,
            },
          },
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
  console.log(`🕐 Timezone: ${activeRecipe.timezone}`);
  console.log(`✅ Active: ${activeRecipe.is_active}\n`);

  console.log(`📋 Recipe Steps (${activeRecipe.steps.length} total):\n`);

  activeRecipe.steps.forEach((step, index) => {
    console.log(`${index + 1}. Step ${step.sequence} - ${step.orchestration.name}`);
    console.log(`   Step ID: ${step.id}`);
    console.log(`   Orchestration ID: ${step.orchestration_id}`);
    console.log(`   Initial Enabled: ${step.initial_enabled}`);
    console.log(`   Initial Run Type: ${step.initial_run_type}`);
    console.log(`   Initial Schedule Time: ${step.initial_schedule_time || "N/A"}`);
    console.log(`   Hourly Interval: ${step.hourly_interval || "Disabled"}`);
    console.log(`   Daily Interval: ${step.daily_interval || "Disabled"}`);
    console.log(`   Daily Time: ${step.daily_time || "N/A"}`);
    console.log();
  });

  // Check for Discord in orchestration names
  const discordSteps = activeRecipe.steps.filter((step) =>
    step.orchestration.name.toLowerCase().includes("discord")
  );

  if (discordSteps.length === 0) {
    console.log("⚠️  No Discord steps found in recipe");
  } else {
    console.log(`\n🎮 Discord Steps Found: ${discordSteps.length}`);
    discordSteps.forEach((step) => {
      console.log(`   - Step ${step.sequence}: ${step.orchestration.name}`);
    });
  }

  // Check all orchestrations to see if there's a Discord one
  const allOrchestrations = await prisma.orchestration.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
    },
  });

  const discordOrchestrations = allOrchestrations.filter((orch) =>
    orch.name.toLowerCase().includes("discord")
  );

  if (discordOrchestrations.length > 0) {
    console.log(`\n📊 Discord Orchestrations in Database: ${discordOrchestrations.length}`);
    discordOrchestrations.forEach((orch) => {
      const inRecipe = activeRecipe.steps.some((step) => step.orchestration_id === orch.id);
      console.log(
        `   - ${orch.name} (${orch.id}) ${inRecipe ? "✅ IN RECIPE" : "❌ NOT IN RECIPE"}`
      );
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
