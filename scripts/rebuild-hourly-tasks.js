import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";

const prisma = new PrismaClient();

const HORIZON_DAYS = 7;
const MILLIS_PER_HOUR = 60 * 60 * 1000;
const STEP_CONFIGS = [
  {
    stepId: "01K9BKWKNA6B135ZNQXVKQAQTA",
    orchestrationId: "01K63MMDBNM67G4PKSBE50BF5E",
    intervalHours: 2,
  },
  {
    stepId: "01K9BKVPPPCPNCYC9R69Q7KP00",
    orchestrationId: "01K61MNDDCCAM4GGZS2BD8747F",
    intervalHours: 4,
  },
];
const ANCHOR_STEP_ID = "01K9BKTDCT56JM8HG20ZN39H1B"; // Step 1 (All Scrapers)

async function getAnchorTime() {
  const now = new Date();

  const executedAnchor = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipe_step_id: ANCHOR_STEP_ID,
      deleted_at: null,
      status: "EXECUTED",
      scheduled_at: { lte: now },
    },
    orderBy: { scheduled_at: "desc" },
  });

  if (executedAnchor) {
    return executedAnchor.scheduled_at;
  }

  const pendingAnchor = await prisma.orchestrationTimerTask.findFirst({
    where: {
      recipe_step_id: ANCHOR_STEP_ID,
      deleted_at: null,
      status: "PENDING",
    },
    orderBy: { scheduled_at: "asc" },
  });

  return pendingAnchor?.scheduled_at ?? now;
}

function* generateSchedule(anchor, intervalHours, horizon) {
  const intervalMs = intervalHours * MILLIS_PER_HOUR;
  const now = Date.now();
  let current = anchor.getTime();

  while (current <= now) {
    current += intervalMs;
  }

  while (current <= horizon.getTime()) {
    yield new Date(current);
    current += intervalMs;
  }
}

async function rebuildHourlyTasks() {
  const anchor = await getAnchorTime();
  const horizon = new Date(Date.now() + HORIZON_DAYS * 24 * MILLIS_PER_HOUR);

  for (const step of STEP_CONFIGS) {
    const tasks = Array.from(generateSchedule(anchor, step.intervalHours, horizon)).map(
      (scheduledAt) => ({
        id: ulid(),
        recipe_step_id: step.stepId,
        orchestration_id: step.orchestrationId,
        task_type: "hourly",
        scheduled_at: scheduledAt,
        status: "PENDING",
      })
    );

    if (tasks.length > 0) {
      await prisma.orchestrationTimerTask.createMany({
        data: tasks,
      });
      console.log(
        `Inserted ${tasks.length} tasks for step ${step.stepId} (interval ${step.intervalHours}h)`
      );
    }
  }
}

async function main() {
  try {
    await rebuildHourlyTasks();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to rebuild hourly tasks", error);
  process.exitCode = 1;
});
