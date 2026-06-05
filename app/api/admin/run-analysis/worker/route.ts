import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { findLatestRunForProject, startRunAnalysis } from "@/lib/analysis-run";
import { runWorkerLoop } from "@/lib/analysis-worker";
import { runAnalysisWorkerPostLoop } from "@/lib/run-analysis-worker-pipeline";

export const dynamic = "force-dynamic";
/**
 * Serverless platforms cap **total** route execution (including `after()`). This matches other long
 * admin routes; it is still far too short for thousands of tasks. For large projects, run the
 * standalone worker: `npm run analysis:worker -- --projectId=...` (see Dockerfile.analysis-worker).
 */
export const maxDuration = 900;

/**
 * POST /api/admin/run-analysis/worker
 * Start the analysis task worker for the project's latest run **in the background**.
 * Use when tasks exist but nothing processes them — the dev server does not auto-poll the worker.
 *
 * **Reliability:** On Vercel/serverless, the invocation is killed after `maxDuration` seconds even if
 * `after()` is still running—long runs will **not** finish via this endpoint. Use the CLI worker.
 *
 * Body: { "projectId": string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const runId = await findLatestRunForProject(projectId);
    if (!runId) {
      return NextResponse.json(
        { error: "No orchestration run with records for this project." },
        { status: 404 }
      );
    }

    await startRunAnalysis(runId);

    after(async () => {
      try {
        console.log(`[AnalysisWorker] background start run=${runId} project=${projectId}`);
        await runWorkerLoop(runId);
        await runAnalysisWorkerPostLoop(projectId, runId);
        console.log(`[AnalysisWorker] background done run=${runId}`);
      } catch (err) {
        console.error(`[AnalysisWorker] background failed run=${runId}`, err);
      }
    });

    return NextResponse.json({
      success: true,
      runId,
      message:
        "Worker started in the server background. Watch terminal logs for [AnalysisWorker]. This can take a long time.",
      warning:
        "On serverless hosts, this HTTP-triggered worker may be stopped after the route maxDuration (~15m). For thousands of tasks or multi-hour runs, use: npm run analysis:worker -- --projectId=<id>",
    });
  } catch (error) {
    console.error("[run-analysis/worker]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start worker" },
      { status: 500 }
    );
  }
}
