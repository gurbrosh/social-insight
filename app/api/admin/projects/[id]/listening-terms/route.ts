import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET — keywords and brand names for a project (admin). Used by HN custom task test UI.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const project = await prisma.project.findFirst({
      where: { id, deleted_at: null },
      include: {
        keywords: { where: { deleted_at: null }, select: { keyword: true } },
        brands: { where: { deleted_at: null }, select: { brand_name: true } },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const keywords: string[] = [];
    const brandNames: string[] = [];
    for (const k of project.keywords) {
      const t = k.keyword.trim();
      if (t) keywords.push(t);
    }
    for (const b of project.brands) {
      const t = b.brand_name.trim();
      if (t) brandNames.push(t);
    }
    const allTerms = [...new Set([...keywords, ...brandNames])];

    return NextResponse.json({
      keywords,
      brandNames,
      allTerms,
    });
  } catch (err) {
    console.error("listening-terms:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
