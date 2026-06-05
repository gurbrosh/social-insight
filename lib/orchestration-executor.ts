import { prisma } from "@/lib/prisma";
import { apifyService, ApifyService } from "@/lib/apify-service";
import { configService } from "@/lib/config-service";
import { resolveCustomTaskForOrchestrationStep } from "@/lib/custom-tasks";
import {
  runBlogPostTableAnalysis,
  type BlogPostTableAnalysisResult,
} from "@/lib/blog-post-analysis-pipeline";
// Define OrchestrationStatus enum locally since Prisma client isn't recognizing it
enum OrchestrationStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}
import { executionLogger } from "@/lib/execution-logger";
import { runSanitizationForProject } from "@/lib/comprehensive-analysis";
import { runThemeResponseGeneratorAfterSanitization } from "@/lib/response-generator/pipeline";
import {
  runTaskBasedAnalysisForProject,
  getAnalysisStepsForProject,
} from "@/lib/task-based-analysis-run";
import {
  heapUsedMb,
  isAnalysisHandoffMetricsEnabled,
  logAnalysisHandoff,
} from "@/lib/analysis-handoff-metrics";
import {
  startOrchestrationRun,
  completeCollection,
  freezeRunMembership,
  enqueueRunTasks,
  startRunAnalysis,
  finalizeRun,
} from "@/lib/analysis-run";
import { runWorkerLoop } from "@/lib/analysis-worker";
import {
  getOrchestrationCustomTaskTimeoutMs,
  runWithTimeout,
} from "@/lib/orchestration-custom-task-timeout";

function logTs(): string {
  return new Date().toLocaleString();
}

/** How long to wait for step/thread rows to reach terminal state before reconciling stuck RUNNING steps. */
const COMPLETION_GATE_MAX_ATTEMPTS = 40;
const COMPLETION_GATE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max batches per run so we don't run forever; each batch is up to 50 posts. */
const BLOG_ANALYSIS_MAX_BATCHES = 100;

/**
 * Run blog post table analysis in a loop until no more posts or max batches.
 * Ensures we catch up when each Brand Blog run adds more posts than one batch processes.
 */
async function runBlogPostTableAnalysisUntilCaughtUp(
  projectId: string,
  isStopped: () => boolean,
  options?: { ingestedRunId?: string | null }
): Promise<BlogPostTableAnalysisResult> {
  const aggregated: BlogPostTableAnalysisResult = {
    postsProcessed: 0,
    analysesCreated: 0,
    ideasDeduped: 0,
    ideasExtracted: 0,
    postsCreated: 0,
    sentimentAnalyzed: 0,
    newsItemsCreated: 0,
    themeMatches: 0,
  };
  for (let batch = 0; batch < BLOG_ANALYSIS_MAX_BATCHES; batch++) {
    if (isStopped()) break;
    const result = await runBlogPostTableAnalysis(projectId, {
      ...(options?.ingestedRunId != null ? { ingestedRunId: options.ingestedRunId } : {}),
    });
    aggregated.postsProcessed += result.postsProcessed;
    aggregated.analysesCreated += result.analysesCreated;
    aggregated.ideasDeduped += result.ideasDeduped;
    aggregated.ideasExtracted += result.ideasExtracted;
    aggregated.postsCreated += result.postsCreated;
    aggregated.sentimentAnalyzed += result.sentimentAnalyzed;
    aggregated.newsItemsCreated += result.newsItemsCreated;
    aggregated.themeMatches += result.themeMatches;
    if (result.errorMessage) aggregated.errorMessage = result.errorMessage;
    if (result.postsProcessed === 0) break;
  }
  return aggregated;
}

/** Blog Open AI task target (step.target from recipe). */
const BLOG_TASK_TARGET = "BrandBlogNews";

function isBlogStep(step: OrchestrationStep): boolean {
  const isOpenAI = step.type === "openai_task" || !!step.taskId;
  const target = (step as { target?: string }).target;
  return isOpenAI && target === BLOG_TASK_TARGET;
}

function isScraperStep(step: OrchestrationStep): boolean {
  return step.type !== "openai_task" && !step.taskId && !!step.scraperId;
}

/**
 * Classify orchestration: has scraper steps and/or blog (Open AI) steps.
 * When both are present we run: normal analysis → blog task → sanitization.
 */
function getOrchestrationStepTypes(threads: OrchestrationThread[]): {
  hasScraperSteps: boolean;
  hasBlogSteps: boolean;
} {
  let hasScraperSteps = false;
  let hasBlogSteps = false;
  for (const thread of threads) {
    for (const step of thread.steps) {
      if (isScraperStep(step)) hasScraperSteps = true;
      if (isBlogStep(step)) hasBlogSteps = true;
    }
  }
  return { hasScraperSteps, hasBlogSteps };
}

export interface OrchestrationConfig {
  id: string;
  name: string;
  description?: string;
  projectIds: string[];
  threads: OrchestrationThread[];
  isRunning: boolean;
  createdAt: string;
  /**
   * When true, scraper threads run concurrently (faster for independent pipelines).
   * Default false: threads run one after another in array order so downstream scrapers (e.g. Profile Posts)
   * never start before an upstream thread (e.g. Twitter Search) finishes.
   */
  parallelScraperThreads?: boolean;
}

export interface OrchestrationThread {
  id: string;
  name: string;
  steps: OrchestrationStep[];
}

export interface OrchestrationStep {
  type?: "scraper" | "openai_task";
  scraperId?: string;
  scraperName?: string;
  platform?: string;
  taskId?: string;
  taskName?: string;
  target?: string;
}

export interface ExecutionContext {
  orchestrationId: string;
  executionId: string;
  projectIds: string[];
  threads: OrchestrationThread[];
}

/** When set, only run steps matching this phase (for mixed scraper + blog orchestrations). */
export type ExecutionPhase = "scraper_only" | "blog_only" | null;

export interface ThreadExecutionContext {
  orchestrationId: string;
  executionId: string;
  threadExecutionId: string;
  threadId: string;
  threadName: string;
  steps: OrchestrationStep[];
  projectIds: string[];
  /** When set, only execute steps matching this phase; null = run all steps. */
  executionPhase?: ExecutionPhase;
  /** For task-based analysis: projectId -> OrchestrationRun.id */
  runIdByProject?: Record<string, string>;
}

export interface StepExecutionContext {
  orchestrationId: string;
  executionId: string;
  threadExecutionId: string;
  threadName: string;
  stepExecutionId: string;
  stepType: "scraper" | "openai_task";
  scraperId?: string;
  scraperName?: string;
  platform?: string;
  taskId?: string;
  taskName?: string;
  target?: string;
  projectIds: string[];
  stepNumber: number;
  /** For task-based analysis: projectId -> OrchestrationRun.id */
  runIdByProject?: Record<string, string>;
}

/**
 * Main orchestration executor that coordinates thread-based execution
 */
export class OrchestrationExecutor {
  private executionId: string | null = null;
  private threadExecutors: Map<string, ThreadExecutor> = new Map();
  private isRunning = false; // Legacy flag for backwards compatibility
  private orchestrationId: string | null = null; // Current orchestration being executed
  private runningJobIds: Set<string> = new Set();
  private runningOrchestrations: Set<string> = new Set(); // Track which orchestrations are currently running
  public accumulatedCounts: {
    newCount: number;
    updatedCount: number;
    savedCount: number;
    discardedCount: number;
  } = { newCount: 0, updatedCount: 0, savedCount: 0, discardedCount: 0 };
  /** For task-based analysis: projectId -> runId. Set at execution start. */
  private runIdByProject: Record<string, string> = {};

  /** True if this process is currently executing the given orchestration (in-memory lock). */
  isOrchestrationRunningInMemory(orchestrationId: string): boolean {
    return this.runningOrchestrations.has(orchestrationId);
  }

