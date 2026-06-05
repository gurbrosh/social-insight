/**
 * One-off cleanup for abandoned task-based analysis runs:
 * 1) Stale project runs (default: "Test12") — fail non-terminal OrchestrationRuns and
 *    mark non-terminal AnalysisTasks FAILED so zombie RUNNING/PENDING rows stop blocking views.
 * 2) Stuck COLLECTING run for another project (default: "Agentic Security") — fail the run,
 *    fail the stuck OrchestrationExecution, and cascade thread/step executions; clear is_running.
 *
 * Does NOT cancel an in-progress ANALYZING run that only has PENDING work (e.g. large backlog);
 * adjust STUCK_COLLECTING_PROJECT if your project name differs.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-analysis-runs.ts
 *   npx tsx scripts/cleanup-stale-analysis-runs.ts --dry-run
 */

import { prisma } from "../lib/prisma";
import type { OrchestrationRunStatus, OrchestrationStatus } from "@prisma/client";

const ERR =
  "Aborted by cleanup-stale-analysis-runs.ts (stale or stuck orchestration; safe to start a new run).";

const STALE_PROJECT_NAME = "Test12";
const STUCK_COLLECTING_PROJECT = "Agentic Security";

const TERMINAL_TASK = ["SUCCEEDED", "FAILED", "SKIPPED"] as const;
const TERMINAL_ORCH = ["COMPLETED", "FAILED", "CANCELLED"] as const;

function dryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function failNonTerminalTasksForRun(runId: string): Promise<number> {
  const res = await prisma.analysisTask.updateMany({
    where: {
      run_id: runId,
      deleted_at: null,
      state: { notIn: [...TERMINAL_TASK] },
    },
    data: {
      state: "FAILED",
      last_error: ERR,
      locked_at: null,
      completed_at: new Date(),
      updated_at: new Date(),
    },
  });
  return res.count;
}

async function failOrchestrationExecutionCascade(executionId: string): Promise<void> {
  const exec = await prisma.orchestrationExecution.findFirst({
    where: { id: executionId, deleted_at: null },
    select: { id: true, orchestration_id: true, status: true },
  });
  if (!exec) {
    console.warn(`[cleanup] No OrchestrationExecution ${executionId}`);
    return;
  }

  const threadRows = await prisma.orchestrationThreadExecution.findMany({
    where: { execution_id: executionId, deleted_at: null },
    select: { id: true },
  });
  const threadIds = threadRows.map((t) => t.id);

  if (threadIds.length > 0) {
    await prisma.orchestrationStepExecution.updateMany({
      where: {
        thread_execution_id: { in: threadIds },
        deleted_at: null,
        status: { notIn: [...TERMINAL_ORCH] },
      },
      data: {
        status: "FAILED" as OrchestrationStatus,
        completed_at: new Date(),
        error_message: ERR,
        updated_at: new Date(),
      },
    });
  }

  await prisma.orchestrationThreadExecution.updateMany({
    where: {
      execution_id: executionId,
      deleted_at: null,
      status: { notIn: [...TERMINAL_ORCH] },
    },
    data: {
      status: "FAILED" as OrchestrationStatus,
      completed_at: new Date(),
      error_message: ERR,
      updated_at: new Date(),
    },
  });

  await prisma.orchestrationExecution.update({
    where: { id: executionId },
    data: {
      status: "FAILED" as OrchestrationStatus,
      completed_at: new Date(),
      error_message: ERR,
      updated_at: new Date(),
    },
  });

  await prisma.orchestration.updateMany({
    where: { id: exec.orchestration_id, deleted_at: null },
    data: { is_running: false, updated_at: new Date() },
  });
}

async function main() {
  const d = dryRun();
  if (d) console.log("[cleanup] DRY RUN — no writes.\n");

  // --- 1) Test12 (or STALE_PROJECT_NAME): any run not in a terminal state
  const staleProject = await prisma.project.findFirst({
    where: { name: STALE_PROJECT_NAME, deleted_at: null },
    select: { id: true, name: true },
  });

  if (!staleProject) {
    console.log(`[cleanup] No project named "${STALE_PROJECT_NAME}" — skip stale-project cleanup.`);
  } else {
    const staleRuns = await prisma.orchestrationRun.findMany({
      where: {
        project_id: staleProject.id,
        deleted_at: null,
        status: { notIn: ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"] },
      },
      select: { id: true, status: true },
    });

    console.log(
      `[cleanup] Project "${staleProject.name}": ${staleRuns.length} non-terminal run(s) to fail.`
    );

    for (const run of staleRuns) {
      if (d) {
        console.log(`  [dry-run] Would fail run ${run.id} (${run.status}) and non-terminal tasks.`);
        continue;
      }
      const n = await failNonTerminalTasksForRun(run.id);
      await prisma.orchestrationRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED" as OrchestrationRunStatus,
          analysis_completed_at: new Date(),
          updated_at: new Date(),
        },
      });
      console.log(`  Failed run ${run.id} (${run.status}) — ${n} task(s) marked FAILED.`);
    }
  }

  // --- 2) Agentic Security: COLLECTING run with a stuck execution still RUNNING
  const stuckProject = await prisma.project.findFirst({
    where: { name: STUCK_COLLECTING_PROJECT, deleted_at: null },
    select: { id: true, name: true },
  });

  if (!stuckProject) {
    console.log(`[cleanup] No project named "${STUCK_COLLECTING_PROJECT}" — skip stuck-COLLECTING cleanup.`);
  } else {
    const collecting = await prisma.orchestrationRun.findMany({
      where: {
        project_id: stuckProject.id,
        deleted_at: null,
        status: "COLLECTING",
      },
      select: { id: true, orchestration_execution_id: true },
    });

    for (const run of collecting) {
      if (!run.orchestration_execution_id) {
        console.warn(`[cleanup] Run ${run.id} is COLLECTING but has no orchestration_execution_id — skip.`);
        continue;
      }

      const execution = await prisma.orchestrationExecution.findFirst({
        where: { id: run.orchestration_execution_id, deleted_at: null },
        select: { id: true, status: true },
      });

      if (!execution || execution.status !== "RUNNING") {
        console.log(
          `[cleanup] Run ${run.id}: execution ${run.orchestration_execution_id} status=${execution?.status ?? "missing"} — skip (not stuck RUNNING).`
        );
        continue;
      }

      if (d) {
        console.log(
          `[dry-run] Would fail COLLECTING run ${run.id} and cascade execution ${execution.id}.`
        );
        continue;
      }

      await failNonTerminalTasksForRun(run.id);
      await prisma.orchestrationRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED" as OrchestrationRunStatus,
          analysis_completed_at: new Date(),
          updated_at: new Date(),
        },
      });
      await failOrchestrationExecutionCascade(execution.id);
      console.log(
        `[cleanup] Failed stuck COLLECTING run ${run.id} and execution ${execution.id} (cascade).`
      );
    }
  }

  if (d) console.log("\n[cleanup] DRY RUN finished. Re-run without --dry-run to apply.");
  else console.log("\n[cleanup] Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
