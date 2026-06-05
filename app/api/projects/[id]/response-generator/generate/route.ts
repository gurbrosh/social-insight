import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { runThemeResponseGeneratorPipeline } from "@/lib/response-generator/pipeline";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

/** Must match Global Actions: only theme-backed categories (same as theme row source). */
const ALLOWED_CATEGORIES = new Set(["all", "themes"]);

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
    const body = await request.json().catch(() => ({}));
    const { limit, category = "all" } = body as { limit?: number; category?: string };

    if (!ALLOWED_CATEGORIES.has(category)) {
      return NextResponse.json(
        {
          error:
            'Generate Responses only runs with analysis category "All categories" or "Themes".',
        },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    console.log(
      `[response-generator] project=${projectId} category=${category} limit=${limit != null ? limit : "all"} ${new Date().toISOString()}`
    );

    const stats = await runThemeResponseGeneratorPipeline(projectId, {
      limit:
        limit != null && Number.isFinite(limit)
          ? Math.max(1, Math.floor(Number(limit)))
          : undefined,
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/edit`);
    revalidatePath("/admin/orchestration");

    return NextResponse.json({
      success: true,
      message: `Response generation finished for ${project.name}.`,
      stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate responses";
    console.error("[response-generator] POST", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