  /**
   * Execute an orchestration configuration
   */
  async executeOrchestration(config: OrchestrationConfig): Promise<string> {
    // Atomic acquire: duplicate add does not increase Set size — prevents double-start races.
    const acquiredId = config.id;
    const sizeBefore = this.runningOrchestrations.size;
    this.runningOrchestrations.add(acquiredId);
    if (this.runningOrchestrations.size === sizeBefore) {
      throw new Error(`Orchestration "${config.name}" (${config.id}) is already running`);
    }

    console.log("=== ORCHESTRATION EXECUTION START ===");
    console.log("🚨 CRITICAL DEBUG: About to process threads:", config.threads.length);
    console.log(
      "🚨 CRITICAL DEBUG: Thread names:",
      config.threads.map((t) => t.name)
    );
    console.log(
      "🚨 CRITICAL DEBUG: Thread IDs:",
      config.threads.map((t) => t.id)
    );
    console.log("Orchestration ID:", config.id);
    console.log("Orchestration Name:", config.name);
    console.log("Project IDs:", config.projectIds);
    try {
      const projects = await prisma.project.findMany({
        where: { id: { in: config.projectIds }, deleted_at: null },
        select: { id: true, name: true },
      });
      const byId = new Map(projects.map((p) => [p.id, p.name]));
      console.log(
        "Projects for this run:",
        config.projectIds.map((id) => `"${byId.get(id) ?? "UNKNOWN"}" (${id})`).join(", ")
      );
    } catch (e) {
      console.warn("Could not resolve project names for logging:", e);
    }
    console.log("Threads:", JSON.stringify(config.threads, null, 2));

    this.isRunning = true; // Legacy flag
    // runningOrchestrations: already acquired at method start
    // Clear any prior stop state before starting
    ApifyService.clearStop();
    this.orchestrationId = config.id;

    try {
      // 0. Clear pending DownstreamPost seeds for the platforms involved in this orchestration
      // BUT: Don't clear records that will be used by downstream-dependent scrapers in this same orchestration
      // We need to identify which scrapers depend on downstream posts and preserve those records
      const platformSet = new Set<string>();

      for (const thread of config.threads) {
        for (const step of thread.steps) {
          const isScraperStep = step.type !== "openai_task" && step.scraperId;
          if (isScraperStep) {
            const trimmed = step.platform?.trim();
            if (trimmed) {
              platformSet.add(trimmed);
              platformSet.add(trimmed.toLowerCase());
            }
          }
        }
      }

      // Get all scrapers in this orchestration to identify dependencies (exclude custom task steps)
      const allScraperIds = new Set<string>();
      for (const thread of config.threads) {
        for (const step of thread.steps) {
          if (step.type !== "openai_task" && step.scraperId) {
            allScraperIds.add(step.scraperId);
          }
        }
      }

      // Fetch scraper configs to identify which are sources for downstream-dependent scrapers
      // AND which scrapers save to DownstreamPost (save_to_db: false). Skip when no scraper steps.
      const scrapers =
        allScraperIds.size > 0
          ? await prisma.scraper.findMany({
              where: {
                id: { in: Array.from(allScraperIds) },
                deleted_at: null,
              },
              select: {
                id: true,
                name: true,
                url_input_source_scraper: true,
                save_to_db: true, // Check if scraper saves to DownstreamPost
              },
            })
          : [];

      // Build set of scraper names that should be preserved:
      // 1. Scrapers that are sources for downstream-dependent scrapers
      // 2. Scrapers that save to DownstreamPost (save_to_db: false) - these are part of the orchestration flow
      const sourceScraperNames = new Set<string>();
      scrapers.forEach((scraper) => {
        // Add scrapers that are sources for other scrapers
        if (scraper.url_input_source_scraper) {
          sourceScraperNames.add(scraper.url_input_source_scraper);
        }
        // Add scrapers that save to DownstreamPost (they're part of the orchestration flow)
        if (scraper.save_to_db === false) {
          sourceScraperNames.add(scraper.name);
        }
      });

      const targetPlatforms = Array.from(platformSet);

      if (targetPlatforms.length > 0) {
        console.log(
          `🧹 Clearing pending downstream seeds for platforms: ${targetPlatforms.join(", ")}`
        );
        console.log(
          `🔍 Preserving DownstreamPost records for scrapers used in this orchestration: ${Array.from(sourceScraperNames).join(", ") || "none"}`
        );

        // Only delete DownstreamPost records that are NOT from source scrapers used in this orchestration
        const deleteResult = await prisma.downstreamPost.deleteMany({
          where: {
            platform: { in: targetPlatforms },
            ...(config.projectIds.length ? { project_id: { in: config.projectIds } } : {}),
            // Exclude records from source scrapers that will be used by downstream-dependent scrapers
            ...(sourceScraperNames.size > 0
              ? { origScraper: { notIn: Array.from(sourceScraperNames) } }
              : {}),
          },
        });

        console.log(
          `✅ Removed ${deleteResult.count} pending downstream seed(s) for current orchestration (preserved ${sourceScraperNames.size > 0 ? `${sourceScraperNames.size} scraper(s) in orchestration` : "none"})`
        );
      } else {
        console.log("ℹ️ No downstream platforms detected for cleanup");
      }

      // 1. Create orchestration execution record
      const execution = await this.createOrchestrationExecution(config);
      this.executionId = execution.id;

      // 1b. Create OrchestrationRun per project (task-based analysis only)
      if (config.projectIds.length > 0) {
        this.runIdByProject = {};
        for (const projectId of config.projectIds) {
          const runId = await startOrchestrationRun(projectId, execution.id);
          this.runIdByProject[projectId] = runId;
        }
        console.log(
          `[Orchestration] Created runs for ${Object.keys(this.runIdByProject).length} project(s).`
        );
      } else {
        this.runIdByProject = {};
      }

      // Reset accumulated counts for new orchestration
      this.accumulatedCounts = { newCount: 0, updatedCount: 0, savedCount: 0, discardedCount: 0 };

      // 2. Update orchestration status to running
      await this.updateOrchestrationStatus(config.id, true);
      console.log(`***** ORCHESTRATION RUN START ${new Date().toLocaleString()} *****`);

      // 3. Create thread execution records
      console.log(
        `🔍 DEBUG: Creating thread executions for ${config.threads.length} threads:`,
        config.threads.map((t) => `${t.name} (${t.id})`)
      );
      const threadExecutions = await this.createThreadExecutions(execution.id, config.threads);
      console.log(`🔍 DEBUG: Created ${threadExecutions.length} thread execution records`);

      const { hasScraperSteps, hasBlogSteps } = getOrchestrationStepTypes(config.threads);
      const isMixedOrchestration = hasScraperSteps && hasBlogSteps;

      if (isMixedOrchestration) {
        // Phased execution: normal analysis → blog task → sanitization
        console.log(
          `[Orchestration] Mixed scraper + blog: running in phases (scraper → analysis → blog → sanitization).`
        );

        // Phase 1: Run scraper steps only
        console.log(`[Orchestration] Phase 1: Scraper steps only.`);
        await this.runThreadsWithPhase(config, threadExecutions, "scraper_only");

        // Phase 2: Run task-based analysis for scraper data
        console.log(`[Orchestration] Phase 2: Task-based analysis for scraper data.`);
        const runIds = Object.values(this.runIdByProject).filter(Boolean);
        if (runIds.length > 0) {
          await this.runTaskBasedAnalysisOnCompletion(runIds);
        }

        // Phase 3: Run blog (Open AI) steps only
        console.log(`[Orchestration] Phase 3: Blog Open AI task steps only.`);
        await this.runThreadsWithPhase(config, threadExecutions, "blog_only");

        // Phase 4: Sanitization
        console.log(`[Orchestration] Phase 4: Sanitization.`);
        for (const projectId of config.projectIds) {
          try {
            const runIdForProject = this.runIdByProject?.[projectId];
            if (runIdForProject) {
              await runSanitizationForProject(
                projectId,
                { news: true, themes: true },
                { orchestrationRunId: runIdForProject }
              );
              await runThemeResponseGeneratorAfterSanitization(projectId, runIdForProject);
            } else {
              await runSanitizationForProject(projectId, { news: true, themes: true });
            }
          } catch (sanitErr) {
            console.error(
              `[Orchestration] Sanitization failed for project ${projectId}:`,
              sanitErr
            );
          }
        }

        await this.completeOrchestrationExecution(execution.id, { skipAnalysis: true });
      } else {
        const runOneThread = async (thread: OrchestrationThread, index: number) => {
          console.log(
            `🚀 Starting thread ${index + 1}/${config.threads.length}: ${thread.name} (${thread.id})`
          );
          const threadExecution = threadExecutions[index];
          console.log(
            `🔍 DEBUG: Thread ${thread.name} - execution record:`,
            threadExecution ? `ID: ${threadExecution.id}` : "MISSING"
          );
          const executor = new ThreadExecutor(this);
          this.threadExecutors.set(thread.id, executor);

          try {
            await executor.executeThread({
              orchestrationId: config.id,
              executionId: execution.id,
              threadExecutionId: threadExecution.id,
              threadId: thread.id,
              threadName: thread.name,
              steps: thread.steps,
              projectIds: config.projectIds,
              runIdByProject: this.runIdByProject,
            });
            console.log(`✅ Thread ${thread.name} completed successfully`);
          } catch (error) {
            console.error(`❌ Thread ${thread.name} failed:`, error);
            // Don't throw - let other threads continue running
          }
        };

        if (config.parallelScraperThreads === true) {
          console.log(
            `🚀 Starting ${config.threads.length} threads concurrently (parallelScraperThreads=true)...`
          );
          await Promise.allSettled(
            config.threads.map((thread, index) => runOneThread(thread, index))
          );
        } else {
          if (config.threads.length > 1) {
            console.log(
              `[Orchestration] Running ${config.threads.length} thread(s) sequentially: ${config.threads.map((t) => t.name).join(" → ")}. ` +
                `Steps within each thread still run in order. For concurrent threads, set parallelScraperThreads: true on the orchestration.`
            );
          }
          for (let index = 0; index < config.threads.length; index++) {
            await runOneThread(config.threads[index], index);
          }
        }

        // 6. Update orchestration status to completed (triggers comprehensive analysis when scrapers ran)
        await this.completeOrchestrationExecution(execution.id);
      }

      return execution.id;
    } catch (error) {
      console.error("Orchestration execution failed:", error);
      // If create failed, executionId was never set — avoid Prisma "id must not be null"
      await this.failOrchestrationExecution(this.executionId, error);
      throw error;
    } finally {
      // Always reset run state flags and DB is_running status as a safety net
      try {
        if (this.orchestrationId) {
          await this.updateOrchestrationStatus(this.orchestrationId, false);
        }
      } catch (e) {
        console.error("Failed to reset orchestration is_running flag in finally:", e);
      }
      this.isRunning = false;
      // Always release the lock for this run (do not rely on this.orchestrationId — stop may null it).
      this.runningOrchestrations.delete(acquiredId);
      this.threadExecutors.clear();
    }
  }

