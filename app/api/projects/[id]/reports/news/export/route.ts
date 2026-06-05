import { NextResponse } from "next/server";
import { verifyReportExportToken } from "@/lib/email-report-export-token";
import { buildNewsCsvContent } from "@/lib/report-sections-export-csv";
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
  if (!payload || payload.kind !== "news") {
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

  const rows = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      OR: [
        { date_range_start: { gte: windowStart } },
        { AND: [{ date_range_start: null }, { created_at: { gte: windowStart } }] },
      ],
    },
    orderBy: { created_at: "desc" },
  });

  const items = rows.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    content: n.content,
    sentiment: n.sentiment,
    importance_score: n.importance_score,
    source_url: n.source_url,
    date_range_start: n.date_range_start,
    date_range_end: n.date_range_end,
    created_at: n.created_at,
    sources: n.sources,
  }));

  const csv = buildNewsCsvContent(items);
  const filename = `news-export-${projectId.slice(-8)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
