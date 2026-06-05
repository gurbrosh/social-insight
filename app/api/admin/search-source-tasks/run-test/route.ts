import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { createCustomTaskFromSearchSourceRow } from "@/lib/custom-tasks";

export const dynamic = "force-dynamic";

/**
 * POST body: { taskName: string, projectName: string } (preferred) or { taskName, projectId } (legacy)
 * Runs a test by task name (for tasks that have no id or when id is not available).
 */
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

    let body: {
      taskName?: string;
      projectName?: string;
      projectId?: string;
      hnKeywordCsv?: string;
      ghKeywordCsv?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON with taskName and projectName (or projectId)." },
        { status: 400 }
      );
    }
    const taskName = typeof body?.taskName === "string" ? body.taskName.trim() : "";
    let projectName = typeof body?.projectName === "string" ? body.projectName.trim() : "";
    if (!projectName && typeof body?.projectId === "string" && body.projectId.trim()) {
      const p = await prisma.project.findFirst({
        where: { id: body.projectId.trim(), deleted_at: null },
        select: { name: true },
      });
      projectName = p?.name ?? "";
    }
    if (!taskName) {
      return NextResponse.json({ error: "taskName is required." }, { status: 400 });
    }
    if (!projectName) {
      return NextResponse.json(
        { error: "projectName is required (or a valid projectId to resolve the name)." },
        { status: 400 }
      );
    }

    const task = await prisma.searchSourceTask.findFirst({
      where: { name: taskName, deleted_at: null },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const hnCsv =
      typeof body?.hnKeywordCsv === "string" && body.hnKeywordCsv.trim()
        ? body.hnKeywordCsv.trim()
        : undefined;
    const ghCsv =
      typeof body?.ghKeywordCsv === "string" && body.ghKeywordCsv.trim()
        ? body.ghKeywordCsv.trim()
        : undefined;
    const customTask = createCustomTaskFromSearchSourceRow(task);
    const result = await customTask.runTest(projectName, {
      ...(hnCsv ? { hnKeywordCsv: hnCsv } : {}),
      ...(ghCsv ? { ghKeywordCsv: ghCsv } : {}),
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
    console.error("Error testing search source task by name:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
