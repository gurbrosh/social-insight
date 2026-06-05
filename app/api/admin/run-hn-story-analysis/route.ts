import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { runHnStoryAnalysis } from "@/lib/hn-story-analysis-pipeline";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/run-hn-story-analysis
 * Body: { projectId: string, limit?: number, storyIds?: string[], forceStoryIds?: boolean }
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
    const { projectId, limit, storyIds, forceStoryIds, ingestedRunId } = body as {
      projectId?: string;
      limit?: number;
      storyIds?: string[];
      forceStoryIds?: boolean;
      ingestedRunId?: string | null;
    };

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

    const result = await runHnStoryAnalysis(projectId, {
      limit,
      storyIds,
      forceStoryIds,
      ingestedRunId: ingestedRunId ?? undefined,
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("[run-hn-story-analysis]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run HN story analysis" },
      { status: 500 }
    );
  }
}