  /**
   * Run all threads with a single phase (scraper_only or blog_only). Used for mixed orchestrations.
   */
  private async runThreadsWithPhase(
    config: OrchestrationConfig,
    threadExecutions: { id: string }[],
    phase: ExecutionPhase
  ): Promise<void> {
    const runOneThread = async (thread: OrchestrationThread, index: number) => {
      const threadExecution = threadExecutions[index];
      if (!threadExecution) return;
      const executor = new ThreadExecutor(this);
      this.threadExecutors.set(thread.id, executor);
      try {
        await executor.executeThread({
          orchestrationId: config.id,
          executionId: this.executionId!,
          threadExecutionId: threadExecution.id,
          threadId: thread.id,
          threadName: thread.name,
          steps: thread.steps,
          projectIds: config.projectIds,
          executionPhase: phase,
          runIdByProject: this.runIdByProject,
        });
      } catch (error) {
        console.error(`❌ Thread ${thread.name} (phase ${phase}) failed:`, error);
      }
    };

    const parallel = config.parallelScraperThreads === true;

    if (parallel) {
      console.log(
        `[Orchestration] Phase ${phase}: starting ${config.threads.length} thread(s) concurrently (parallelScraperThreads=true)...`
      );
      const threadPromises = config.threads.map((thread, index) => runOneThread(thread, index));
      await Promise.allSettled(threadPromises);
    } else {
      if (config.threads.length > 1) {
        console.log(
          `[Orchestration] Phase ${phase}: running ${config.threads.length} thread(s) sequentially: ${config.threads.map((t) => t.name).join(" → ")}.`
        );
      }
      for (let index = 0; index < config.threads.length; index++) {
        await runOneThread(config.threads[index], index);
      }
    }
  }

  /**
   * Stop a running orchestration
   */
  async stopOrchestration(orchestrationId?: string): Promise<void> {
    // If orchestrationId is provided, check if it matches current orchestration
    if (orchestrationId && this.orchestrationId !== orchestrationId) {
      throw new Error("Orchestration ID does not match currently running orchestration");
    }

    // Force stop even if isRunning is false - this handles stuck orchestrations
    if (!this.executionId) {
      throw new Error("No orchestration execution ID found");
    }

    const currentOrchestrationId = this.orchestrationId;
    console.log(`Stopping orchestration ${currentOrchestrationId}...`);

    // Signal Apify layer to stop spawning new runs
    ApifyService.requestStop();

    // Stop all thread executors
    for (const executor of this.threadExecutors.values()) {
      await executor.stop();
    }

    // Update orchestration status
    await this.cancelOrchestrationExecution(this.executionId);

    // Reset state
    this.isRunning = false;
    if (this.orchestrationId) {
      this.runningOrchestrations.delete(this.orchestrationId);
    }
    this.orchestrationId = null;
    this.executionId = null;
    this.threadExecutors.clear();

    console.log(`Orchestration ${currentOrchestrationId} stopped successfully`);
  }

  /**
   * Force reset the orchestration state (for stuck orchestrations)
   */
  async forceReset(): Promise<void> {
    console.log("Force resetting orchestration state...");
    // Also flip the stop flag to prevent new spawns during reset
    ApifyService.requestStop();

    // Cancel all running Apify jobs
    await this.cancelAllRunningJobs();

    // Update ALL orchestrations in database to not running
    console.log("🔧 Updating all orchestrations in database to not running...");
    await prisma.orchestration.updateMany({
      where: { is_running: true },
      data: { is_running: false },
    });
    console.log("✅ All orchestrations marked as not running in database");

    this.isRunning = false;
    this.runningOrchestrations.clear(); // Clear all running orchestrations
    this.orchestrationId = null;
    this.executionId = null;
    this.threadExecutors.clear();
    this.runningJobIds.clear();
    console.log("Orchestration state reset successfully");
  }

  /**
   * Add a running job ID to track
   */
  addRunningJob(jobId: string): void {
    this.runningJobIds.add(jobId);
  }

  /**
   * Remove a job ID from tracking
   */
  removeRunningJob(jobId: string): void {
    this.runningJobIds.delete(jobId);
  }

  /**
   * Cancel all running Apify jobs
   */
  private async cancelAllRunningJobs(): Promise<void> {
    console.log("Cancelling all running Apify jobs...");

    const apifyService = new ApifyService();

    try {
      // Cancel ALL running jobs on Apify (not just tracked ones)
      await apifyService.cancelAllRunningJobs();

      // Also clear our tracked jobs
      this.runningJobIds.clear();
      console.log("All running jobs cancelled successfully");
    } catch (error) {
      console.error("Error cancelling running jobs:", error);
      // Still clear our tracked jobs even if API call fails
      this.runningJobIds.clear();
    }
  }

  private async createOrchestrationExecution(config: OrchestrationConfig) {
    return await prisma.orchestrationExecution.create({
      data: {
        orchestration_id: config.id,
        status: OrchestrationStatus.RUNNING,
        started_at: new Date(),
      },
    });
  }

  private async createThreadExecutions(executionId: string, threads: OrchestrationThread[]) {
    const threadExecutions = await Promise.all(
      threads.map((thread, index) =>
        prisma.orchestrationThreadExecution.create({
          data: {
            execution_id: executionId,
            thread_name: thread.name,
            thread_sequence: index + 1, // Add sequence number
            status: OrchestrationStatus.PENDING,
            total_steps: thread.steps.length,
          },
        })
      )
    );

    return threadExecutions;
  }

  public async finalizeExistingExecution(executionId: string): Promise<void> {
    await this.completeOrchestrationExecution(executionId);
  }

  private async updateOrchestrationStatus(orchestrationId: string, isRunning: boolean) {
    await prisma.orchestration.update({
      where: { id: orchestrationId },
      data: { is_running: isRunning },
    });
  }

