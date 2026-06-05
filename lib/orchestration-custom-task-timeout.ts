/**
 * Orchestration custom tasks (Hacker News, GitHub Reader, etc.) run in-process with no Apify
 * run id, so hung awaits leave OrchestrationStepExecution stuck in RUNNING forever.
 * These helpers enforce a wall-clock limit and define stale detection for reconciliation.
 */

/** Default 3 hours (GitHub Reader + rate limits can exceed 45 min). Set ORCHESTRATION_CUSTOM_TASK_TIMEOUT_MS=0 to disable (not recommended). */
export function getOrchestrationCustomTaskTimeoutMs(): number | null {
  const raw = process.env.ORCHESTRATION_CUSTOM_TASK_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") {
    return 180 * 60 * 1000;
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

/**
 * How long a custom step may stay RUNNING before reconciliation marks it FAILED.
 * Default: custom task timeout + 15 minutes (crash mid-run).
 */
export function getOrchestrationStaleCustomStepMs(): number {
  const raw = process.env.ORCHESTRATION_STALE_CUSTOM_STEP_MS?.trim();
  if (raw !== undefined && raw !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 60_000) {
      return n;
    }
  }
  const t = getOrchestrationCustomTaskTimeoutMs();
  const base = t ?? 180 * 60 * 1000;
  return base + 15 * 60 * 1000;
}

export function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${description} exceeded orchestration time limit (${timeoutMs}ms). ` +
            `Set ORCHESTRATION_CUSTOM_TASK_TIMEOUT_MS to raise the cap or 0 to disable (not recommended).`
        )
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}
