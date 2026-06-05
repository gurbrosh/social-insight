import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectOwner } from "@/lib/my-product/assert-project-owner";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId, docId } = await params;
    const ok = await assertProjectOwner(projectId, session.user.id);
    if (!ok) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const doc = await prisma.projectMyProductDocument.findFirst({
      where: { id: docId, project_id: projectId, deleted_at: null },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await prisma.projectMyProductDocument.update({
      where: { id: docId },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[my-product/documents/DELETE]", e);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
