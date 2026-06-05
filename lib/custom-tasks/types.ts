import type { RunTaskResult } from "@/lib/search-source-task-runner";

/**
 * Result of running a custom task in test mode (same shape as search-source runner).
 */
export type CustomTaskTestResult = RunTaskResult;

/**
 * Options for a full (non-test) run, e.g. orchestration. Maps to `runSearchSourceTask` options
 * for search-source-backed tasks; other implementations use the same shape for consistency.
 */
export interface CustomTaskRunOptions {
  /** When true, test-style behavior (minimal side effects). */
  testMode: boolean;
  persistTaskRun?: boolean;
  executionId?: string;
  stepExecutionId?: string;
  ingestedRunId?: string | null;
}

/**
 * Optional inputs for admin test runs (e.g. Hacker News CSV override).
 * Search-source tasks ignore these.
 */
export interface CustomTaskRunTestOptions {
  /** Comma- or newline-separated terms; when set, overrides project keywords/brands for this test only. */
  hnKeywordCsv?: string;
  /** Same shape as HN override; used by Github Reader only. */
  ghKeywordCsv?: string;
  /**
   * When aborted (e.g. user clicks Stop), cooperative tasks should exit. Usually `request.signal`
   * from the test API route so disconnect also cancels server work.
   */
  signal?: AbortSignal;
}

/**
 * Pluggable custom task (admin: previously "OpenAI task" / `openai_task` in orchestration).
 * Implementations may wrap DB rows, scripts, or external APIs.
 *
 * Orchestration and admin test flows should use this interface — not `runSearchSourceTask` directly —
 * so new task types (e.g. HN, GitHub) can be added as implementations.
 */
export interface CustomTask {
  /** Stable identifier (e.g. SearchSourceTask id). */
  readonly id: string;

  /** Display name. */
  name: string;

  /** Optional human-readable description. */
  description?: string | null;

  /**
   * Target discriminator for orchestration follow-ups (e.g. blog table analysis after BrandBlogNews).
   * `null` when not applicable.
   */
  readonly targetKey: string | null;

  /**
   * Run a test for the given project (matched by **project name**, not id).
   * Implementations may accept optional runner-specific options (e.g. HN keyword override).
   */
  runTest(projectName: string, options?: CustomTaskRunTestOptions): Promise<CustomTaskTestResult>;

  /**
   * Run for a project by **id** (orchestration, scheduled runs). Prefer over name when id is known.
   */
  run(projectId: string, options: CustomTaskRunOptions): Promise<CustomTaskTestResult>;
}
