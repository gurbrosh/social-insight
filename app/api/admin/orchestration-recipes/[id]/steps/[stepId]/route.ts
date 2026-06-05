import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { generateTimerTasksFromRecipeStep } from "@/lib/orchestration-recipe-service";

export const dynamic = "force-dynamic";

const updateStepSchema = z.object({
  orchestration_id: z.string().optional(),
  sequence: z.number().int().min(1).optional(),
  initial_enabled: z.boolean().optional(),
  initial_run_type: z.enum(["NOW", "SCHEDULED"]).optional(),
  initial_schedule_time: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional()
    .nullable(),
  hourly_interval: z.number().int().min(1).max(23).optional().nullable(),
  daily_interval: z.number().int().min(1).max(100).optional().nullable(),
  daily_time: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional()
    .nullable(),
  skip_step_ids: z.array(z.string()).optional(),
});

function getDefaultDailyTime(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const formatted = formatter.format(new Date());
  const match = formatted.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "00:00";
}

async function applySkipConfiguration(
  recipeId: string,
  stepId: string,
  skipStepIds?: string[] | null
) {
  if (skipStepIds === undefined) {
    return;
  }

  await prisma.orchestrationRecipeStepSkip.deleteMany({ where: { step_id: stepId } });

  const ids = (skipStepIds ?? []).filter((id) => id !== stepId);
  if (ids.length === 0) {
    return;
  }

  const validSteps = await prisma.orchestrationRecipeStep.findMany({
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

  await prisma.orchestrationRecipeStepSkip.createMany({
    data: validSteps.map((step) => ({
      id: generateUlid(),
      step_id: stepId,
      skip_step_id: step.id,
    })),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: recipeId, stepId } = await params;
    const body = await request.json();
    const validatedData = updateStepSchema.parse(body);

    // Check if recipe exists and belongs to user
    const recipe = await prisma.orchestrationRecipe.findFirst({
      where: { id: recipeId, deleted_at: null, user_id: session.user.id },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Check if step exists
    const existingStep = await prisma.orchestrationRecipeStep.findFirst({
      where: { id: stepId, recipe_id: recipeId, deleted_at: null },
    });

    if (!existingStep) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    const finalInitialEnabled =
      validatedData.initial_enabled !== undefined
        ? validatedData.initial_enabled
        : existingStep.initial_enabled;
    const finalInitialRunType =
      validatedData.initial_run_type ?? existingStep.initial_run_type ?? "NOW";
    const finalInitialScheduleTime =
      validatedData.initial_schedule_time !== undefined
        ? validatedData.initial_schedule_time
        : existingStep.initial_schedule_time;

    if (finalInitialEnabled && finalInitialRunType === "SCHEDULED" && !finalInitialScheduleTime) {
      return NextResponse.json(
        { error: "initial_schedule_time is required when initial_run_type is SCHEDULED" },
        { status: 400 }
      );
    }

    let finalDailyTime = existingStep.daily_time;

    if (validatedData.daily_interval !== undefined) {
      if (validatedData.daily_interval === null) {
        finalDailyTime = null;
      } else if (validatedData.daily_time !== undefined && validatedData.daily_time !== null) {
        finalDailyTime = validatedData.daily_time;
      } else {
        finalDailyTime = existingStep.daily_time ?? getDefaultDailyTime(recipe.timezone);
      }
    } else if (validatedData.daily_time !== undefined) {
      finalDailyTime = validatedData.daily_time;
    }

    // If orchestration_id is being updated, validate it exists
    if (validatedData.orchestration_id) {
      const orchestration = await prisma.orchestration.findFirst({
        where: { id: validatedData.orchestration_id, deleted_at: null },
      });

      if (!orchestration) {
        return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
      }
    }

    // If sequence is being updated, handle reordering
    // Use a transaction to avoid unique constraint violations
    if (validatedData.sequence !== undefined && validatedData.sequence !== existingStep.sequence) {
      const newSequence = validatedData.sequence;
      const oldSequence = existingStep.sequence;

      // Get all steps for this recipe
      const allSteps = await prisma.orchestrationRecipeStep.findMany({
        where: {
          recipe_id: recipeId,
          deleted_at: null,
        },
        orderBy: { sequence: "asc" },
      });

      // Use transaction to avoid unique constraint violations
      await prisma.$transaction(async (tx) => {
        // Store original sequences before updating
        const originalSequences = new Map(allSteps.map((step) => [step.id, step.sequence]));

        // First, set all sequences to temporary high values (10000 + original) to free up the sequence space
        const tempOffset = 10000;
        for (const step of allSteps) {
          await tx.orchestrationRecipeStep.update({
            where: { id: step.id },
            data: { sequence: tempOffset + step.sequence },
          });
        }

        // Now assign final sequences using the stored original sequences
        for (const step of allSteps) {
          const originalSequence = originalSequences.get(step.id)!;
          let finalSequence: number;

          if (step.id === stepId) {
            // This is the step being moved
            finalSequence = newSequence;
          } else {
            if (newSequence > oldSequence) {
              // Moving down: shift steps between old and new down by 1
              if (originalSequence > oldSequence && originalSequence <= newSequence) {
                finalSequence = originalSequence - 1;
              } else {
                finalSequence = originalSequence;
              }
            } else {
              // Moving up: shift steps between new and old up by 1
              if (originalSequence >= newSequence && originalSequence < oldSequence) {
                finalSequence = originalSequence + 1;
              } else {
                finalSequence = originalSequence;
              }
            }
          }

          await tx.orchestrationRecipeStep.update({
            where: { id: step.id },
            data: { sequence: finalSequence },
          });
        }
      });
    }

    // Update step
    const updateData: any = {};
    if (validatedData.orchestration_id !== undefined)
      updateData.orchestration_id = validatedData.orchestration_id;
    if (validatedData.sequence !== undefined) updateData.sequence = validatedData.sequence;
    if (validatedData.initial_enabled !== undefined)
      updateData.initial_enabled = validatedData.initial_enabled;
    if (validatedData.initial_run_type !== undefined) {
      updateData.initial_run_type = validatedData.initial_run_type;
      // Only clear initial_schedule_time if setting to NOW AND no hourly interval
      // (hourly tasks use initial_schedule_time for their start time, not just initial tasks)
      const hasHourlyInterval = existingStep.hourly_interval !== null;
      if (validatedData.initial_run_type === "NOW" && !hasHourlyInterval) {
        updateData.initial_schedule_time = null;
      }
    }
    if (validatedData.initial_schedule_time !== undefined) {
      // Save initial_schedule_time if:
      // 1. Initial task is enabled and scheduled (for initial tasks)
      // 2. OR hourly_interval is set (for hourly task start time)
      const hasHourlyInterval =
        validatedData.hourly_interval !== undefined
          ? validatedData.hourly_interval !== null
          : existingStep.hourly_interval !== null;
      const isInitialScheduled =
        finalInitialEnabled &&
        (validatedData.initial_run_type ?? existingStep.initial_run_type) === "SCHEDULED";

      updateData.initial_schedule_time =
        isInitialScheduled || hasHourlyInterval ? validatedData.initial_schedule_time : null;
    } else if (validatedData.initial_enabled !== undefined && !validatedData.initial_enabled) {
      // Only clear initial_schedule_time if disabling initial task AND no hourly interval
      const hasHourlyInterval = existingStep.hourly_interval !== null;
      if (!hasHourlyInterval) {
        updateData.initial_schedule_time = null;
      }
    }
    if (validatedData.hourly_interval !== undefined) {
      updateData.hourly_interval = validatedData.hourly_interval;
    }
    if (validatedData.daily_interval !== undefined) {
      updateData.daily_interval = validatedData.daily_interval;
      updateData.daily_time = finalDailyTime;
    } else if (validatedData.daily_time !== undefined) {
      updateData.daily_time = finalDailyTime;
    }

    const step = await prisma.orchestrationRecipeStep.update({
      where: { id: stepId },
      data: updateData,
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
      },
    });

    await applySkipConfiguration(recipeId, stepId, validatedData.skip_step_ids ?? undefined);

    const stepWithSkips = await prisma.orchestrationRecipeStep.findUnique({
      where: { id: stepId },
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
      },
    });

    // Regenerate timer tasks if recipe is active (delete old ones first)
    if (recipe.is_active) {
      await prisma.orchestrationTimerTask.updateMany({
        where: {
          recipe_step_id: stepId,
          deleted_at: null,
          status: "PENDING",
        },
        data: { deleted_at: new Date() },
      });
      await generateTimerTasksFromRecipeStep(step.id);
    }

    return NextResponse.json({ step: stepWithSkips ?? step });
  } catch (error) {
    console.error("Error updating recipe step:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  // Destructure params outside try block so they're available in catch block
  const { id: recipeId, stepId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if recipe exists and belongs to user
    const recipe = await prisma.orchestrationRecipe.findFirst({
      where: { id: recipeId, deleted_at: null, user_id: session.user.id },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Check if step exists
    const step = await prisma.orchestrationRecipeStep.findFirst({
      where: { id: stepId, recipe_id: recipeId, deleted_at: null },
    });

    if (!step) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    // Get all active steps for this recipe (excluding the one being deleted)
    const allActiveSteps = await prisma.orchestrationRecipeStep.findMany({
      where: {
        recipe_id: recipeId,
        deleted_at: null,
        id: { not: stepId }, // Exclude the step being deleted
      },
      orderBy: { sequence: "asc" },
    });

    // Soft delete step and its timer tasks, then reorder remaining steps
    // CRITICAL: Use transaction to avoid unique constraint violations with @@unique([recipe_id, sequence])
    // The unique constraint applies to ALL rows (including soft-deleted), so we must use temporary offset technique
    await prisma.$transaction(async (tx) => {
      // Step 1: Clean up skip configurations first (before soft-deleting step)
      // Delete skip configurations where the step to be deleted is the skip target
      await tx.orchestrationRecipeStepSkip.deleteMany({
        where: {
          skip_step_id: stepId,
        },
      });

      // Delete skip configurations where the step to be deleted is the source
      await tx.orchestrationRecipeStepSkip.deleteMany({
        where: {
          step_id: stepId,
        },
      });

      // Step 2: Get all steps (including deleted) to calculate temp offset and move deleted steps first
      const allStepsInRecipe = await tx.orchestrationRecipeStep.findMany({
        where: { recipe_id: recipeId },
      });

      const deletedSteps = allStepsInRecipe.filter((s) => s.deleted_at !== null);
      const maxSequence =
        allStepsInRecipe.length > 0 ? Math.max(...allStepsInRecipe.map((s) => s.sequence)) : 0;
      const tempOffset = Math.max(100000, maxSequence + 10000); // Use very large offset
      const deletedOffset = tempOffset + 100000; // Put deleted steps even higher

      // Step 3: Move ALL deleted steps (including the one we're about to delete) to very high sequences FIRST
      // This prevents conflicts when moving active steps
      for (const deletedStep of deletedSteps) {
        if (deletedStep.id !== stepId) {
          // Move existing deleted steps even higher
          await tx.orchestrationRecipeStep.update({
            where: { id: deletedStep.id },
            data: { sequence: deletedOffset + deletedStep.sequence },
          });
        }
      }

      // Step 4: Soft delete the step being removed and move it to a very high sequence
      await tx.orchestrationRecipeStep.update({
        where: { id: stepId },
        data: {
          deleted_at: new Date(),
          sequence: deletedOffset + 99999, // Move deleted step to very high sequence
        },
      });

      // Step 5: Move ALL active steps (except deleted one) to temporary high sequences
      // This frees up the sequence space so we can reassign correctly
      for (const activeStep of allActiveSteps) {
        await tx.orchestrationRecipeStep.update({
          where: { id: activeStep.id },
          data: { sequence: tempOffset + activeStep.sequence },
        });
      }

      // Step 6: Delete pending timer tasks for the deleted step
      await tx.orchestrationTimerTask.updateMany({
        where: {
          recipe_step_id: stepId,
          deleted_at: null,
          status: "PENDING",
        },
        data: { deleted_at: new Date() },
      });

      // Step 7: Reassign sequences to remaining active steps (1, 2, 3, ...)
      for (let i = 0; i < allActiveSteps.length; i++) {
        const activeStep = allActiveSteps[i];
        await tx.orchestrationRecipeStep.update({
          where: { id: activeStep.id },
          data: { sequence: i + 1 }, // Reassign to 1, 2, 3, ...
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting recipe step:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Error details:", { errorMessage, errorStack, stepId, recipeId });

    // Check if it's a Prisma unique constraint error
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json(
        {
          error: "Unique constraint violation",
          details: "Failed to reorder steps due to sequence conflict. Please try again.",
          stepId,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