  private async completeOrchestrationExecution(
    executionId: string,
    options?: { skipAnalysis?: boolean }
  ) {
    // Check if execution is already completed to prevent duplicate analysis runs
    const existingExecution = await prisma.orchestrationExecution.findUnique({
      where: { id: executionId },
      select: { status: true, completed_at: true, orchestration_id: true },
    });

    if (!existingExecution) {
      console.warn(`[Orchestration] Execution ${executionId} not found, skipping completion`);
      return;
    }

    // If already completed, check if analysis was triggered
    // If not, trigger it now (handles cases where completion happened but analysis didn't run)
    if (
      existingExecution.status === OrchestrationStatus.COMPLETED &&
      existingExecution.completed_at
    ) {
      console.log(
        `[Orchestration] Execution ${executionId} already completed at ${existingExecution.completed_at.toISOString()}`
      );

      // Only trigger analysis if this execution had at least one step (otherwise no new records from this run)
      const existingThreads = await prisma.orchestrationThreadExecution.findMany({
        where: { execution_id: executionId },
        select: { total_steps: true },
      });
      const totalStepsAlready = existingThreads.reduce((s, t) => s + t.total_steps, 0);
      if (totalStepsAlready === 0) {
        console.log(
          `[Orchestration] Skipping comprehensive analysis: execution had 0 steps (no new records from this run).`
        );
        return;
      }

      console.log(
        `[Orchestration] Ensuring task-based analysis is triggered for orchestration ${existingExecution.orchestration_id}`
      );
      const runIds = Object.values(this.runIdByProject).filter(Boolean);
      Promise.resolve()
        .then(async () => {
          if (runIds.length > 0) return this.runTaskBasedAnalysisOnCompletion(runIds);
        })
        .catch((error) => {
          console.error(
            `Error running analysis for orchestration ${existingExecution.orchestration_id}:`,
            error
          );
        });
      return;
    }

    // Verify all threads and steps are actually complete before finalizing.
    // IMPORTANT: Previously we returned immediately when any step/thread was non-terminal; the log said
    // "Waiting..." but nothing ever retried — so execution stayed RUNNING, OrchestrationRun stayed
    // COLLECTING, and task-based analysis never ran. Also, updateStepStatus used to swallow DB errors,
    // so a thread could be COMPLETED while a step stayed RUNNING — this gate blocked forever.
    const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

    let allThreads = await prisma.orchestrationThreadExecution.findMany({
      where: { execution_id: executionId },
      select: { id: true, status: true, total_steps: true },
    });

    let allSteps = await prisma.orchestrationStepExecution.findMany({
      where: {
        thread_execution_id: { in: allThreads.map((t) => t.id) },
      },
      select: { id: true, status: true, thread_execution_id: true },
    });

    let threadsTerminal = allThreads.filter((t) => terminalStatuses.has(t.status));
    let stepsTerminal = allSteps.filter((s) => terminalStatuses.has(s.status));

    let attempt = 0;
    while (
      (threadsTerminal.length < allThreads.length || stepsTerminal.length < allSteps.length) &&
      attempt < COMPLETION_GATE_MAX_ATTEMPTS
    ) {
      console.log(
        `[Orchestration] Execution ${executionId} not ready to complete (attempt ${attempt + 1}/${COMPLETION_GATE_MAX_ATTEMPTS}): ` +
          `${threadsTerminal.length}/${allThreads.length} threads terminal, ` +
          `${stepsTerminal.length}/${allSteps.length} steps terminal — rechecking after ${COMPLETION_GATE_DELAY_MS}ms`
      );
      await sleep(COMPLETION_GATE_DELAY_MS);
      allThreads = await prisma.orchestrationThreadExecution.findMany({
        where: { execution_id: executionId },
        select: { id: true, status: true, total_steps: true },
      });
      allSteps = await prisma.orchestrationStepExecution.findMany({
        where: {
          thread_execution_id: { in: allThreads.map((t) => t.id) },
        },
        select: { id: true, status: true, thread_execution_id: true },
      });
      threadsTerminal = allThreads.filter((t) => terminalStatuses.has(t.status));
      stepsTerminal = allSteps.filter((s) => terminalStatuses.has(s.status));
      attempt++;
    }

    if (threadsTerminal.length < allThreads.length || stepsTerminal.length < allSteps.length) {
      const terminalThreadIds = new Set(
        allThreads.filter((t) => terminalStatuses.has(t.status)).map((t) => t.id)
      );
      const stuckRunning = allSteps.filter(
        (s) => s.status === "RUNNING" && terminalThreadIds.has(s.thread_execution_id)
      );
      if (stuckRunning.length > 0) {
        console.warn(
          `[Orchestration] Reconciling ${stuckRunning.length} RUNNING step(s) under already-terminal threads (likely failed status update). Marking FAILED.`
        );
        await prisma.orchestrationStepExecution.updateMany({
          where: { id: { in: stuckRunning.map((s) => s.id) } },
          data: {
            status: OrchestrationStatus.FAILED,
            error_message:
              "Step status reconciliation: was RUNNING while thread was already terminal (DB update may have failed silently earlier).",
            completed_at: new Date(),
            updated_at: new Date(),
          },
        });
        allSteps = await prisma.orchestrationStepExecution.findMany({
          where: {
            thread_execution_id: { in: allThreads.map((t) => t.id) },
          },
          select: { id: true, status: true, thread_execution_id: true },
        });
        stepsTerminal = allSteps.filter((s) => terminalStatuses.has(s.status));
      }

      if (threadsTerminal.length < allThreads.length || stepsTerminal.length < allSteps.length) {
        console.error(
          `[Orchestration] Execution ${executionId} still not ready after retry + reconciliation: ` +
            `${threadsTerminal.length}/${allThreads.length} threads terminal, ` +
            `${stepsTerminal.length}/${allSteps.length} steps terminal. Skipping finalization and analysis for this execution.`
        );
        return;
      }
    }

    const anyFailure =
      allSteps.some((s) => s.status === "FAILED" || s.status === "CANCELLED") ||
      allThreads.some((t) => t.status === "FAILED" || t.status === "CANCELLED");

    await prisma.orchestrationExecution.update({
      where: { id: executionId },
      data: {
        status: anyFailure ? OrchestrationStatus.FAILED : OrchestrationStatus.COMPLETED,
        completed_at: new Date(),
      },
    });

    // Update orchestration is_running status
    await this.updateOrchestrationStatus(existingExecution.orchestration_id, false);

    // Generate and log orchestration summary
    try {
      const { executionLogger } = await import("./execution-logger");
      const summary = await executionLogger.generateOrchestrationSummary(
        existingExecution.orchestration_id
      );
      console.log(summary);
    } catch (error) {
      console.error("Failed to generate orchestration summary:", error);
    }
    console.log(
      `[Orchestration] Post-summary (background): materialize conversation threads, then analysis worker ` +
        `(sentiment / themes / chatter / network / news / brand via OpenAI). executionId=${executionId}`
    );

    // Only run comprehensive analysis when this execution had at least one step (and not skipped for phased run).
    const totalSteps = allThreads.reduce((s, t) => s + t.total_steps, 0);
    const skipAnalysis = options?.skipAnalysis === true;
    const runIds = Object.values(this.runIdByProject).filter(Boolean);

    let projectIds: string[] = [];
    try {
      const orchestration = await prisma.orchestration.findUnique({
        where: { id: existingExecution.orchestration_id },
        select: { project_ids: true },
      });
      if (orchestration?.project_ids) {
        try {
          projectIds = JSON.parse(orchestration.project_ids);
        } catch {
          projectIds = [];
        }
      }
    } catch (error) {
      console.error("[Orchestration] Could not load orchestration project_ids:", error);
    }

    // Twitter Search seeds stay PENDING through Post Replies (multi-batch) and Profile Posts; remove them once
    // the execution finishes successfully so the table does not grow forever.
    if (!anyFailure && projectIds.length > 0) {
      try {
        const deleted = await prisma.downstreamPost.deleteMany({
          where: {
            orchestration_execution_id: executionId,
            origScraper: "Twitter (X.com) Search Scraper",
            project_id: { in: projectIds },
          },
        });
        if (deleted.count > 0) {
          console.log(
            `[Orchestration] Deferred cleanup: removed ${deleted.count} Twitter Search DownstreamPost seed(s) for execution ${executionId}.`
          );
        }
      } catch (e) {
        console.error("[Orchestration] Deferred Twitter Search seed cleanup failed:", e);
      }
    }

    // Defer materialize + task-based analysis so completeOrchestrationExecution returns immediately
    // and the event loop can serve HTTP (UI refresh, polling). Work continues in the background.
    const orchestrationIdForLog = existingExecution.orchestration_id;
    void Promise.resolve()
      .then(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const runIdByProjectSnap = { ...this.runIdByProject };
        try {
          if (projectIds.length > 0) {
            console.log(
              `[Orchestration] Background: building/updating Conversation tables for ${projectIds.length} project(s)…`
            );
            const { materializeConversationsForProject } = await import(
              "@/lib/conversation-materializer"
            );
            for (const projectId of projectIds) {
              const rid = runIdByProjectSnap[projectId];
              await materializeConversationsForProject(
                projectId,
                rid ? { seedRunIds: [rid] } : undefined
              );
            }
            console.log(`[Orchestration] Background: conversation materialization finished.`);
          }
        } catch (error) {
          console.error("[Orchestration] Conversation materialization failed:", error);
        }

        if (skipAnalysis) {
          console.log(
            `[Orchestration] Skipping comprehensive analysis trigger (already run in phased flow).`
          );
          return;
        }
        if (totalSteps === 0) {
          console.log(
            `[Orchestration] Skipping comprehensive analysis: execution had 0 steps (no new records from this run).`
          );
          return;
        }
        console.log(
          `[Orchestration] Background: starting analysis for orchestration ${orchestrationIdForLog} (${totalSteps} scrape step(s); run id(s): ${runIds.length ? runIds.join(", ") : "none"}).`
        );
        if (runIds.length === 0) {
          console.log(
            `[Orchestration] No orchestration run IDs in handoff — skipping task-based analysis (check runIdByProject if you expected LLM work).`
          );
          return;
        }
        try {
          await this.runTaskBasedAnalysisOnCompletion(runIds);
        } catch (error) {
          console.error(
            `Error running analysis for orchestration ${orchestrationIdForLog}:`,
            error
          );
        }
      })
      .catch((error) => {
        console.error(
          `[Orchestration] Deferred handoff (materialize/analysis) failed for ${orchestrationIdForLog}:`,
          error
        );
      });
  }

  private async runTaskBasedAnalysisOnCompletion(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      try {
        const handoffT0 = isAnalysisHandoffMetricsEnabled() ? Date.now() : 0;
        const heapBefore = isAnalysisHandoffMetricsEnabled() ? heapUsedMb() : 0;
        console.log(
          `[Orchestration] Analysis prep for run ${runId}: freezing run membership and enqueueing tasks…`
        );
        await completeCollection(runId);
        await freezeRunMembership(runId);
        await enqueueRunTasks(runId);
        await startRunAnalysis(runId);
        if (isAnalysisHandoffMetricsEnabled()) {
          logAnalysisHandoff("handoffBeforeWorkerLoop", {
            runId,
            durationMs: Date.now() - handoffT0,
            heapDeltaMb: Math.round((heapUsedMb() - heapBefore) * 10) / 10,
            phases:
              "completeCollection + freezeRunMembership + enqueueRunTasks + startRunAnalysis (see per-phase logs above)",
          });
        }
        console.log(
          `[Orchestration] Analysis worker for run ${runId}: processing LLM tasks until the queue is empty (often the longest phase; step progress uses [AnalysisWorker]).`
        );
        await runWorkerLoop(runId);
        console.log(
          `[Orchestration] Analysis worker finished run ${runId}; sanitizing stored results and finalizing…`
        );
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
        console.log(`[Orchestration] Task-based analysis completed for run ${runId}`);
      } catch (err) {
        console.error(`[Orchestration] Task-based analysis failed for run ${runId}:`, err);
      }
    }
  }

  private async failOrchestrationExecution(executionId: string | null | undefined, error: unknown) {
    if (!executionId) {
      console.warn(
        "[Orchestration] No execution record to mark FAILED (create may have failed before insert)."
      );
      return;
    }
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    await prisma.orchestrationExecution.update({
      where: { id: executionId },
      data: {
        status: OrchestrationStatus.FAILED,
        completed_at: new Date(),
        error_message: message,
      },
    });

    // Update orchestration is_running status
    const execution = await prisma.orchestrationExecution.findUnique({
      where: { id: executionId },
      select: { orchestration_id: true },
    });

    if (execution) {
      await this.updateOrchestrationStatus(execution.orchestration_id, false);
    }
  }

  private async cancelOrchestrationExecution(executionId: string) {
    await prisma.orchestrationExecution.update({
      where: { id: executionId },
      data: {
        status: OrchestrationStatus.CANCELLED,
        completed_at: new Date(),
      },
    });

    // Update orchestration is_running status
    const execution = await prisma.orchestrationExecution.findUnique({
      where: { id: executionId },
      select: { orchestration_id: true },
    });

    if (execution) {
      await this.updateOrchestrationStatus(execution.orchestration_id, false);
    }
  }
}

