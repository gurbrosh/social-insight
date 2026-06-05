import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 23:09 Pacific Time last night
// Pacific Time is UTC-8 (PST) or UTC-7 (PDT)
// For November (PST), 23:09 PST = 07:09 UTC next day
const now = new Date();
const yesterday23_09_pst = new Date(now);
yesterday23_09_pst.setDate(yesterday23_09_pst.getDate() - 1);
yesterday23_09_pst.setUTCHours(7, 9, 0, 0); // 23:09 PST = 07:09 UTC next day

async function analyze() {
  console.log("=== SCHEDULE ANALYSIS ===");
  console.log(`Analyzing from: ${yesterday23_09_pst.toISOString()} (23:09 PST yesterday)`);
  console.log(`Current time: ${now.toISOString()}\n`);

  // Get all recipes
  const recipes = await prisma.orchestrationRecipe.findMany({
    where: {
      deleted_at: null,
    },
    include: {
      steps: {
        where: { deleted_at: null },
        orderBy: { sequence: "asc" },
      },
    },
  });

  console.log(`Found ${recipes.length} recipes\n`);

  for (const recipe of recipes) {
    if (!recipe.is_active) continue;

    console.log(`\n📋 Recipe: ${recipe.name} (${recipe.id})`);
    console.log(`   Timezone: ${recipe.timezone || "UTC"}`);
    console.log(`   Steps: ${recipe.steps.length}`);

    for (const step of recipe.steps) {
      console.log(`\n   Step ${step.sequence}: Orchestration ID ${step.orchestration_id}`);
      console.log(
        `      Initial: ${
          step.initial_enabled
            ? step.initial_run_type === "NOW"
              ? "NOW"
              : `SCHEDULED ${step.initial_schedule_time}`
            : "disabled"
        }`
      );
      console.log(
        `      Hourly: ${step.hourly_interval ? `every ${step.hourly_interval} hours` : "disabled"}`
      );
      console.log(
        `      Daily: ${step.daily_interval ? `every ${step.daily_interval} days at ${step.daily_time}` : "disabled"}`
      );

      // Get scheduled tasks from yesterday 23:09 onwards
      const scheduledTasks = await prisma.orchestrationTimerTask.findMany({
        where: {
          recipe_step_id: step.id,
          scheduled_at: {
            gte: yesterday23_09_pst,
          },
          deleted_at: null,
        },
        orderBy: { scheduled_at: "asc" },
      });

      console.log(`      Scheduled tasks (from 23:09 PST): ${scheduledTasks.length}`);

      // Get executed tasks
      const executedTasks = scheduledTasks.filter((t) => t.status === "EXECUTED");
      console.log(`      Executed: ${executedTasks.length}`);

      // Get actual execution times
      const tasksWithExecution = await prisma.orchestrationTimerTask.findMany({
        where: {
          recipe_step_id: step.id,
          scheduled_at: {
            gte: yesterday23_09_pst,
          },
          executed_at: {
            not: null,
          },
          deleted_at: null,
        },
        orderBy: { executed_at: "asc" },
        take: 30,
      });

      if (tasksWithExecution.length > 0) {
        console.log(`      First 15 execution times:`);
        tasksWithExecution.slice(0, 15).forEach((task) => {
          const scheduled = new Date(task.scheduled_at);
          const executed = task.executed_at ? new Date(task.executed_at) : null;
          const diff = executed ? (executed.getTime() - scheduled.getTime()) / 1000 / 60 : null; // minutes
          console.log(
            `         Scheduled: ${scheduled.toISOString()}, Executed: ${executed?.toISOString() || "N/A"}, Diff: ${diff?.toFixed(1) || "N/A"} min, Type: ${task.task_type}`
          );
        });

        // Check for multiple executions in a short time
        const executions = tasksWithExecution.map((t) => t.executed_at).filter(Boolean) as Date[];
        const timeWindows: Array<{
          first: string;
          second: string;
          diffMinutes: string;
        }> = [];
        for (let i = 0; i < executions.length - 1; i++) {
          const diff =
            (new Date(executions[i + 1]).getTime() - new Date(executions[i]).getTime()) / 1000 / 60; // minutes
          if (diff < 60) {
            // Less than 1 hour
            timeWindows.push({
              first: new Date(executions[i]).toISOString(),
              second: new Date(executions[i + 1]).toISOString(),
              diffMinutes: diff.toFixed(1),
            });
          }
        }
        if (timeWindows.length > 0) {
          console.log(
            `      ⚠️  SUSPICIOUS: Found ${timeWindows.length} executions within 1 hour of each other:`
          );
          timeWindows.slice(0, 10).forEach((w) => {
            console.log(`         ${w.first} -> ${w.second} (${w.diffMinutes} min apart)`);
          });
        }

        // Analyze frequency - check if hourly tasks ran more frequently than configured
        const hourlyTasks = tasksWithExecution.filter((t) => t.task_type === "hourly");
        if (hourlyTasks.length > 1 && step.hourly_interval) {
          const intervals: number[] = [];
          for (let i = 0; i < hourlyTasks.length - 1; i++) {
            const diff =
              (new Date(hourlyTasks[i + 1].executed_at!).getTime() -
                new Date(hourlyTasks[i].executed_at!).getTime()) /
              1000 /
              60 /
              60; // hours
            intervals.push(diff);
          }
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const expectedInterval = step.hourly_interval;
          if (avgInterval < expectedInterval * 0.8) {
            // Ran more than 20% faster than expected
            console.log(
              `      ⚠️  FREQUENCY ISSUE: Hourly tasks ran every ${avgInterval.toFixed(2)} hours on average, but configured for every ${expectedInterval} hours`
            );
          }
        }
      }
    }
  }

  await prisma.$disconnect();
}

analyze().catch(console.error);
