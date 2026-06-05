import type { SearchSourceTask } from "@prisma/client";
import { runSearchSourceTask } from "@/lib/search-source-task-runner";
import type {
  CustomTask,
  CustomTaskRunOptions,
  CustomTaskRunTestOptions,
  CustomTaskTestResult,
} from "./types";
import { findProjectIdByName } from "./project-resolution";

/**
 * Custom task backed by a `SearchSourceTask` row (e.g. Brand Blog / Post targets).
 * This is the implementation used for tasks such as those configured for the Test12 project.
 */
export class SearchSourceCustomTask implements CustomTask {
  readonly id: string;

  constructor(private readonly task: SearchSourceTask) {
    this.id = task.id;
  }

  get name(): string {
    return this.task.name;
  }

  get description(): string | null {
    return this.task.description;
  }

  get targetKey(): string | null {
    return this.task.target ?? null;
  }

  async run(projectId: string, options: CustomTaskRunOptions): Promise<CustomTaskTestResult> {
    return runSearchSourceTask(this.task, projectId, {
      persistTaskRun: options.persistTaskRun ?? !options.testMode,
      testMode: options.testMode,
      executionId: options.executionId,
      stepExecutionId: options.stepExecutionId,
      ingestedRunId: options.ingestedRunId ?? undefined,
    });
  }

  async runTest(
    projectName: string,
    _options?: CustomTaskRunTestOptions
  ): Promise<CustomTaskTestResult> {
    const projectId = await findProjectIdByName(projectName);
    if (!projectId) {
      return {
        success: false,
        resultPreview: null,
        errorMessage: `No active project found with name "${projectName.trim()}".`,
        rowCount: 0,
      };
    }

    return this.run(projectId, { testMode: true, persistTaskRun: false });
  }
}

export function createSearchSourceCustomTask(task: SearchSourceTask): SearchSourceCustomTask {
  return new SearchSourceCustomTask(task);
}
