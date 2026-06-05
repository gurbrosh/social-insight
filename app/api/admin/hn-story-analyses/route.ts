import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET — row count for HnStoryAnalysis (admin).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const activeCount = await prisma.hnStoryAnalysis.count();
    return NextResponse.json({ activeCount });
  } catch (e) {
    console.error("[hn-story-analyses GET]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/**
 * DELETE — permanently delete all HnStoryAnalysis rows (admin).
 * Clears Post.hn_story_analysis_id first so FK constraints are satisfied.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.post.updateMany({
        where: { hn_story_analysis_id: { not: null } },
        data: { hn_story_analysis_id: null },
      });
      const result = await tx.hnStoryAnalysis.deleteMany({});
      return result.count;
    });

    return NextResponse.json({ success: true, deleted });
  } catch (e) {
    console.error("[hn-story-analyses DELETE]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
