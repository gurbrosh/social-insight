/**
 * Run Github Reader search-source task test (same as admin UI POST .../test).
 *
 * Usage:
 *   npx tsx scripts/run-github-reader-test.ts [taskId] [projectName]
 *
 * Defaults: task from your Github Reader task id; project "Agentic Security".
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { createCustomTaskFromSearchSourceRow } from "../lib/custom-tasks";

const DEFAULT_TASK_ID = "01KMNQHND5DPXN2ZS8MEE8QRW2";
const DEFAULT_PROJECT = "Agentic Security";

async function main(): Promise<void> {
  const taskId = (process.argv[2] ?? DEFAULT_TASK_ID).trim();
  const projectName = (process.argv[3] ?? DEFAULT_PROJECT).trim();

  if (!process.env.GITHUB_TOKEN?.trim()) {
    console.error("GITHUB_TOKEN is required in .env");
    process.exit(1);
  }

  const task = await prisma.searchSourceTask.findFirst({
    where: { id: taskId, deleted_at: null },
  });
  if (!task) {
    console.error("Search source task not found:", taskId);
    process.exit(1);
  }

  const customTask = createCustomTaskFromSearchSourceRow(task);
  console.error(`Task: ${task.name} (${task.id})\nProject: ${projectName}\n---\n`);

  const result = await customTask.runTest(projectName, {});
  console.log(result.resultPreview ?? "");
  if (result.errorMessage) {
    console.error("\n---\nError:", result.errorMessage);
  }
  process.exit(result.success ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
