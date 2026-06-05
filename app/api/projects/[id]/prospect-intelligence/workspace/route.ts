import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadProspectIntelligenceWorkspace } from "@/lib/prospect-intelligence/load-workspace";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const workspace = await loadProspectIntelligenceWorkspace(projectId, session.user.id);
    if (!workspace) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(workspace);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[prospect-intelligence/workspace]", e);
    return NextResponse.json({ error: msg || "Failed to load workspace" }, { status: 500 });
  }
}