/**
 * Thread executor that runs scrapers sequentially within a single thread
 */
export class ThreadExecutor {
  private isRunning = false;
  private isStopped = false;
  private stepExecutors: Map<string, StepExecutor> = new Map();
  private orchestrationExecutor: OrchestrationExecutor;

  constructor(orchestrationExecutor: OrchestrationExecutor) {
    this.orchestrationExecutor = orchestrationExecutor;
  }

  async executeThread(context: ThreadExecutionContext): Promise<void> {
    this.isRunning = true;
    this.isStopped = false;

    // When executionPhase is set, only run steps matching that phase (for mixed scraper + blog orchestrations)
    let stepsToRun = context.steps;
    if (context.executionPhase) {
      stepsToRun =
        context.executionPhase === "scraper_only"
          ? context.steps.filter((s) => isScraperStep(s))
          : context.steps.filter((s) => isBlogStep(s));
      console.log(
        `[Orchestration] Thread ${context.threadName} phase=${context.executionPhase}: ${stepsToRun.length}/${context.steps.length} steps.`
      );
    }

    console.log("=== THREAD EXECUTION START ===");
    console.log("Thread ID:", context.threadId);
    console.log("Thread Name:", context.threadName);
    console.log("Steps to execute:", stepsToRun.length);
    console.log(
      `🔍 DEBUG: About to execute ${stepsToRun.length} steps for thread ${context.threadName}`
    );

    try {
      // Update thread status to running
      await this.updateThreadStatus(context.threadExecutionId, OrchestrationStatus.RUNNING);

      // When thread has no steps to run (e.g. pipeline-only intent, or phase filter left none), run blog for each project only if no phase filter
      if (stepsToRun.length === 0) {
        if (!context.executionPhase) {
          console.log(
            `[${logTs()}] [Orchestration] Thread ${context.threadName}: running blog post table analysis for ${context.projectIds.length} project(s).`
          );
          for (const projectId of context.projectIds) {
            if (this.isStopped) break;
            try {
              console.log(
                `[${logTs()}] [Orchestration] Starting blog post table analysis for project ${projectId} (batches until caught up).`
              );
              const blogResult = await runBlogPostTableAnalysisUntilCaughtUp(
                projectId,
                () => this.isStopped,
                { ingestedRunId: context.runIdByProject?.[projectId] }
              );
              console.log(
                `[${logTs()}] [Orchestration] Blog analysis done (project ${projectId}): posts=${blogResult.postsProcessed} analyses=${blogResult.analysesCreated} news=${blogResult.newsItemsCreated} themeMatches=${blogResult.themeMatches}` +
                  (blogResult.errorMessage ? ` error=${blogResult.errorMessage}` : "")
              );
              if (blogResult.postsCreated > 0) {
                console.log(
                  `[${logTs()}] [Orchestration] Triggering task-based analysis for project ${projectId} (blog posts created, need News synthesis).`
                );
                Promise.resolve()
                  .then(async () => {
                    const steps = await getAnalysisStepsForProject(projectId);
                    return runTaskBasedAnalysisForProject(projectId, {
                      steps,
                      runSanitization: true,
                    });
                  })
                  .catch((err) =>
                    console.error(
                      `[Orchestration] Task-based analysis after blog failed for ${projectId}:`,
                      err
                    )
                  );
              }
            } catch (blogErr) {
              console.error("[Orchestration] Blog post table analysis failed:", blogErr);
            }
          }
        }
      } else {
        // Execute steps sequentially (use stepsToRun so phase filter is applied)
        for (let i = 0; i < stepsToRun.length; i++) {
          if (this.isStopped) {
            console.log(`🛑 Thread ${context.threadName} was stopped, cancelling execution`);
            await this.updateThreadStatus(context.threadExecutionId, OrchestrationStatus.CANCELLED);
            return;
          }

          const step = stepsToRun[i];
          const stepType: "scraper" | "openai_task" =
            step.type === "openai_task" || step.taskId ? "openai_task" : "scraper";
          const stepLabel =
            stepType === "openai_task"
              ? `${step.taskName ?? "Custom Task"} (task)`
              : `${step.scraperName} (${step.platform})`;
          console.log(
            `🔍 DEBUG: Executing step ${i + 1}/${context.steps.length} for thread ${context.threadName}: ${stepLabel}`
          );

          const executor = new StepExecutor(this.orchestrationExecutor);
          const stepKey = stepType === "openai_task" ? (step.taskId ?? "") : (step.scraperId ?? "");
          this.stepExecutors.set(stepKey, executor);

          try {
            await executor.executeStep({
              ...context,
              stepExecutionId: "", // Will be created by executeStep
              stepType,
              scraperId: step.scraperId,
              scraperName: step.scraperName,
              platform: step.platform,
              taskId: step.taskId,
              taskName: step.taskName,
              target: step.target,
              stepNumber: i + 1, // Add step number (1-based)
            });
            console.log(`✅ Step ${i + 1} completed successfully for thread ${context.threadName}`);
          } catch (error) {
            console.error(`❌ Step ${i + 1} failed for thread ${context.threadName}:`, error);
            if (error instanceof Error) {
              console.error(`❌ Error message: ${error.message}`);
              console.error(`❌ Error stack: ${error.stack}`);
            } else {
              console.error(`❌ Error object:`, JSON.stringify(error, null, 2));
            }
            // Don't throw error - continue with next step instead of stopping the thread
            console.log(`⚠️ Continuing with next step despite failure of step ${i + 1}`);
          }
        }
      }

      // Update thread status to completed
      await this.updateThreadStatus(context.threadExecutionId, OrchestrationStatus.COMPLETED);
    } catch (error) {
      console.error(`Thread ${context.threadName} execution failed:`, error);
      await this.updateThreadStatus(
        context.threadExecutionId,
        OrchestrationStatus.FAILED,
        error instanceof Error ? error.message : String(error)
      );
      // Don't throw error - let other threads continue
    } finally {
      this.isRunning = false;
      this.stepExecutors.clear();
    }
  }

  async stop(): Promise<void> {
    console.log(`🛑 Stopping thread executor...`);
    this.isStopped = true;

    // Stop all step executors
    const stopPromises = Array.from(this.stepExecutors.values()).map((executor) =>
      executor.stop().catch((error) => console.error("Error stopping step executor:", error))
    );

    await Promise.allSettled(stopPromises);
    this.stepExecutors.clear();

    console.log(`✅ Thread executor stopped`);
  }

  private async updateThreadStatus(
    threadExecutionId: string,
    status: OrchestrationStatus,
    errorMessage?: string
  ) {
    await prisma.orchestrationThreadExecution.update({
      where: { id: threadExecutionId },
      data: {
        status,
        error_message: errorMessage,
        ...(status === OrchestrationStatus.COMPLETED ||
        status === OrchestrationStatus.FAILED ||
        status === OrchestrationStatus.CANCELLED
          ? { completed_at: new Date() }
          : {}),
      },
    });
  }
}

/**
 * Step executor that runs a single scraper
 */
export class StepExecutor {
  private isRunning = false;
  private isStopped = false;
  private scrapeJobId: string | null = null;
  private orchestrationExecutor: OrchestrationExecutor;

  constructor(orchestrationExecutor: OrchestrationExecutor) {
    this.orchestrationExecutor = orchestrationExecutor;
  }

