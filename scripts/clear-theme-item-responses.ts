/**
 * Soft-delete generated theme replies (ThemeItemResponse) for a project so you can
 * re-run "Generate Responses" tests without touching ThemesAnalysis or objectives.
 *
 * Usage:
 *   npx tsx scripts/clear-theme-item-responses.ts --project-id <ULID>
 *   npx tsx scripts/clear-theme-item-responses.ts --project-id <ULID> --dry-run
 *
 * Optional:
 *   --objective-id <ULID>   Only remove responses for that response objective
 *   --all                   Soft-delete all ThemeItemResponse rows (any project; ignores --project-id)
 */

import { prisma } from "../lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const clearAll = args.includes("--all");
  const projectIdx = args.indexOf("--project-id");
  const projectId =
    projectIdx !== -1 && args[projectIdx + 1] ? String(args[projectIdx + 1]).trim() : null;
  const objectiveIdx = args.indexOf("--objective-id");
  const objectiveId =
    objectiveIdx !== -1 && args[objectiveIdx + 1] ? String(args[objectiveIdx + 1]).trim() : null;
  const dryRun = args.includes("--dry-run");

  if (!clearAll && !projectId) {
    console.error(
      "Usage: npx tsx scripts/clear-theme-item-responses.ts --project-id <ULID> [--objective-id <ULID>] [--dry-run]\n" +
        "   or: npx tsx scripts/clear-theme-item-responses.ts --all [--dry-run]"
    );
    process.exit(1);
  }

  if (clearAll) {
    const count = await prisma.themeItemResponse.count({ where: { deleted_at: null } });
    console.log(`Active ThemeItemResponse rows (all projects): ${count}`);
    if (dryRun) {
      console.log("Dry run — no changes.");
      return;
    }
    if (count === 0) {
      console.log("Nothing to do.");
      return;
    }
    const now = new Date();
    const result = await prisma.themeItemResponse.updateMany({
      where: { deleted_at: null },
      data: { deleted_at: now },
    });
    console.log(`Soft-deleted ${result.count} theme item response(s). Re-run Generate Responses to regenerate.`);
    return;
  }

  const pid = projectId as string;

  const project = await prisma.project.findFirst({
    where: { id: pid, deleted_at: null },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`No active project with id ${pid}`);
    process.exit(1);
  }

  if (objectiveId) {
    const obj = await prisma.responseObjective.findFirst({
      where: { id: objectiveId, project_id: pid, deleted_at: null },
      select: { id: true, name: true },
    });
    if (!obj) {
      console.error(`No response objective ${objectiveId} for this project.`);
      process.exit(1);
    }
  }

  const where = {
    deleted_at: null,
    themesAnalysis: { project_id: pid },
    ...(objectiveId ? { response_objective_id: objectiveId } : {}),
  } as const;

  const count = await prisma.themeItemResponse.count({ where });

  console.log(`Project: ${project.name} (${project.id})`);
  if (objectiveId) {
    console.log(`Objective filter: ${objectiveId}`);
  }
  console.log(`Active ThemeItemResponse rows to clear: ${count}`);

  if (dryRun) {
    console.log("Dry run — no changes.");
    return;
  }

  if (count === 0) {
    console.log("Nothing to do.");
    return;
  }

  const now = new Date();
  const result = await prisma.themeItemResponse.updateMany({
    where,
    data: { deleted_at: now },
  });

  console.log(`Soft-deleted ${result.count} theme item response(s). Re-run Generate Responses to regenerate.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
