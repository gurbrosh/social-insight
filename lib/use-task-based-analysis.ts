/**
 * Task-based analysis is the only supported path.
 * This module is kept for compatibility (e.g. config cache clear); it always returns true.
 */
export async function useTaskBasedAnalysis(): Promise<boolean> {
  return true;
}

/** No-op; kept for API compatibility. */
export function clearTaskBasedAnalysisCache(): void {
  // no-op
}
