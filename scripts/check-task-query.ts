import { prisma } from "@/lib/prisma";

async function checkTaskQuery() {
  const now = new Date();
  console.log(`Current time: ${now.toISOString()}`);

  // Check the specific task
  const task = await prisma.orchestrationTimerTask.findFirst({
    where: {
      id: "01KAHAPFBRFVTQ2J8ZTYPRT7N5",
    },
    include: {
      recipeStep: {
        include: {
          recipe: true,
        },
      },
    },
  });

  if (!task) {
    console.log("❌ Task not found in database");
    return;
  }

  console.log("\n=== Task Details ===");
  console.log(`ID: ${task.id}`);
  console.log(`Scheduled: ${task.scheduled_at.toISOString()}`);
  console.log(`Status: ${task.status}`);
  console.log(`Deleted at: ${task.deleted_at}`);
  console.log(`Task type: ${task.task_type}`);
  console.log(`Recipe step ID: ${task.recipe_step_id}`);
  console.log(`Recipe step deleted: ${task.recipeStep?.deleted_at || "N/A"}`);
  console.log(`Recipe active: ${task.recipeStep?.recipe?.is_active || "N/A"}`);
  console.log(`Recipe deleted: ${task.recipeStep?.recipe?.deleted_at || "N/A"}`);
  console.log(`Scheduled <= now: ${task.scheduled_at <= now}`);

  // Now check if it matches the query criteria
  console.log("\n=== Query Criteria Check ===");
  const matchesStatus = task.status === "PENDING";
  const matchesScheduled = task.scheduled_at <= now;
  const matchesDeleted = task.deleted_at === null;
  const matchesRecipeActive = task.recipeStep?.recipe?.is_active === true;
  const matchesRecipeDeleted = task.recipeStep?.recipe?.deleted_at === null;
  const matchesStepDeleted = task.recipeStep?.deleted_at === null;

  console.log(`✓ status === "PENDING": ${matchesStatus}`);
  console.log(`✓ scheduled_at <= now: ${matchesScheduled}`);
  console.log(`✓ deleted_at === null: ${matchesDeleted}`);
  console.log(`✓ recipe.is_active === true: ${matchesRecipeActive}`);
  console.log(`✓ recipe.deleted_at === null: ${matchesRecipeDeleted}`);
  console.log(`✓ recipeStep.deleted_at === null: ${matchesStepDeleted}`);

  const allMatch =
    matchesStatus &&
    matchesScheduled &&
    matchesDeleted &&
    matchesRecipeActive &&
    matchesRecipeDeleted &&
    matchesStepDeleted;
  console.log(`\n${allMatch ? "✅" : "❌"} Task matches query criteria: ${allMatch}`);

  // Try the actual query
  console.log("\n=== Running Actual Query ===");
  const queryResult = await prisma.orchestrationTimerTask.findMany({
    where: {
      status: "PENDING",
      scheduled_at: { lte: now },
      deleted_at: null,
      recipeStep: {
        recipe: {
          is_active: true,
          deleted_at: null,
        },
        deleted_at: null,
      },
    },
    orderBy: { scheduled_at: "asc" },
    take: 10,
    select: {
      id: true,
      recipe_step_id: true,
      orchestration_id: true,
      task_type: true,
      scheduled_at: true,
      created_at: true,
    },
  });

  console.log(`Found ${queryResult.length} tasks`);
  if (queryResult.length > 0) {
    console.log("Tasks found:");
    queryResult.forEach((t) => {
      console.log(`  - ${t.id}: scheduled=${t.scheduled_at.toISOString()}, type=${t.task_type}`);
    });
  } else {
    console.log("❌ Query found 0 tasks - this is why the runner isn't executing anything");
  }
}

checkTaskQuery()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
