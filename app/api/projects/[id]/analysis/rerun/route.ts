import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { updateAnalysisProgress } from "@/lib/analysis-progress";
import {
  runTaskBasedAnalysisForProject,
  getAnalysisStepsForProject,
} from "@/lib/task-based-analysis-run";
import type { AnalysisStep } from "@prisma/client";

export const dynamic = "force-dynamic";

export type AnalysisCategory = "all" | "influencers" | "news" | "chatter" | "themes" | "brands";

const CATEGORY_TO_STEPS: Record<AnalysisCategory, AnalysisStep[]> = {
  all: ["SENTIMENT", "THEMES", "CHATTER", "NETWORK", "NEWS", "BRAND"],
  influencers: ["NETWORK"],
  news: ["NEWS"],
  chatter: ["CHATTER"],
  themes: ["THEMES"],
  brands: ["BRAND"],
};

/**
 * POST /api/projects/[id]/analysis/rerun
 * Rerun analysis for one or more categories. Task-based only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 });
    }

    const { id: projectId } = await params;
    const body = await request.json();
    const { category = "all", limit } = body as {
      category?: AnalysisCategory;
      limit?: number;
    };

    const steps =
      category === "all"
        ? await getAnalysisStepsForProject(projectId)
        : CATEGORY_TO_STEPS[category];
    if (!steps?.length) {
      return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    console.log(
      `[Rerun] ${new Date().toLocaleString()} (local) project=${projectId} category=${category} limit=${limit ?? "all"}`
    );

    const stepsSet = new Set(steps);
    if (limit == null) {
      if (stepsSet.has("THEMES")) {
        await prisma.themesAnalysis.updateMany({
          where: { project_id: projectId, deleted_at: null },
          data: { deleted_at: new Date() },
        });
        await updateAnalysisProgress(projectId, { last_themes_post_id: 0 });
      }
      if (stepsSet.has("CHATTER")) {
        await prisma.chatterAnalysis.updateMany({
          where: { project_id: projectId, deleted_at: null },
          data: { deleted_at: new Date() },
        });
      }
      if (stepsSet.has("NETWORK")) {
        await prisma.networkAnalysis.updateMany({
          where: { project_id: projectId, deleted_at: null },
          data: { deleted_at: new Date() },
        });
      }
      if (stepsSet.has("NEWS")) {
        await prisma.postNews.updateMany({
          where: { project_id: projectId, deleted_at: null },
          data: { deleted_at: new Date() },
        });
      }
      if (stepsSet.has("BRAND")) {
        await prisma.brandAnalysis.updateMany({
          where: { project_id: projectId, deleted_at: null },
          data: { deleted_at: new Date() },
        });
        await updateAnalysisProgress(projectId, { last_brand_post_id: 0 });
      }
    }

    const result = await runTaskBasedAnalysisForProject(projectId, { steps, limit });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);
    revalidatePath("/admin/orchestration");

    return NextResponse.json({
      success: true,
      message: `Reran ${category} analysis${result.isAdHoc ? " (ad-hoc run)" : ""}${limit != null ? `, last ${limit} posts` : ""}.`,
      runId: result.runId,
      tasksReset: result.tasksReset,
      ...(limit != null ? { limit } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rerun analysis";
    if (message.includes("No posts found")) {
      return NextResponse.json({ error: message, code: "NO_DATA" }, { status: 400 });
    }
    console.error("Error rerunning analysis:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
