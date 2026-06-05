/**
 * Cancel all non-terminal task-based analysis for a project: fail remaining tasks
 * and set OrchestrationRun to FAILED.
 *
 * Usage:
 *   npx tsx scripts/cancel-project-analysis.ts --project-name "Agent Security"
 *   npx tsx scripts/cancel-project-analysis.ts --project-name "Agent Security" --dry-run
 */

import { prisma } from "../lib/prisma";
import type { OrchestrationRunStatus } from "@prisma/client";

const MSG = "Cancelled by cancel-project-analysis.ts";

const TERMINAL_RUN: OrchestrationRunStatus[] = ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"];
const TERMINAL_TASK = ["SUCCEEDED", "FAILED", "SKIPPED"] as const;

async function main() {
  const nameIdx = process.argv.indexOf("--project-name");
  const projectName =
    nameIdx !== -1 && process.argv[nameIdx + 1] ? String(process.argv[nameIdx + 1]).trim() : "";
  if (!projectName) {
    console.error('Usage: npx tsx scripts/cancel-project-analysis.ts --project-name "<name>" [--dry-run]');
    process.exit(1);
  }
  const dry = process.argv.includes("--dry-run");

  const project = await prisma.project.findFirst({
    where: { name: projectName, deleted_at: null },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`No active project named "${projectName}".`);
    process.exit(1);
  }

  const runs = await prisma.orchestrationRun.findMany({
    where: {
      project_id: project.id,
      deleted_at: null,
      status: { notIn: TERMINAL_RUN },
    },
    select: { id: true, status: true, orchestration_execution_id: true },
  });

  if (runs.length === 0) {
    console.log(`No non-terminal OrchestrationRun for "${project.name}". Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Project "${project.name}": ${runs.length} non-terminal run(s).`);
  if (dry) console.log("[dry-run] No database writes.\n");

  for (const run of runs) {
    if (dry) {
      console.log(`  [dry-run] Would cancel run ${run.id} (${run.status})`);
      continue;
    }

    const taskRes = await prisma.analysisTask.updateMany({
      where: {
        run_id: run.id,
        deleted_at: null,
        state: { notIn: [...TERMINAL_TASK] },
      },
      data: {
        state: "FAILED",
        last_error: MSG,
        locked_at: null,
        completed_at: new Date(),
        updated_at: new Date(),
      },
    });

    await prisma.orchestrationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        analysis_completed_at: new Date(),
        updated_at: new Date(),
      },
    });

    console.log(`  Cancelled run ${run.id} (${run.status}) — ${taskRes.count} task(s) marked FAILED.`);

    const execId = run.orchestration_execution_id;
    if (execId) {
      const exec = await prisma.orchestrationExecution.findFirst({
        where: { id: execId, deleted_at: null, status: "RUNNING" },
        select: { id: true, orchestration_id: true },
      });
      if (exec) {
        await prisma.orchestrationExecution.update({
          where: { id: exec.id },
          data: {
            status: "FAILED",
            completed_at: new Date(),
            error_message: MSG,
            updated_at: new Date(),
          },
        });
        await prisma.orchestration.updateMany({
          where: { id: exec.orchestration_id, deleted_at: null },
          data: { is_running: false, updated_at: new Date() },
        });
        console.log(`  Marked execution ${exec.id} FAILED and cleared orchestration is_running.`);
      }
    }
  }

  if (dry) console.log("\n[dry-run] Re-run without --dry-run to apply.");
  else console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
