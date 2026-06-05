/**
 * Task-based analysis worker: claim tasks and execute step logic.
 * THEMES does not wait on SENTIMENT: a leftover SENTIMENT task stuck in PENDING from an older run
 * would otherwise block THEMES forever (themes-only reruns only upsert THEMES rows).
 */

import { prisma } from "@/lib/prisma";
import {
  expireStalePendingAnalysisTasksForRun,
  getPendingAnalysisTaskMaxAgeHours,
} from "@/lib/analysis-pending-task-ttl";
import { isGithubPlatform, isHackerNewsPlatform } from "@/lib/utils/platform";
import {
  runSentimentForPostIds,
  runThemesForPostIds,
  runChatterForPostIds,
  runNetworkForPostIds,
  runNewsForPostIds,
  runBrandForPostIds,
} from "@/lib/analysis/core";
import { runBlogPostAnalysisForIds } from "@/lib/blog-post-analysis-pipeline";
import { isRunComplete, isStepComplete } from "@/lib/analysis-run";
import type { AnalysisStep, AnalysisTaskState } from "@prisma/client";

const NEWS_BATCH_SIZE = 200;

/** Optional: reset RUNNING tasks whose lease (locked_at) is older than this (ms). 0 = disabled. */
const TASK_LEASE_MS = Math.max(0, parseInt(process.env.ANALYSIS_TASK_LEASE_MS ?? "0", 10) || 0);

/**
 * Reset stuck RUNNING tasks back to PENDING so another worker can claim them.
 * Safe to call when a process died mid-task; may cause duplicate LLM work if the original worker is still alive.
 */
export async function reclaimStaleRunningTasks(runId: string, maxAgeMs: number): Promise<number> {
  if (maxAgeMs <= 0) return 0;
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.analysisTask.updateMany({
    where: {
      run_id: runId,
      state: "RUNNING",
      locked_at: { not: null, lt: cutoff },
      deleted_at: null,
    },
    data: {
      state: "PENDING",
      locked_at: null,
      last_error: "Stale lease reclaimed",
      updated_at: new Date(),
    },
  });
  return result.count;
}
/** Batch BRAND tasks so one DB pass handles many posts (avoids one task = one post). */
const BRAND_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.ANALYSIS_BRAND_BATCH_SIZE ?? "100", 10) || 100
);
/** Legacy: used with ANALYSIS_THEMES_CONCURRENCY to size claim batches (THEMES_BATCH_SIZE × concurrency). */
const THEMES_BATCH_SIZE = 20;
/**
 * Legacy multiplier for default claim size only. Parallel theme batches are disabled — all claimed
 * post ids merge into one runThemesForPostIds per iteration (avoids analyzing the same Discord thread 5×).
 */
const THEMES_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.ANALYSIS_THEMES_CONCURRENCY ?? "5", 10) || 1
);
/** Max THEMES tasks (post ids) to claim per worker iteration; merged into a single runThemesForPostIds. */
const THEMES_CLAIM_LIMIT = Math.max(
  1,
  parseInt(process.env.ANALYSIS_THEMES_CLAIM_LIMIT ?? "", 10) ||
    THEMES_BATCH_SIZE * THEMES_CONCURRENCY
);
/** Batch CHATTER so one runChatterForPostIds call covers many posts (shared thread load + storeChatter work). */
const CHATTER_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.ANALYSIS_CHATTER_BATCH_SIZE ?? "20", 10) || 20
);
/** How many CHATTER batches to run in parallel (each batch = CHATTER_BATCH_SIZE posts). */
const CHATTER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.ANALYSIS_CHATTER_CONCURRENCY ?? "5", 10) || 1
);
/**
 * SENTIMENT: must match runSentimentForPostIds batching in comprehensive-analysis (posts per API call).
 * Worker claims many tasks and groups them so we do not pay one LLM call per post.
 */
const SENTIMENT_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.ANALYSIS_SENTIMENT_BATCH_SIZE ?? "20", 10) || 20
);
const SENTIMENT_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.ANALYSIS_SENTIMENT_CONCURRENCY ?? "5", 10) || 1
);

