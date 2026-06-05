#!/usr/bin/env tsx
/**
 * After fixing enqueue filters for post_conversation_role=null:
 * 1) Materialize Conversation rows (optional but recommended for correct CHATTER targeting)
 * 2) Upsert THEMES + CHATTER AnalysisTasks for the project's latest orchestration run
 *
 * Usage:
 *   npx tsx scripts/repair-themes-chatter-tasks.ts <projectId> [--skip-materialize] [--worker]
 *
 * --worker runs the full analysis worker loop (can take a long time). Omit to only enqueue.
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { materializeConversationsForProject } from "../lib/conversation-materializer";
import {
  findLatestRunForProject,
  enqueueRunTasksForSteps,
  startRunAnalysis,
} from "../lib/analysis-run";
import { runWorkerLoop } from "../lib/analysis-worker";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const projectId = args[0];
  const skipMaterialize = flags.has("--skip-materialize");
  const runWorker = flags.has("--worker");

  if (!projectId) {
    console.error(
      "Usage: npx tsx scripts/repair-themes-chatter-tasks.ts <projectId> [--skip-materialize] [--worker]"
    );
    process.exit(1);
  }

  const runId = await findLatestRunForProject(projectId);
  if (!runId) {
    console.error(
      "No eligible OrchestrationRun with RunRecords for this project. Run an orchestration/analysis once first."
    );
    process.exit(1);
  }

  console.log(`Project: ${projectId}`);
  console.log(`Run: ${runId}`);

  if (!skipMaterialize) {
    console.log("[1/2] Materializing conversations...");
    const m = await materializeConversationsForProject(projectId);
    console.log(
      `      conversationsCreated=${m.conversationsCreated} nodesCreated=${m.nodesCreated} postsUpdated=${m.postsUpdated}`
    );
  } else {
    console.log("[1/2] Skipping materialize (--skip-materialize)");
  }

  const beforeThemes = await prisma.analysisTask.count({
    where: { run_id: runId, step: "THEMES", deleted_at: null },
  });
  const beforeChatter = await prisma.analysisTask.count({
    where: { run_id: runId, step: "CHATTER", deleted_at: null },
  });
  console.log(`      Before upsert: THEMES tasks=${beforeThemes}, CHATTER tasks=${beforeChatter}`);

  console.log("[2/2] Upserting THEMES + CHATTER tasks...");
  const upserted = await enqueueRunTasksForSteps(runId, ["THEMES", "CHATTER"]);
  console.log(`      enqueueRunTasksForSteps upsert attempts: ${upserted}`);

  const afterThemes = await prisma.analysisTask.count({
    where: { run_id: runId, step: "THEMES", deleted_at: null },
  });
  const afterChatter = await prisma.analysisTask.count({
    where: { run_id: runId, step: "CHATTER", deleted_at: null },
  });
  console.log(`      After upsert: THEMES tasks=${afterThemes}, CHATTER tasks=${afterChatter}`);

  await startRunAnalysis(runId);

  if (runWorker) {
    console.log("Running worker until run completes (this may take hours)...");
    await runWorkerLoop(runId);
    console.log("Worker finished.");
  } else {
    console.log("Done. Start the app and let the analysis worker run, or re-run with --worker.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
