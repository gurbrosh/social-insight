/**
 * Shared post-worker pipeline: progress timestamps, sanitization, finalize run.
 * Used by the HTTP `after()` worker route and the standalone analysis worker script.
 */

import { runSanitizationForProject } from "@/lib/comprehensive-analysis";
import { finalizeRun } from "@/lib/analysis-run";
import { runThemeResponseGeneratorAfterSanitization } from "@/lib/response-generator/pipeline";

export async function runAnalysisWorkerPostLoop(projectId: string, runId: string): Promise<void> {
  await runSanitizationForProject(
    projectId,
    { news: true, themes: true, chatter: true, network: true },
    { orchestrationRunId: runId }
  );
  await runThemeResponseGeneratorAfterSanitization(projectId, runId);
  await finalizeRun(runId);
}
