import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { updateAnalysisProgress } from "@/lib/analysis-progress";
import { runTaskBasedAnalysisForProject } from "@/lib/task-based-analysis-run";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/run-chatter
 * Admin-only: Clears chatter analysis for a project and runs chatter-only task-based analysis.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    await prisma.chatterAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    await updateAnalysisProgress(projectId, { last_chatter_post_id: 0 });
    await updateAnalysisProgress(projectId, { last_sanitized_chatter_at: new Date() });

    const result = await runTaskBasedAnalysisForProject(projectId, {
      steps: ["CHATTER"],
      runSanitization: true,
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return NextResponse.json({
      success: true,
      runId: result.runId,
      tasksReset: result.tasksReset,
    });
  } catch (error) {
    console.error("Error running chatter-only analysis:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run chatter-only analysis" },
      { status: 500 }
    );
  }
}