  async executeStep(context: StepExecutionContext): Promise<void> {
    this.isRunning = true;
    this.isStopped = false;
    let stepExecution: { id: string } | null = null;

    try {
      // Create step execution record
      stepExecution = await this.createStepExecution(context);

      // Update step status to running
      await this.updateStepStatus(stepExecution.id, OrchestrationStatus.RUNNING);

      if (context.stepType === "openai_task") {
        const taskIdParam = (context.taskId ?? "").trim();
        const taskName = (context.taskName ?? "").trim();
        const stepTarget = (context.target ?? "").trim();
        const customTask = await resolveCustomTaskForOrchestrationStep({
          taskId: taskIdParam,
          taskName,
          target: stepTarget,
        });
        if (!customTask) {
          const allTasks = await prisma.searchSourceTask.findMany({
            select: { id: true, name: true, target: true, deleted_at: true },
          });
          console.error(
            "[Orchestration] Custom task resolution failed. Looked for name=%j target=%j. Existing tasks:",
            taskName || "(empty)",
            stepTarget || "(empty)",
            JSON.stringify(allTasks, null, 2)
          );
          throw new Error(
            "Custom task step missing taskId (and could not resolve by task name or target)"
          );
        }
        const taskTarget = customTask.targetKey ?? "";
        if (taskTarget === "BrandBlogNews") {
          console.log(
            `[${logTs()}] [Orchestration] Starting Brand Blog task (discovery → content) for ${context.projectIds.length} project(s).`
          );
        }

        if (!stepExecution) {
          throw new Error("Step execution record missing for custom task");
        }
        const stepExec = stepExecution;

        const label = taskName || stepTarget || "custom task";
        const runCustomTaskBody = async () => {
          for (const projectId of context.projectIds) {
            if (this.isStopped) break;
            const result = await customTask.run(projectId, {
              testMode: false,
              persistTaskRun: true,
              executionId: context.executionId,
              stepExecutionId: stepExec.id,
              ingestedRunId: context.runIdByProject?.[projectId],
            });
            if (!result.success) {
              await this.updateStepStatus(
                stepExec.id,
                OrchestrationStatus.FAILED,
                result.errorMessage ?? "Task failed"
              );
              throw new Error(result.errorMessage ?? "Custom task failed");
            }
            if (taskTarget === "BrandBlogNews") {
              try {
                console.log(
                  `[${logTs()}] [Orchestration] Brand Blog step complete; running blog post table analysis for project ${projectId} (batches until caught up).`
                );
                const blogResult = await runBlogPostTableAnalysisUntilCaughtUp(
                  projectId,
                  () => this.isStopped,
                  { ingestedRunId: context.runIdByProject?.[projectId] }
                );
                console.log(
                  `[${logTs()}] [Orchestration] Blog analysis done (project ${projectId}): posts=${blogResult.postsProcessed} analyses=${blogResult.analysesCreated} news=${blogResult.newsItemsCreated} themeMatches=${blogResult.themeMatches}` +
                    (blogResult.errorMessage ? ` error=${blogResult.errorMessage}` : "")
                );
              } catch (blogErr) {
                console.error("[Orchestration] Blog post table analysis failed:", blogErr);
              }
            }
          }
          if (this.isStopped) {
            await this.updateStepStatus(stepExec.id, OrchestrationStatus.CANCELLED);
          } else {
            await this.updateStepStatus(stepExec.id, OrchestrationStatus.COMPLETED);
          }
        };

        const timeoutMs = getOrchestrationCustomTaskTimeoutMs();
        if (timeoutMs != null) {
          await runWithTimeout(runCustomTaskBody(), timeoutMs, `Custom task "${label}"`);
        } else {
          await runCustomTaskBody();
        }
        return;
      }

      // Scraper path: require scraper fields
      const scraperId = context.scraperId;
      const scraperName = context.scraperName;
      const platform = context.platform;
      if (!scraperId || !scraperName || !platform) {
        throw new Error("Scraper step missing scraperId, scraperName, or platform");
      }

      // Execute the scraper for each project sequentially.
      // Discord: merge channel URLs from all orchestration projects and run the step once (first project owns the scrape job row).
      let discordOrchestrationDone = false;
      const projectResults = [];
      for (const projectId of context.projectIds) {
        if (this.isStopped) break;

        if (platform.toLowerCase() === "discord" && discordOrchestrationDone) {
          continue;
        }

        const projectStartTime = new Date();
        let executionStartTime = projectStartTime; // Default to project start time
        let apifyStartTime: Date | null = null;
        const scraperStepLogIdentity = {
          executionId: context.executionId,
          orchestrationId: context.orchestrationId,
          threadId: context.threadExecutionId,
          threadName: context.threadName,
          scraperId,
          scraperName,
          platform,
          projectId,
          startTime: projectStartTime,
        };

        // Create ScrapeJob record first
        const runId = context.runIdByProject?.[projectId];
        const scrapeJob = await prisma.scrapeJob.create({
          data: {
            project_id: projectId,
            scraper_id: scraperId,
            status: "PENDING",
            ...(runId ? { orchestration_run_id: runId } : {}),
            orchestration_execution_id: context.executionId,
          },
        });

        // Start scraping job using orchestration configuration
        const jobIds = await apifyService.startOrchestrationScrapingJob(
          projectId,
          scraperId,
          scraperName,
          platform,
          context.executionId,
          platform.toLowerCase() === "discord"
            ? { discordMergeProjectIds: context.projectIds }
            : undefined
        );

        if (platform.toLowerCase() === "discord") {
          discordOrchestrationDone = true;
        }

        // Update ScrapeJob(s) with Apify run ID(s)
        const scrapeJobIds: string[] = [];
        if (jobIds.length > 0) {
          // Update the original job with the first run ID
          const updated = await prisma.scrapeJob.update({
            where: { id: scrapeJob.id },
            data: {
              apify_run_id: jobIds[0],
              status: "RUNNING",
              started_at: new Date(),
            },
          });
          scrapeJobIds.push(updated.id);

          // For additional batched runs, create sibling ScrapeJob records and set their run IDs
          if (jobIds.length > 1) {
            for (let i = 1; i < jobIds.length; i++) {
              const sibling = await prisma.scrapeJob.create({
                data: {
                  project_id: projectId,
                  scraper_id: scraperId,
                  status: "RUNNING",
                  started_at: new Date(),
                  apify_run_id: jobIds[i],
                  ...(runId ? { orchestration_run_id: runId } : {}),
                  orchestration_execution_id: context.executionId,
                },
              });
              scrapeJobIds.push(sibling.id);
            }
          }
        }

        try {
          // Log execution start
          await executionLogger.logExecutionStart({
            executionId: context.executionId,
            orchestrationId: context.orchestrationId,
            threadId: context.threadExecutionId,
            threadName: context.threadName,
            stepExecutionId: stepExecution.id,
            scraperId,
            scraperName,
            platform,
            projectId: projectId,
            startTime: projectStartTime,
            scrapeJobId: undefined, // Will be updated after job creation
          });

          // Store scrape job ID for potential cancellation (use first job if multiple)
          this.scrapeJobId = jobIds.length > 0 ? jobIds[0] : null;

          // Track all job IDs in the orchestration executor
          jobIds.forEach((jobId) => {
            this.orchestrationExecutor.addRunningJob(jobId);
          });

          // Link step execution to the (primary) ScrapeJob so job completion can look up execution ID
          // Use the DB ScrapeJob id (scrapeJob.id), not jobIds[0] which is the Apify run ID
          if (jobIds.length > 0) {
            await prisma.orchestrationStepExecution.update({
              where: { id: stepExecution.id },
              data: { scrape_job_id: scrapeJob.id },
            });
          }

          // Wait for completion and get results for all job IDs (handles batched runs)
          if (jobIds.length === 0) {
            // Gracefully handle skipped scrapers (e.g., downstream source returned no records)
            console.log(
              `[Orchestration] Skipping Apify for step "${context.scraperName}" (platform=${platform}) — ` +
                `startOrchestrationScrapingJob returned no job IDs (empty input or downstream had no seeds). ` +
                `projectId=${projectId} executionId=${context.executionId} scrapeJobId=${scrapeJob.id}. ` +
                `Hints: LinkedIn Search needs project keywords/brands; LinkedIn Comments need PENDING DownstreamPost from the upstream step with matching origScraper and execution id; LinkedIn Post Scraper needs LinkedIn profile/company URLs. See server logs above for "[fetchUrlsFromDownstreamPosts]" or "Skipping Apify".`
            );

            const skipTime = new Date();
            const skipDuration = skipTime.getTime() - projectStartTime.getTime();

            // Log execution completion with completed status (zero records)
            await executionLogger.logExecutionComplete(stepExecution.id, {
              endTime: skipTime,
              duration: skipDuration,
              status: "COMPLETED",
              recordsCollected: 0,
              recordsInserted: 0,
              errorMessage: "Skipped - no input data available from downstream source",
              identity: scraperStepLogIdentity,
            });

            // Mark step as completed (with zero records)
            await prisma.orchestrationStepExecution.update({
              where: { id: stepExecution.id },
              data: {
                status: OrchestrationStatus.COMPLETED,
                completed_at: skipTime,
                error_message: "Skipped - no input data available from downstream source",
              },
            });

            // Add to project results with zero stats
            projectResults.push({
              projectId,
              scrapeJobId: null,
              recordsCollected: 0,
              recordsInserted: 0,
              recordsDiscarded: 0,
              duplicateRecords: 0,
              duration: skipDuration,
            });

            // Continue to next project instead of failing
            continue;
          }

          // Track actual execution start time (when we start waiting for jobs)
          executionStartTime = new Date();

          // Get the actual job start time from Apify for more accurate duration calculation
          try {
            const apifyService = new ApifyService();
            const firstJobStatus = await apifyService.getRunStatus(jobIds[0]);
            if (firstJobStatus.startedAt) {
              apifyStartTime = new Date(firstJobStatus.startedAt);
            }
          } catch (error) {
            console.warn("Could not get Apify start time, using execution start time:", error);
          }
          let totalCollected = 0;
          let totalInserted = 0;
          let totalNew = 0;
          let totalUpdated = 0;
          let totalDiscarded = 0;
          let totalDuplicates = 0;

          // Process all job IDs in parallel (especially important for Twitter Post Replies with multiple batches)
          // waitForJobCompletion handles waiting for completion AND processing datasets
          if (jobIds.length > 1) {
            console.log(
              `🚀 Processing ${jobIds.length} batches in parallel for ${context.scraperName}...`
            );

            const completionPromises = jobIds.map(async (jobId, index) => {
              try {
                const completionResult = await this.waitForJobCompletion(
                  jobId,
                  `${context.scraperName} (batch ${index + 1})`
                );
                return { success: true, result: completionResult, batchNumber: index + 1 };
              } catch (error) {
                console.error(
                  `❌ Batch ${index + 1} failed:`,
                  error instanceof Error ? error.message : String(error)
                );
                return { success: false, error, batchNumber: index + 1 };
              }
            });

            const results = await Promise.allSettled(completionPromises);

            results.forEach((settled, _index) => {
              if (settled.status === "fulfilled" && settled.value.success && settled.value.result) {
                const { result } = settled.value;
                totalCollected += result.recordsCollected;
                totalInserted += result.recordsInserted;
                totalNew += result.recordsNew;
                totalUpdated += result.recordsUpdated;
                totalDiscarded += result.recordsDiscarded;
                totalDuplicates += result.duplicateRecords;
              } else {
                // Error already logged in waitForJobCompletion
                // Continue processing other batches
              }
            });

            const succeeded = results.filter(
              (r) => r.status === "fulfilled" && r.value.success
            ).length;
            const failed = results.length - succeeded;
            console.log(
              `✅ Processed ${succeeded}/${jobIds.length} batches in parallel for ${context.scraperName} (${failed} failed)`
            );
          } else {
            // Single batch - process normally
            for (let i = 0; i < jobIds.length; i++) {
              try {
                const completionResult = await this.waitForJobCompletion(
                  jobIds[i],
                  `${context.scraperName}${jobIds.length > 1 ? ` (batch ${i + 1})` : ""}`
                );
                totalCollected += completionResult.recordsCollected;
                totalInserted += completionResult.recordsInserted;
                totalNew += completionResult.recordsNew;
                totalUpdated += completionResult.recordsUpdated;
                totalDiscarded += completionResult.recordsDiscarded;
                totalDuplicates += completionResult.duplicateRecords;
              } catch (error) {
                console.error(
                  `❌ Batch ${i + 1} failed:`,
                  error instanceof Error ? error.message : String(error)
                );
                // Continue with next batch instead of stopping
                continue;
              }
            }
          }

          // Get the actual job end time from Apify for more accurate duration calculation
          let apifyEndTime: Date | null = null;
          try {
            const apifyService = new ApifyService();
            const lastJobStatus = await apifyService.getRunStatus(jobIds[jobIds.length - 1]);
            if (lastJobStatus.finishedAt) {
              apifyEndTime = new Date(lastJobStatus.finishedAt);
            }
          } catch (error) {
            console.warn("Could not get Apify end time, using current time:", error);
          }

          const endTime = apifyEndTime || new Date();
          const startTime = apifyStartTime || executionStartTime;
          const duration = endTime.getTime() - startTime.getTime();

          // Log execution completion
          await executionLogger.logExecutionComplete(stepExecution.id, {
            endTime,
            duration,
            recordsCollected: totalCollected,
            recordsInserted: totalInserted,
            recordsNew: totalNew,
            recordsUpdated: totalUpdated,
            recordsDiscarded: totalDiscarded,
            duplicateRecords: totalDuplicates,
            status: "COMPLETED",
            identity: scraperStepLogIdentity,
          });

          projectResults.push({
            projectId,
            scrapeJobId: jobIds.length > 0 ? jobIds[0] : null,
            recordsCollected: totalCollected,
            recordsInserted: totalInserted,
            recordsDiscarded: totalDiscarded,
            duplicateRecords: totalDuplicates,
            duration,
          });

          // Remove completed job IDs from tracking
          jobIds.forEach((jobId) => {
            this.orchestrationExecutor.removeRunningJob(jobId);
          });
        } catch (error) {
          const endTime = new Date();
          const startTime = apifyStartTime || executionStartTime;
          const duration = endTime.getTime() - startTime.getTime();

          // Log execution failure
          await executionLogger.logExecutionComplete(stepExecution.id, {
            endTime,
            duration,
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            identity: scraperStepLogIdentity,
          });

          console.error(`Scraper ${context.scraperName} failed for project ${projectId}:`, error);

          // Remove failed job IDs from tracking
          if (jobIds && jobIds.length > 0) {
            jobIds.forEach((jobId) => {
              this.orchestrationExecutor.removeRunningJob(jobId);
            });
          }

          throw error;
        }
      }

      if (this.isStopped) {
        await this.updateStepStatus(stepExecution.id, OrchestrationStatus.CANCELLED);
      } else {
        await this.updateStepStatus(stepExecution.id, OrchestrationStatus.COMPLETED);
      }
    } catch (error) {
      const stepLabel = context.taskName ?? context.scraperName ?? "step";
      console.error(`Step ${stepLabel} execution failed:`, error);
      if (stepExecution) {
        await this.updateStepStatus(
          stepExecution.id,
          OrchestrationStatus.FAILED,
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async stop(): Promise<void> {
    console.log(`🛑 Stopping step executor...`);
    this.isStopped = true;

    // If we have a scrape job running, try to abort it on Apify
    if (this.scrapeJobId) {
      try {
        console.log(`🛑 Aborting Apify job ${this.scrapeJobId}...`);
        const response = await fetch(
          `https://api.apify.com/v2/actor-runs/${this.scrapeJobId}/abort`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
            },
          }
        );

        if (response.ok) {
          console.log(`✅ Successfully aborted Apify job ${this.scrapeJobId}`);
        } else {
          console.error(`❌ Failed to abort Apify job ${this.scrapeJobId}: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`❌ Error aborting Apify job ${this.scrapeJobId}:`, error);
      }
    }

    console.log(`✅ Step executor stopped`);
  }

  private async createStepExecution(context: StepExecutionContext) {
    const isCustomTask = context.stepType === "openai_task";
    const projectId = context.projectIds[0];
    if (!projectId) throw new Error("Step execution requires at least one project");
    return await prisma.orchestrationStepExecution.create({
      data: {
        thread_execution_id: context.threadExecutionId,
        step_sequence: context.stepNumber,
        scraper_id: isCustomTask ? undefined : (context.scraperId ?? undefined),
        search_source_task_id: isCustomTask ? (context.taskId ?? undefined) : undefined,
        scraper_name: isCustomTask
          ? (context.taskName ?? "Custom Task")
          : (context.scraperName ?? ""),
        platform: isCustomTask ? "openai_task" : (context.platform ?? ""),
        project_id: projectId,
        status: OrchestrationStatus.PENDING,
      } as Parameters<typeof prisma.orchestrationStepExecution.create>[0]["data"],
    });
  }

  /**
   * Get actual record counts from processed data
   */
  private async getActualRecordCounts(apifyRunId: string): Promise<{
    collected: number;
    inserted: number;
    new: number;
    updated: number;
    discarded: number;
    duplicates: number;
  }> {
    try {
      // Find the ScrapeJob that corresponds to this Apify run
      const scrapeJob = await prisma.scrapeJob.findFirst({
        where: {
          apify_run_id: apifyRunId,
          deleted_at: null,
        },
      });

      if (scrapeJob) {
        // Count posts created by this specific job (this is the actual inserted count)
        const insertedCount = await prisma.post.count({
          where: {
            job_id: scrapeJob.id,
          },
        });

        // Use the actual database count as the inserted count
        const actualInsertedCount = insertedCount;

        // Use the discarded_count from the ScrapeJob (should be updated by processAndSavePosts)
        const discardedCount = (scrapeJob as any).discarded_count || 0;

        // The collected count should be the sum of inserted and discarded
        const collectedCount = actualInsertedCount + discardedCount;

        // Duplicates should be 0 since we use upsert with unique constraints
        const duplicateCount = 0;

        console.log(
          `🔍 DEBUG: Record counts for job ${scrapeJob.id} (apify_run_id: ${apifyRunId}): collected=${collectedCount}, inserted=${actualInsertedCount}, discarded=${discardedCount}, duplicates=${duplicateCount}`
        );

        // Not tracking individual batch new/updated counts to avoid confusion
        const batchNewCount = 0;
        const batchUpdatedCount = 0;

        console.log(
          `🔍 DEBUG: Using individual batch counts: new=${batchNewCount}, updated=${batchUpdatedCount}`
        );

        return {
          collected: collectedCount,
          inserted: actualInsertedCount,
          new: batchNewCount,
          updated: batchUpdatedCount,
          discarded: discardedCount,
          duplicates: duplicateCount,
        };
      } else {
        console.log(`🔍 DEBUG: No ScrapeJob found for apify_run_id: ${apifyRunId}`);
      }
    } catch (error) {
      console.error(`Error getting actual record counts for job ${apifyRunId}:`, error);
    }

    // Fallback to 0 if we can't determine actual counts
    return { collected: 0, inserted: 0, new: 0, updated: 0, discarded: 0, duplicates: 0 };
  }

  /**
   * Wait for Apify job completion by polling the API
   */
  private async waitForJobCompletion(
    jobId: string,
    scraperName: string
  ): Promise<{
    recordsCollected: number;
    recordsInserted: number;
    recordsNew: number;
    recordsUpdated: number;
    recordsDiscarded: number;
    duplicateRecords: number;
  }> {
    // Store accumulated individual batch counts for this specific job
    let totalNewCount = 0;
    let totalUpdatedCount = 0;
    let totalSavedCount = 0;
    let totalDiscardedCount = 0;
    // For orchestration, jobId is already the Apify run ID
    const apifyRunId = jobId;
    console.log(
      `🔍 DEBUG: waitForJobCompletion called with jobId: ${jobId}, scraperName: ${scraperName}`
    );

    if (!apifyRunId || apifyRunId === "undefined" || apifyRunId === "null") {
      throw new Error(`Invalid jobId provided to waitForJobCompletion: ${jobId}`);
    }

    console.log(`Waiting for Apify job ${apifyRunId} (${scraperName}) to complete...`);

    // Poll every 10 seconds until completion (no timeout)
    const maxAttempts = Number.MAX_SAFE_INTEGER; // No timeout - wait until completion
    let attempts = 0;

    while (attempts < maxAttempts) {
      // Check stop flags first - this is critical for proper stopping
      if (this.isStopped) {
        console.log(`🛑 Step execution was stopped - aborting job ${apifyRunId}`);
        // Try to abort the job on Apify
        try {
          await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}/abort`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
            },
          });
        } catch (error) {
          console.error(`Failed to abort job ${apifyRunId}:`, error);
        }
        throw new Error("Step execution was stopped");
      }

      try {
        // Use only one API call to check status - remove duplicate calls
        const response = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}`, {
          headers: {
            Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to check Apify run status: ${response.statusText}`);
        }

