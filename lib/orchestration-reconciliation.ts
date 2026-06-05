import { apifyService } from "@/lib/apify-service";
import { orchestrationExecutor } from "@/lib/orchestration-executor";
import { executionLogger } from "@/lib/execution-logger";
import { getOrchestrationStaleCustomStepMs } from "@/lib/orchestration-custom-task-timeout";
import { prisma } from "@/lib/prisma";
import { JobStatus, OrchestrationStatus, ScrapeJob } from "@prisma/client";

const MAX_JOBS_PER_RECONCILIATION = 5;
const MAX_STALE_CUSTOM_STEPS_PER_TICK = 10;
const RUNNING_STATUSES = new Set(["RUNNING", "READY"]);
const SUCCESS_STATUSES = new Set(["SUCCEEDED", "TIMED-OUT"]);

type JobCounts = {
  newCount: number;
  updatedCount: number;
  savedCount: number;
  discardedCount: number;
};

type ScrapeJobWithScraper = ScrapeJob & {
  scraper: { name: string } | null;
};

/**
 * Custom task steps (search_source_task / openai_task) have no Apify run to poll.
 * If the Node process dies or a task hangs without throwing, rows stay RUNNING forever.
 * Marks stale RUNNING steps FAILED and advances thread/orchestration completion.
 */
export async function reconcileStaleCustomTaskSteps(): Promise<void> {
  const staleMs = getOrchestrationStaleCustomStepMs();
  const cutoff = new Date(Date.now() - staleMs);

  const stale = await prisma.orchestrationStepExecution.findMany({
    where: {
      status: OrchestrationStatus.RUNNING,
      search_source_task_id: { not: null },
      deleted_at: null,
      created_at: { lt: cutoff },
    },
    orderBy: { created_at: "asc" },
    take: MAX_STALE_CUSTOM_STEPS_PER_TICK,
    select: {
      id: true,
      thread_execution_id: true,
      scraper_name: true,
      created_at: true,
    },
  });

  for (const row of stale) {
    const ageMin = Math.round((Date.now() - row.created_at.getTime()) / 60_000);
    const msg = `Stale RUNNING custom task step (${ageMin}+ min). Server may have restarted or the task hung without completing.`;

    try {
      await prisma.orchestrationStepExecution.update({
        where: { id: row.id },
        data: {
          status: OrchestrationStatus.FAILED,
          completed_at: new Date(),
          error_message: msg,
        },
      });

      const duration = Math.max(0, Date.now() - row.created_at.getTime());
      await executionLogger.logExecutionComplete(row.id, {
        endTime: new Date(),
        duration,
        status: "FAILED",
        errorMessage: msg,
      });
    } catch (error) {
      console.error(
        `[Orchestration Reconciliation] Failed to fail stale custom step ${row.id}:`,
        error
      );
      continue;
    }

    try {
      await finalizeThreadIfIdle(row.thread_execution_id);
    } catch (error) {
      console.error(
        `[Orchestration Reconciliation] finalizeThreadIfIdle after stale step ${row.id}:`,
        error
      );
    }
  }
}

export async function reconcileInFlightJobs(): Promise<void> {
  await reconcileStaleCustomTaskSteps();

  const jobs = await prisma.scrapeJob.findMany({
    where: {
      status: "RUNNING",
      deleted_at: null,
      apify_run_id: { not: null },
    },
    orderBy: { created_at: "asc" },
    take: MAX_JOBS_PER_RECONCILIATION,
    include: {
      scraper: {
        select: {
          name: true,
        },
      },
    },
  });

  if (jobs.length === 0) {
    return;
  }

  for (const job of jobs) {
    if (!job.apify_run_id) {
      continue;
    }

    try {
      const runStatus = await apifyService.getRunStatus(job.apify_run_id);
      const status = (runStatus?.status || "").toUpperCase();

      if (runStatus?.notFound || status === "NOT-FOUND") {
        const notFoundMessage =
          runStatus?.statusMessage || "Apify run not found (it may have been purged or expired).";

        try {
          await prisma.scrapeJob.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              error_message: notFoundMessage,
              completed_at: new Date(),
            },
          });
        } catch (updateError) {
          console.error(
            `[Orchestration Reconciliation] Failed to mark job ${job.id} as failed after run not found:`,
            updateError
          );
        }

        await finalizeStepExecution(job, "FAILED", notFoundMessage, null);
        continue;
      }

      if (!status || RUNNING_STATUSES.has(status)) {
        continue;
      }

      let counts: JobCounts | null = null;
      try {
        counts = await apifyService.updateJobStatus(job.id);
      } catch (error) {
        console.error(
          `[Orchestration Reconciliation] Failed to update job ${job.id} status:`,
          error
        );
        continue;
      }

      const statusMessage = runStatus?.statusMessage;

      await finalizeStepExecution(job, status, statusMessage, counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTransient =
        message.includes("502") || message.includes("503") || message.includes("504");
      if (isTransient) {
        console.warn(
          `[Orchestration Reconciliation] Transient error for job ${job.id} (will retry next tick):`,
          message
        );
      } else {
        console.error(`[Orchestration Reconciliation] Failed to reconcile job ${job.id}:`, error);
      }
    }
  }
}

