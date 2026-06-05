/**
 * Orchestration Recipe Service
 *
 * Generates timer tasks from recipe step configurations
 */

import { prisma } from "@/lib/prisma";

const SKIP_TOLERANCE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SCHEDULE_HORIZON_DAYS = 7;
export const SCHEDULE_HORIZON_MS = SCHEDULE_HORIZON_DAYS * DAY_MS;
function convertLocalTimeToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  if (timezone === "UTC") {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(
      hour
    ).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
    return new Date(dateStr);
  }

  const midnightUTC = new Date(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`
  );

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const formatted = formatter.format(midnightUTC);
  const match = formatted.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/);

  if (!match) {
    return new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(
        hour
      ).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`
    );
  }

  const [, tzMonthStr, tzDayStr, tzYearStr, tzHourStr, tzMinuteStr] = match;
  const tzYear = Number(tzYearStr);
  const tzMonth = Number(tzMonthStr);
  const tzDay = Number(tzDayStr);
  const tzHour = Number(tzHourStr);
  const tzMinute = Number(tzMinuteStr);

  const isPreviousDay =
    tzYear < year || (tzYear === year && (tzMonth < month || (tzMonth === month && tzDay < day)));

  let offsetHours: number;
  let offsetMinutes: number;

  if (isPreviousDay) {
    offsetHours = 24 - tzHour;
    offsetMinutes = -tzMinute;
  } else {
    offsetHours = tzHour;
    offsetMinutes = tzMinute;
  }

  let targetHourUTC = hour + offsetHours;
  let targetMinuteUTC = minute + offsetMinutes;

  if (targetMinuteUTC < 0) {
    targetMinuteUTC += 60;
    targetHourUTC -= 1;
  } else if (targetMinuteUTC >= 60) {
    targetMinuteUTC -= 60;
    targetHourUTC += 1;
  }

  let finalDay = day;
  if (targetHourUTC < 0) {
    targetHourUTC += 24;
    finalDay -= 1;
  } else if (targetHourUTC >= 24) {
    targetHourUTC -= 24;
    finalDay += 1;
  }

  return new Date(
    `${year}-${String(month).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}T${String(
      targetHourUTC
    ).padStart(2, "0")}:${String(targetMinuteUTC).padStart(2, "0")}:00Z`
  );
}

function getLocalDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function getNextOccurrenceLocalTime(
  hour: number,
  minute: number,
  timezone: string,
  referenceDate: Date
): Date {
  const { year, month, day } = getLocalDateParts(referenceDate, timezone);
  let candidate = convertLocalTimeToUTC(year, month, day, hour, minute, timezone);

  // Only move to tomorrow if the candidate time is actually in the past (not equal or future)
  // Use strict less-than comparison so times set for "now" or in the next few minutes use today
  if (candidate < referenceDate) {
    const nextDate = new Date(referenceDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextParts = getLocalDateParts(nextDate, timezone);
    candidate = convertLocalTimeToUTC(
      nextParts.year,
      nextParts.month,
      nextParts.day,
      hour,
      minute,
      timezone
    );
  }

  return candidate;
}

function getScheduleHorizon(referenceTime: Date): Date {
  return new Date(referenceTime.getTime() + SCHEDULE_HORIZON_MS);
}

function alignToAnchor(time: Date, anchor: Date, intervalMs: number): Date {
  const delta = time.getTime() - anchor.getTime();
  const remainder = ((delta % intervalMs) + intervalMs) % intervalMs;
  if (remainder === 0) {
    return time;
  }
  return new Date(time.getTime() + (intervalMs - remainder));
}

async function getPrimaryStepAnchorTime(
  recipeId: string,
  referenceTime: Date
): Promise<Date | null> {
  // Get the first step (sequence = 1) of this recipe
  const firstStep = await prisma.orchestrationRecipeStep.findFirst({
    where: {
      recipe_id: recipeId,
      sequence: 1,
      deleted_at: null,
    },
  });

  if (!firstStep) {
    return null;
  }

  // CRITICAL: If the first step has an explicit start time, don't use anchor alignment
  // The start time is the user's explicit choice and should not be overridden
  if (firstStep.initial_schedule_time) {
    return null; // No anchor alignment when start time is explicitly set
  }

  // CRITICAL FIX: Only use EXECUTED tasks that are in the past (<= referenceTime)
  // Never use PENDING tasks as anchors, as they can be in the future and cause
  // hourly tasks to be scheduled way too far ahead
  const anchorTask = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipe_step_id: firstStep.id,
      task_type: "hourly",
      status: "EXECUTED", // Only use EXECUTED tasks, not PENDING
      deleted_at: null,
      scheduled_at: {
        lte: referenceTime, // Only use tasks in the past, not future
      },
    },
    orderBy: { scheduled_at: "desc" },
  });

  return anchorTask?.scheduled_at ?? null;
}

type PendingTaskSeed = {
  id: string;
  recipe_step_id: string;
  orchestration_id: string;
  task_type: "initial" | "hourly" | "daily";
  scheduled_at: Date;
  status: "PENDING";
};

