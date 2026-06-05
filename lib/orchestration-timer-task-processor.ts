import { prisma } from "@/lib/prisma";
import {
  ensureRecipeScheduleHorizon,
  getPendingTimerTasks,
  stopRecipeIfBeyondHorizon,
  SCHEDULE_HORIZON_DAYS,
} from "@/lib/orchestration-recipe-service";

// Grace period for "Run Now" initial tasks: 5 minutes
const RUN_NOW_GRACE_PERIOD_MS = 5 * 60 * 1000;

interface ProcessResult {
  executed: number;
  skipped: number;
  failed: Array<{ id: string; error: string }>;
}

export async function processPendingTimerTasks(limit = 50): Promise<ProcessResult> {
  const referenceTime = new Date();
  const pendingTasks = await getPendingTimerTasks(limit);

  // Removed verbose logging - only log when tasks are actually executed (see orchestration-runner.ts)

  if (pendingTasks.length === 0) {
    return { executed: 0, skipped: 0, failed: [] };
  }

  const executedTasks: string[] = [];
  const skippedTasks: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const touchedRecipes = new Set<string>();

  for (const task of pendingTasks) {
    try {
      const recipeStep = await prisma.orchestrationRecipeStep
        .findUnique({
          where: { id: task.recipe_step_id },
          include: {
            recipe: {
              include: {
                user: true,
              },
            },
            skipConfigurations: {
              select: {
                skip_step_id: true,
              },
            },
          },
        })
        .catch((error) => {
          // Handle case where skipConfigurations relation table might not exist yet
          // Try again without the relation
          if (
            error.message?.includes("OrchestrationRecipeStepSkip") ||
            error.name === "PrismaClientUnknownRequestError"
          ) {
            return prisma.orchestrationRecipeStep
              .findUnique({
                where: { id: task.recipe_step_id },
                include: {
                  recipe: {
                    include: {
                      user: true,
                    },
                  },
                },
              })
              .then((step) => (step ? { ...step, skipConfigurations: [] } : null));
          }
          throw error;
        });

      if (!recipeStep || recipeStep.deleted_at) {
        console.log(
          `[Timer Task] ❌ Cancelling task ${task.id}: recipe step is deleted (step_id=${task.recipe_step_id})`
        );
        await prisma.orchestrationTimerTask.update({
          where: { id: task.id },
          data: {
            status: "CANCELLED",
            executed_at: new Date(),
            error_message: "Cancelled - recipe step was deleted",
            deleted_at: new Date(),
          },
        });
        skippedTasks.push(task.id);
        continue;
      }

      const recipe = recipeStep.recipe;
      if (!recipe || !recipe.is_active || recipe.deleted_at) {
        const reason = !recipe
          ? "recipe not found"
          : recipe.deleted_at
            ? "recipe was deleted"
            : !recipe.is_active
              ? "recipe is inactive"
              : "unknown";
        console.log(
          `[Timer Task] ❌ Cancelling task ${task.id}: ${reason} (recipe_id=${recipeStep.recipe_id})`
        );
        await prisma.orchestrationTimerTask.update({
          where: { id: task.id },
          data: {
            status: "CANCELLED",
            executed_at: new Date(),
            error_message: `Cancelled - ${reason}`,
            deleted_at: new Date(),
          },
        });
        skippedTasks.push(task.id);
        continue;
      }

      touchedRecipes.add(recipeStep.recipe_id);

      const now = Date.now();
      const scheduledTime = task.scheduled_at.getTime();
      const isPastScheduledTime = now > scheduledTime;
      const timeSinceScheduled = now - scheduledTime;
      const isInitialTask = task.task_type === "initial";

      // Determine if this is a "Run Now" initial task (no explicit schedule time)
      let isRunNowTask = false;
      if (isInitialTask) {
        const step = await prisma.orchestrationRecipeStep.findUnique({
          where: { id: task.recipe_step_id },
          select: { initial_run_type: true, initial_schedule_time: true },
        });
        isRunNowTask = step?.initial_run_type === "NOW" || !step?.initial_schedule_time;
      }

      // Log task details for debugging
      console.log(
        `[Timer Task] Processing task ${task.id} (${task.task_type}): ` +
          `scheduled=${new Date(scheduledTime).toISOString()}, ` +
          `now=${new Date(now).toISOString()}, ` +
          `isPast=${isPastScheduledTime}, ` +
          `isInitialTask=${isInitialTask}, ` +
          `isRunNowTask=${isRunNowTask}, ` +
          `timeSinceScheduled=${Math.round(timeSinceScheduled / 1000)} seconds`
      );

      // If task is past its scheduled time:
      if (isPastScheduledTime) {
        if (isRunNowTask && timeSinceScheduled <= RUN_NOW_GRACE_PERIOD_MS) {
          // "Run Now" task within 5-minute grace period – allow execution
          console.log(
            `[Timer Task] ✅ Executing "Run Now" initial task ${task.id} (${Math.round(
              timeSinceScheduled / 1000
            )} seconds late, within ${RUN_NOW_GRACE_PERIOD_MS / 1000}s grace)`
          );
          // Continue to execution
        } else if (!isRunNowTask && timeSinceScheduled <= 60_000) {
          // Scheduled task slightly late (<= 60s) – still execute
          console.log(
            `[Timer Task] ✅ Executing scheduled task ${task.id} (${Math.round(
              timeSinceScheduled / 1000
            )} seconds late, within 60s grace window)`
          );
          // Continue to execution
        } else {
          // Outside grace window – cancel instead of executing
          const reason = isRunNowTask
            ? `Cancelled - "Run Now" task past scheduled time and outside ${
                RUN_NOW_GRACE_PERIOD_MS / 1000 / 60
              } minute grace period (${Math.round(timeSinceScheduled / 1000 / 60)} minutes late)`
            : `Cancelled - scheduled task past its scheduled time by ${Math.round(
                timeSinceScheduled / 1000 / 60
              )} minutes (outside 60s grace window)`;
          console.log(`[Timer Task] ❌ Cancelling task ${task.id}: ${reason}`);
          await prisma.orchestrationTimerTask.update({
            where: { id: task.id },
            data: {
              status: "CANCELLED",
              executed_at: new Date(),
              error_message: reason,
            },
          });
          skippedTasks.push(task.id);
          continue;
        }
      } else {
        // Task is due now or in the future - execute it if due now
        console.log(
          `[Timer Task] ✅ Executing task ${task.id} on time (scheduled=${new Date(
            scheduledTime
          ).toISOString()}, now=${new Date(now).toISOString()})`
        );
        // Continue to execution
      }

      const skipStepIds = recipeStep.skipConfigurations?.map((cfg) => cfg.skip_step_id) ?? [];
      if (skipStepIds.length > 0) {
        const toleranceMs = 60 * 1000;
        const conflict = await prisma.orchestrationTimerTask.findFirst({
          where: {
            recipe_step_id: { in: skipStepIds },
            deleted_at: null,
            scheduled_at: {
              gte: new Date(task.scheduled_at.getTime() - toleranceMs),
              lte: new Date(task.scheduled_at.getTime() + toleranceMs),
            },
            status: "PENDING",
          },
          orderBy: { status: "asc" },
        });

        if (conflict) {
          await prisma.orchestrationTimerTask.update({
            where: { id: task.id },
            data: {
              status: "CANCELLED",
              deleted_at: new Date(),
              error_message: `Cancelled due to overlapping with step ${conflict.recipe_step_id}`,
            },
          });
          continue;
        }
      }

      if (task.orchestration_id) {
        const orchestration = await prisma.orchestration.findUnique({
          where: { id: task.orchestration_id },
        });

        if (!orchestration || orchestration.deleted_at) {
          throw new Error("Orchestration not found or deleted");
        }

        const projectIds: string[] = JSON.parse(orchestration.project_ids || "[]");
        const threads: any[] = JSON.parse(orchestration.threads || "[]");

        const orchestrationConfig = {
          id: orchestration.id,
          name: orchestration.name,
          description: orchestration.description || undefined,
          projectIds,
          threads,
          isRunning: false,
          createdAt: orchestration.created_at.toISOString(),
        };

        const { orchestrationExecutor } = await import("@/lib/orchestration-executor");
        orchestrationExecutor.executeOrchestration(orchestrationConfig).catch((error) => {
          console.error(
            `[Timer Task] Error executing orchestration ${task.orchestration_id}:`,
            error
          );
        });
      }

      await prisma.orchestrationTimerTask.update({
        where: { id: task.id },
        data: {
          status: "EXECUTED",
          executed_at: new Date(),
        },
      });

      executedTasks.push(task.id);
    } catch (error) {
      console.error(`Error executing timer task ${task.id}:`, error);
      await prisma.orchestrationTimerTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          error_message: error instanceof Error ? error.message : "Unknown error",
        },
      });

      failed.push({
        id: task.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  for (const recipeId of touchedRecipes) {
    try {
      await ensureRecipeScheduleHorizon(recipeId, referenceTime);
      const stopped = await stopRecipeIfBeyondHorizon(recipeId, referenceTime);
      if (stopped) {
        console.warn(
          `[Timer Task] Recipe ${recipeId} exceeded schedule horizon (>= ${SCHEDULE_HORIZON_DAYS} days) and was stopped.`
        );
      }
    } catch (error) {
      console.error(`Error maintaining schedule horizon for recipe ${recipeId}:`, error);
    }
  }

  return {
    executed: executedTasks.length,
    skipped: skippedTasks.length,
    failed,
  };
}
