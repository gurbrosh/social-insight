/**
 * Explain why X/Twitter posts may be missing from task-based analysis (all categories).
 *
 * Checks:
 * - Post.platform distribution for X-like sources
 * - ingested_run_id null vs set (orchestration stamps run; admin test scrapes do not)
 * - RunRecord + AnalysisTask presence for sampled posts
 * - Latest OrchestrationRun vs post stamps
 *
 * Usage:
 *   npx tsx scripts/diagnose-x-analysis-run.ts <projectId>
 *   npx tsx scripts/diagnose-x-analysis-run.ts --find
 *     (--find lists projects that have Post rows with platform x/twitter)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const X_PLATFORMS = ["x", "X", "twitter", "Twitter"] as const;

function xPostsBaseWhere(projectId: string) {
  return {
    project_id: projectId,
    OR: X_PLATFORMS.map((platform) => ({ platform })),
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: npx tsx scripts/diagnose-x-analysis-run.ts <projectId>\n" +
        "       npx tsx scripts/diagnose-x-analysis-run.ts --find"
    );
    process.exit(1);
  }

  if (arg === "--find") {
    const rows = await prisma.post.groupBy({
      by: ["project_id"],
      where: {
        OR: [{ platform: "x" }, { platform: "X" }, { platform: "twitter" }, { platform: "Twitter" }],
      },
      _count: { id: true },
    });
    if (rows.length === 0) {
      console.log("No Post rows with platform x/X/twitter/Twitter in the database.");
      return;
    }
    console.log("Projects with X-like posts (by count):");
    for (const r of rows.sort((a, b) => b._count.id - a._count.id)) {
      console.log(`  ${r.project_id}  (${r._count.id} posts)`);
    }
    return;
  }

  const projectId = arg;

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true, name: true, analysis_sample_post_limit: true },
  });
  if (!project) {
    console.error("Project not found:", projectId);
    process.exit(1);
  }

  console.log("Project:", project.name ?? project.id);
  console.log("analysis_sample_post_limit:", project.analysis_sample_post_limit ?? "(null = no cap)");
  console.log("");

  const platformGroups = await prisma.post.groupBy({
    by: ["platform"],
    where: { project_id: projectId },
    _count: { id: true },
  });
  console.log("--- Post.platform counts (all platforms in project) ---");
  platformGroups
    .sort((a, b) => b._count.id - a._count.id)
    .forEach((g) => console.log(`  ${g.platform ?? "(null)"}: ${g._count.id}`));
  console.log("");

  const xTotal = await prisma.post.count({ where: xPostsBaseWhere(projectId) });
  const xWithRun = await prisma.post.count({
    where: { ...xPostsBaseWhere(projectId), ingested_run_id: { not: null } },
  });
  const xWithoutRun = await prisma.post.count({
    where: { ...xPostsBaseWhere(projectId), ingested_run_id: null },
  });

  const xPosts = await prisma.post.findMany({
    where: xPostsBaseWhere(projectId),
    select: {
      id: true,
      platform: true,
      postId: true,
      ingested_run_id: true,
      sentiment: true,
      ai_processed_at: true,
    },
    orderBy: { id: "desc" },
    take: 8,
  });

  console.log("--- X/Twitter posts (platform in x, X, twitter, Twitter) ---");
  console.log(`Total: ${xTotal}`);
  if (xTotal === 0) {
    console.log(
      "No rows: either nothing was ingested as X, or platform is stored under a different string.\n" +
        "Check raw platform values above."
    );
    return;
  }

  console.log(`ingested_run_id set: ${xWithRun}`);
  console.log(`ingested_run_id NULL: ${xWithoutRun}`);
  console.log(
    xWithoutRun > 0
      ? "  => Posts without a run id were never tied to freezeRunMembership(orchestration).\n" +
          "     Common causes: admin scraper test save, manual/API ingest without orchestration_run_id on the job."
      : "  (all sampled posts have a run id)"
  );
  console.log("");

  const latestRuns = await prisma.orchestrationRun.findMany({
    where: { project_id: projectId },
    orderBy: { created_at: "desc" },
    take: 5,
    select: { id: true, status: true, created_at: true, collected_at: true },
  });
  console.log("--- Latest OrchestrationRun rows (up to 5) ---");
  if (latestRuns.length === 0) {
    console.log("None.");
  } else {
    latestRuns.forEach((r) =>
      console.log(`  ${r.id}  status=${r.status}  created=${r.created_at?.toISOString?.() ?? r.created_at}`)
    );
  }
  console.log("");

  const latestRunId = latestRuns[0]?.id;
  if (latestRunId) {
    const rr = await prisma.runRecord.count({
      where: { run_id: latestRunId, record_type: "POST", deleted_at: null },
    });
    const postsForRun = await prisma.post.count({
      where: { project_id: projectId, ingested_run_id: latestRunId },
    });
    console.log(`--- Latest run ${latestRunId.slice(0, 8)}... ---`);
    console.log(`Posts with ingested_run_id = this run: ${postsForRun}`);
    console.log(`RunRecord POST rows for this run: ${rr}`);
    if (postsForRun !== rr && postsForRun > 0) {
      console.log(
        "  Mismatch: RunRecord count should match posts stamped with this run id after freezeRunMembership."
      );
    }
    console.log("");
  }

  if (xWithRun > 0) {
    const byRun = await prisma.post.groupBy({
      by: ["ingested_run_id"],
      where: { ...xPostsBaseWhere(projectId), ingested_run_id: { not: null } },
      _count: { id: true },
    });
    console.log("--- X posts grouped by ingested_run_id (all runs) ---");
    for (const row of byRun.sort((a, b) => b._count.id - a._count.id).slice(0, 8)) {
      const rid = row.ingested_run_id!;
      const run = await prisma.orchestrationRun.findUnique({
        where: { id: rid },
        select: { status: true, collected_at: true },
      });
      const rrCount = await prisma.runRecord.count({
        where: { run_id: rid, record_type: "POST", deleted_at: null },
      });
      console.log(
        `  run=${rid.slice(0, 12)}...  x_posts=${row._count.id}  orchestrationRun.status=${run?.status ?? "NOT FOUND"}  RunRecord_POST=${rrCount}`
      );
      if (run && run.status !== "READY_FOR_ANALYSIS" && run.status !== "ANALYZING" && run.status !== "COMPLETED") {
        console.log(
          `    => Run never reached READY_FOR_ANALYSIS; freezeRunMembership may not have run — no tasks.`
        );
      }
      if (rrCount === 0 && row._count.id > 0) {
        console.log(`    => Posts stamped but zero RunRecords for this run — membership step did not complete.`);
      }
    }
    console.log("");
  }

  console.log("--- Sample X posts (newest first, up to 8) ---");
  for (const p of xPosts) {
    const tasks = await prisma.analysisTask.count({
      where: {
        project_id: projectId,
        record_type: "POST",
        record_key: String(p.id),
        deleted_at: null,
      },
    });
    let runRecord = "n/a";
    if (p.ingested_run_id) {
      const rec = await prisma.runRecord.findFirst({
        where: {
          run_id: p.ingested_run_id,
          record_type: "POST",
          record_key: String(p.id),
          deleted_at: null,
        },
        select: { id: true },
      });
      runRecord = rec ? "yes" : "MISSING";
    }
    console.log(
      `  post.id=${p.id} platform=${p.platform} ingested_run_id=${p.ingested_run_id ?? "NULL"} ` +
        `RunRecord=${runRecord} analysisTasks=${tasks} sentiment=${p.sentiment ?? "null"}`
    );
  }
  console.log("");
  console.log("--- How to fix (summary) ---");
  if (xWithoutRun > 0) {
    console.log(
      "- Posts with NULL ingested_run_id: run full analysis without relying on orchestration membership,\n" +
        "  e.g. ad-hoc `runTaskBasedAnalysisForProject(projectId, { steps: [...] })` which uses\n" +
        "  freezeRunMembershipFromExistingPosts (all posts), or re-ingest via orchestration so\n" +
        "  ScrapeJob.orchestration_run_id is set and posts get stamped."
    );
  }
  if (xWithRun > 0) {
    console.log(
      "- Posts with ingested_run_id but RunRecord MISSING / analysisTasks=0: orchestration did not finish\n" +
        "  completeCollection → freezeRunMembership → enqueueRunTasks for that run (stuck COLLECTING,\n" +
        "  crashed, or analysis never triggered). Fix: repair run or run ad-hoc analysis on all posts."
    );
  }
  if (project.analysis_sample_post_limit != null && project.analysis_sample_post_limit > 0) {
    console.log(
      `- analysis_sample_post_limit=${project.analysis_sample_post_limit}: ad-hoc reruns may only include the newest N posts by id;\n` +
        "  older X posts can be excluded from tasks."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
