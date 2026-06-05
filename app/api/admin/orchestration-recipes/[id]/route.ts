import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { generateTimerTasksFromRecipe } from "@/lib/orchestration-recipe-service";
import { processPendingTimerTasks } from "@/lib/orchestration-timer-task-processor";

export const dynamic = "force-dynamic";

const updateRecipeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  is_active: z.boolean().optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const recipe = await prisma.orchestrationRecipe.findFirst({
      where: { id, deleted_at: null },
      include: {
        steps: {
          where: { deleted_at: null },
          include: {
            orchestration: {
              select: {
                id: true,
                name: true,
                description: true,
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
          orderBy: { sequence: "asc" },
        },
      },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    return NextResponse.json({ recipe });
  } catch (error) {
    console.error("Error fetching recipe:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = updateRecipeSchema.parse(body);

    // Check if recipe exists (admins can manage any recipe)
    const existingRecipe = await prisma.orchestrationRecipe.findFirst({
      where: { id, deleted_at: null },
      include: {
        steps: {
          where: { deleted_at: null },
        },
      },
    });

    if (!existingRecipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Check if is_active is being changed
    const wasActive = existingRecipe.is_active;
    const willBeActive =
      validatedData.is_active !== undefined ? validatedData.is_active : wasActive;
    const isStarting = !wasActive && willBeActive;

    // Update recipe FIRST (non-blocking) - this is the critical operation
    const recipe = await prisma.orchestrationRecipe.update({
      where: { id },
      data: validatedData,
      include: {
        steps: {
          where: { deleted_at: null },
          orderBy: { sequence: "asc" },
        },
      },
    });

    // NOTE: When stopping a recipe (is_active: false), we NO LONGER eagerly cancel
    // all pending tasks here. Instead, the timer task processor:
    // - Continues to see PENDING tasks for this recipe
    // - When a task's scheduled time arrives, it checks recipe.is_active
    //   - If recipe is not running: marks the task as CANCELLED
    //   - If recipe is running: executes it
    // This matches the requirement that stopping a recipe pauses execution
    // without deleting the horizon, and tasks are cancelled lazily at run time
    // if the recipe is still stopped.

    // If starting, regenerate timer tasks for all steps
    // Only execute tasks that are due NOW (within grace period), not future tasks
    if (isStarting) {
      try {
        // First, regenerate timer tasks to ensure schedule horizon is populated
        await generateTimerTasksFromRecipe(id);

        // Only execute tasks that are due NOW (past their scheduled time but within grace period)
        // This respects the user's configured start times - future tasks will run at their scheduled time
        const now = new Date();
        const gracePeriodMs = 10 * 60 * 1000; // 10 minutes grace period
        const gracePeriodStart = new Date(now.getTime() - gracePeriodMs);

        // Find tasks that are due now (scheduled in the past, within grace period)
        // OR tasks scheduled for exactly now (within a small window)
        const tasksDueNow = await prisma.orchestrationTimerTask.findMany({
          where: {
            recipeStep: {
              recipe_id: id,
              deleted_at: null,
            },
            deleted_at: null,
            status: "PENDING",
            scheduled_at: {
              lte: now, // Past or current time
              gte: gracePeriodStart, // But within grace period (not too old)
            },
          },
          include: {
            recipeStep: {
              include: {
                orchestration: true,
              },
            },
          },
          orderBy: [{ recipeStep: { sequence: "asc" } }, { scheduled_at: "asc" }],
        });

        // Group by step to get the first due task for each step
        const stepTaskMap = new Map<string, (typeof tasksDueNow)[0]>();
        for (const task of tasksDueNow) {
          if (!stepTaskMap.has(task.recipe_step_id)) {
            stepTaskMap.set(task.recipe_step_id, task);
          }
        }

        // Execute each step's due task (only if it's actually due, not future)
        const tasksToExecuteNow: string[] = [];
        for (const task of stepTaskMap.values()) {
          // Task is already scheduled for now or in the past (within grace period)
          // Just trigger processing - don't change the scheduled time
          tasksToExecuteNow.push(task.id);
          console.log(
            `[Recipe Activation] Found due task for step ${task.recipeStep.sequence} (${task.recipeStep.orchestration.name}) - task ${task.id} (scheduled for ${task.scheduled_at.toISOString()})`
          );
        }

        // Trigger immediate processing of these tasks (don't wait)
        if (tasksToExecuteNow.length > 0) {
          processPendingTimerTasks(50).catch((error) => {
            console.error("[Recipe Activation] Error processing immediate tasks:", error);
          });
          console.log(
            `[Recipe Activation] Triggered execution of ${tasksToExecuteNow.length} due step(s) for recipe ${id} (future tasks will run at their scheduled times)`
          );
        } else {
          console.log(
            `[Recipe Activation] No tasks due now for recipe ${id} - all tasks will run at their scheduled times`
          );
        }
      } catch (error) {
        console.error("Error generating timer tasks after starting recipe:", error);
        // Don't fail the request, just log the error
      }
    }

    return NextResponse.json({ recipe });
  } catch (error) {
    console.error("Error updating recipe:", error);

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
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    // Check if recipe exists (admins can delete any recipe)
    const existingRecipe = await prisma.orchestrationRecipe.findFirst({
      where: { id, deleted_at: null },
      include: {
        steps: {
          where: { deleted_at: null },
          select: { id: true },
        },
      },
    });

    if (!existingRecipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // If recipe is active, deactivate it first (non-blocking)
    if (existingRecipe.is_active) {
      try {
        await prisma.orchestrationRecipe.update({
          where: { id },
          data: { is_active: false },
        });
        console.log(`[Recipe Delete] Deactivated recipe ${id} before deletion`);
      } catch (error) {
        console.error(`[Recipe Delete] Error deactivating recipe:`, error);
        // Continue with deletion even if deactivation fails
      }
    }

    // Delete all pending timer tasks FIRST (before deletion, but with timeout protection)
    const stepIds = existingRecipe.steps.map((s) => s.id);
    if (stepIds.length > 0) {
      try {
        // Use a timeout to prevent hanging
        const cancelPromise = prisma.orchestrationTimerTask.deleteMany({
          where: {
            recipe_step_id: { in: stepIds },
            status: "PENDING",
            deleted_at: null, // Safety: ignore already-soft-deleted tasks
          },
        });

        // 5 second timeout for task cancellation
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });

        await Promise.race([cancelPromise, timeoutPromise]);
        console.log(`[Recipe Delete] Hard-deleted pending timer tasks for recipe ${id}`);
      } catch (error) {
        console.error(`[Recipe Delete] Error cancelling timer tasks:`, error);
        // Continue with deletion even if cancellation fails or times out
      }
    }

    // Soft delete recipe and all its steps (critical operation - must complete)
    await prisma.$transaction([
      prisma.orchestrationRecipe.update({
        where: { id },
        data: { deleted_at: new Date() },
      }),
      prisma.orchestrationRecipeStep.updateMany({
        where: { recipe_id: id, deleted_at: null },
        data: { deleted_at: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting recipe:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