/**
 * NETWORK was one task per post but each run re-aggregated authors + project context — extremely slow
 * for large scrapes (e.g. 1k Discord messages, 0 qualifying influencers). Claim many tasks and run
 * runNetworkForPostIds once per batch (same semantics as merging min..max post id range).
 */
const NETWORK_CLAIM_LIMIT = Math.max(
  1,
  parseInt(process.env.ANALYSIS_NETWORK_CLAIM_LIMIT ?? "5000", 10) || 5000
);

/**
 * Claim PENDING tasks atomically (single UPDATE … RETURNING) so two workers cannot claim the same rows.
 */
export async function claimTasks(
  projectId: string,
  runId: string,
  step: AnalysisStep,
  limit: number
): Promise<Awaited<ReturnType<typeof prisma.analysisTask.findMany>>> {
  const now = new Date();

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AnalysisTask"
    SET "state" = 'RUNNING', "locked_at" = ${now}, "attempt_count" = "attempt_count" + 1, "updated_at" = ${now}
    WHERE "id" IN (
      SELECT t."id" FROM (
        SELECT t2."id" FROM "AnalysisTask" t2
        WHERE t2."project_id" = ${projectId}
          AND t2."run_id" = ${runId}
          AND t2."step" = ${step}
          AND t2."state" = 'PENDING'
          AND t2."deleted_at" IS NULL
        ORDER BY t2."id" ASC
        LIMIT ${limit}
      ) AS t
    )
    AND "state" = 'PENDING'
    RETURNING "id"
  `;

  if (claimed.length === 0) return [];
  const ids = claimed.map((r) => r.id);
  return prisma.analysisTask.findMany({
    where: { id: { in: ids } },
  });
}

/** Mark task terminal. */
export async function markTaskTerminal(
  taskId: string,
  state: AnalysisTaskState,
  error?: string | null
): Promise<void> {
  await prisma.analysisTask.update({
    where: { id: taskId },
    data: {
      state,
      completed_at: new Date(),
      last_error: error ?? null,
      locked_at: null,
      updated_at: new Date(),
    },
  });
}

/** Same as many single updates but one query per chunk — avoids SQLite P1008 when hundreds of tasks share state. */
const MARK_TERMINAL_MANY_CHUNK = 400;

async function markTasksTerminalMany(
  taskIds: string[],
  state: AnalysisTaskState,
  error?: string | null
): Promise<void> {
  if (taskIds.length === 0) return;
  const now = new Date();
  for (let i = 0; i < taskIds.length; i += MARK_TERMINAL_MANY_CHUNK) {
    const slice = taskIds.slice(i, i + MARK_TERMINAL_MANY_CHUNK);
    await prisma.analysisTask.updateMany({
      where: { id: { in: slice } },
      data: {
        state,
        completed_at: now,
        last_error: error ?? null,
        locked_at: null,
        updated_at: now,
      },
    });
  }
}

async function executePostStepWithRun(
  projectId: string,
  recordKey: string,
  runId: string,
  step: "THEMES" | "CHATTER" | "NETWORK" | "BRAND"
): Promise<{ success: boolean; error?: string }> {
  const postId = parseInt(recordKey, 10);
  if (isNaN(postId)) {
    return { success: false, error: `Invalid post id: ${recordKey}` };
  }
  const opts = { orchestrationRunId: runId };
  try {
    switch (step) {
      case "THEMES":
        await runThemesForPostIds(projectId, [postId], opts);
        break;
      case "CHATTER":
        await runChatterForPostIds(projectId, [postId], opts);
        break;
      case "NETWORK":
        await runNetworkForPostIds(projectId, [postId], opts);
        break;
      case "BRAND":
        await runBrandForPostIds(projectId, [postId]);
        break;
      default:
        return { success: false, error: `Unknown post step: ${step}` };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/** Execute THEMES for multiple tasks in one runThemesForPostIds call (fewer API calls). */
async function executeBrandBatch(
  projectId: string,
  tasks: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>
): Promise<{ success: boolean; error?: string }> {
  const postIds: number[] = [];
  for (const t of tasks) {
    if (t.record_type !== "POST") continue;
    const id = parseInt(t.record_key, 10);
    if (!isNaN(id)) postIds.push(id);
  }
  if (postIds.length === 0) return { success: true };
  try {
    await runBrandForPostIds(projectId, postIds);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/** Execute CHATTER for multiple tasks in one runChatterForPostIds call; skips GitHub (no chatter). */
async function executeChatterBatch(
  projectId: string,
  tasks: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>
): Promise<{ success: boolean; error?: string }> {
  const postIds: number[] = [];
  for (const t of tasks) {
    if (t.record_type !== "POST") continue;
    const id = parseInt(t.record_key, 10);
    if (!isNaN(id)) postIds.push(id);
  }
  if (postIds.length === 0) return { success: true };
  const rows = await prisma.post.findMany({
    where: { id: { in: postIds }, project_id: projectId },
    select: { id: true, platform: true },
  });
  const idsForChatter = rows.filter((p) => !isGithubPlatform(p.platform)).map((p) => p.id);
  if (idsForChatter.length === 0) return { success: true };
  try {
    const runId = tasks[0]?.run_id;
    await runChatterForPostIds(projectId, idsForChatter, { orchestrationRunId: runId });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/** One OpenAI call per chunk (see runSentimentForPostIds); excludes GitHub posts (no LLM sentiment). */
async function executeNetworkBatch(
  projectId: string,
  tasks: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>
): Promise<{ success: boolean; error?: string }> {
  const postIds: number[] = [];
  for (const t of tasks) {
    if (t.record_type !== "POST") continue;
    const id = parseInt(t.record_key, 10);
    if (!isNaN(id)) postIds.push(id);
  }
  if (postIds.length === 0) return { success: true };
  try {
    const runId = tasks[0]?.run_id;
    await runNetworkForPostIds(projectId, postIds, { orchestrationRunId: runId });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

async function executeSentimentBatch(
  projectId: string,
  tasks: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>
): Promise<{ success: boolean; error?: string }> {
  const postIds: number[] = [];
  for (const t of tasks) {
    if (t.record_type !== "POST") continue;
    const id = parseInt(t.record_key, 10);
    if (!isNaN(id)) postIds.push(id);
  }
  if (postIds.length === 0) return { success: true };
  const rows = await prisma.post.findMany({
    where: { id: { in: postIds }, project_id: projectId },
    select: { id: true, platform: true },
  });
  const idsForLlm = rows.filter((p) => !isGithubPlatform(p.platform)).map((p) => p.id);
  if (idsForLlm.length === 0) return { success: true };
  try {
    await runSentimentForPostIds(projectId, idsForLlm);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

async function executeNewsBatchStep(
  task: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>[number]
): Promise<{ success: boolean; error?: string }> {
  const { project_id, record_key, run_id } = task;
  const batchIdxMatch = record_key.match(/-batch-(\d+)$/);
  if (!batchIdxMatch) {
    return { success: false, error: `Invalid NEWS_BATCH record_key: ${record_key}` };
  }
  const batchIdx = parseInt(batchIdxMatch[1], 10);
  if (isNaN(batchIdx) || batchIdx < 0) {
    return { success: false, error: `Invalid batch index: ${record_key}` };
  }
  const postRecords = await prisma.runRecord.findMany({
    where: { run_id, record_type: "POST", deleted_at: null },
    select: { record_key: true },
  });
  const sortedIds = postRecords
    .map((r) => parseInt(r.record_key, 10))
    .filter((id) => !isNaN(id))
    .sort((a, b) => a - b);
  const batchIds = sortedIds.slice(
    batchIdx * NEWS_BATCH_SIZE,
    batchIdx * NEWS_BATCH_SIZE + NEWS_BATCH_SIZE
  );
  if (batchIds.length === 0) return { success: true }; // Empty batch - no-op
  const postsInBatch = await prisma.post.findMany({
    where: { id: { in: batchIds }, project_id },
    select: { id: true, platform: true },
  });
  const idsForNews = postsInBatch.filter((p) => !isGithubPlatform(p.platform)).map((p) => p.id);
  if (idsForNews.length === 0) return { success: true };
  await runNewsForPostIds(project_id, idsForNews, { orchestrationRunId: run_id });
  return { success: true };
}

/** Execute a single task. Returns success. */
export async function executeTask(
  task: Awaited<ReturnType<typeof prisma.analysisTask.findMany>>[number]
): Promise<{ success: boolean; error?: string }> {
  const { project_id, record_type, record_key, step, run_id } = task;

  try {
    switch (step) {
      case "SENTIMENT":
        if (record_type !== "POST") {
          return { success: true }; // Skip non-POST
        }
        const postId = parseInt(record_key, 10);
        if (isNaN(postId)) {
          return { success: false, error: `Invalid post id: ${record_key}` };
        }
        {
          const row = await prisma.post.findUnique({
            where: { id: postId },
            select: { platform: true },
          });
          if (isGithubPlatform(row?.platform)) {
            await prisma.post.update({
              where: { id: postId },
              data: { ai_processed_at: new Date() },
            });
            return { success: true };
          }
        }
        const result = await runSentimentForPostIds(project_id, [postId]);
        if (result.analyzed === 0) {
          // Post may already have sentiment
          const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { sentiment: true },
          });
          if (post?.sentiment) return { success: true };
        }
        return { success: true };

      case "THEMES":
        if (record_type !== "POST") return { success: true };
        return executePostStepWithRun(project_id, record_key, run_id, "THEMES");

      case "CHATTER":
        if (record_type !== "POST") return { success: true };
        {
          const pid = parseInt(record_key, 10);
          if (!isNaN(pid)) {
            const row = await prisma.post.findUnique({
              where: { id: pid },
              select: { platform: true },
            });
            if (isGithubPlatform(row?.platform)) return { success: true };
          }
        }
        return executePostStepWithRun(project_id, record_key, run_id, "CHATTER");

      case "NETWORK":
        if (record_type !== "POST") return { success: true };
        {
          const pid = parseInt(record_key, 10);
          if (!isNaN(pid)) {
            const row = await prisma.post.findUnique({
              where: { id: pid },
              select: { platform: true, hn_story_analysis_id: true },
            });
            if (
              isGithubPlatform(row?.platform) ||
              isHackerNewsPlatform(row?.platform, row?.hn_story_analysis_id)
            ) {
              return { success: true };
            }
          }
        }
        return executePostStepWithRun(project_id, record_key, run_id, "NETWORK");

      case "BRAND":
        if (record_type !== "POST") return { success: true };
        return executePostStepWithRun(project_id, record_key, run_id, "BRAND");

      case "NEWS":
        if (record_type !== "NEWS_BATCH") return { success: true };
        return executeNewsBatchStep(task);

      case "BLOG_NEWS_ANALYSIS":
        if (record_type !== "BLOG_POST") return { success: true };
        if (!record_key?.trim()) {
          return { success: false, error: "Empty blog post id" };
        }
        await runBlogPostAnalysisForIds(project_id, [record_key], {
          ingestedRunId: task.run_id,
        });
        return { success: true };

      default:
        return { success: false, error: `Unknown step: ${step}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/** Default concurrency for steps that still use per-task executeTask (e.g. BLOG_NEWS). Override with ANALYSIS_CONCURRENCY env. */
const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.ANALYSIS_CONCURRENCY ?? "3", 10) || 1);

