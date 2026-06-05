import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { outreachTemplateRowToDefinition } from "@/lib/prospect-intelligence/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, user_id: session.user.id, deleted_at: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await prisma.outreachTemplate.findMany({
    where: { project_id: projectId, deleted_at: null },
    orderBy: [{ channel: "asc" }, { priority: "asc" }],
  });
  return NextResponse.json({ templates: rows.map(outreachTemplateRowToDefinition) });
}
