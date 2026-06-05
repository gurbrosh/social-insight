import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runBlogAnalysis } from "@/lib/blog-news-analysis-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json();
    const sourceUrls = Array.isArray(body.sourceUrls) ? body.sourceUrls : [];
    const noItemsBeforeDateRaw = body.noItemsBeforeDate;
    const articleUrls = Array.isArray(body.articleUrls) ? body.articleUrls : undefined;

    if (sourceUrls.length === 0 && (!articleUrls || articleUrls.length === 0)) {
      return NextResponse.json(
        { error: "Either sourceUrls or articleUrls must be provided" },
        { status: 400 }
      );
    }

    let noItemsBeforeDate: Date;
    try {
      noItemsBeforeDate =
        noItemsBeforeDateRaw != null ? new Date(noItemsBeforeDateRaw) : new Date(0);
      if (Number.isNaN(noItemsBeforeDate.getTime())) {
        noItemsBeforeDate = new Date(0);
      }
    } catch {
      noItemsBeforeDate = new Date(0);
    }

    const result = await runBlogAnalysis({
      projectId,
      sourceUrls,
      noItemsBeforeDate,
      articleUrls,
    });

    return NextResponse.json({
      runId: result.runId,
      status: result.status,
      itemsFound: result.itemsFound,
      itemsNew: result.itemsNew,
      ...(result.errorMessage && { errorMessage: result.errorMessage }),
    });
  } catch (err) {
    console.error("[blog-analysis/run]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
