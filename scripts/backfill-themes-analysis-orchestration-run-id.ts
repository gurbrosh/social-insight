/**
 * Set ThemesAnalysis.orchestration_run_id from Post.ingested_run_id when missing (or optionally
 * when it disagrees with the post) so run-scoped response generation and UI filters match ingest.
 *
 * Run:
 *   DATABASE_URL="file:./db/prod.db" npx tsx scripts/backfill-themes-analysis-orchestration-run-id.ts
 *
 * Options:
 *   --dry-run          Log counts only; no updates
 *   --project-id <id>  Limit to one project
 *   --sync-mismatch    Also update rows where orchestration_run_id is set but differs from post
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type Row = { id: string; target_run_id: string };

function parseArgs() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let syncMismatch = false;
  let projectId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--sync-mismatch") syncMismatch = true;
    else if (argv[i] === "--project-id" && argv[i + 1]) {
      projectId = argv[++i];
    }
  }
  return { dryRun, syncMismatch, projectId };
}

async function loadCandidates(
  syncMismatch: boolean,
  projectId?: string
): Promise<Row[]> {
  const mismatchSql = syncMismatch
    ? Prisma.sql`OR ta.orchestration_run_id != p.ingested_run_id`
    : Prisma.empty;
  const projectSql = projectId
    ? Prisma.sql`AND ta.project_id = ${projectId}`
    : Prisma.empty;

  return prisma.$queryRaw<Row[]>`
    SELECT ta.id AS id, p.ingested_run_id AS target_run_id
    FROM ThemesAnalysis ta
    INNER JOIN Post p ON p.id = ta.post_id AND p.project_id = ta.project_id
    WHERE ta.deleted_at IS NULL
      AND p.ingested_run_id IS NOT NULL
      AND (
        ta.orchestration_run_id IS NULL
        ${mismatchSql}
      )
      ${projectSql}
  `;
}

async function main() {
  const { dryRun, syncMismatch, projectId } = parseArgs();

  console.log(
    `Backfill ThemesAnalysis.orchestration_run_id from Post.ingested_run_id\n` +
      `  dryRun=${dryRun} syncMismatch=${syncMismatch} projectId=${projectId ?? "(all)"}\n`
  );

  const candidates = await loadCandidates(syncMismatch, projectId);
  if (candidates.length === 0) {
    console.log("No rows to update.");
    return;
  }

  const runIds = [...new Set(candidates.map((c) => c.target_run_id))];
  const validRuns = await prisma.orchestrationRun.findMany({
    where: { id: { in: runIds }, deleted_at: null },
    select: { id: true },
  });
  const valid = new Set(validRuns.map((r) => r.id));
  const skippedInvalidFk = candidates.filter((c) => !valid.has(c.target_run_id));

  const toApply = candidates.filter((c) => valid.has(c.target_run_id));

  console.log(
    `Candidates: ${candidates.length} (will apply: ${toApply.length}, skip missing OrchestrationRun: ${skippedInvalidFk.length})`
  );

  if (dryRun) {
    if (skippedInvalidFk.length > 0) {
      const sample = skippedInvalidFk.slice(0, 5).map((s) => `${s.id}→${s.target_run_id}`);
      console.log(`Sample skipped (no run row): ${sample.join("; ")}`);
    }
    return;
  }

  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < toApply.length; i += CHUNK) {
    const chunk = toApply.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.themesAnalysis.update({
          where: { id: row.id },
          data: { orchestration_run_id: row.target_run_id },
        })
      )
    );
    updated += chunk.length;
    if (updated % 500 === 0 || updated === toApply.length) {
      console.log(`Updated ${updated}/${toApply.length}…`);
    }
  }

  console.log(`Done. Updated ${updated} ThemesAnalysis row(s).`);
  if (skippedInvalidFk.length > 0) {
    console.warn(
      `Skipped ${skippedInvalidFk.length} row(s): Post.ingested_run_id does not match an active OrchestrationRun.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