async function ensureInitialTask(
  step: {
    id: string;
    orchestration_id: string;
    initial_enabled: boolean;
    initial_run_type: "NOW" | "SCHEDULED" | null;
    initial_schedule_time: string | null;
  },
  timezone: string,
  referenceTime: Date,
  tasks: PendingTaskSeed[]
) {
  if (!step.initial_enabled) {
    return;
  }

  // CRITICAL: Check for ANY existing initial task (PENDING or EXECUTED)
  // Initial tasks should only run ONCE per step lifecycle, not repeatedly
  // Only create a new initial task if there's no existing one at all
  const existingInitial = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipe_step_id: step.id,
      task_type: "initial",
      deleted_at: null,
      // Check for PENDING (not yet executed) OR EXECUTED (already ran successfully)
      // Don't create a new one if either exists
      status: {
        in: ["PENDING", "EXECUTED"],
      },
    },
  });

  if (existingInitial) {
    // Already have an initial task - don't create another one
    return;
  }

  const { ulid: generateUlid } = await import("ulid");
  let scheduledAt = referenceTime;

  if (step.initial_run_type === "SCHEDULED" && step.initial_schedule_time) {
    const [initialHour, initialMinute] = step.initial_schedule_time.split(":").map(Number);
    if (!Number.isNaN(initialHour) && !Number.isNaN(initialMinute)) {
      scheduledAt = getNextOccurrenceLocalTime(initialHour, initialMinute, timezone, referenceTime);
      // If scheduled time is in the past (more than 1 hour ago), schedule for now instead
      // This prevents tasks from being skipped when recipe is activated after the scheduled time
      // Matches the 1-hour tolerance used when processing initial tasks
      const timeDiff = scheduledAt.getTime() - referenceTime.getTime();
      const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour
      if (timeDiff < -ONE_HOUR_MS) {
        // More than 1 hour in the past
        console.log(
          `[Timer Task] Initial task for step ${step.id} was scheduled for ${scheduledAt.toISOString()} (more than 1 hour ago), rescheduling for now`
        );
        scheduledAt = referenceTime;
      }
    }
  }

  tasks.push({
    id: generateUlid(),
    recipe_step_id: step.id,
    orchestration_id: step.orchestration_id,
    task_type: "initial",
    scheduled_at: scheduledAt,
    status: "PENDING",
  });
}

async function ensureHourlyTasks(
  step: {
    id: string;
    orchestration_id: string;
    hourly_interval: number | null;
    recipe_id: string;
    sequence: number;
    initial_schedule_time: string | null;
  },
  timezone: string,
  referenceTime: Date,
  horizon: Date,
  tasks: PendingTaskSeed[]
) {
  if (!step.hourly_interval || step.hourly_interval < 1 || step.hourly_interval > 23) {
    return;
  }

  // Only get anchor time for steps after the first one (sequence > 1)
  // Anchor must be an EXECUTED task in the past, never a PENDING future task
  const anchorTime =
    step.sequence > 1 ? await getPrimaryStepAnchorTime(step.recipe_id, referenceTime) : null;

  // Only check for misalignment if we have a valid past anchor
  if (anchorTime && anchorTime <= referenceTime) {
    const misalignedPending = await prisma.orchestrationTimerTask.findMany({
      where: {
        recipe_step_id: step.id,
        task_type: "hourly",
        status: "PENDING",
        deleted_at: null,
      },
      orderBy: { scheduled_at: "asc" },
    });

    const intervalMs = step.hourly_interval * 60 * 60 * 1000;
    const hasMisalignment = misalignedPending.some((task) => {
      const delta = task.scheduled_at.getTime() - anchorTime.getTime();
      return delta % intervalMs !== 0;
    });

    if (hasMisalignment && misalignedPending.length > 0) {
      await prisma.orchestrationTimerTask.deleteMany({
        where: {
          recipe_step_id: step.id,
          task_type: "hourly",
          status: "PENDING",
          deleted_at: null,
        },
      });
    }
  }

  const { ulid: generateUlid } = await import("ulid");
  const intervalMs = step.hourly_interval * 60 * 60 * 1000;
  let baseTime: Date | null = null;
  let lastExecuted: { scheduled_at: Date } | null = null;
  let useStartTimeDirectly = false;

  // CRITICAL: initial_schedule_time ALWAYS takes precedence - check it FIRST
  // This ensures the user's requested start time is always respected, even if pending tasks exist
  if (step.initial_schedule_time) {
    const [hour, minute] = step.initial_schedule_time.split(":").map(Number);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      const scheduledStartTime = getNextOccurrenceLocalTime(hour, minute, timezone, referenceTime);
      // Always use the start time if it's set - it's the user's explicit choice
      baseTime = scheduledStartTime;
      // If the start time is in the future, use it directly as the first scheduled time
      if (scheduledStartTime > referenceTime) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        useStartTimeDirectly = true;
      }
    }
  }

  // Only check for pending/executed tasks if no start time was set
  if (!baseTime) {
    const lastPending = await prisma.orchestrationTimerTask.findFirst({
      where: {
        recipe_step_id: step.id,
        task_type: "hourly",
        status: "PENDING",
        deleted_at: null,
      },
      orderBy: { scheduled_at: "desc" },
    });

    baseTime = lastPending?.scheduled_at ?? null;

    if (!baseTime) {
      lastExecuted = await prisma.orchestrationTimerTask.findFirst({
        where: {
          recipe_step_id: step.id,
          task_type: "hourly",
          status: "EXECUTED",
          deleted_at: null,
          scheduled_at: {
            lte: referenceTime,
          },
        },
        orderBy: { scheduled_at: "desc" },
      });

      baseTime = lastExecuted?.scheduled_at ?? anchorTime ?? referenceTime;
    }
  }

  // If initial_schedule_time is set, ALWAYS use it as the first run time
  // This is the user's explicit choice and takes precedence over everything
  let nextTime: Date;
  if (step.initial_schedule_time) {
    // The start time is set - calculate it directly from the time string
    const [hour, minute] = step.initial_schedule_time.split(":").map(Number);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      // Get the next occurrence of this time (handles past times automatically)
      nextTime = getNextOccurrenceLocalTime(hour, minute, timezone, referenceTime);

      // CRITICAL: Log what we're calculating for debugging
      console.log(
        `[Hourly Task] Step ${step.sequence}: initial_schedule_time=${step.initial_schedule_time}, ` +
          `calculated nextTime=${nextTime.toISOString()}, referenceTime=${referenceTime.toISOString()}, ` +
          `timezone=${timezone}`
      );

      // If it's still in the past (shouldn't happen, but be safe), add one day
      while (nextTime <= referenceTime) {
        nextTime = new Date(nextTime.getTime() + DAY_MS);
      }
    } else {
      // Invalid time format - fallback to interval from now
      console.warn(
        `[Hourly Task] Step ${step.sequence}: Invalid initial_schedule_time format: "${step.initial_schedule_time}", ` +
          `falling back to interval from now`
      );
      nextTime = new Date(referenceTime.getTime() + intervalMs);
    }
  } else {
    // No start time set - calculate from baseTime (pending/executed task or anchor/reference)
    console.log(
      `[Hourly Task] Step ${step.sequence}: No initial_schedule_time set, using baseTime=${baseTime.toISOString()}, ` +
        `adding interval=${intervalMs}ms`
    );
    nextTime = new Date(baseTime.getTime() + intervalMs);

    // Only align to anchor if it exists and is in the past (not a future task)
    if (anchorTime && anchorTime <= referenceTime) {
      nextTime = alignToAnchor(nextTime, anchorTime, intervalMs);
    }

    // Advance until we land on a time strictly in the future.
    while (nextTime <= referenceTime) {
      nextTime = new Date(nextTime.getTime() + intervalMs);
      if (anchorTime && anchorTime <= referenceTime) {
        nextTime = alignToAnchor(nextTime, anchorTime, intervalMs);
      }
    }
  }

  while (nextTime <= horizon) {
    tasks.push({
      id: generateUlid(),
      recipe_step_id: step.id,
      orchestration_id: step.orchestration_id,
      task_type: "hourly",
      scheduled_at: nextTime,
      status: "PENDING",
    });

    // For subsequent runs: if start time is set, just add interval (no anchor alignment)
    // If no start time, align to anchor if it exists
    if (step.initial_schedule_time) {
      // User specified start time - subsequent runs are just interval-based from start time
      nextTime = new Date(nextTime.getTime() + intervalMs);
    } else {
      // No start time - align to anchor if it exists
      nextTime =
        anchorTime && anchorTime <= referenceTime
          ? alignToAnchor(new Date(nextTime.getTime() + intervalMs), anchorTime, intervalMs)
          : new Date(nextTime.getTime() + intervalMs);
    }
  }
}

