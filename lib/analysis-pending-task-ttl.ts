/**
 * Drop unbounded backlog: mark PENDING analysis tasks SKIPPED once they exceed a max age (default 1 day).
 * Age uses `updated_at` so re-enqueued / upsert-reset tasks get a fresh clock.
 */

import { prisma } from "@/lib/prisma";

/** Default max age before a PENDING task is skipped without running (hours). Set env to 0 to disable. */
const DEFAULT_PENDING_MAX_AGE_HOURS = 24;

/**
 * Parses ANALYSIS_TASK_PENDING_MAX_AGE_HOURS (default {@link DEFAULT_PENDING_MAX_AGE_HOURS}).
 * Returns null when TTL skip is disabled.
 */
export function getPendingAnalysisTaskMaxAgeHours(): number | null {
  const raw = process.env.ANALYSIS_TASK_PENDING_MAX_AGE_HOURS;
  const n =
    raw != null && String(raw).trim() !== ""
      ? Number.parseFloat(String(raw))
      : DEFAULT_PENDING_MAX_AGE_HOURS;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 24 * 365 * 10);
}

/**
 * Marks PENDING tasks whose `updated_at` is older than the configured max age as SKIPPED,
 * scoped to one orchestration run. Idempotent per task.
 *
 * Uses `updated_at` (not `created_at`) so tasks reset via upsert/new run get time to execute.
 *
 * @returns number of rows updated
 */
export async function expireStalePendingAnalysisTasksForRun(runId: string): Promise<number> {
  const hours = getPendingAnalysisTaskMaxAgeHours();
  if (hours == null) return 0;

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const now = new Date();
  const reason = `Skipped: pending task exceeded max age (${hours}h from updated_at, cutoff ${cutoff.toISOString()})`;

  const result = await prisma.analysisTask.updateMany({
    where: {
      run_id: runId,
      state: "PENDING",
      deleted_at: null,
      updated_at: { lt: cutoff },
    },
    data: {
      state: "SKIPPED",
      completed_at: now,
      last_error: reason,
      locked_at: null,
      updated_at: now,
    },
  });

  return result.count;
}
