import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ingestWebsiteScraperOutput, type WebsiteScraperOutputItem } from "@/lib/blog-post-ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/[id]/blog-posts/ingest
 * Body: { items: WebsiteScraperOutputItem[] } — output of website-url-scraper (actor IerxEFOV9xkpwHXQp).
 * Maps to BlogPost: no duplicates (upsert by project_id + article_url), stores content, sets affiliation when from brand's page.
 */
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
    const items = Array.isArray(body?.items) ? (body.items as WebsiteScraperOutputItem[]) : [];
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Body must contain an array of items (scraper output)." },
        { status: 400 }
      );
    }

    const result = await ingestWebsiteScraperOutput(projectId, items);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[blog-posts/ingest]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
