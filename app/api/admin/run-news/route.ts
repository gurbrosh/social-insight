import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { updateAnalysisProgress } from "@/lib/analysis-progress";
import { runTaskBasedAnalysisForProject } from "@/lib/task-based-analysis-run";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/run-news
 * Admin-only: Clears PostNews for a project and runs news-only task-based analysis.
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

    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const clearResult = await prisma.postNews.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    console.log(
      `[run-news] Project ${projectId}: soft-deleted ${clearResult.count} existing news item(s) before re-run`
    );

    await updateAnalysisProgress(projectId, {
      last_news_post_id: 0,
      last_sanitized_news_at: null,
    });

    const result = await runTaskBasedAnalysisForProject(projectId, {
      steps: ["NEWS"],
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
    console.error("Error running news-only analysis:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run news-only analysis" },
      { status: 500 }
    );
  }
}