async function ensureDailyTasks(
  step: {
    id: string;
    orchestration_id: string;
    daily_interval: number | null;
    daily_time: string | null;
  },
  timezone: string,
  referenceTime: Date,
  horizon: Date,
  tasks: PendingTaskSeed[]
) {
  if (
    !step.daily_interval ||
    step.daily_interval < 1 ||
    step.daily_interval > 100 ||
    !step.daily_time
  ) {
    return;
  }

  const [hours, minutes] = step.daily_time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return;
  }

  const lastPending = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipe_step_id: step.id,
      task_type: "daily",
      status: "PENDING",
      deleted_at: null,
    },
    orderBy: { scheduled_at: "desc" },
  });

  const { ulid: generateUlid } = await import("ulid");
  const intervalMs = step.daily_interval * DAY_MS;
  let baseTime = lastPending?.scheduled_at ?? null;

  if (!baseTime) {
    const lastExecuted = await prisma.orchestrationTimerTask.findFirst({
      where: {
        recipe_step_id: step.id,
        task_type: "daily",
        status: "EXECUTED",
        deleted_at: null,
        scheduled_at: {
          lte: referenceTime,
        },
      },
      orderBy: { scheduled_at: "desc" },
    });

    baseTime = lastExecuted?.scheduled_at ?? null;
  }

  let nextTime: Date;
  if (baseTime) {
    nextTime = new Date(baseTime.getTime() + intervalMs);
  } else {
    nextTime = getNextOccurrenceLocalTime(hours, minutes, timezone, referenceTime);
  }

  if (nextTime <= referenceTime) {
    nextTime = getNextOccurrenceLocalTime(hours, minutes, timezone, referenceTime);
  }

  while (nextTime <= horizon) {
    tasks.push({
      id: generateUlid(),
      recipe_step_id: step.id,
      orchestration_id: step.orchestration_id,
      task_type: "daily",
      scheduled_at: nextTime,
      status: "PENDING",
    });

    nextTime = new Date(nextTime.getTime() + intervalMs);
  }
}

/**
 * Generate timer tasks based on recipe step configuration
 */
