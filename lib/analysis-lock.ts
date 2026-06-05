export const ANALYSIS_LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type AnalysisLockMode = "manual" | "orchestration";

export interface AnalysisLock {
  projectId: string;
  startedAt: number;
  mode: AnalysisLockMode;
}

let currentAnalysisLock: AnalysisLock | null = null;

export function getAnalysisLock(): AnalysisLock | null {
  return currentAnalysisLock;
}

export function setAnalysisLock(lock: AnalysisLock): void {
  currentAnalysisLock = lock;
}

export function clearAnalysisLock(projectId?: string): void {
  if (!currentAnalysisLock) {
    return;
  }

  if (!projectId || currentAnalysisLock.projectId === projectId) {
    currentAnalysisLock = null;
  }
}

export function isAnalysisLockStale(lock: AnalysisLock, ttlMs: number): boolean {
  return Date.now() - lock.startedAt >= ttlMs;
}
