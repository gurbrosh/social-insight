/**
 * Opt-in timing/heap logs for the scrape → analysis handoff (materialize, freeze, enqueue).
 * Enable: ANALYSIS_HANDOFF_METRICS=1 (or true/yes)
 *
 * Use to spot SQLite write storms, long phases, or heap growth before the worker runs.
 */

import { logger } from "@/lib/utils/logger";

export function isAnalysisHandoffMetricsEnabled(): boolean {
  const v = process.env.ANALYSIS_HANDOFF_METRICS?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Heap used in MB (one decimal). */
export function heapUsedMb(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

export function logAnalysisHandoff(
  phase: string,
  meta: Record<string, unknown> & { durationMs?: number }
): void {
  if (!isAnalysisHandoffMetricsEnabled()) return;
  logger.info(`[AnalysisHandoff] ${phase}`, {
    ...meta,
    heapUsedMb: heapUsedMb(),
  });
}
