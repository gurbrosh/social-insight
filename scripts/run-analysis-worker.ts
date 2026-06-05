/**
 * Standalone analysis worker (no Next.js HTTP server).
 * Mirrors POST /api/admin/run-analysis/worker: startRunAnalysis → runWorkerLoop → sanitization → finalizeRun.
 *
 * Usage:
 *   npx tsx scripts/run-analysis-worker.ts --runId=<ulid>
 *   npx tsx scripts/run-analysis-worker.ts --projectId=<ulid>   # uses latest run for project
 *
 * Env: DATABASE_URL, OPENAI_API_KEY, etc. (same as the app). Do not run two workers on the same run
 * while the HTTP `after()` worker is also processing it unless ANALYSIS_TASK_LEASE_MS is set appropriately.
 */

import { findLatestRunForProject, startRunAnalysis } from "@/lib/analysis-run";
import { runWorkerLoop, reclaimStaleRunningTasks } from "@/lib/analysis-worker";
import { runAnalysisWorkerPostLoop } from "@/lib/run-analysis-worker-pipeline";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

async function main(): Promise<void> {
  const runIdArg = arg("runId");
  const projectIdArg = arg("projectId");

  let runId = runIdArg;
  let projectId = projectIdArg;

  if (runId && projectId) {
    console.error("Specify only one of --runId or --projectId");
    process.exit(1);
  }

  if (!runId && projectId) {
    const latest = await findLatestRunForProject(projectId);
    if (!latest) {
      console.error(`No orchestration run with records for project ${projectId}`);
      process.exit(1);
    }
    runId = latest;
  }

  if (!runId) {
    console.error("Usage: npx tsx scripts/run-analysis-worker.ts --runId=<id> | --projectId=<id>");
    process.exit(1);
  }

  const { prisma } = await import("@/lib/prisma");
  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) {
    console.error(`Run ${runId} not found`);
    process.exit(1);
  }
  projectId = run.project_id;

  const leaseMs = Math.max(0, parseInt(process.env.ANALYSIS_TASK_LEASE_MS ?? "0", 10) || 0);
  if (leaseMs > 0) {
    const n = await reclaimStaleRunningTasks(runId, leaseMs);
    if (n > 0) console.log(`[run-analysis-worker] reclaimed ${n} stale RUNNING task(s)`);
  }

  console.log(`[run-analysis-worker] start run=${runId} project=${projectId}`);
  await startRunAnalysis(runId);
  await runWorkerLoop(runId);
  await runAnalysisWorkerPostLoop(projectId, runId);
  console.log(`[run-analysis-worker] done run=${runId}`);
}

main().catch((err) => {
  console.error("[run-analysis-worker] failed", err);
  process.exit(1);
});
