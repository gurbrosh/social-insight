/**
 * Task-based analysis lifecycle: OrchestrationRun, RunRecord, AnalysisTask.
 * Replaces cursor-based AnalysisProgress with per-record tasks and per-record
 * THEMES tasks claim independently of SENTIMENT (see analysis-worker claimTasks).
 *
 * IMPORTANT: AnalysisTask unique key is (project_id, record_type, record_key, step, result_version)
 * and does NOT include run_id. When upserting tasks, the update branch MUST reassign run_id to
 * the current run and reset state to PENDING (and clear completed_at, last_error, locked_at)
 * so the worker executes tasks for this run. Otherwise existing tasks from a previous run stay
 * SUCCEEDED and the new run has no work.
 */

import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";
import { Prisma } from "@prisma/client";
import type { OrchestrationRunStatus, RunRecordType, AnalysisStep } from "@prisma/client";
import {
  getPostSourceAnalysisPolicy,
  shouldEnqueuePostAnalysisStep,
} from "@/lib/analysis-post-source-policy";
import { getPostStepsForProfile, shouldEnqueueNewsAndBlogSteps } from "@/lib/analysis-profile";
import { createManySkippingDuplicatesSqlite } from "@/lib/prisma-create-many-sqlite";
import {
  heapUsedMb,
  isAnalysisHandoffMetricsEnabled,
  logAnalysisHandoff,
} from "@/lib/analysis-handoff-metrics";
import { isGithubPlatform } from "@/lib/utils/platform";

const NEWS_BATCH_SIZE = 200;

/** Chunk size for RunRecord createMany (SQLite parameter / statement size). */
const RUN_RECORD_CREATE_CHUNK = 400;

/** Chunk size for batched AnalysisTask INSERT ... ON CONFLICT DO UPDATE. */
const ANALYSIS_TASK_UPSERT_CHUNK = 150;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Batched upsert matching per-row prisma.analysisTask.upsert semantics for result_version 1.
 * SQLite: one INSERT per chunk with ON CONFLICT DO UPDATE (reassign run_id, reset worker fields).
 */
