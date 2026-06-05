import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBlogHighlights } from "@/lib/blog-news-analysis-service";

export const dynamic = "force-dynamic";

/**
 * GET: Blog highlights for this project — high relevance (4 or 5), prioritized by mention_count.
 * No re-analysis; returns existing BlogNewsAnalysis rows that came from blogs.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit =
      limitParam != null ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 100)) : undefined;

    const highlights = await getBlogHighlights(projectId, { limit });

    return NextResponse.json({ highlights });
  } catch (err) {
    console.error("[blog-analysis/highlights]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
