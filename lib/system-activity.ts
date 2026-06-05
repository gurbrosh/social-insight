import { prisma } from "@/lib/prisma";
import {
  ANALYSIS_LOCK_TTL_MS,
  AnalysisLock,
  clearAnalysisLock,
  getAnalysisLock,
  isAnalysisLockStale,
} from "@/lib/analysis-lock";

type SerializedDate = string;

function parseProjectIds(raw?: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function toIsoDate(date?: Date | null): SerializedDate {
  return (date ?? new Date()).toISOString();
}

function shortApifyRunId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Truncate for one-line UI without breaking layout. */
function truncateForUi(s: string, maxLen: number): string {
  const t = s.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

/** Aggregates failed analysis tasks for the run so the UI can show what broke (HTTP 200 does not imply every task succeeded). */
async function getFailedTaskSummaryForRun(runId: string): Promise<{
  failedTaskCount: number;
  failedTasksByStep: { step: string; count: number }[];
  failedTaskSampleError: string | null;
}> {
  const grouped = await prisma.analysisTask.groupBy({
    by: ["step"],
    where: { run_id: runId, deleted_at: null, state: "FAILED" },
    _count: { _all: true },
  });
  const failedTaskCount = grouped.reduce((sum, g) => sum + g._count._all, 0);
  const failedTasksByStep = grouped
    .map((g) => ({ step: g.step, count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.step.localeCompare(b.step));

  const sample = await prisma.analysisTask.findFirst({
    where: {
      run_id: runId,
      deleted_at: null,
      state: "FAILED",
      last_error: { not: null },
    },
    orderBy: { updated_at: "desc" },
    select: { last_error: true },
  });
  const failedTaskSampleError = sample?.last_error ? truncateForUi(sample.last_error, 360) : null;

  return { failedTaskCount, failedTasksByStep, failedTaskSampleError };
}

function formatFailedStepsShort(
  byStep: { step: string; count: number }[],
  totalFailed: number
): string {
  if (totalFailed <= 0 || byStep.length === 0) return "";
  const parts = byStep.map(({ step, count }) => (count > 1 ? `${step} ×${count}` : step));
  return `${totalFailed} failed: ${parts.join(", ")}`;
}

/** Human-readable run outcome for task-analysis headlines (avoids raw enum strings like COMPLETED_WITH_ERRORS). */
function formatOrchestrationRunStatusForUi(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "All steps succeeded";
    case "COMPLETED_WITH_ERRORS":
      return "Some analysis tasks failed (see below)";
    case "FAILED":
      return "Run failed";
    case "COLLECTING":
      return "Collecting";
    case "READY_FOR_ANALYSIS":
      return "Ready for analysis";
    case "ANALYZING":
      return "Analyzing";
    default:
      return status;
  }
}

/** While OrchestrationRun is COLLECTING, best-effort labels from step + Apify scrape job (if any). */
async function getCollectionPhaseHints(
  projectId: string,
  runId: string
): Promise<{ activeStepLabel: string | null; scrapeJobHint: string | null }> {
  const [runningStep, activeScrapeJob] = await Promise.all([
    prisma.orchestrationStepExecution.findFirst({
      where: { project_id: projectId, status: "RUNNING", deleted_at: null },
      orderBy: { updated_at: "desc" },
      select: { scraper_name: true, platform: true },
    }),
    prisma.scrapeJob.findFirst({
      where: {
        project_id: projectId,
        orchestration_run_id: runId,
        deleted_at: null,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { updated_at: "desc" },
      select: { status: true, apify_run_id: true },
    }),
  ]);

  let activeStepLabel: string | null = null;
  if (runningStep) {
    const kind =
      runningStep.platform === "openai_task" ? "custom task" : `${runningStep.platform} scrape`;
    activeStepLabel = `${runningStep.scraper_name} · ${kind}`;
  }

  let scrapeJobHint: string | null = null;
  if (activeScrapeJob) {
    if (activeScrapeJob.apify_run_id) {
      scrapeJobHint = `Apify run ${shortApifyRunId(activeScrapeJob.apify_run_id)} (${activeScrapeJob.status})`;
    } else {
      scrapeJobHint = `Scrape job ${activeScrapeJob.status}`;
    }
  }

  return { activeStepLabel, scrapeJobHint };
}

/**
 * One grouped query instead of two full COUNTs — much cheaper on large runs (e.g. 10k+ Discord tasks).
 * Intentionally no in-memory cache here: caching snapshots made the UI look “stuck” at one % while tasks advanced.
 */
async function countAnalysisTasksByState(
  runId: string
): Promise<{ totalTasks: number; pendingTasks: number }> {
  const rows = await prisma.$queryRaw<Array<{ state: string; c: bigint }>>`
    SELECT "state", COUNT(*) AS c
    FROM "AnalysisTask"
    WHERE "run_id" = ${runId} AND "deleted_at" IS NULL
    GROUP BY "state"
  `;
  let totalTasks = 0;
  let pendingTasks = 0;
  const terminal = new Set(["SUCCEEDED", "FAILED", "SKIPPED"]);
  for (const r of rows) {
    const c = Number(r.c);
    totalTasks += c;
    if (!terminal.has(r.state)) {
      pendingTasks += c;
    }
  }
  return { totalTasks, pendingTasks };
}

/**
 * Short TTL cache for the task-analysis snapshot only (used by `/api/system/activity` polling).
 * Fresh counts on every request contended with SQLite during large runs; ~5s staleness is acceptable
 * to avoid the UI/server "stuck–go" loop from overlapping polls hammering the same GROUP BY.
 */
const taskSnapshotCache = new Map<string, { at: number; snapshot: TaskAnalysisStatus | null }>();
const TASK_SNAPSHOT_TTL_MS = 5_000;
const TASK_SNAPSHOT_CACHE_MAX_KEYS = 48;

function pruneTaskSnapshotCache(now: number): void {
  if (taskSnapshotCache.size <= TASK_SNAPSHOT_CACHE_MAX_KEYS) return;
  for (const [k, v] of taskSnapshotCache) {
    if (now - v.at > 120_000) taskSnapshotCache.delete(k);
  }
  if (taskSnapshotCache.size <= TASK_SNAPSHOT_CACHE_MAX_KEYS) return;
  const entries = [...taskSnapshotCache.entries()].sort((a, b) => a[1].at - b[1].at);
  const overflow = taskSnapshotCache.size - TASK_SNAPSHOT_CACHE_MAX_KEYS;
  for (let i = 0; i < overflow; i++) {
    taskSnapshotCache.delete(entries[i][0]);
  }
}

async function getTaskAnalysisSnapshotCached(
  projectId: string
): Promise<TaskAnalysisStatus | null> {
  const now = Date.now();
  const hit = taskSnapshotCache.get(projectId);
  if (hit && now - hit.at < TASK_SNAPSHOT_TTL_MS) {
    return hit.snapshot;
  }
  const snapshot = await getTaskAnalysisSnapshot(projectId);
  taskSnapshotCache.set(projectId, { at: now, snapshot });
  pruneTaskSnapshotCache(now);
  return snapshot;
}

async function getTaskAnalysisSnapshot(projectId: string): Promise<TaskAnalysisStatus | null> {
  const run = await prisma.orchestrationRun.findFirst({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { started_at: "desc" },
    select: {
      id: true,
      status: true,
      orchestration_execution_id: true,
      analysis_started_at: true,
      analysis_completed_at: true,
    },
  });
  if (!run) {
    return null;
  }

  /**
   * Collection phase: trust DB `OrchestrationExecution.status === RUNNING` for this run's
   * `orchestration_execution_id`. In-memory executor checks are unreliable across serverless
   * isolates, HMR, or timer vs request contexts — users would see "Idle" during long custom tasks.
   */
  let isOrchestrationCollecting = false;
  if (run.status === "COLLECTING" && run.orchestration_execution_id) {
    const execution = await prisma.orchestrationExecution.findFirst({
      where: { id: run.orchestration_execution_id, deleted_at: null },
      select: { id: true, status: true, orchestration_id: true },
    });
    if (execution?.status === "RUNNING") {
      isOrchestrationCollecting = true;
    }
  }

  const { totalTasks, pendingTasks } = await countAnalysisTasksByState(run.id);

  const isFinished =
    run.analysis_completed_at != null ||
    run.status === "COMPLETED" ||
    run.status === "COMPLETED_WITH_ERRORS" ||
    run.status === "FAILED";

  const isRunning = pendingTasks > 0;

  const isPipelineActive =
    !isFinished &&
    (pendingTasks > 0 ||
      isOrchestrationCollecting ||
      run.status === "READY_FOR_ANALYSIS" ||
      run.status === "ANALYZING");

  let pipelinePhase: TaskAnalysisStatus["pipelinePhase"];
  if (isFinished) {
    pipelinePhase = "finished";
  } else if (pendingTasks > 0) {
    pipelinePhase = "analysis_tasks";
  } else if (isOrchestrationCollecting) {
    pipelinePhase = "collecting";
  } else if (run.status === "COLLECTING") {
    /** DB still says COLLECTING but no RUNNING orchestration (stopped/crashed; step rows may be stale). */
    pipelinePhase = "idle";
  } else if (run.status === "READY_FOR_ANALYSIS") {
    pipelinePhase = "preparing_analysis";
  } else if (run.status === "ANALYZING") {
    pipelinePhase = "analyzing";
  } else {
    pipelinePhase = "idle";
  }

  let activeStepLabel: string | null = null;
  let scrapeJobHint: string | null = null;
  if (!isFinished && isOrchestrationCollecting) {
    const hints = await getCollectionPhaseHints(projectId, run.id);
    activeStepLabel = hints.activeStepLabel;
    scrapeJobHint = hints.scrapeJobHint;
  }

  const completedTasks = Math.max(0, totalTasks - pendingTasks);
  const percentComplete =
    totalTasks > 0
      ? Math.min(100, Math.max(0, Math.round((completedTasks / totalTasks) * 100)))
      : 0;

  const failedSummary = isFinished
    ? await getFailedTaskSummaryForRun(run.id)
    : {
        failedTaskCount: 0,
        failedTasksByStep: [] as { step: string; count: number }[],
        failedTaskSampleError: null as string | null,
      };

  const failedHeadlineSuffix =
    isFinished && failedSummary.failedTaskCount > 0
      ? ` · ${formatFailedStepsShort(failedSummary.failedTasksByStep, failedSummary.failedTaskCount)}`
      : "";

  let headline: string;
  if (totalTasks === 0) {
    if (isFinished) {
      const when = run.analysis_completed_at
        ? new Date(run.analysis_completed_at).toLocaleString()
        : "";
      headline = `Analysis run finished · ${formatOrchestrationRunStatusForUi(run.status)}${failedHeadlineSuffix}${when ? ` · ${when}` : ""}`;
    } else if (isOrchestrationCollecting) {
      headline = "Collecting data for this run…";
    } else if (run.status === "COLLECTING") {
      headline = "No analysis tasks queued for the latest run yet.";
    } else if (run.status === "READY_FOR_ANALYSIS") {
      headline = "Preparing analysis queue…";
    } else if (run.status === "ANALYZING") {
      headline = "Starting analysis…";
    } else {
      headline = "No analysis tasks queued for the latest run yet.";
    }
  } else if (pendingTasks > 0) {
    headline = "Analysis running";
  } else if (isFinished) {
    const when = run.analysis_completed_at
      ? new Date(run.analysis_completed_at).toLocaleString()
      : "";
    headline = `Entire analysis finished · ${formatOrchestrationRunStatusForUi(run.status)}${failedHeadlineSuffix}${when ? ` · ${when}` : ""}`;
  } else {
    headline = `All ${totalTasks.toLocaleString()} tasks terminal · ${formatOrchestrationRunStatusForUi(run.status)}${failedHeadlineSuffix}`;
  }

  return {
    runId: run.id,
    status: run.status,
    pendingTasks,
    totalTasks,
    completedTasks,
    percentComplete,
    analysisStartedAt: run.analysis_started_at?.toISOString() ?? null,
    analysisCompletedAt: run.analysis_completed_at?.toISOString() ?? null,
    isFinished,
    isRunning,
    isPipelineActive,
    pipelinePhase,
    activeStepLabel,
    scrapeJobHint,
    headline,
    failedTaskCount: failedSummary.failedTaskCount,
    failedTasksByStep: failedSummary.failedTasksByStep,
    failedTaskSampleError: failedSummary.failedTaskSampleError,
  };
}

async function resolveAnalysisLock(
  lock: AnalysisLock | null,
  projectFilter?: string
): Promise<SystemActivity["analysis"]> {
  if (!lock) {
    return null;
  }

  if (isAnalysisLockStale(lock, ANALYSIS_LOCK_TTL_MS)) {
    clearAnalysisLock(lock.projectId);
    return null;
  }

  if (projectFilter && lock.projectId !== projectFilter) {
    return null;
  }

  const project = await prisma.project.findUnique({
    where: { id: lock.projectId },
    select: { name: true },
  });

  return {
    projectId: lock.projectId,
    projectName: project?.name ?? undefined,
    mode: lock.mode,
    startedAt: new Date(lock.startedAt).toISOString(),
  };
}

export interface OrchestrationActivity {
  executionId: string;
  orchestrationId: string;
  name: string;
  startedAt: SerializedDate;
  projectIds: string[];
}

export interface AnalysisActivity {
  projectId: string;
  projectName?: string;
  mode: AnalysisLock["mode"];
  startedAt: SerializedDate;
}

/** Task-based analysis (AnalysisTask / OrchestrationRun) — only when projectId is passed to getSystemActivity. */
export interface TaskAnalysisStatus {
  runId: string;
  status: string;
  pendingTasks: number;
  totalTasks: number;
  /** Tasks in SUCCEEDED, FAILED, or SKIPPED. */
  completedTasks: number;
  /** 0–100 based on completedTasks / totalTasks. */
  percentComplete: number;
  analysisStartedAt: SerializedDate | null;
  analysisCompletedAt: SerializedDate | null;
  /** True when the run is marked complete (or completed with errors). */
  isFinished: boolean;
  /** True while analysis tasks remain (non-terminal AnalysisTask rows). */
  isRunning: boolean;
  /**
   * True while the run pipeline is in motion: collection, enqueue, analysis tasks, or analysis phase
   * before terminal. Use for polling; broader than `isRunning` (which is analysis-task rows only).
   */
  isPipelineActive: boolean;
  /**
   * High-level phase for UI. Collection detail comes from `activeStepLabel` / `scrapeJobHint` when
   * `collecting` (OrchestrationExecution RUNNING + optional step/scrape hints); includes custom tasks.
   */
  pipelinePhase:
    | "collecting"
    | "preparing_analysis"
    | "analyzing"
    | "analysis_tasks"
    | "idle"
    | "finished";
  /** Active orchestration step label while COLLECTING, if any RUNNING step exists for this project. */
  activeStepLabel: string | null;
  /** Active Apify-linked scrape job for this run, if any (not set for pure custom-task steps). */
  scrapeJobHint: string | null;
  /** Short status line; detailed progress uses completedTasks / totalTasks / percentComplete. */
  headline: string;
  /** Count of AnalysisTask rows with state FAILED for this run (populated when the run is finished). */
  failedTaskCount: number;
  /** FAILED tasks grouped by step (e.g. BLOG_NEWS_ANALYSIS). */
  failedTasksByStep: { step: string; count: number }[];
  /** Most recent non-null last_error among failed tasks (truncated). */
  failedTaskSampleError: string | null;
}

export interface SystemActivity {
  orchestration: OrchestrationActivity | null;
  analysis: AnalysisActivity | null;
  /** Latest orchestration run task pipeline for this project (null if projectId not requested or no run). */
  taskAnalysis: TaskAnalysisStatus | null;
}

/**
 * Ignore RUNNING executions for UI if the row has not been updated in this long (zombie / stuck).
 * Real collection/analysis should touch `updated_at` regularly via Prisma `@updatedAt`.
 */
const STALE_ORCHESTRATION_EXECUTION_MS = 72 * 60 * 60 * 1000;

/**
 * Project-scoped orchestration banner: only the execution linked from the **latest** `OrchestrationRun`
 * for this project, and only while that execution is actually RUNNING. Avoids showing a zombie
 * `OrchestrationExecution` from an older run that never transitioned to COMPLETED.
 */
async function getOrchestrationActivityForProject(
  projectId: string
): Promise<OrchestrationActivity | null> {
  const latestRun = await prisma.orchestrationRun.findFirst({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { started_at: "desc" },
    select: { orchestration_execution_id: true },
  });
  const execId = latestRun?.orchestration_execution_id?.trim();
  if (!execId) {
    return null;
  }

  const orchestrationExecution = await prisma.orchestrationExecution.findFirst({
    where: {
      id: execId,
      deleted_at: null,
      status: "RUNNING",
    },
    include: {
      orchestration: {
        select: {
          id: true,
          name: true,
          project_ids: true,
        },
      },
    },
  });
  if (!orchestrationExecution) {
    return null;
  }

  const ageMs = Date.now() - orchestrationExecution.updated_at.getTime();
  if (ageMs > STALE_ORCHESTRATION_EXECUTION_MS) {
    return null;
  }

  try {
    const orchId =
      orchestrationExecution.orchestration?.id ?? orchestrationExecution.orchestration_id;
    return {
      executionId: orchestrationExecution.id,
      orchestrationId: orchId,
      name: orchestrationExecution.orchestration?.name ?? "Orchestration Run",
      startedAt: toIsoDate(orchestrationExecution.started_at ?? orchestrationExecution.created_at),
      projectIds: parseProjectIds(orchestrationExecution.orchestration?.project_ids ?? null),
    };
  } catch (error) {
    console.error("Error parsing orchestration activity for project:", error);
    return null;
  }
}

export async function getSystemActivity(options?: { projectId?: string }): Promise<SystemActivity> {
  try {
    const projectId = options?.projectId;

    let orchestration: OrchestrationActivity | null = null;
    if (projectId) {
      orchestration = await getOrchestrationActivityForProject(projectId);
    } else {
      const orchestrationExecution = await prisma.orchestrationExecution.findFirst({
        where: {
          deleted_at: null,
          status: "RUNNING",
          orchestration: {
            deleted_at: null,
          },
        },
        orderBy: [
          {
            started_at: "desc",
          },
        ],
        include: {
          orchestration: {
            select: {
              id: true,
              name: true,
              project_ids: true,
            },
          },
        },
      });

      if (orchestrationExecution) {
        try {
          const orchId =
            orchestrationExecution.orchestration?.id ?? orchestrationExecution.orchestration_id;
          orchestration = {
            executionId: orchestrationExecution.id,
            orchestrationId: orchId,
            name: orchestrationExecution.orchestration?.name ?? "Orchestration Run",
            startedAt: toIsoDate(
              orchestrationExecution.started_at ?? orchestrationExecution.created_at
            ),
            projectIds: parseProjectIds(orchestrationExecution.orchestration?.project_ids ?? null),
          };
        } catch (error) {
          console.error("Error parsing orchestration activity:", error);
          orchestration = null;
        }
      }
    }

    const analysisLock = getAnalysisLock();
    let analysis: AnalysisActivity | null = null;
    try {
      analysis = await resolveAnalysisLock(analysisLock, projectId);
    } catch (error) {
      console.error("Error resolving analysis lock:", error);
      // Return null if analysis lock resolution fails, but don't fail the entire request
      analysis = null;
    }

    let taskAnalysis: TaskAnalysisStatus | null = null;
    if (projectId) {
      try {
        taskAnalysis = await getTaskAnalysisSnapshotCached(projectId);
      } catch (error) {
        console.error("Error fetching task analysis snapshot:", error);
      }
    }

    return {
      orchestration,
      analysis,
      taskAnalysis,
    };
  } catch (error) {
    console.error("Error in getSystemActivity:", error);
    // Return empty activity instead of throwing
    return {
      orchestration: null,
      analysis: null,
      taskAnalysis: null,
    };
  }
}
