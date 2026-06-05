import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { purgeProjectAnalysis } from "@/lib/projects/purge-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const projectExists = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!projectExists) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const deleted = await purgeProjectAnalysis(projectId);

    return NextResponse.json({
      success: true,
      projectId,
      projectName: projectExists.name,
      deleted,
      message: "Analysis progress reset successfully",
    });
  } catch (error) {
    console.error("Error resetting analysis progress:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset analysis progress" },
      { status: 500 }
    );
  }
}
