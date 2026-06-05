import { prisma } from "@/lib/prisma";

async function checkMissedTask() {
  const now = new Date();
  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Current time (local): ${now.toLocaleString()}`);

  // Find tasks scheduled around 11:45 today
  const today = new Date();
  today.setHours(11, 45, 0, 0);
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  console.log(
    `\nLooking for tasks scheduled between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`
  );

  const tasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      scheduled_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
      deleted_at: null,
    },
    include: {
      recipeStep: {
        include: {
          orchestration: {
            select: {
              id: true,
              name: true,
            },
          },
          recipe: {
            select: {
              id: true,
              name: true,
              is_active: true,
              timezone: true,
            },
          },
        },
      },
    },
    orderBy: { scheduled_at: "asc" },
    take: 50,
  });

  console.log(`\nFound ${tasks.length} tasks scheduled today:\n`);

  for (const task of tasks) {
    const scheduledLocal = new Date(task.scheduled_at).toLocaleString();
    const status = task.status;
    const isPast = task.scheduled_at <= now;
    const minutesLate = isPast
      ? Math.round((now.getTime() - task.scheduled_at.getTime()) / 1000 / 60)
      : 0;

    console.log(
      `Task ${task.id}: ` +
        `scheduled=${task.scheduled_at.toISOString()} (${scheduledLocal}), ` +
        `status=${status}, ` +
        `type=${task.task_type}, ` +
        `orchestration="${task.recipeStep?.orchestration?.name || "N/A"}", ` +
        `recipe="${task.recipeStep?.recipe?.name || "N/A"}" (active=${task.recipeStep?.recipe?.is_active}), ` +
        `timezone=${task.recipeStep?.recipe?.timezone || "UTC"}, ` +
        `isPast=${isPast}${isPast ? ` (${minutesLate} minutes late)` : ""}`
    );
  }

  // Check for LinkedIn Search tasks specifically
  const linkedinTasks = tasks.filter(
    (t) =>
      t.recipeStep?.orchestration?.name?.toLowerCase().includes("linkedin") &&
      t.recipeStep?.orchestration?.name?.toLowerCase().includes("search")
  );

  if (linkedinTasks.length > 0) {
    console.log(`\n=== LinkedIn Search Tasks ===`);
    for (const task of linkedinTasks) {
      console.log(
        `Task ${task.id}: ` +
          `scheduled=${task.scheduled_at.toISOString()} (${new Date(task.scheduled_at).toLocaleString()}), ` +
          `status=${task.status}, ` +
          `isPast=${task.scheduled_at <= now}`
      );
    }
  }
}

checkMissedTask()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
