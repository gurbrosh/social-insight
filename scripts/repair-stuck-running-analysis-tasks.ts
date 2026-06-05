#!/usr/bin/env tsx
/**
 * Reset AnalysisTask rows stuck in RUNNING (e.g. after a crash or reboot before markTaskTerminal).
 * The worker only claims PENDING tasks, so RUNNING rows must be moved back to PENDING to continue.
 *
 * Usage:
 *   npx tsx scripts/repair-stuck-running-analysis-tasks.ts --runId=<ulid> [--dry-run] [--step=NETWORK]
 *   npx tsx scripts/repair-stuck-running-analysis-tasks.ts --projectId=<ulid> [--dry-run] [--step=NETWORK]
 *
 * --projectId uses the latest OrchestrationRun for that project (by started_at).
 * --step limits the reset to one AnalysisStep (optional; default = all RUNNING for the run).
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import type { AnalysisStep } from "@prisma/client";

const RECLAIM_NOTE = "Reclaimed RUNNING→PENDING (repair-stuck-running-analysis-tasks)";

function parseArgs(argv: string[]): {
  runId?: string;
  projectId?: string;
  dryRun: boolean;
  step?: AnalysisStep;
} {
  let runId: string | undefined;
  let projectId: string | undefined;
  let dryRun = false;
  let step: AnalysisStep | undefined;

  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--runId=")) runId = a.slice("--runId=".length).trim();
    else if (a.startsWith("--projectId=")) projectId = a.slice("--projectId=".length).trim();
    else if (a.startsWith("--step=")) {
      const s = a.slice("--step=".length).trim() as AnalysisStep;
      step = s;
    }
  }
  return { runId, projectId, dryRun, step };
}

const VALID_STEPS: AnalysisStep[] = [
  "SENTIMENT",
  "THEMES",
  "CHATTER",
  "NETWORK",
  "NEWS",
  "BRAND",
  "BLOG_NEWS_ANALYSIS",
];

async function resolveRunId(projectId: string): Promise<string | null> {
  const run = await prisma.orchestrationRun.findFirst({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { started_at: "desc" },
    select: { id: true, status: true, started_at: true },
  });
  return run?.id ?? null;
}

async function main() {
  const { runId: argRunId, projectId, dryRun, step } = parseArgs(process.argv.slice(2));

  if (step && !VALID_STEPS.includes(step)) {
    console.error(`Invalid --step=${step}. Valid: ${VALID_STEPS.join(", ")}`);
    process.exit(1);
  }

  let runId = argRunId;
  if (!runId && projectId) {
    runId = (await resolveRunId(projectId)) ?? undefined;
    if (!runId) {
      console.error(`No OrchestrationRun found for project ${projectId}`);
      process.exit(1);
    }
    console.log(`Resolved --projectId to run_id=${runId}`);
  }

  if (!runId) {
    console.error(
      "Usage: npx tsx scripts/repair-stuck-running-analysis-tasks.ts --runId=<ulid> [--dry-run] [--step=STEP]\n" +
        "   or: npx tsx scripts/repair-stuck-running-analysis-tasks.ts --projectId=<ulid> [--dry-run] [--step=STEP]"
    );
    process.exit(1);
  }

  const run = await prisma.orchestrationRun.findFirst({
    where: { id: runId, deleted_at: null },
    select: { id: true, project_id: true, status: true, started_at: true },
  });
  if (!run) {
    console.error(`OrchestrationRun not found: ${runId}`);
    process.exit(1);
  }

  const baseWhere = {
    run_id: runId,
    state: "RUNNING" as const,
    deleted_at: null,
    ...(step ? { step } : {}),
  };

  const byStep = await prisma.analysisTask.groupBy({
    by: ["step"],
    where: baseWhere,
    _count: { _all: true },
  });

  const total = byStep.reduce((s, g) => s + g._count._all, 0);
  console.log(`Run ${runId} (project=${run.project_id}, status=${run.status})`);
  console.log(`RUNNING tasks to reclaim: ${total}${step ? ` (step=${step} only)` : ""}`);
  for (const g of byStep.sort((a, b) => a.step.localeCompare(b.step))) {
    console.log(`  ${g.step}: ${g._count._all}`);
  }

  if (total === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("--dry-run: no database changes.");
    process.exit(0);
  }

  const now = new Date();
  const result = await prisma.analysisTask.updateMany({
    where: baseWhere,
    data: {
      state: "PENDING",
      locked_at: null,
      last_error: RECLAIM_NOTE,
      updated_at: now,
    },
  });

  console.log(`Updated ${result.count} row(s): RUNNING → PENDING.`);
  console.log(
    "Next: start the analysis worker for this run, e.g. npm run analysis:worker -- --runId=" + runId
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
