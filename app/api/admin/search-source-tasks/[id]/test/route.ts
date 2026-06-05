import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { createCustomTaskFromSearchSourceRow } from "@/lib/custom-tasks";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const task = await prisma.searchSourceTask.findFirst({
      where: { id, deleted_at: null },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let projectName = "";
    let hnKeywordCsv: string | undefined;
    let ghKeywordCsv: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.hnKeywordCsv === "string" && body.hnKeywordCsv.trim()) {
        hnKeywordCsv = body.hnKeywordCsv.trim();
      }
      if (typeof body?.ghKeywordCsv === "string" && body.ghKeywordCsv.trim()) {
        ghKeywordCsv = body.ghKeywordCsv.trim();
      }
      if (typeof body?.projectName === "string" && body.projectName.trim()) {
        projectName = body.projectName.trim();
      } else if (body?.projectId) {
        const projectId = String(body.projectId).trim();
        const project = await prisma.project.findFirst({
          where: { id: projectId, deleted_at: null },
          select: { name: true },
        });
        projectName = project?.name ?? "";
      }
    } catch {
      // no body
    }
    if (!projectName) {
      return NextResponse.json(
        { error: "projectName is required (or projectId to resolve the name)." },
        { status: 400 }
      );
    }

    const customTask = createCustomTaskFromSearchSourceRow(task);
    const result = await customTask.runTest(projectName, {
      ...(hnKeywordCsv ? { hnKeywordCsv } : {}),
      ...(ghKeywordCsv ? { ghKeywordCsv } : {}),
      signal: request.signal,
    });
    return NextResponse.json({
      success: result.success,
      resultPreview: result.resultPreview,
      errorMessage: result.errorMessage,
      rowCount: result.rowCount,
      linkBreakdown: result.linkBreakdown ?? undefined,
      ...(result.scraperRunId != null && { scraperRunId: result.scraperRunId }),
      ...(result.scraperError != null && { scraperError: result.scraperError }),
      ...(result.ingestResult != null && { ingestResult: result.ingestResult }),
    });
  } catch (err) {
    console.error("Error testing search source task:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
