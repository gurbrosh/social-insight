import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkCampaignPostBasedPrerequisites } from "@/lib/campaigns/check-prerequisites";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const project = await prisma.project.findFirst({
      where: { id: projectId, user_id: session.user.id, deleted_at: null },
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const prerequisite = await checkCampaignPostBasedPrerequisites(projectId);
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      postBasedPrerequisite: prerequisite,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/prerequisites]", e);
    return NextResponse.json({ error: msg || "Failed to check prerequisites" }, { status: 500 });
  }
}
