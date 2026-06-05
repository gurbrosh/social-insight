import { prisma } from "@/lib/prisma";

async function deleteAllRecipesAndTasks() {
  console.log("⚠️  Deleting ALL orchestration recipes and timer tasks from the database...");

  // Count before
  const [recipeCount, stepCount, taskCount, skipCount] = await Promise.all([
    prisma.orchestrationRecipe.count(),
    prisma.orchestrationRecipeStep.count(),
    prisma.orchestrationTimerTask.count(),
    prisma.orchestrationRecipeStepSkip.count(),
  ]);

  console.log(
    `Before delete: recipes=${recipeCount}, steps=${stepCount}, tasks=${taskCount}, skips=${skipCount}`
  );

  // Order matters because of foreign keys:
  // 1) Timer tasks
  // 2) Step skip configs
  // 3) Steps
  // 4) Recipes
  const deleteTasks = prisma.orchestrationTimerTask.deleteMany({});
  const deleteSkips = prisma.orchestrationRecipeStepSkip.deleteMany({});
  const deleteSteps = prisma.orchestrationRecipeStep.deleteMany({});
  const deleteRecipes = prisma.orchestrationRecipe.deleteMany({});

  await prisma.$transaction([deleteTasks, deleteSkips, deleteSteps, deleteRecipes]);

  // Count after
  const [recipeAfter, stepAfter, taskAfter, skipAfter] = await Promise.all([
    prisma.orchestrationRecipe.count(),
    prisma.orchestrationRecipeStep.count(),
    prisma.orchestrationTimerTask.count(),
    prisma.orchestrationRecipeStepSkip.count(),
  ]);

  console.log(
    `After delete: recipes=${recipeAfter}, steps=${stepAfter}, tasks=${taskAfter}, skips=${skipAfter}`
  );

  console.log("✅ All orchestration recipes and timer tasks have been deleted.");
}

deleteAllRecipesAndTasks()
  .catch((error) => {
    console.error("Error deleting recipes and tasks:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
