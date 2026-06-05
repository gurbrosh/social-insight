import { processPendingTimerTasks } from "@/lib/orchestration-timer-task-processor";
import { ensureScheduleHorizonForAllActiveRecipes } from "@/lib/orchestration-recipe-service";
import { reconcileInFlightJobs } from "@/lib/orchestration-reconciliation";

const MAX_TASKS_PER_TICK = 25;
const MIN_INTERVAL_MS = 15_000;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECONCILIATION_INTERVAL_MS = 60_000;

// Watchdog configuration
const WATCHDOG_INTERVAL_MS = 30_000; // How often to check runner health
const MAX_STALL_MS = 60_000; // If no tick for this long, consider runner stalled

let runnerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
let lastRun = 0;
let lastMaintenance = 0;
let lastReconciliation = 0;
let watchdogInterval: NodeJS.Timeout | null = null;
let watchdogInitialized = false;

export async function runOrchestrationTick(): Promise<void> {
  if (isProcessing) {
    return;
  }

  const now = Date.now();
  if (now - lastRun < MIN_INTERVAL_MS) {
    return;
  }

  isProcessing = true;
  // Mark the tick as "alive" immediately so the watchdog doesn't spam restarts if the tick throws early
  // (e.g., DB temporarily unavailable or schema not ready).
  lastRun = now;
  try {
    const result = await processPendingTimerTasks(MAX_TASKS_PER_TICK).catch((error) => {
      // Wrap the error to get more context
      const enhancedError = new Error(
        `processPendingTimerTasks failed: ${error instanceof Error ? error.message : String(error)}`
      );
      (enhancedError as any).originalError = error;
      throw enhancedError;
    });

    if (result.executed > 0 || result.skipped > 0) {
      console.log(
        `[Orchestration Runner] Executed ${result.executed} task(s)` +
          (result.skipped > 0 ? `, skipped ${result.skipped}` : "") +
          (result.failed.length > 0 ? `, ${result.failed.length} failed` : "")
      );
    }

    if (result.failed.length > 0) {
      console.error("[Orchestration Runner] Failed tasks:", result.failed);
    }

    if (now - lastMaintenance >= MAINTENANCE_INTERVAL_MS) {
      try {
        await ensureScheduleHorizonForAllActiveRecipes(new Date());
      } catch (maintenanceError) {
        console.error("[Orchestration Runner] Schedule maintenance failed:", maintenanceError);
      } finally {
        lastMaintenance = Date.now();
      }
    }

    if (now - lastReconciliation >= RECONCILIATION_INTERVAL_MS) {
      try {
        await reconcileInFlightJobs();
      } catch (reconciliationError) {
        console.error("[Orchestration Runner] Reconciliation failed:", reconciliationError);
      } finally {
        lastReconciliation = Date.now();
      }
    }
  } catch (error) {
    // Log detailed error information for Prisma errors
    if (error && typeof error === "object" && "name" in error) {
      const prismaError = error as any;
      console.error("[Orchestration Runner] Error running tick:", {
        name: prismaError.name,
        message: prismaError.message,
        code: prismaError.code,
        meta: prismaError.meta,
        cause: prismaError.cause,
        clientVersion: prismaError.clientVersion,
        stack: prismaError.stack,
      });
    } else {
      console.error("[Orchestration Runner] Error running tick:", error);
    }
  } finally {
    isProcessing = false;
  }
}

export function startOrchestrationRunner(): void {
  if (runnerInterval) {
    return;
  }

  // Initialize timestamps so the watchdog doesn't log an absurd "no ticks since epoch" on startup.
  const now = Date.now();
  lastRun = now;
  lastMaintenance = now;
  lastReconciliation = now;

  runnerInterval = setInterval(async () => {
    await runOrchestrationTick();
  }, 10_000);

  // Start a watchdog that ensures the runner keeps ticking.
  // If we haven't seen a tick in a while (e.g., due to an unexpected error or event loop issue),
  // restart the interval so tasks don't get stuck pending indefinitely.
  if (!watchdogInitialized) {
    watchdogInitialized = true;
    watchdogInterval = setInterval(() => {
      if (isProcessing) {
        return;
      }
      const now = Date.now();
      const sinceLastRun = now - lastRun;
      if (sinceLastRun > MAX_STALL_MS) {
        console.warn(
          `[Orchestration Runner] Watchdog detected no ticks for ${Math.round(
            sinceLastRun / 1000
          )}s, restarting runner interval`
        );
        if (runnerInterval) {
          clearInterval(runnerInterval);
        }
        runnerInterval = setInterval(async () => {
          await runOrchestrationTick();
        }, 10_000);
        lastRun = Date.now();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  // Kick off an initial reconciliation so we catch stale jobs immediately.
  reconcileInFlightJobs().catch((error) => {
    console.error("[Orchestration Runner] Initial reconciliation failed:", error);
  });
}

export function stopOrchestrationRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}
