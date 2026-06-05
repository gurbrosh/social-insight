/**
 * Ensure each step has an explicit type so executor logic does not rely on undefined !== "openai_task".
 * UI payloads sometimes omit `type` when only scraperId/platform are set.
 */
export function normalizeOrchestrationThreads(threads: unknown): unknown[] {
  if (!Array.isArray(threads)) return [];
  return threads.map((thread) => {
    const t = thread as { steps?: unknown[]; [key: string]: unknown };
    return {
      ...t,
      steps: (t.steps ?? []).map((raw) => {
        const step = raw as Record<string, unknown>;
        if (step.type === "openai_task") return raw;
        if (step.taskId) return { ...step, type: "openai_task" };
        if (step.scraperId) return { ...step, type: "scraper" };
        return raw;
      }),
    };
  });
}
