import { NextResponse } from "next/server";
import { getStoredNetworkAnalysisForUser } from "@/app/actions/network-analysis";
import { verifyReportExportToken } from "@/lib/email-report-export-token";
import { buildInfluencersCsvContent } from "@/lib/report-sections-export-csv";
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
  if (!payload || payload.kind !== "influencers") {
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

  const result = await getStoredNetworkAnalysisForUser(projectId, payload.userId, {
    latestPostAfter: windowStart,
    limit: 10000,
    dateRange: "all",
    minReactions: 10,
  });

  if (!result.success || !result.people) {
    return NextResponse.json(
      { error: result.error || "Failed to load influencers" },
      { status: 500 }
    );
  }

  const csv = buildInfluencersCsvContent(result.people);
  const filename = `influencers-export-${projectId.slice(-8)}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