export async function generateTimerTasksFromRecipeStep(
  recipeStepId: string,
  referenceTime: Date = new Date()
): Promise<void> {
  const step = await prisma.orchestrationRecipeStep.findUnique({
    where: { id: recipeStepId },
    include: {
      recipe: true,
      skipConfigurations: {
        select: {
          skip_step_id: true,
        },
      },
    },
  });

  if (!step || step.deleted_at) {
    return;
  }

  if (!step.recipe.is_active || step.recipe.deleted_at) {
    return;
  }

  const timezone = step.recipe.timezone || "UTC";
  const horizon = getScheduleHorizon(referenceTime);
  const tasks: Array<{
    id: string;
    recipe_step_id: string;
    orchestration_id: string;
    task_type: "initial" | "hourly" | "daily";
    scheduled_at: Date;
    status: "PENDING";
  }> = [];

  await ensureInitialTask(step, timezone, referenceTime, tasks);
  await ensureHourlyTasks(
    {
      id: step.id,
      orchestration_id: step.orchestration_id,
      hourly_interval: step.hourly_interval,
      recipe_id: step.recipe_id,
      sequence: step.sequence,
      initial_schedule_time: step.initial_schedule_time,
    },
    timezone,
    referenceTime,
    horizon,
    tasks
  );
  await ensureDailyTasks(step, timezone, referenceTime, horizon, tasks);

  if (tasks.length === 0) {
    return;
  }

  // Deduplicate: Check for existing PENDING tasks with the same scheduled_at time and task_type
  // This prevents duplicates even if ensureRecipeScheduleHorizon is called multiple times
  const existingTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipe_step_id: step.id,
      deleted_at: null,
      status: "PENDING",
      OR: tasks.map((t) => ({
        AND: [{ scheduled_at: t.scheduled_at }, { task_type: t.task_type }],
      })),
    },
    select: { scheduled_at: true, task_type: true },
  });

  const existingKeys = new Set(
    existingTasks.map((t) => `${t.scheduled_at.getTime()}:${t.task_type}`)
  );
  const uniqueTasks = tasks.filter(
    (t) => !existingKeys.has(`${t.scheduled_at.getTime()}:${t.task_type}`)
  );

  if (uniqueTasks.length === 0) {
    return;
  }

  // Use createMany and gracefully handle duplicates (SQLite doesn't support skipDuplicates)
  try {
    await prisma.orchestrationTimerTask.createMany({
      data: uniqueTasks,
    });
  } catch (error: any) {
    // If unique constraint violation occurs, log and continue
    // This is a safety net in case of race conditions
    if (error.code === "P2002" || error.message?.includes("UNIQUE constraint")) {
      console.warn(`[Timer Task] Duplicate task prevented for step ${step.id}, this is expected`);
    } else {
      throw error;
    }
  }
}

/**
 * Generate timer tasks for all active steps in a recipe
 */
export async function generateTimerTasksFromRecipe(
  recipeId: string,
  referenceTime: Date = new Date()
): Promise<void> {
  const recipe = await prisma.orchestrationRecipe.findUnique({
    where: { id: recipeId },
    include: {
      steps: {
        where: { deleted_at: null },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (!recipe || !recipe.is_active || recipe.deleted_at) {
    return;
  }

  // Generate tasks for each step
  for (const step of recipe.steps) {
    await generateTimerTasksFromRecipeStep(step.id, referenceTime);
  }
}

export async function ensureRecipeScheduleHorizon(
  recipeId: string,
  referenceTime: Date = new Date()
): Promise<void> {
  const recipe = await prisma.orchestrationRecipe.findUnique({
    where: { id: recipeId, deleted_at: null },
    include: {
      steps: {
        where: { deleted_at: null },
        orderBy: { sequence: "asc" },
      },
    },
  });

  if (!recipe || !recipe.is_active || recipe.deleted_at || recipe.steps.length === 0) {
    return;
  }

  const horizon = getScheduleHorizon(referenceTime);

  // 1) Ensure horizon is filled out to SCHEDULE_HORIZON_DAYS using the normal generation logic
  for (const step of recipe.steps) {
    // Ensure we only extend horizon; skip if we already have pending tasks beyond horizon
    const latestTask = await prisma.orchestrationTimerTask.findFirst({
      where: {
        recipe_step_id: step.id,
        deleted_at: null,
        status: "PENDING",
      },
      orderBy: { scheduled_at: "desc" },
      select: { scheduled_at: true },
    });

    if (latestTask && latestTask.scheduled_at >= horizon) {
      continue;
    }

    await generateTimerTasksFromRecipeStep(step.id, referenceTime);
  }

  // 2) Sanity: ensure we have at least 7 distinct scheduled days for this recipe's tasks.
  // If we only have 6 or fewer, extend by one more day by mirroring the previous day's pattern.
  const tasksForRecipe = await prisma.orchestrationTimerTask.findMany({
    where: {
      recipeStep: {
        recipe_id: recipeId,
        deleted_at: null,
      },
      deleted_at: null,
      status: "PENDING",
      scheduled_at: {
        gte: referenceTime,
      },
    },
    orderBy: { scheduled_at: "asc" },
  });

  if (tasksForRecipe.length > 0) {
    // Build a set of distinct calendar days (in recipe timezone)
    const dayKey = (d: Date) =>
      d.toLocaleDateString("en-CA", { timeZone: recipe.timezone || "UTC" }); // YYYY-MM-DD
    const days = Array.from(new Set(tasksForRecipe.map((t) => dayKey(t.scheduled_at)))).sort();

    if (days.length < SCHEDULE_HORIZON_DAYS) {
      const lastDayKey = days[days.length - 1];
      const lastDayTasks = tasksForRecipe.filter((t) => dayKey(t.scheduled_at) === lastDayKey);

      if (lastDayTasks.length > 0) {
        const { ulid: generateUlid } = await import("ulid");

        // Compute delta to "next day" in recipe timezone by shifting 24h.
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const newTasksData = lastDayTasks.map((t) => ({
          id: generateUlid(),
          recipe_step_id: t.recipe_step_id,
          orchestration_id: t.orchestration_id,
          task_type: t.task_type,
          scheduled_at: new Date(t.scheduled_at.getTime() + ONE_DAY_MS),
          status: "PENDING" as const,
        }));

        // Insert the extra day's tasks
        await prisma.orchestrationTimerTask.createMany({
          data: newTasksData,
        });
      }
    }
  }

  // 3) Run deduplication to ensure we never have duplicate (step, time, type) tasks
  await checkForDuplicateTimerTasks();
}

export async function ensureScheduleHorizonForAllActiveRecipes(
  referenceTime: Date = new Date()
): Promise<void> {
  const activeRecipes = await prisma.orchestrationRecipe.findMany({
    where: {
      is_active: true,
      deleted_at: null,
    },
    select: { id: true },
  });

  for (const recipe of activeRecipes) {
    await ensureRecipeScheduleHorizon(recipe.id, referenceTime);
  }
}

export async function stopRecipeIfBeyondHorizon(
  recipeId: string,
  referenceTime: Date = new Date()
): Promise<boolean> {
  const futureTask = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipeStep: {
        recipe_id: recipeId,
        recipe: {
          deleted_at: null,
        },
        deleted_at: null,
      },
      deleted_at: null,
      status: "PENDING",
      scheduled_at: {
        gte: referenceTime,
      },
    },
  });

  if (futureTask) {
    return false;
  }

  const lastTask = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipeStep: {
        recipe_id: recipeId,
        recipe: {
          deleted_at: null,
        },
        deleted_at: null,
      },
      deleted_at: null,
    },
    orderBy: { scheduled_at: "desc" },
  });

  if (!lastTask) {
    return false;
  }

  if (referenceTime.getTime() - lastTask.scheduled_at.getTime() >= SCHEDULE_HORIZON_MS) {
    await prisma.orchestrationRecipe.update({
      where: { id: recipeId },
      data: {
        is_active: false,
      },
    });
    return true;
  }

  return false;
}

