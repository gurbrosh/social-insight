/**
 * Find OrchestrationRun rows stuck in COLLECTING: posts were stamped with ingested_run_id
 * but freezeRunMembership never ran (RunRecord POST count = 0), so analysis never started.
 *
 * Runs the same pipeline as orchestration completion: completeCollection → freezeRunMembership
 * → enqueueRunTasks → startRunAnalysis → runWorkerLoop → sanitization → finalizeRun.
 *
 * Usage:
 *   npx tsx scripts/repair-stuck-orchestration-runs.ts              # dry-run: list only
 *   npx tsx scripts/repair-stuck-orchestration-runs.ts --apply      # repair all matching runs
 *   npx tsx scripts/repair-stuck-orchestration-runs.ts --apply --project-id <ulid>
 *   npx tsx scripts/repair-stuck-orchestration-runs.ts --apply --run-id <ulid>
 *
 * By default, runs whose OrchestrationExecution.status is still RUNNING are skipped
 * (orchestration may still be active). Use --include-running-execution to repair those too
 * (e.g. zombie execution left RUNNING after scrapes finished).
 */

import { prisma } from "../lib/prisma";
import {
  completeCollection,
  freezeRunMembership,
  enqueueRunTasks,
  startRunAnalysis,
  finalizeRun,
} from "../lib/analysis-run";
import { runWorkerLoop } from "../lib/analysis-worker";
import { runSanitizationForProject } from "../lib/comprehensive-analysis";
import { runThemeResponseGeneratorAfterSanitization } from "../lib/response-generator/pipeline";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function repairOneRun(runId: string): Promise<void> {
  await completeCollection(runId);
  await freezeRunMembership(runId);
  await enqueueRunTasks(runId);
  await startRunAnalysis(runId);
  await runWorkerLoop(runId);

  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (run?.project_id) {
    await runSanitizationForProject(
      run.project_id,
      { news: true, themes: true, chatter: true, network: true },
      { orchestrationRunId: runId }
    );
    await runThemeResponseGeneratorAfterSanitization(run.project_id, runId);
  }
  await finalizeRun(runId);
}

async function main() {
  const apply = hasFlag("--apply");
  const projectFilter = argValue("--project-id");
  const runFilter = argValue("--run-id");
  const includeRunningExecution = hasFlag("--include-running-execution");

  const collecting = await prisma.orchestrationRun.findMany({
    where: {
      deleted_at: null,
      status: "COLLECTING",
      ...(projectFilter ? { project_id: projectFilter } : {}),
      ...(runFilter ? { id: runFilter } : {}),
    },
    select: {
      id: true,
      project_id: true,
      orchestration_execution_id: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" },
  });

  const candidates: Array<{
    id: string;
    project_id: string;
    ingestedPosts: number;
    runRecordPosts: number;
    executionStatus: string | null;
  }> = [];
  let skippedRunningExecution = 0;

  for (const r of collecting) {
    const ingestedPosts = await prisma.post.count({
      where: { project_id: r.project_id, ingested_run_id: r.id },
    });
    const runRecordPosts = await prisma.runRecord.count({
      where: { run_id: r.id, record_type: "POST", deleted_at: null },
    });

    const executionStatus = r.orchestration_execution_id
      ? ((
          await prisma.orchestrationExecution.findUnique({
            where: { id: r.orchestration_execution_id },
            select: { status: true },
          })
        )?.status ?? null)
      : null;

    // Stuck: data was ingested for this run id but membership was never frozen.
    if (ingestedPosts > 0 && runRecordPosts === 0) {
      if (executionStatus === "RUNNING" && !includeRunningExecution) {
        skippedRunningExecution++;
        continue;
      }
      candidates.push({
        id: r.id,
        project_id: r.project_id,
        ingestedPosts,
        runRecordPosts,
        executionStatus,
      });
    }
  }

  const projectNames = new Map<string, string>();
  for (const c of candidates) {
    if (!projectNames.has(c.project_id)) {
      const p = await prisma.project.findFirst({
        where: { id: c.project_id, deleted_at: null },
        select: { name: true },
      });
      projectNames.set(c.project_id, p?.name ?? c.project_id);
    }
  }

  console.log(
    `Found ${candidates.length} stuck run(s): COLLECTING + ingested posts > 0 + RunRecord POST = 0\n`
  );
  for (const c of candidates) {
    console.log(
      `  run_id=${c.id}\n` +
        `  project=${projectNames.get(c.project_id)} (${c.project_id})\n` +
        `  posts with ingested_run_id=${c.ingestedPosts}  RunRecord POST=${c.runRecordPosts}  execution.status=${c.executionStatus ?? "(no execution)"}`
    );
    console.log("");
  }

  if (!includeRunningExecution && skippedRunningExecution > 0) {
    console.log(
      `Note: ${skippedRunningExecution} stuck run(s) with execution.status=RUNNING were skipped. Add --include-running-execution to list/repair them.\n`
    );
  }

  if (!apply) {
    console.log(
      "Dry-run only. Re-run with --apply to run completeCollection → freezeRunMembership → worker → finalize."
    );
    return;
  }

  if (candidates.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  for (const c of candidates) {
    console.log(`[repair] Processing run ${c.id} (project ${c.project_id})...`);
    try {
      await repairOneRun(c.id);
      console.log(`[repair] OK — completed task-based pipeline for run ${c.id}`);
    } catch (e) {
      console.error(`[repair] FAILED run ${c.id}:`, e);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
