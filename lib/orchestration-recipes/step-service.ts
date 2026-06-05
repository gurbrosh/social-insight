import { prisma } from "@/lib/prisma";
import { generateTimerTasksFromRecipeStep } from "@/lib/orchestration-recipe-service";
import { CreateStepInput } from "@/lib/validation/orchestration-recipe-step";

async function applySkipConfiguration(
  client: typeof prisma,
  recipeId: string,
  stepId: string,
  skipStepIds?: string[] | null
) {
  const ids = (skipStepIds ?? []).filter((id) => id !== stepId);

  await client.orchestrationRecipeStepSkip.deleteMany({
    where: { step_id: stepId },
  });

  if (ids.length === 0) {
    return;
  }

  const validSteps = await client.orchestrationRecipeStep.findMany({
    where: {
      id: { in: ids },
      recipe_id: recipeId,
      deleted_at: null,
    },
    select: { id: true },
  });

  if (validSteps.length === 0) {
    return;
  }

  const { ulid: generateUlid } = await import("ulid");

  await client.orchestrationRecipeStepSkip.createMany({
    data: validSteps.map((step) => ({
      id: generateUlid(),
      step_id: stepId,
      skip_step_id: step.id,
    })),
  });
}

export async function createRecipeStepForUser(
  userId: string,
  recipeId: string,
  input: CreateStepInput
) {
  if (
    input.initial_enabled &&
    input.initial_run_type === "SCHEDULED" &&
    !input.initial_schedule_time
  ) {
    throw new Error("initial_schedule_time is required when initial_run_type is SCHEDULED");
  }

  const { ulid: generateUlid } = await import("ulid");

  const result = await prisma.$transaction(async (tx) => {
    const recipe = await tx.orchestrationRecipe.findFirst({
      where: { id: recipeId, deleted_at: null, user_id: userId },
    });

    if (!recipe) {
      throw new Error("Recipe not found");
    }

    const orchestration = await tx.orchestration.findFirst({
      where: { id: input.orchestration_id, deleted_at: null },
    });

    if (!orchestration) {
      throw new Error("Orchestration not found");
    }

    const previousStep = await tx.orchestrationRecipeStep.findFirst({
      where: {
        recipe_id: recipeId,
      },
      orderBy: { sequence: "desc" },
    });

    const targetSequence = previousStep ? previousStep.sequence + 1 : 1;

    let dailyTime = input.daily_time;
    if (input.daily_interval && !dailyTime) {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: recipe.timezone || "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const formatted = formatter.format(new Date());
      const match = formatted.match(/(\d{2}):(\d{2})/);
      dailyTime = match ? `${match[1]}:${match[2]}` : "00:00";
    }

    const createdStep = await tx.orchestrationRecipeStep.create({
      data: {
        id: generateUlid(),
        recipe_id: recipeId,
        orchestration_id: input.orchestration_id,
        sequence: targetSequence,
        initial_enabled: input.initial_enabled,
        initial_run_type: input.initial_enabled ? input.initial_run_type : "NOW",
        // Save initial_schedule_time if:
        // 1. Initial task is enabled and scheduled (for initial tasks)
        // 2. OR hourly_interval is set (for hourly task start time)
        initial_schedule_time:
          (input.initial_enabled && input.initial_run_type === "SCHEDULED") || input.hourly_interval
            ? input.initial_schedule_time || null
            : null,
        hourly_interval: input.hourly_interval,
        daily_interval: input.daily_interval,
        daily_time: dailyTime || null,
      },
    });

    await applySkipConfiguration(
      tx as typeof prisma,
      recipeId,
      createdStep.id,
      input.skip_step_ids ?? []
    );

    return {
      stepId: createdStep.id,
      recipeIsActive: recipe.is_active,
    };
  });

  const stepWithRelations = await prisma.orchestrationRecipeStep.findUnique({
    where: { id: result.stepId },
    include: {
      orchestration: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      skipConfigurations: {
        include: {
          skipStep: {
            select: {
              id: true,
              sequence: true,
              orchestration: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      _count: {
        select: {
          timerTasks: {
            where: {
              deleted_at: null,
              status: "PENDING",
            },
          },
        },
      },
    },
  });

  if (!stepWithRelations) {
    throw new Error("Failed to load created step");
  }

  if (result.recipeIsActive) {
    await generateTimerTasksFromRecipeStep(result.stepId);
  }

  return stepWithRelations;
}