/** Run worker loop until run is complete. */
export async function runWorkerLoop(
  runId: string,
  options?: { pollIntervalMs?: number; concurrency?: number }
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 2000;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const steps: AnalysisStep[] = [
    "SENTIMENT",
    "THEMES",
    "CHATTER",
    "NETWORK",
    "NEWS",
    "BRAND",
    "BLOG_NEWS_ANALYSIS",
  ];

  const run = await prisma.orchestrationRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  const projectId = run.project_id;

  console.log(
    `[AnalysisWorker] ${new Date().toLocaleString()} (local) run=${runId} project=${projectId} started (steps: ${steps.join(", ")})`
  );

  if (TASK_LEASE_MS > 0) {
    const reclaimed = await reclaimStaleRunningTasks(runId, TASK_LEASE_MS);
    if (reclaimed > 0) {
      console.log(
        `[AnalysisWorker] run=${runId} reclaimed ${reclaimed} stale RUNNING task(s) (ANALYSIS_TASK_LEASE_MS=${TASK_LEASE_MS})`
      );
    }
  }

  async function runPendingTtlPass(): Promise<void> {
    if (getPendingAnalysisTaskMaxAgeHours() == null) return;
    const n = await expireStalePendingAnalysisTasksForRun(runId);
    if (n > 0) {
      const h = getPendingAnalysisTaskMaxAgeHours();
      console.log(
        `[AnalysisWorker] run=${runId} TTL: skipped ${n} stale PENDING task(s) (max age ${h}h from updated_at; set ANALYSIS_TASK_PENDING_MAX_AGE_HOURS or 0=off)`
      );
    }
  }

  /** One line per step when there is nothing to claim and the step is fully terminal (avoids log spam while dependencies block). */
  const loggedStepIdleSummary = new Set<AnalysisStep>();

  /** Counts consecutive outer-loop iterations where no tasks were claimed (run still not complete). */
  let idlePollsWhileIncomplete = 0;
  const STUCK_LOG_EVERY_IDLE_POLLS = 15;

  while (true) {
    /** Let HTTP/polling replies through between batches (same process as Next.js API routes). */
    await new Promise<void>((resolve) => setImmediate(resolve));
    await runPendingTtlPass();

    let claimedAny = false;

    for (const step of steps) {
      const claimLimit =
        step === "THEMES"
          ? THEMES_CLAIM_LIMIT
          : step === "CHATTER"
            ? CHATTER_BATCH_SIZE * CHATTER_CONCURRENCY
            : step === "SENTIMENT"
              ? SENTIMENT_BATCH_SIZE * SENTIMENT_CONCURRENCY
              : step === "BRAND"
                ? BRAND_BATCH_SIZE
                : step === "NETWORK"
                  ? NETWORK_CLAIM_LIMIT
                  : concurrency;
      const tasks = await claimTasks(projectId, runId, step, claimLimit);
      if (tasks.length === 0) {
        if (!loggedStepIdleSummary.has(step) && (await isStepComplete(runId, step))) {
          const total = await prisma.analysisTask.count({
            where: { run_id: runId, step, deleted_at: null },
          });
          const succeeded = await prisma.analysisTask.count({
            where: { run_id: runId, step, deleted_at: null, state: "SUCCEEDED" },
          });
          loggedStepIdleSummary.add(step);
          if (total === 0) {
            console.log(
              `[AnalysisWorker] run=${runId} ${step}: no tasks enqueued for this run (nothing to claim)`
            );
          } else {
            console.log(
              `[AnalysisWorker] run=${runId} ${step}: idle; step finished (${succeeded}/${total} SUCCEEDED)`
            );
          }
        }
        continue;
      }
      claimedAny = true;

      if (step === "SENTIMENT" && tasks.length > 0) {
        const chunks: (typeof tasks)[] = [];
        for (let i = 0; i < tasks.length; i += SENTIMENT_BATCH_SIZE) {
          chunks.push(tasks.slice(i, i + SENTIMENT_BATCH_SIZE));
        }
        const chunkResults = await Promise.all(
          chunks.map((chunk) => executeSentimentBatch(projectId, chunk))
        );
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const result = chunkResults[i];
          const state = result.success ? "SUCCEEDED" : "FAILED";
          await markTasksTerminalMany(
            chunk.map((t) => t.id),
            state,
            result.error
          );
        }
      } else if (step === "THEMES" && tasks.length > 0) {
        const postIds: number[] = [];
        for (const t of tasks) {
          if (t.record_type !== "POST") continue;
          const id = parseInt(t.record_key, 10);
          if (!isNaN(id)) postIds.push(id);
        }
        const uniqueIds = [...new Set(postIds)];
        if (uniqueIds.length === 0) {
          await markTasksTerminalMany(
            tasks.map((t) => t.id),
            "SUCCEEDED"
          );
        } else {
          try {
            console.log(
              `[AnalysisWorker] THEMES: ${uniqueIds.length} unique post id(s) from ${tasks.length} task(s) → one runThemesForPostIds (dedupes threads; avoids parallel duplicate LLM on same conversation)`
            );
            await runThemesForPostIds(projectId, uniqueIds, { orchestrationRunId: runId });
            await markTasksTerminalMany(
              tasks.map((t) => t.id),
              "SUCCEEDED"
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await markTasksTerminalMany(
              tasks.map((t) => t.id),
              "FAILED",
              msg
            );
          }
        }
      } else if (step === "CHATTER" && tasks.length > 0) {
        const chunks: (typeof tasks)[] = [];
        for (let i = 0; i < tasks.length; i += CHATTER_BATCH_SIZE) {
          chunks.push(tasks.slice(i, i + CHATTER_BATCH_SIZE));
        }
        const chunkResults = await Promise.all(
          chunks.map((chunk) => executeChatterBatch(projectId, chunk))
        );
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const result = chunkResults[i];
          const state = result.success ? "SUCCEEDED" : "FAILED";
          await markTasksTerminalMany(
            chunk.map((t) => t.id),
            state,
            result.error
          );
        }
      } else if (step === "BRAND" && tasks.length > 0) {
        const result = await executeBrandBatch(projectId, tasks);
        const state = result.success ? "SUCCEEDED" : "FAILED";
        await markTasksTerminalMany(
          tasks.map((t) => t.id),
          state,
          result.error
        );
      } else if (step === "NETWORK" && tasks.length > 0) {
        const result = await executeNetworkBatch(projectId, tasks);
        const state = result.success ? "SUCCEEDED" : "FAILED";
        await markTasksTerminalMany(
          tasks.map((t) => t.id),
          state,
          result.error
        );
      } else {
        await Promise.all(
          tasks.map(async (task) => {
            const result = await executeTask(task);
            await markTaskTerminal(task.id, result.success ? "SUCCEEDED" : "FAILED", result.error);
          })
        );
      }
    }

    if (await isRunComplete(runId)) {
      console.log(`[AnalysisWorker] run=${runId} complete`);
      return;
    }

    if (!claimedAny) {
      idlePollsWhileIncomplete += 1;
      if (
        idlePollsWhileIncomplete >= STUCK_LOG_EVERY_IDLE_POLLS &&
        idlePollsWhileIncomplete % STUCK_LOG_EVERY_IDLE_POLLS === 0
      ) {
        const grouped = await prisma.analysisTask.groupBy({
          by: ["state"],
          where: { run_id: runId, deleted_at: null },
          _count: { _all: true },
        });
        const parts = grouped.map((g) => `${g.state}=${g._count._all}`).join(", ");
        console.warn(
          `[AnalysisWorker] run=${runId} not complete but no tasks claimed this round (idle polls=${idlePollsWhileIncomplete}). Task counts: ${parts || "none"}. If PENDING>0 with long idle: stuck RUNNING (${process.env.ANALYSIS_TASK_LEASE_MS ? `lease ${process.env.ANALYSIS_TASK_LEASE_MS}ms` : "set ANALYSIS_TASK_LEASE_MS"}), or PENDING older than ANALYSIS_TASK_PENDING_MAX_AGE_HOURS (TTL skip).`
        );
      }
      if (process.env.ANALYSIS_METRICS_JSON === "true") {
        console.log(
          JSON.stringify({
            type: "analysis_worker_poll_idle",
            runId,
            projectId,
            pollIntervalMs,
            idlePollsWhileIncomplete,
            ts: new Date().toISOString(),
          })
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    } else {
      idlePollsWhileIncomplete = 0;
    }
  }
}
