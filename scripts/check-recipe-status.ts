import { prisma } from "@/lib/prisma";

async function checkRecipeStatus() {
  // Find the recipe for this task
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
    console.log("Task not found");
    return;
  }

  const recipeId = task.recipeStep?.recipe_id;
  if (!recipeId) {
    console.log("Recipe ID not found");
    return;
  }

  console.log(`Recipe ID: ${recipeId}`);

  // Check the recipe directly
  const recipe = await prisma.orchestrationRecipe.findFirst({
    where: { id: recipeId },
  });

  if (recipe) {
    console.log("\n=== Recipe Status ===");
    console.log(`ID: ${recipe.id}`);
    console.log(`Name: ${recipe.name}`);
    console.log(`is_active: ${recipe.is_active}`);
    console.log(`deleted_at: ${recipe.deleted_at}`);
    console.log(`Created: ${recipe.created_at}`);
    console.log(`Updated: ${recipe.updated_at}`);
  }

  // Check the recipe step
  const step = await prisma.orchestrationRecipeStep.findFirst({
    where: { id: task.recipe_step_id },
  });

  if (step) {
    console.log("\n=== Recipe Step Status ===");
    console.log(`ID: ${step.id}`);
    console.log(`Sequence: ${step.sequence}`);
    console.log(`deleted_at: ${step.deleted_at}`);
    console.log(`Created: ${step.created_at}`);
    console.log(`Updated: ${step.updated_at}`);
  }

  // Check if there are other pending tasks for this recipe
  const allTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipeStep: {
        recipe_id: recipeId,
      },
      status: "PENDING",
      deleted_at: null,
    },
    include: {
      recipeStep: {
        include: {
          recipe: true,
        },
      },
    },
    take: 10,
  });

  console.log("\n=== All PENDING Tasks for Recipe ===");
  console.log(`Found ${allTasks.length} pending tasks`);
  allTasks.forEach((t) => {
    console.log(
      `  - ${t.id}: scheduled=${t.scheduled_at.toISOString()}, step_deleted=${t.recipeStep?.deleted_at || "null"}, recipe_deleted=${t.recipeStep?.recipe?.deleted_at || "null"}`
    );
  });
}

checkRecipeStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
