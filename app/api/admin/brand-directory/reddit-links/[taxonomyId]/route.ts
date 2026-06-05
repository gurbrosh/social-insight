import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getRedditLinksForTaxonomy } from "@/lib/brand-directory/reddit-links-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-directory/reddit-links/[taxonomyId]
 * Get all Reddit links for a taxonomy node (including inherited links)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taxonomyId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const resolvedParams = await params;
    const links = await getRedditLinksForTaxonomy(resolvedParams.taxonomyId);

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error fetching Reddit links:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
