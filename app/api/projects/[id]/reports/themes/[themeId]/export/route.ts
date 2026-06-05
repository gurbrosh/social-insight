import { NextResponse } from "next/server";
import { getStoredThemesAnalysisForUser } from "@/app/actions/themes-analysis";
import { verifyReportExportToken } from "@/lib/email-report-export-token";
import { buildThemesCsvContent, dedupeThemeMatchesForExport } from "@/lib/themes-export-csv";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; themeId: string }> }
) {
  const { id: projectId, themeId: routeThemeId } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const payload = verifyReportExportToken(token);
  if (!payload || payload.kind !== "themes") {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  if (payload.projectId !== projectId || payload.themeId !== routeThemeId) {
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

  const result = await getStoredThemesAnalysisForUser(projectId, payload.userId, {
    themeId: routeThemeId,
    postedAfter: windowStart,
    minRelevance: 50,
    limit: 10000,
    dateRange: "all",
  });

  if (!result.success || !result.matches) {
    return NextResponse.json(
      { error: result.error || "Failed to load theme matches" },
      { status: 500 }
    );
  }

  const csv = buildThemesCsvContent(dedupeThemeMatchesForExport(result.matches));
  const filename = `themes-export-${routeThemeId.slice(-8)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