        const runData = await response.json();
        const status = runData.data?.status;

        console.log(`Job ${apifyRunId} status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);

        if (status === "SUCCEEDED") {
          console.log(`Job ${apifyRunId} completed successfully`);

          // Process the results and save to database FIRST
          try {
            console.log(`Processing results for job ${apifyRunId}...`);

            // Find the ScrapeJob record that corresponds to this Apify run ID
            const scrapeJob = await prisma.scrapeJob.findFirst({
              where: {
                apify_run_id: apifyRunId,
                deleted_at: null,
              },
              include: { scraper: true },
            });

            if (scrapeJob) {
              const apifyService = new ApifyService();
              const updateResult = await apifyService.updateJobStatus(scrapeJob.id);

              // Store the counts if available
              if (updateResult) {
                console.log(
                  `🔍 DEBUG: updateJobStatus returned counts: new=${updateResult.newCount}, updated=${updateResult.updatedCount}, saved=${updateResult.savedCount}, discarded=${updateResult.discardedCount}`
                );
                // Accumulate individual batch counts for this specific job
                totalNewCount += updateResult.newCount;
                totalUpdatedCount += updateResult.updatedCount;
                totalSavedCount += updateResult.savedCount;
                totalDiscardedCount += updateResult.discardedCount;
                // Accumulate the counts for use in getActualRecordCounts
                this.orchestrationExecutor.accumulatedCounts.newCount += updateResult.newCount;
                this.orchestrationExecutor.accumulatedCounts.updatedCount +=
                  updateResult.updatedCount;
                this.orchestrationExecutor.accumulatedCounts.savedCount += updateResult.savedCount;
                this.orchestrationExecutor.accumulatedCounts.discardedCount +=
                  updateResult.discardedCount;
              }

              // Update ScrapeJob status to completed
              await prisma.scrapeJob.update({
                where: { id: scrapeJob.id },
                data: {
                  status: "COMPLETED",
                  completed_at: new Date(),
                },
              });

              console.log(
                `Results processed successfully for job ${apifyRunId} (ScrapeJob: ${scrapeJob.id})`
              );
            } else {
              console.log(
                `No ScrapeJob found for Apify run ID ${apifyRunId} - skipping data processing`
              );
            }
          } catch (error) {
            console.error(`Error processing results for job ${apifyRunId}:`, error);
            // Don't fail the orchestration if data processing fails
          }

          // Get actual record counts AFTER processing is complete
          const actualRecords = await this.getActualRecordCounts(apifyRunId);

          return {
            recordsCollected: actualRecords.collected,
            recordsInserted: actualRecords.inserted,
            recordsNew: totalNewCount,
            recordsUpdated: totalUpdatedCount,
            recordsDiscarded: actualRecords.discarded,
            duplicateRecords: actualRecords.duplicates,
          };
        } else if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
          console.log(
            `⚠️ Job ${apifyRunId} ${status.toLowerCase()} - processing collected data before continuing`
          );

          // Even if the job timed out or failed, try to process any data that was collected
          try {
            console.log(`Processing results for timed-out job ${apifyRunId}...`);

            // Find the ScrapeJob record that corresponds to this Apify run ID
            const scrapeJob = await prisma.scrapeJob.findFirst({
              where: {
                apify_run_id: apifyRunId,
                deleted_at: null,
              },
              include: { scraper: true },
            });

            if (scrapeJob) {
              const apifyService = new ApifyService();
              const updateResult = await apifyService.updateJobStatus(scrapeJob.id);

              // Store the counts if available
              if (updateResult) {
                console.log(
                  `🔍 DEBUG: updateJobStatus returned counts: new=${updateResult.newCount}, updated=${updateResult.updatedCount}, saved=${updateResult.savedCount}, discarded=${updateResult.discardedCount}`
                );
                // Accumulate individual batch counts for this specific job
                totalNewCount += updateResult.newCount;
                totalUpdatedCount += updateResult.updatedCount;
                totalSavedCount += updateResult.savedCount;
                totalDiscardedCount += updateResult.discardedCount;
                // Accumulate the counts for use in getActualRecordCounts
                this.orchestrationExecutor.accumulatedCounts.newCount += updateResult.newCount;
                this.orchestrationExecutor.accumulatedCounts.updatedCount +=
                  updateResult.updatedCount;
                this.orchestrationExecutor.accumulatedCounts.savedCount += updateResult.savedCount;
                this.orchestrationExecutor.accumulatedCounts.discardedCount +=
                  updateResult.discardedCount;
              }

              // Update ScrapeJob status to completed (even if it timed out, we got some data)
              await prisma.scrapeJob.update({
                where: { id: scrapeJob.id },
                data: {
                  status: "COMPLETED",
                  completed_at: new Date(),
                },
              });

              console.log(
                `Results processed successfully for timed-out job ${apifyRunId} (ScrapeJob: ${scrapeJob.id})`
              );
            } else {
              console.log(
                `No ScrapeJob found for timed-out Apify run ID ${apifyRunId} - skipping data processing`
              );
            }
          } catch (error) {
            console.error(`Error processing results for timed-out job ${apifyRunId}:`, error);
            // Don't fail the orchestration if data processing fails
          }

          // Get actual record counts AFTER processing is complete (even for failed jobs)
          const actualRecords = await this.getActualRecordCounts(apifyRunId);

          console.log(
            `🔍 DEBUG: Final counts for job ${apifyRunId}: new=${totalNewCount}, updated=${totalUpdatedCount}, saved=${totalSavedCount}, discarded=${totalDiscardedCount}`
          );

          return {
            recordsCollected: actualRecords.collected,
            recordsInserted: actualRecords.inserted,
            recordsNew: totalNewCount,
            recordsUpdated: totalUpdatedCount,
            recordsDiscarded: actualRecords.discarded,
            duplicateRecords: actualRecords.duplicates,
          };
        } else if (status === "READY" || status === "RUNNING") {
          // Job is still running, wait and check again
          const pollingInterval =
            (await configService.getConfig("performance", "job_status_polling_interval")) || 10000;
          await new Promise((resolve) => setTimeout(resolve, pollingInterval));
          attempts++;
        } else {
          console.log(`Unknown job status: ${status}, continuing to wait...`);
          const pollingInterval =
            (await configService.getConfig("performance", "job_status_polling_interval")) || 10000;
          await new Promise((resolve) => setTimeout(resolve, pollingInterval));
          attempts++;
        }
      } catch (error) {
        console.error(`Error checking job ${apifyRunId} status:`, error);
        const retryDelay = (await configService.getConfig("performance", "retry_delay")) || 2000;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        attempts++;
      }
    }

    // This should never be reached since we removed the timeout
    throw new Error(`Job ${apifyRunId} failed to complete - this should not happen`);
  }

  private async updateStepStatus(
    stepExecutionId: string,
    status: OrchestrationStatus,
    errorMessage?: string
  ) {
    const maxRetries = 3;
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await prisma.orchestrationStepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status,
            error_message: errorMessage,
            ...(status === OrchestrationStatus.COMPLETED ||
            status === OrchestrationStatus.FAILED ||
            status === OrchestrationStatus.CANCELLED
              ? { completed_at: new Date() }
              : {}),
          },
        });
        return;
      } catch (error) {
        lastError = error;
        console.error(
          `[Orchestration] Failed to update step execution ${stepExecutionId} (attempt ${i + 1}/${maxRetries}):`,
          error
        );
        if (i < maxRetries - 1) await sleep(150);
      }
    }
    // Swallowing here caused threads to reach COMPLETED while steps stayed RUNNING, blocking
    // completeOrchestrationExecution forever (no task-based analysis).
    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to update step execution ${stepExecutionId} to ${status}`);
  }
}

// Singleton instance for global orchestration management
export const orchestrationExecutor = new OrchestrationExecutor();

// Global stop function that can be called from anywhere
export async function stopAllOrchestrations(): Promise<void> {
  console.log("Stopping all orchestrations...");
  try {
    await orchestrationExecutor.stopOrchestration();
    console.log("All orchestrations stopped successfully");
  } catch (error) {
    // If no orchestration is running, that's fine - just log it
    if (
      error instanceof Error &&
      (error.message === "No orchestration is currently running" ||
        error.message === "No orchestration execution ID found")
    ) {
      console.log("No orchestrations were running to stop");
      // Force reset the orchestration state
      await orchestrationExecutor.forceReset();
      return;
    }
    console.error("Error stopping orchestrations:", error);
    throw error;
  }
}
