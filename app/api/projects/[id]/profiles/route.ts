import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await context.params;

    // Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get all active profiles
    const profiles = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      select: {
        id: true,
        platform: true,
        name: true,
        url: true,
        type: true,
        is_selected: true,
      },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Error fetching project profiles:", error);
    return NextResponse.json({ error: "Failed to fetch profiles" }, { status: 500 });
  }
}
