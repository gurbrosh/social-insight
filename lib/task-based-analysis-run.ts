/**
 * Single entry point for running task-based analysis on a project.
 * Used by rerun route, admin run-* routes, and orchestration (e.g. after blog ingest).
 */

import { prisma } from "@/lib/prisma";
import { runSanitizationForProject } from "@/lib/comprehensive-analysis";
import {
  findLatestRunForProject,
  rerunSteps,
  startRunAnalysis,
  finalizeRun,
  startOrchestrationRun,
  completeCollection,
  freezeRunMembershipFromExistingPosts,
  enqueueRunTasksForSteps,
} from "@/lib/analysis-run";
import { MINIMAL_POST_STEPS } from "@/lib/analysis-profile";
import { runWorkerLoop } from "@/lib/analysis-worker";
import { runThemeResponseGeneratorAfterSanitization } from "@/lib/response-generator/pipeline";
import type { AnalysisProfile, AnalysisStep } from "@prisma/client";

const ALL_STEPS: AnalysisStep[] = ["SENTIMENT", "THEMES", "CHATTER", "NETWORK", "NEWS", "BRAND"];

export type RunTaskBasedAnalysisOptions = {
  steps: AnalysisStep[];
  limit?: number;
  /** Run sanitization after worker loop. Default true. */
  runSanitization?: boolean;
};

export type RunTaskBasedAnalysisResult = {
  success: true;
  runId: string;
  tasksReset: number;
  isAdHoc: boolean;
};

/**
 * Run task-based analysis for a project: create or reuse run, enqueue steps, run worker, optional sanitization, finalize.
 * Caller is responsible for wiping analysis tables and resetting progress if needed.
 */
export async function runTaskBasedAnalysisForProject(
  projectId: string,
  options: RunTaskBasedAnalysisOptions
): Promise<RunTaskBasedAnalysisResult> {
  const { steps, runSanitization = true } = options;
  const projectPrefs = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { analysis_sample_post_limit: true },
  });
  const effectiveLimit =
    options.limit != null && options.limit > 0
      ? options.limit
      : projectPrefs?.analysis_sample_post_limit != null &&
          projectPrefs.analysis_sample_post_limit > 0
        ? projectPrefs.analysis_sample_post_limit
        : undefined;
  const reuseExistingRun = effectiveLimit != null && effectiveLimit > 0;
  let runId = reuseExistingRun ? await findLatestRunForProject(projectId) : null;
  let tasksReset = 0;
  let isAdHoc = false;

  if (runId) {
    let recordKeys: string[] | undefined;
    if (effectiveLimit != null && effectiveLimit > 0) {
      const postRecords = await prisma.runRecord.findMany({
        where: { run_id: runId, record_type: "POST", deleted_at: null },
        select: { record_key: true },
      });
      const sorted = postRecords.map((r) => r.record_key).sort((a, b) => Number(b) - Number(a));
      recordKeys = sorted.slice(0, effectiveLimit);
    }
    tasksReset = await rerunSteps(runId, steps, "RESET", {
      ...(recordKeys?.length ? { recordKeys } : {}),
    });
    if (tasksReset === 0) runId = null;
  }

  if (!runId) {
    const postCount = await prisma.post.count({ where: { project_id: projectId } });
    if (postCount === 0) {
      throw new Error("No posts found for this project. Scrape or ingest data first.");
    }
    runId = await startOrchestrationRun(projectId, null);
    await completeCollection(runId);
    await freezeRunMembershipFromExistingPosts(runId, projectId, {
      ...(effectiveLimit != null && effectiveLimit > 0 ? { limit: effectiveLimit } : {}),
    });
    tasksReset = await enqueueRunTasksForSteps(runId, steps);
    isAdHoc = true;
  }

  await startRunAnalysis(runId);
  await runWorkerLoop(runId);

  if (runSanitization) {
    await runSanitizationForProject(
      projectId,
      { news: true, themes: true, chatter: true, network: true },
      { orchestrationRunId: runId }
    );
    await runThemeResponseGeneratorAfterSanitization(projectId, runId);
  }

  await finalizeRun(runId);

  return { success: true, runId, tasksReset, isAdHoc };
}

/** Steps for "full" analysis (all categories). */
export function getAllAnalysisSteps(): AnalysisStep[] {
  return [...ALL_STEPS];
}

/**
 * Steps to run for a project's configured analysis profile (full vs minimal).
 * Does not include blog/news batch steps — those are enqueued via RunRecord tasks.
 */
export async function getAnalysisStepsForProject(projectId: string): Promise<AnalysisStep[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { analysis_profile: true },
  });
  const profile: AnalysisProfile = project?.analysis_profile ?? "full";
  if (profile === "minimal") {
    return [...MINIMAL_POST_STEPS];
  }
  return [...ALL_STEPS];
}

/**
 * Resume the task worker for the project's latest orchestration run (tasks already enqueued).
 * Use when repair/enqueue ran without runWorkerLoop — polling the UI does not process tasks.
 */
export async function resumeWorkerForLatestRun(projectId: string): Promise<{ runId: string }> {
  const runId = await findLatestRunForProject(projectId);
  if (!runId) {
    throw new Error(
      "No orchestration run with RunRecords for this project. Run analysis or orchestration once first."
    );
  }
  await startRunAnalysis(runId);
  await runWorkerLoop(runId);
  await runSanitizationForProject(
    projectId,
    { news: true, themes: true, chatter: true, network: true },
    { orchestrationRunId: runId }
  );
  await runThemeResponseGeneratorAfterSanitization(projectId, runId);
  await finalizeRun(runId);
  return { runId };
}
