import type { SearchSourceTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createHackerNewsCustomTask, TARGET_HACKER_NEWS } from "./hacker-news-custom-task";
import { createGithubReaderCustomTask, TARGET_GITHUB_READER } from "./github-reader-custom-task";
import { createSearchSourceCustomTask } from "./search-source-custom-task";
import type { CustomTask } from "./types";

/** Dispatch DB row to the correct CustomTask implementation (search-source vs Hacker News, etc.). */
export function createCustomTaskFromSearchSourceRow(row: SearchSourceTask): CustomTask {
  const t = (row.target ?? "").trim();
  if (t === TARGET_HACKER_NEWS) {
    return createHackerNewsCustomTask(row);
  }
  if (t === TARGET_GITHUB_READER) {
    return createGithubReaderCustomTask(row);
  }
  return createSearchSourceCustomTask(row);
}

/**
 * Resolve a custom task for orchestration / admin, using the same rules as legacy `openai_task` steps:
 * prefer task id, then name, then target string (e.g. BrandBlogNews).
 *
 * New task implementations can extend this resolver to return non–search-source tasks when needed.
 */
export async function resolveCustomTaskForOrchestrationStep(params: {
  taskId?: string;
  taskName?: string;
  target?: string;
}): Promise<CustomTask | null> {
  const taskIdParam = (params.taskId ?? "").trim();
  const taskName = (params.taskName ?? "").trim();
  const stepTarget = (params.target ?? "").trim();

  let row =
    taskIdParam !== ""
      ? await prisma.searchSourceTask.findFirst({
          where: { id: taskIdParam, deleted_at: null },
        })
      : null;
  if (!row && taskName) {
    row = await prisma.searchSourceTask.findFirst({
      where: { name: taskName, deleted_at: null },
    });
  }
  if (!row && stepTarget) {
    row = await prisma.searchSourceTask.findFirst({
      where: { target: stepTarget, deleted_at: null },
    });
  }
  if (!row) return null;
  return createCustomTaskFromSearchSourceRow(row);
}

export { TARGET_HACKER_NEWS } from "./hacker-news-custom-task";
export { TARGET_GITHUB_READER } from "./github-reader-custom-task";

/**
 * All custom tasks backed by active SearchSourceTask rows (DB).
 */
export async function listSearchSourceCustomTasks(): Promise<CustomTask[]> {
  const rows = await prisma.searchSourceTask.findMany({
    where: { deleted_at: null, is_active: true },
    orderBy: { name: "asc" },
  });
  return rows.map((t) => createCustomTaskFromSearchSourceRow(t));
}

/**
 * Resolve a custom task by SearchSourceTask id.
 */
export async function getSearchSourceCustomTaskById(taskId: string): Promise<CustomTask | null> {
  const task = await prisma.searchSourceTask.findFirst({
    where: { id: taskId, deleted_at: null },
  });
  if (!task) return null;
  return createCustomTaskFromSearchSourceRow(task);
}

/**
 * Unified list for admin UIs that only need the `CustomTask` interface.
 */
export async function listCustomTasks(): Promise<CustomTask[]> {
  return listSearchSourceCustomTasks();
}