async function upsertAnalysisTasksInChunks(
  tasks: Array<{
    id: string;
    projectId: string;
    runId: string;
    recordType: RunRecordType;
    recordKey: string;
    step: AnalysisStep;
    now: Date;
  }>
): Promise<void> {
  if (tasks.length === 0) return;
  const runId = tasks[0].runId;
  const upsertT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  let chunkCount = 0;
  let maxChunkMs = 0;
  for (const batch of chunkArray(tasks, ANALYSIS_TASK_UPSERT_CHUNK)) {
    chunkCount++;
    const chunkT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
    const valueRows = batch.map(
      (t) =>
        Prisma.sql`(${t.id}, ${t.now}, ${t.now}, NULL, ${t.projectId}, ${t.runId}, ${t.recordType}, ${t.recordKey}, ${t.step}, ${"PENDING"}, 0, NULL, NULL, 1, NULL)`
    );
    await prisma.$executeRaw`
      INSERT INTO "AnalysisTask" ("id", "created_at", "updated_at", "deleted_at", "project_id", "run_id", "record_type", "record_key", "step", "state", "attempt_count", "locked_at", "last_error", "result_version", "completed_at")
      VALUES ${Prisma.join(valueRows)}
      ON CONFLICT("project_id", "record_type", "record_key", "step", "result_version") DO UPDATE SET
        "run_id" = excluded."run_id",
        "state" = 'PENDING',
        "completed_at" = NULL,
        "last_error" = NULL,
        "locked_at" = NULL,
        "attempt_count" = 0,
        "updated_at" = excluded."updated_at"
    `;
    if (isAnalysisHandoffMetricsEnabled()) {
      const cm = Date.now() - chunkT0;
      maxChunkMs = Math.max(maxChunkMs, cm);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (isAnalysisHandoffMetricsEnabled()) {
    logAnalysisHandoff("analysisTaskBulkUpsert", {
      runId,
      taskRows: tasks.length,
      chunks: chunkCount,
      durationMs: Date.now() - upsertT0,
      maxChunkMs,
      chunkSize: ANALYSIS_TASK_UPSERT_CHUNK,
    });
  }
}

/**
 * GitHub repo ingest posts skip sentiment LLM. Do not set `sentiment: null` on every enqueue
 * (that matches "needs analysis" in legacy queries and causes repeat work). Stamp `ai_processed_at`
 * so rows are clearly treated as processed for this pipeline.
 */
async function stampGithubPostsIngestAnalysisSkipped(
  projectId: string,
  postIds: number[]
): Promise<void> {
  if (postIds.length === 0) return;
  const rows = await prisma.post.findMany({
    where: { project_id: projectId, id: { in: postIds } },
    select: { id: true, platform: true },
  });
  const gh = rows.filter((r) => isGithubPlatform(r.platform)).map((r) => r.id);
  if (gh.length === 0) return;
  const now = new Date();
  await prisma.post.updateMany({
    where: { id: { in: gh } },
    data: { ai_processed_at: now },
  });
}

/** Create OrchestrationRun at execution start. Returns runId. */
export async function startOrchestrationRun(
  projectId: string,
  orchestrationExecutionId?: string | null
): Promise<string> {
  const id = generateId();
  await prisma.orchestrationRun.create({
    data: {
      id,
      project_id: projectId,
      orchestration_execution_id: orchestrationExecutionId ?? null,
      status: "COLLECTING",
      updated_at: new Date(),
    },
  });
  return id;
}

/** Mark collection phase complete. */
export async function completeCollection(runId: string): Promise<void> {
  await prisma.orchestrationRun.update({
    where: { id: runId },
    data: {
      status: "READY_FOR_ANALYSIS",
      collected_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/** Insert RunRecords for all Post/BlogPost where ingested_run_id = runId. */
export async function freezeRunMembership(runId: string): Promise<number> {
  const handoffT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  const heap0 = isAnalysisHandoffMetricsEnabled() ? heapUsedMb() : 0;

  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) throw new Error(`OrchestrationRun ${runId} not found`);

  const projectId = run.project_id;

  // Posts — batched createMany (duplicates ignored; same as prior upsert with empty update)
  const posts = await prisma.post.findMany({
    where: { project_id: projectId, ingested_run_id: runId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  await createManySkippingDuplicatesSqlite(
    prisma.runRecord,
    posts.map((post) => ({
      id: generateId(),
      run_id: runId,
      project_id: projectId,
      record_type: "POST" as const,
      record_key: String(post.id),
    })),
    RUN_RECORD_CREATE_CHUNK
  );

  // BlogPosts
  const blogPosts = await prisma.blogPost.findMany({
    where: { project_id: projectId, ingested_run_id: runId },
    select: { id: true },
  });
  await createManySkippingDuplicatesSqlite(
    prisma.runRecord,
    blogPosts.map((bp) => ({
      id: generateId(),
      run_id: runId,
      project_id: projectId,
      record_type: "BLOG_POST" as const,
      record_key: bp.id,
    })),
    RUN_RECORD_CREATE_CHUNK
  );

  // News batches: group POST RunRecords into batches
  const postRecords = await prisma.runRecord.findMany({
    where: { run_id: runId, record_type: "POST", deleted_at: null },
    select: { record_key: true },
    orderBy: { record_key: "asc" },
  });
  const newsBatchRows: Array<{
    id: string;
    run_id: string;
    project_id: string;
    record_type: "NEWS_BATCH";
    record_key: string;
  }> = [];
  for (let i = 0; i < postRecords.length; i += NEWS_BATCH_SIZE) {
    const batchIdx = Math.floor(i / NEWS_BATCH_SIZE);
    newsBatchRows.push({
      id: generateId(),
      run_id: runId,
      project_id: projectId,
      record_type: "NEWS_BATCH",
      record_key: `${runId}-batch-${batchIdx}`,
    });
  }
  if (newsBatchRows.length > 0) {
    await createManySkippingDuplicatesSqlite(
      prisma.runRecord,
      newsBatchRows,
      RUN_RECORD_CREATE_CHUNK
    );
  }

  const total = posts.length + blogPosts.length + newsBatchRows.length;
  if (isAnalysisHandoffMetricsEnabled()) {
    logAnalysisHandoff("freezeRunMembership", {
      runId,
      projectId,
      postRunRecords: posts.length,
      blogRunRecords: blogPosts.length,
      newsBatchRunRecords: newsBatchRows.length,
      declaredRunRecordTotal: total,
      durationMs: Date.now() - handoffT0,
      heapDeltaMb: Math.round((heapUsedMb() - heap0) * 10) / 10,
    });
  }
  return total;
}

/** Create AnalysisTasks for all RunRecords. */
export async function enqueueRunTasks(runId: string): Promise<number> {
  const handoffT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
  const heap0 = isAnalysisHandoffMetricsEnabled() ? heapUsedMb() : 0;

  const records = await prisma.runRecord.findMany({
    where: { run_id: runId, deleted_at: null },
    select: { id: true, record_type: true, record_key: true },
  });

  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) return 0;

  const projectRow = await prisma.project.findFirst({
    where: { id: run.project_id, deleted_at: null },
    select: { analysis_profile: true },
  });
  const analysisProfile = projectRow?.analysis_profile ?? "full";
  const includeNewsBlog = shouldEnqueueNewsAndBlogSteps(analysisProfile);

  const postIds = records
    .filter((r) => r.record_type === "POST")
    .map((r) => parseInt(r.record_key, 10))
    .filter((id) => !isNaN(id));
  const postRoles = new Map<number, { role: string | null; conversationId: string | null }>();
  const postPolicies = new Map<number, ReturnType<typeof getPostSourceAnalysisPolicy>>();
  if (postIds.length > 0) {
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, project_id: run.project_id },
      select: {
        id: true,
        post_conversation_role: true,
        conversation_id: true,
        platform: true,
        hn_story_analysis_id: true,
      },
    });
    for (const p of posts) {
      postRoles.set(p.id, {
        role: p.post_conversation_role,
        conversationId: p.conversation_id,
      });
      postPolicies.set(p.id, getPostSourceAnalysisPolicy(p.platform, p.hn_story_analysis_id));
    }
  }

  const postSteps = getPostStepsForProfile(analysisProfile);
  const stepsByRecordType: Record<RunRecordType, AnalysisStep[]> = {
    POST: postSteps,
    BLOG_POST: includeNewsBlog ? ["BLOG_NEWS_ANALYSIS"] : [],
    NEWS_BATCH: includeNewsBlog ? ["NEWS"] : [],
  };

  const now = new Date();
  const tasksToUpsert: Array<{
    id: string;
    projectId: string;
    runId: string;
    recordType: RunRecordType;
    recordKey: string;
    step: AnalysisStep;
    now: Date;
  }> = [];

  for (const rec of records) {
    const steps = stepsByRecordType[rec.record_type];
    if (!steps) continue;

    const stepsToCreate =
      rec.record_type === "POST"
        ? steps.filter((step) => {
            const postId = parseInt(rec.record_key, 10);
            if (isNaN(postId)) return true;
            const roleInfo = postRoles.get(postId);
            const policy = postPolicies.get(postId) ?? getPostSourceAnalysisPolicy(null, null);
            if (!roleInfo) return shouldEnqueuePostAnalysisStep(step, undefined, policy);
            return shouldEnqueuePostAnalysisStep(step, roleInfo, policy);
          })
        : steps;

    for (const step of stepsToCreate) {
      tasksToUpsert.push({
        id: generateId(),
        projectId: run.project_id,
        runId,
        recordType: rec.record_type,
        recordKey: rec.record_key,
        step,
        now,
      });
    }
  }

  await upsertAnalysisTasksInChunks(tasksToUpsert);
  await stampGithubPostsIngestAnalysisSkipped(run.project_id, postIds);
  if (isAnalysisHandoffMetricsEnabled()) {
    logAnalysisHandoff("enqueueRunTasks", {
      runId,
      projectId: run.project_id,
      runRecordCount: records.length,
      analysisTaskRowsUpserted: tasksToUpsert.length,
      durationMs: Date.now() - handoffT0,
      heapDeltaMb: Math.round((heapUsedMb() - heap0) * 10) / 10,
    });
  }
  return tasksToUpsert.length;
}

/** Mark analysis phase started. */
export async function startRunAnalysis(runId: string): Promise<void> {
  await prisma.orchestrationRun.update({
    where: { id: runId },
    data: {
      status: "ANALYZING",
      analysis_started_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/** Check if all tasks for run are terminal. */
export async function isRunComplete(runId: string): Promise<boolean> {
  const pending = await prisma.analysisTask.count({
    where: {
      run_id: runId,
      deleted_at: null,
      state: { notIn: ["SUCCEEDED", "FAILED", "SKIPPED"] },
    },
  });
  return pending === 0;
}

/**
 * Check if a given analysis step is complete for a run (all tasks terminal).
 * Use this as the "flag" to know when e.g. all THEMES analysis has finished.
 */
export async function isStepComplete(runId: string, step: AnalysisStep): Promise<boolean> {
  const pending = await prisma.analysisTask.count({
    where: {
      run_id: runId,
      step,
      deleted_at: null,
      state: { notIn: ["SUCCEEDED", "FAILED", "SKIPPED"] },
    },
  });
  return pending === 0;
}

/** Finalize run based on task outcomes. */
export async function finalizeRun(runId: string): Promise<void> {
  const failed = await prisma.analysisTask.count({
    where: { run_id: runId, deleted_at: null, state: "FAILED" },
  });
  const status: OrchestrationRunStatus = failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  await prisma.orchestrationRun.update({
    where: { id: runId },
    data: {
      status,
      analysis_completed_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/** Chunk size for bulk skip (SQLite bind limits; matches analysis-worker batching). */
const SKIP_PENDING_BACKLOG_CHUNK = 400;

const SKIP_BACKLOG_REASON = "Skipped by operator (clear backlog); not re-queued.";

/**
 * Mark all PENDING analysis tasks for a project as SKIPPED so workers will not process them.
 * Does not touch RUNNING tasks (those may still finish). For any run that had pending work here,
 * finalizes the run when every task is terminal afterward.
 */
export async function skipAllPendingAnalysisTasksForProject(projectId: string): Promise<{
  skippedCount: number;
  finalizedRunIds: string[];
}> {
  const runGroups = await prisma.analysisTask.groupBy({
    by: ["run_id"],
    where: {
      project_id: projectId,
      deleted_at: null,
      state: "PENDING",
    },
  });

  const runIdsToCheck = runGroups.map((g) => g.run_id);

  let skippedCount = 0;
  for (;;) {
    const batch = await prisma.analysisTask.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        state: "PENDING",
      },
      select: { id: true },
      take: SKIP_PENDING_BACKLOG_CHUNK,
    });
    if (batch.length === 0) break;
    const ids = batch.map((b) => b.id);
    const r = await prisma.analysisTask.updateMany({
      where: { id: { in: ids } },
      data: {
        state: "SKIPPED",
        completed_at: new Date(),
        locked_at: null,
        last_error: SKIP_BACKLOG_REASON,
        updated_at: new Date(),
      },
    });
    skippedCount += r.count;
  }

  const finalizedRunIds: string[] = [];
  for (const runId of runIdsToCheck) {
    if (await isRunComplete(runId)) {
      await finalizeRun(runId);
      finalizedRunIds.push(runId);
    }
  }

  return { skippedCount, finalizedRunIds };
}

/**
 * Reset tasks for given steps to PENDING so worker will re-execute them.
 * @param recordKeys - If set (e.g. post ids), only reset POST tasks for these record_key values. Batch steps (NEWS, BLOG_NEWS_ANALYSIS) are always reset in full.
 */
export async function rerunSteps(
  runId: string,
  steps: AnalysisStep[],
  _mode?: "RESET" | "NEW_VERSION",
  options?: { recordKeys?: string[] }
): Promise<number> {
  if (steps.length === 0) return 0;

  const base = {
    run_id: runId,
    step: { in: steps },
    deleted_at: null,
  };
  const recordKeys = options?.recordKeys;
  const where: Parameters<typeof prisma.analysisTask.updateMany>[0]["where"] =
    recordKeys != null && recordKeys.length > 0
      ? {
          ...base,
          OR: [
            { record_type: { not: "POST" } },
            { record_type: "POST", record_key: { in: recordKeys } },
          ],
        }
      : base;

  const result = await prisma.analysisTask.updateMany({
    where,
    data: {
      state: "PENDING",
      locked_at: null,
      last_error: null,
      attempt_count: 0,
      updated_at: new Date(),
    },
  });

  return result.count;
}

/**
 * Create RunRecords from existing project posts (ad-hoc run).
 * Use when there is no orchestration run—e.g. to rerun analysis on existing data.
 * @param limit - If set, only the last N posts (by id desc) are included. Omit for all posts.
 * Blog posts (Post.platform === "blogs") are always merged in so News step can produce blog-sourced items.
 */
export async function freezeRunMembershipFromExistingPosts(
  runId: string,
  projectId: string,
  options?: { limit?: number }
): Promise<number> {
  let count = 0;

  const limit = options?.limit;
  const lastPosts = await prisma.post.findMany({
    where: { project_id: projectId },
    select: { id: true },
    orderBy: { id: "desc" },
    ...(limit != null ? { take: limit } : {}),
  });
  const lastIds = new Set(lastPosts.map((p) => p.id));

  // Always include all blog posts (Post.platform "blogs") so News step can create blog-sourced PostNews
  const blogPostRows = await prisma.post.findMany({
    where: { project_id: projectId, platform: "blogs" },
    select: { id: true },
  });
  const allPostIds = [...new Set([...lastIds, ...blogPostRows.map((p) => p.id)])].sort(
    (a, b) => a - b
  );

  for (const postId of allPostIds) {
    const id = generateId();
    await prisma.runRecord.upsert({
      where: {
        run_id_record_type_record_key: {
          run_id: runId,
          record_type: "POST",
          record_key: String(postId),
        },
      },
      create: {
        id,
        run_id: runId,
        project_id: projectId,
        record_type: "POST",
        record_key: String(postId),
      },
      update: {},
    });
    count++;
  }

  const blogLimit = options?.limit;
  const blogPosts = await prisma.blogPost.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true },
    orderBy: { created_at: "desc" },
    ...(blogLimit != null ? { take: blogLimit } : {}),
  });
  blogPosts.reverse();

  for (const bp of blogPosts) {
    const id = generateId();
    await prisma.runRecord.upsert({
      where: {
        run_id_record_type_record_key: {
          run_id: runId,
          record_type: "BLOG_POST",
          record_key: bp.id,
        },
      },
      create: {
        id,
        run_id: runId,
        project_id: projectId,
        record_type: "BLOG_POST",
        record_key: bp.id,
      },
      update: {},
    });
    count++;
  }

  // News batches: chunk by numeric id order so batches are deterministic and blog-heavy batches run
  for (let i = 0; i < allPostIds.length; i += NEWS_BATCH_SIZE) {
    const batchIdx = Math.floor(i / NEWS_BATCH_SIZE);
    const recordKey = `${runId}-batch-${batchIdx}`;
    const id = generateId();
    await prisma.runRecord.upsert({
      where: {
        run_id_record_type_record_key: {
          run_id: runId,
          record_type: "NEWS_BATCH",
          record_key: recordKey,
        },
      },
      create: {
        id,
        run_id: runId,
        project_id: projectId,
        record_type: "NEWS_BATCH",
        record_key: recordKey,
      },
      update: {},
    });
    count++;
  }

  return count;
}

/** Create AnalysisTasks only for the given steps. Used for targeted ad-hoc reruns. */
export async function enqueueRunTasksForSteps(
  runId: string,
  steps: AnalysisStep[]
): Promise<number> {
  const stepSet = new Set(steps);
  if (stepSet.size === 0) return 0;

  const records = await prisma.runRecord.findMany({
    where: { run_id: runId, deleted_at: null },
    select: { id: true, record_type: true, record_key: true },
  });

  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) return 0;

  const postIds = records
    .filter((r) => r.record_type === "POST")
    .map((r) => parseInt(r.record_key, 10))
    .filter((id) => !isNaN(id));
  const postRoles = new Map<number, { role: string | null; conversationId: string | null }>();
  const postPolicies = new Map<number, ReturnType<typeof getPostSourceAnalysisPolicy>>();
  if (postIds.length > 0) {
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, project_id: run.project_id },
      select: {
        id: true,
        post_conversation_role: true,
        conversation_id: true,
        platform: true,
        hn_story_analysis_id: true,
      },
    });
    for (const p of posts) {
      postRoles.set(p.id, {
        role: p.post_conversation_role,
        conversationId: p.conversation_id,
      });
      postPolicies.set(p.id, getPostSourceAnalysisPolicy(p.platform, p.hn_story_analysis_id));
    }
  }

  const stepsByRecordType: Record<RunRecordType, AnalysisStep[]> = {
    POST: ["SENTIMENT", "THEMES", "CHATTER", "NETWORK", "BRAND"],
    BLOG_POST: ["BLOG_NEWS_ANALYSIS"],
    NEWS_BATCH: ["NEWS"],
  };

  // Multi-step reruns that include THEMES but not SENTIMENT still need sentiment for ordering in some flows.
  const effectiveSteps = [...stepSet];
  if (stepSet.has("THEMES") && !stepSet.has("SENTIMENT") && stepSet.size > 1) {
    effectiveSteps.push("SENTIMENT");
  }

  let count = 0;
  for (const rec of records) {
    const allStepsForType = stepsByRecordType[rec.record_type];
    if (!allStepsForType) continue;

    const stepsToCreate =
      rec.record_type === "POST"
        ? allStepsForType.filter((step) => {
            if (!effectiveSteps.includes(step)) return false;
            const postId = parseInt(rec.record_key, 10);
            if (isNaN(postId)) return true;
            const roleInfo = postRoles.get(postId);
            const policy = postPolicies.get(postId) ?? getPostSourceAnalysisPolicy(null, null);
            if (!roleInfo) return shouldEnqueuePostAnalysisStep(step, undefined, policy);
            return shouldEnqueuePostAnalysisStep(step, roleInfo, policy);
          })
        : allStepsForType.filter((s) => effectiveSteps.includes(s));

    for (const step of stepsToCreate) {
      try {
        await prisma.analysisTask.upsert({
          where: {
            project_id_record_type_record_key_step_result_version: {
              project_id: run.project_id,
              record_type: rec.record_type,
              record_key: rec.record_key,
              step,
              result_version: 1,
            },
          },
          create: {
            id: generateId(),
            project_id: run.project_id,
            run_id: runId,
            record_type: rec.record_type,
            record_key: rec.record_key,
            step,
            updated_at: new Date(),
          },
          // Reassign and reset so ad-hoc reruns re-execute: task unique key does not include run_id
          update: {
            run_id: runId,
            state: "PENDING",
            completed_at: null,
            last_error: null,
            locked_at: null,
            attempt_count: 0,
            updated_at: new Date(),
          },
        });
        count++;
      } catch {
        // Ignore duplicates
      }
    }
  }

  // Themes-only: old SENTIMENT rows often stay PENDING forever. Skip them so workers/UI don't show stuck sentiment.
  if (stepSet.has("THEMES") && !stepSet.has("SENTIMENT") && stepSet.size === 1) {
    const postRecordKeys = records.filter((r) => r.record_type === "POST").map((r) => r.record_key);
    if (postRecordKeys.length > 0) {
      const skipped = await prisma.analysisTask.updateMany({
        where: {
          project_id: run.project_id,
          record_type: "POST",
          record_key: { in: postRecordKeys },
          step: "SENTIMENT",
          state: "PENDING",
          deleted_at: null,
        },
        data: {
          run_id: runId,
          state: "SKIPPED",
          completed_at: new Date(),
          last_error: "Skipped: themes-only run",
          locked_at: null,
          updated_at: new Date(),
        },
      });
      if (skipped.count > 0) {
        console.log(
          `[enqueueRunTasksForSteps] run=${runId}: marked ${skipped.count} SENTIMENT task(s) SKIPPED (themes-only)`
        );
      }
    }
  }

  await stampGithubPostsIngestAnalysisSkipped(run.project_id, postIds);
  return count;
}

/** Find latest OrchestrationRun for a project that has run records. */
export async function findLatestRunForProject(projectId: string): Promise<string | null> {
  const run = await prisma.orchestrationRun.findFirst({
    where: {
      project_id: projectId,
      deleted_at: null,
      status: { in: ["READY_FOR_ANALYSIS", "ANALYZING", "COMPLETED", "COMPLETED_WITH_ERRORS"] },
    },
    select: { id: true },
    orderBy: { started_at: "desc" },
  });
  if (!run) return null;

  const hasRecords = await prisma.runRecord.count({
    where: { run_id: run.id, deleted_at: null },
  });
  return hasRecords > 0 ? run.id : null;
}
