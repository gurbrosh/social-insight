import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { updateAnalysisProgress } from "@/lib/analysis-progress";
import { runTaskBasedAnalysisForProject } from "@/lib/task-based-analysis-run";
import { ulid as generateUlid } from "ulid";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/run-network
 * Admin-only: Clears NetworkAnalysis for a project and runs network-only task-based analysis.
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

    await prisma.networkAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    const existingProgress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
      select: { project_id: true },
    });

    if (existingProgress) {
      await prisma.analysisProgress.update({
        where: { project_id: projectId },
        data: {
          last_network_post_id: 0,
          last_sanitized_network_at: null,
        },
      });
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
      steps: ["NETWORK"],
      runSanitization: true,
    });

    return NextResponse.json({
      success: true,
      runId: result.runId,
      tasksReset: result.tasksReset,
    });
  } catch (error) {
    console.error("Error running network-only analysis:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run network-only analysis" },
      { status: 500 }
    );
  }
}