async function finalizeStepExecution(
  job: ScrapeJobWithScraper,
  runStatus: string,
  statusMessage?: string,
  counts?: JobCounts | null
): Promise<void> {
  const stepExecution = await prisma.orchestrationStepExecution.findFirst({
    where: {
      project_id: job.project_id,
      scraper_id: job.scraper_id,
      status: OrchestrationStatus.RUNNING,
      deleted_at: null,
    },
    orderBy: { created_at: "desc" },
  });

  if (!stepExecution) {
    return;
  }

  let succeeded = SUCCESS_STATUSES.has(runStatus);
  let resolvedErrorMessage = succeeded
    ? null
    : statusMessage || `Apify run ended with status ${runStatus}`;

  // Multi-batch orchestration steps create several ScrapeJob rows with the same execution +
  // scraper. Do not mark the step (or thread / orchestration) complete until every sibling
  // job is terminal; otherwise reconciliation would finalize while other batches still run.
  if (job.orchestration_execution_id) {
    const openPeers = await prisma.scrapeJob.count({
      where: {
        project_id: job.project_id,
        scraper_id: job.scraper_id,
        orchestration_execution_id: job.orchestration_execution_id,
        deleted_at: null,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
    });

    if (openPeers > 0) {
      console.log(
        `[Orchestration Reconciliation] Deferring step finalize (${openPeers} scrape job(s) still PENDING/RUNNING for execution ${job.orchestration_execution_id}, scraper ${job.scraper_id})`
      );
      return;
    }

    const peers = await prisma.scrapeJob.findMany({
      where: {
        project_id: job.project_id,
        scraper_id: job.scraper_id,
        orchestration_execution_id: job.orchestration_execution_id,
        deleted_at: null,
      },
      select: { status: true, error_message: true },
    });

    const anyFailedOrCancelled = peers.some(
      (p) => p.status === JobStatus.FAILED || p.status === JobStatus.CANCELLED
    );

    if (anyFailedOrCancelled) {
      succeeded = false;
      resolvedErrorMessage =
        peers.find((p) => p.error_message)?.error_message ||
        "One or more batch scrape jobs failed or were cancelled.";
    }
  }

  const stepStatus = succeeded ? OrchestrationStatus.COMPLETED : OrchestrationStatus.FAILED;

  await prisma.orchestrationStepExecution.update({
    where: { id: stepExecution.id },
    data: {
      status: stepStatus,
      completed_at: new Date(),
      error_message: succeeded ? null : resolvedErrorMessage,
    },
  });

  await logStepCompletion(
    stepExecution.id,
    stepExecution.created_at,
    counts,
    succeeded,
    succeeded ? undefined : resolvedErrorMessage ?? undefined
  );

  await finalizeThreadIfIdle(stepExecution.thread_execution_id);
}

async function logStepCompletion(
  stepExecutionId: string,
  createdAt: Date,
  counts: JobCounts | null | undefined,
  succeeded: boolean,
  statusMessage?: string
): Promise<void> {
  try {
    const endTime = new Date();
    const duration = Math.max(0, endTime.getTime() - createdAt.getTime());

    await executionLogger.logExecutionComplete(stepExecutionId, {
      endTime,
      duration,
      recordsCollected: counts ? counts.savedCount + counts.discardedCount : undefined,
      recordsInserted: counts ? counts.savedCount : undefined,
      recordsDiscarded: counts ? counts.discardedCount : undefined,
      recordsNew: counts ? counts.newCount : undefined,
      recordsUpdated: counts ? counts.updatedCount : undefined,
      status: succeeded ? "COMPLETED" : "FAILED",
      errorMessage: succeeded ? undefined : statusMessage,
    });
  } catch (error) {
    console.error(
      `[Orchestration Reconciliation] Failed to log execution for step ${stepExecutionId}:`,
      error
    );
  }
}

async function finalizeThreadIfIdle(threadExecutionId: string): Promise<void> {
  const threadExecution = await prisma.orchestrationThreadExecution.findUnique({
    where: { id: threadExecutionId },
    select: {
      status: true,
      execution_id: true,
      total_steps: true,
    },
  });

  if (!threadExecution) {
    return;
  }

  if (
    threadExecution.status === OrchestrationStatus.COMPLETED ||
    threadExecution.status === OrchestrationStatus.CANCELLED ||
    threadExecution.status === OrchestrationStatus.FAILED
  ) {
    await maybeFinalizeOrchestration(threadExecution.execution_id);
    return;
  }

  // Only mark thread COMPLETED when we have total_steps step executions in a terminal state.
  // Step executions are created when each step starts, so after step 1 completes, step 2's
  // record may not exist yet — we must not treat "no remaining RUNNING/PENDING" as "all done".
  const finishedSteps = await prisma.orchestrationStepExecution.count({
    where: {
      thread_execution_id: threadExecutionId,
      deleted_at: null,
      status: {
        in: [
          OrchestrationStatus.COMPLETED,
          OrchestrationStatus.FAILED,
          OrchestrationStatus.CANCELLED,
        ],
      },
    },
  });

  if (finishedSteps >= threadExecution.total_steps && threadExecution.total_steps > 0) {
    await prisma.orchestrationThreadExecution.update({
      where: { id: threadExecutionId },
      data: {
        status: OrchestrationStatus.COMPLETED,
        completed_at: new Date(),
      },
    });
  }

  await maybeFinalizeOrchestration(threadExecution.execution_id);
}

async function maybeFinalizeOrchestration(executionId: string): Promise<void> {
  const openThreads = await prisma.orchestrationThreadExecution.count({
    where: {
      execution_id: executionId,
      deleted_at: null,
      status: {
        in: [OrchestrationStatus.RUNNING, OrchestrationStatus.PENDING],
      },
    },
  });

  if (openThreads > 0) {
    return;
  }

  const execution = await prisma.orchestrationExecution.findUnique({
    where: { id: executionId },
    select: { status: true },
  });

  if (!execution || execution.status !== OrchestrationStatus.RUNNING) {
    return;
  }

  try {
    await orchestrationExecutor.finalizeExistingExecution(executionId);
  } catch (error) {
    console.error(
      `[Orchestration Reconciliation] Failed to finalize orchestration execution ${executionId}:`,
      error
    );
  }
}
