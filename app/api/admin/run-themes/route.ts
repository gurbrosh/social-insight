import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { updateAnalysisProgress } from "@/lib/analysis-progress";
import { runTaskBasedAnalysisForProject } from "@/lib/task-based-analysis-run";
import { ulid as generateUlid } from "ulid";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/run-themes
 * Admin-only: Clears ThemesAnalysis for a project and runs themes-only task-based analysis.
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

    const clearResult = await prisma.themesAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    console.log(
      `[run-themes] Project ${projectId}: soft-deleted ${clearResult.count} existing theme match(es) before re-run`
    );

    const existingProgress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
      select: { project_id: true },
    });

    if (existingProgress) {
      await prisma.analysisProgress.update({
        where: { project_id: projectId },
        data: { last_themes_post_id: 0 },
      });
      await updateAnalysisProgress(projectId, { last_sanitized_themes_at: new Date() });
    } else {
      await prisma.analysisProgress.create({
        data: {
          id: generateUlid(),
          project_id: projectId,
          last_sentiment_post_id: 0,
          last_chatter_post_id: 0,
          last_themes_post_id: 0,
          last_network_post_id: 0,
          last_news_post_id: 0,
          last_brand_post_id: 0,
          last_sanitized_chatter_at: null,
          last_sanitized_themes_at: null,
          last_sanitized_network_at: null,
          last_sanitized_news_at: null,
        },
      });
    }

    const result = await runTaskBasedAnalysisForProject(projectId, {
      steps: ["THEMES"],
      runSanitization: true,
    });

    console.log(`[run-themes] Project ${projectId}: run ${result.runId} finished`);

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return NextResponse.json({
      success: true,
      runId: result.runId,
      tasksReset: result.tasksReset,
    });
  } catch (error) {
    console.error("Error running themes-only analysis:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run themes-only analysis" },
      { status: 500 }
    );
  }
}
