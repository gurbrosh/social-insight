import { NextResponse } from "next/server";
import { getStoredChatterAnalysisForUser } from "@/app/actions/chatter-analysis";
import { verifyReportExportToken } from "@/lib/email-report-export-token";
import { buildChatterCsvContent } from "@/lib/report-sections-export-csv";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const payload = verifyReportExportToken(token);
  if (!payload || payload.kind !== "chatter") {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  if (payload.projectId !== projectId) {
    return NextResponse.json({ error: "Token does not match resource" }, { status: 403 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user_id: payload.userId,
      deleted_at: null,
    },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const windowStart = new Date(payload.windowStartMs);

  const result = await getStoredChatterAnalysisForUser(projectId, payload.userId, {
    lastPostAfter: windowStart,
    limit: 10000,
    dateRange: "all",
  });

  if (!result.success || !result.conversations) {
    return NextResponse.json(
      { error: result.error || "Failed to load chatter" },
      { status: 500 }
    );
  }

  const csv = buildChatterCsvContent(result.conversations);
  const filename = `chatter-export-${projectId.slice(-8)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