/**
 * Get pending timer tasks that are due to execute
 */
export async function getPendingTimerTasks(limit: number = 10): Promise<
  Array<{
    id: string;
    recipe_step_id: string;
    orchestration_id: string;
    task_type: string;
    scheduled_at: Date;
    created_at: Date;
  }>
> {
  const now = new Date();
  const tasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      status: "PENDING",
      scheduled_at: { lte: now },
      deleted_at: null,
      // NOTE: We intentionally DO NOT filter by recipe.is_active or recipe/step deleted state here.
      // The timer task processor is responsible for:
      // - Cancelling tasks whose recipe or step has been deleted
      // - Cancelling tasks for recipes that are stopped (not running)
      // This allows us to lazily cancel tasks at run time, matching the desired semantics.
    },
    orderBy: { scheduled_at: "asc" },
    take: limit,
    select: {
      id: true,
      recipe_step_id: true,
      orchestration_id: true,
      task_type: true,
      scheduled_at: true,
      created_at: true,
    },
  });

  return tasks;
}

type PreviewTaskType = "initial" | "hourly" | "daily";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface PreviewCandidate {
  stepId: string;
  stepSequence: number;
  orchestrationId: string;
  orchestrationName: string;
  taskType: PreviewTaskType;
  scheduledAt: Date;
}

function formatLocalDateTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export async function previewRecipeSchedule(
  recipeId: string,
  options?: { limit?: number; referenceTime?: Date }
): Promise<{
  timezone: string;
  generatedAt: string;
  runs: Array<{
    stepId: string;
    stepSequence: number;
    orchestrationId: string;
    orchestrationName: string;
    taskType: PreviewTaskType;
    scheduledAtUtc: string;
    scheduledAtLocal: string;
    status: string;
    executedAtUtc?: string;
    executedAtLocal?: string;
    errorMessage?: string;
  }>;
  skipped: Array<{
    stepId: string;
    stepSequence: number;
    orchestrationId: string;
    orchestrationName: string;
    taskType: PreviewTaskType;
    scheduledAtUtc: string;
    scheduledAtLocal: string;
    status: string;
    skippedBecauseStepId: string;
    skippedBecauseStepSequence: number;
  }>;
}> {
  const limit = options?.limit ?? 100;
  const referenceTime = options?.referenceTime ?? new Date();

  const recipe = await prisma.orchestrationRecipe.findFirst({
    where: { id: recipeId, deleted_at: null },
    include: {
      steps: {
        where: { deleted_at: null },
        orderBy: { sequence: "asc" },
        include: {
          orchestration: {
            select: {
              id: true,
              name: true,
            },
          },
          skipConfigurations: {
            include: {
              skipStep: {
                select: {
                  id: true,
                  sequence: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!recipe) {
    throw new Error("Recipe not found");
  }

  const timezone = recipe.timezone || "UTC";
  const stepIds = recipe.steps.map((s) => s.id);

  // CRITICAL: Use the ACTUAL task generation logic, not theoretical calculations
  // For inactive recipes, simulate what WOULD be created if activated right now
  // For active recipes, show what's actually scheduled in the database

  let actualTasks: Array<{
    id: string;
    recipe_step_id: string;
    orchestration_id: string;
    task_type: string;
    scheduled_at: Date;
    executed_at: Date | null;
    status: string;
    error_message: string | null;
    recipeStep: {
      orchestration: {
        id: string;
        name: string;
      };
    };
  }> = [];

  if (recipe.is_active) {
    // Recipe is active - show what's ACTUALLY scheduled in the database.
    // This makes Test Schedule a true window into the real timer tasks the runner will process.
    const dbTasks = await prisma.orchestrationTimerTask.findMany({
      where: {
        recipe_step_id: { in: stepIds },
        deleted_at: null,
        // Only show upcoming and recently executed tasks to keep the preview relevant
        scheduled_at: {
          gte: referenceTime,
        },
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
          },
        },
      },
      orderBy: { scheduled_at: "asc" },
      take: limit * 2,
    });

    actualTasks = dbTasks;
  } else {
    // Recipe is inactive - use ACTUAL task generation logic to preview what WOULD be created
    // CRITICAL: For inactive recipes, simulate a FRESH START - ignore any existing tasks in DB
    // This ensures the preview shows exactly what will be created when the recipe is activated
    const previewTasks: PendingTaskSeed[] = [];
    const horizon = getScheduleHorizon(referenceTime);

    // Build step map for orchestration lookups
    const stepMapWithOrchestration = new Map(
      recipe.steps.map((s) => [
        s.id,
        {
          step: s,
          orchestration: s.orchestration,
        },
      ])
    );

    for (const step of recipe.steps) {
      if (!step.orchestration) {
        continue;
      }

      // For preview of inactive recipe, simulate fresh start:
      // - Initial tasks: only create if initial_enabled is true
      // - Hourly/Daily tasks: calculate from referenceTime, ignoring existing DB tasks

      // Initial task preview (only if enabled)
      if (step.initial_enabled) {
        const { ulid: generateUlid } = await import("ulid");
        let scheduledAt = referenceTime;
        if (step.initial_run_type === "SCHEDULED" && step.initial_schedule_time) {
          const [initialHour, initialMinute] = step.initial_schedule_time.split(":").map(Number);
          if (!Number.isNaN(initialHour) && !Number.isNaN(initialMinute)) {
            scheduledAt = getNextOccurrenceLocalTime(
              initialHour,
              initialMinute,
              timezone,
              referenceTime
            );
            const timeDiff = scheduledAt.getTime() - referenceTime.getTime();
            const ONE_HOUR_MS = 60 * 60 * 1000;
            if (timeDiff < -ONE_HOUR_MS) {
              scheduledAt = referenceTime;
            }
          }
        }
        previewTasks.push({
          id: generateUlid(),
          recipe_step_id: step.id,
          orchestration_id: step.orchestration_id,
          task_type: "initial",
          scheduled_at: scheduledAt,
          status: "PENDING",
        });
      }

      // Hourly tasks preview - use same logic but ignore existing DB tasks
      if (step.hourly_interval && step.hourly_interval >= 1 && step.hourly_interval <= 23) {
        const { ulid: generateUlid } = await import("ulid");
        const intervalMs = step.hourly_interval * 60 * 60 * 1000;

        // Get anchor time for alignment (only for steps after first)
        const anchorTime =
          step.sequence > 1 ? await getPrimaryStepAnchorTime(step.recipe_id, referenceTime) : null;

        // If initial_schedule_time is set, ALWAYS use it as the first run time
        // This is the user's explicit choice and takes precedence over everything
        let nextTime: Date;
        if (step.initial_schedule_time) {
          // The start time is set - calculate it directly from the time string
          const [hour, minute] = step.initial_schedule_time.split(":").map(Number);
          if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
            // Get the next occurrence of this time (handles past times automatically)
            nextTime = getNextOccurrenceLocalTime(hour, minute, timezone, referenceTime);
            // If it's still in the past (shouldn't happen, but be safe), add one day
            while (nextTime <= referenceTime) {
              nextTime = new Date(nextTime.getTime() + DAY_MS);
            }
          } else {
            // Invalid time format - fallback to interval from now
            nextTime = new Date(referenceTime.getTime() + intervalMs);
          }
        } else {
          // No start time set - calculate from anchor/reference
          const baseTime = anchorTime ?? referenceTime;
          nextTime = new Date(baseTime.getTime() + intervalMs);

          // Only align to anchor if it exists and is in the past (not a future task)
          if (anchorTime && anchorTime <= referenceTime) {
            nextTime = alignToAnchor(nextTime, anchorTime, intervalMs);
          }

          // Advance until we land on a time strictly in the future.
          while (nextTime <= referenceTime) {
            nextTime = new Date(nextTime.getTime() + intervalMs);
            if (anchorTime && anchorTime <= referenceTime) {
              nextTime = alignToAnchor(nextTime, anchorTime, intervalMs);
            }
          }
        }

        while (nextTime <= horizon) {
          previewTasks.push({
            id: generateUlid(),
            recipe_step_id: step.id,
            orchestration_id: step.orchestration_id,
            task_type: "hourly",
            scheduled_at: nextTime,
            status: "PENDING",
          });

          // For subsequent runs: if start time is set, just add interval (no anchor alignment)
          // If no start time, align to anchor if it exists
          if (step.initial_schedule_time) {
            // User specified start time - subsequent runs are just interval-based from start time
            nextTime = new Date(nextTime.getTime() + intervalMs);
          } else {
            // No start time - align to anchor if it exists
            nextTime =
              anchorTime && anchorTime <= referenceTime
                ? alignToAnchor(new Date(nextTime.getTime() + intervalMs), anchorTime, intervalMs)
                : new Date(nextTime.getTime() + intervalMs);
          }
        }
      }

      // Daily tasks preview - use same logic but ignore existing DB tasks
      if (
        step.daily_interval &&
        step.daily_interval >= 1 &&
        step.daily_interval <= 100 &&
        step.daily_time
      ) {
        const [hours, minutes] = step.daily_time.split(":").map(Number);
        if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
          const { ulid: generateUlid } = await import("ulid");
          const intervalMs = step.daily_interval * DAY_MS;

          // For preview, start from the next occurrence of the daily time
          let nextTime = getNextOccurrenceLocalTime(hours, minutes, timezone, referenceTime);

          while (nextTime <= horizon) {
            previewTasks.push({
              id: generateUlid(),
              recipe_step_id: step.id,
              orchestration_id: step.orchestration_id,
              task_type: "daily",
              scheduled_at: nextTime,
              status: "PENDING",
            });

            nextTime = new Date(nextTime.getTime() + intervalMs);
          }
        }
      }
    }

    // Convert preview tasks to the format expected by the rest of the function
    // Check for existing tasks to deduplicate (same logic as generateTimerTasksFromRecipeStep)
    if (previewTasks.length > 0) {
      const existingTasks = await prisma.orchestrationTimerTask.findMany({
        where: {
          recipe_step_id: { in: stepIds },
          deleted_at: null,
          status: "PENDING",
          OR: previewTasks.map((t) => ({
            AND: [{ scheduled_at: t.scheduled_at }, { task_type: t.task_type }],
          })),
        },
        select: { scheduled_at: true, task_type: true },
      });

      const existingKeys = new Set(
        existingTasks.map((t) => `${t.scheduled_at.getTime()}:${t.task_type}`)
      );
      const uniquePreviewTasks = previewTasks.filter(
        (t) => !existingKeys.has(`${t.scheduled_at.getTime()}:${t.task_type}`)
      );

      // Map preview tasks to the expected format
      actualTasks = uniquePreviewTasks
        .map((task) => {
          const stepInfo = stepMapWithOrchestration.get(task.recipe_step_id);
          return {
            id: task.id,
            recipe_step_id: task.recipe_step_id,
            orchestration_id: task.orchestration_id,
            task_type: task.task_type,
            scheduled_at: task.scheduled_at,
            executed_at: null,
            status: "PENDING" as const, // Preview tasks are always PENDING
            error_message: null,
            recipeStep: {
              orchestration: {
                id: stepInfo?.orchestration?.id || task.orchestration_id,
                name: stepInfo?.orchestration?.name || "Unknown",
              },
            },
          };
        })
        // Sort by scheduled_at ascending (next execution first - earliest scheduled)
        .sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime());
    }
  }

  if (actualTasks.length === 0) {
    // No tasks found (active) or would be generated (inactive)
    return {
      timezone,
      generatedAt: referenceTime.toISOString(),
      runs: [],
      skipped: [],
    };
  }

  // If recipe is inactive and all tasks are CANCELLED, note this in the response
  // The UI should show a warning that the recipe needs to be activated

  // Build a map of steps for quick lookup
  const stepMap = new Map(recipe.steps.map((s) => [s.id, s]));

  // Build skip map for determining skipped tasks
  const skipMap = new Map<string, Array<{ id: string; sequence: number }>>();
  for (const step of recipe.steps) {
    if (step.skipConfigurations && step.skipConfigurations.length > 0) {
      skipMap.set(
        step.id,
        step.skipConfigurations.map((cfg) =>
          cfg.skipStep
            ? { id: cfg.skipStep.id, sequence: cfg.skipStep.sequence }
            : { id: cfg.skip_step_id, sequence: Number.NaN }
        )
      );
    }
  }

  const runs: Array<{
    stepId: string;
    stepSequence: number;
    orchestrationId: string;
    orchestrationName: string;
    taskType: PreviewTaskType;
    scheduledAtUtc: string;
    scheduledAtLocal: string;
    status: string;
    executedAtUtc?: string;
    executedAtLocal?: string;
    errorMessage?: string;
  }> = [];

  const skipped: Array<{
    stepId: string;
    stepSequence: number;
    orchestrationId: string;
    orchestrationName: string;
    taskType: PreviewTaskType;
    scheduledAtUtc: string;
    scheduledAtLocal: string;
    status: string;
    skippedBecauseStepId: string;
    skippedBecauseStepSequence: number;
  }> = [];

  // Process actual tasks from database
  for (const task of actualTasks) {
    if (runs.length >= limit && skipped.length >= limit) {
      break;
    }

    const step = stepMap.get(task.recipe_step_id);
    if (!step || !task.recipeStep?.orchestration) {
      continue;
    }

    const taskData = {
      stepId: task.recipe_step_id,
      stepSequence: step.sequence,
      orchestrationId: task.orchestration_id,
      orchestrationName: task.recipeStep.orchestration.name,
      taskType: task.task_type as PreviewTaskType,
      scheduledAtUtc: task.scheduled_at.toISOString(),
      scheduledAtLocal: formatLocalDateTime(task.scheduled_at, timezone),
      status: task.status,
      executedAtUtc: task.executed_at ? task.executed_at.toISOString() : undefined,
      executedAtLocal: task.executed_at
        ? formatLocalDateTime(task.executed_at, timezone)
        : undefined,
      errorMessage: task.error_message || undefined,
    };

    // Check if this task was skipped due to skip configurations
    if (task.status === "CANCELLED" && task.error_message?.includes("overlapping")) {
      const potentialConflicts = skipMap.get(task.recipe_step_id) ?? [];
      if (potentialConflicts.length > 0) {
        // Try to find the conflicting task
        const conflictingTask = actualTasks.find(
          (t) =>
            t.id !== task.id &&
            potentialConflicts.some((skip) => skip.id === t.recipe_step_id) &&
            Math.abs(t.scheduled_at.getTime() - task.scheduled_at.getTime()) <= SKIP_TOLERANCE_MS &&
            t.status === "PENDING"
        );

        if (conflictingTask) {
          const conflictStep = stepMap.get(conflictingTask.recipe_step_id);
          if (conflictStep) {
            skipped.push({
              ...taskData,
              status: task.status || "SKIPPED",
              skippedBecauseStepId: conflictStep.id,
              skippedBecauseStepSequence: conflictStep.sequence,
            });
            continue;
          }
        }
      }
    }

    runs.push(taskData);
  }

  return {
    timezone,
    generatedAt: referenceTime.toISOString(),
    runs,
    skipped,
  };
}

/**
 * Find and remove duplicate timer tasks
 * This function identifies tasks with the same recipe_step_id, scheduled_at, and task_type
 * and keeps only the oldest one (by created_at), marking others as deleted
 */
export async function deduplicateTimerTasks(): Promise<{
  duplicatesFound: number;
  duplicatesRemoved: number;
  details: Array<{
    recipe_step_id: string;
    scheduled_at: Date;
    task_type: string;
    kept: string;
    removed: string[];
  }>;
}> {
  // Find all PENDING tasks grouped by recipe_step_id, scheduled_at, and task_type
  const allPendingTasks = await prisma.orchestrationTimerTask.findMany({
    where: {
      status: "PENDING",
      deleted_at: null,
    },
    orderBy: [
      { recipe_step_id: "asc" },
      { scheduled_at: "asc" },
      { task_type: "asc" },
      { created_at: "asc" },
    ],
  });

  // Group by (recipe_step_id, scheduled_at, task_type)
  const groups = new Map<string, typeof allPendingTasks>();
  for (const task of allPendingTasks) {
    const key = `${task.recipe_step_id}:${task.scheduled_at.getTime()}:${task.task_type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(task);
  }

  // Find duplicates (groups with more than 1 task)
  const duplicates: Array<{
    recipe_step_id: string;
    scheduled_at: Date;
    task_type: string;
    kept: string;
    removed: string[];
  }> = [];
  let totalRemoved = 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [key, tasks] of groups.entries()) {
    if (tasks.length > 1) {
      // Keep the oldest task (first by created_at)
      const sorted = [...tasks].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      const kept = sorted[0];
      const toRemove = sorted.slice(1);

      // Soft delete the duplicates
      const removedIds = toRemove.map((t) => t.id);
      await prisma.orchestrationTimerTask.updateMany({
        where: {
          id: { in: removedIds },
        },
        data: {
          deleted_at: new Date(),
          status: "CANCELLED",
          error_message: "Removed as duplicate during deduplication check",
        },
      });

      duplicates.push({
        recipe_step_id: kept.recipe_step_id,
        scheduled_at: kept.scheduled_at,
        task_type: kept.task_type,
        kept: kept.id,
        removed: removedIds,
      });

      totalRemoved += removedIds.length;
    }
  }

  return {
    duplicatesFound: duplicates.length,
    duplicatesRemoved: totalRemoved,
    details: duplicates,
  };
}

/**
 * Check for duplicate timer tasks and log a warning if any are found
 * This should be called periodically (e.g., during maintenance) to ensure data integrity
 */
export async function checkForDuplicateTimerTasks(): Promise<boolean> {
  const result = await deduplicateTimerTasks();

  if (result.duplicatesFound > 0) {
    console.warn(
      `[Timer Task Deduplication] Found ${result.duplicatesFound} duplicate task groups, removed ${result.duplicatesRemoved} duplicates`
    );
    console.warn(
      `[Timer Task Deduplication] Details:`,
      result.details.map((d) => ({
        step: d.recipe_step_id,
        scheduled: d.scheduled_at.toISOString(),
        type: d.task_type,
        kept: d.kept,
        removed: d.removed.length,
      }))
    );
    return true;
  }

  return false;
}

export interface ScheduleDeleteSummary {
  deletedTasks: number;
  affectedRecipes: Array<{
    id: string;
    name: string;
    stepCount: number;
  }>;
}

export async function deleteProjectSchedule(projectId: string): Promise<ScheduleDeleteSummary> {
  const orchestrations = await prisma.orchestration.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      project_ids: true,
      recipeSteps: {
        where: { deleted_at: null },
        select: { id: true },
      },
    },
  });

  const affected = orchestrations
    .map((orch) => {
      let projectIds: string[] = [];
      try {
        projectIds = JSON.parse(orch.project_ids || "[]");
      } catch (error) {
        console.warn(
          `[deleteProjectSchedule] Failed to parse project_ids for orchestration ${orch.id}`,
          error
        );
      }

      return {
        id: orch.id,
        name: orch.name,
        stepIds: orch.recipeSteps.map((step) => step.id),
        matchesProject: projectIds.includes(projectId),
      };
    })
    .filter((orch) => orch.matchesProject && orch.stepIds.length > 0);

  if (affected.length === 0) {
    return {
      deletedTasks: 0,
      affectedRecipes: [],
    };
  }

  const stepIds = affected.flatMap((orch) => orch.stepIds);

  const deleteResult = await prisma.orchestrationTimerTask.deleteMany({
    where: {
      recipe_step_id: { in: stepIds },
      status: "PENDING",
    },
  });

  return {
    deletedTasks: deleteResult.count,
    affectedRecipes: affected.map((orch) => ({
      id: orch.id,
      name: orch.name,
      stepCount: orch.stepIds.length,
    })),
  };
}
