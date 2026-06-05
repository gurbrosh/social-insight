import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  getSearchProgress,
  getSearchProgressMapSize,
} from "@/lib/brand-directory/taxonomy-source-search-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-directory/taxonomy-sources/search/[searchId]
 * Get search progress and results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ searchId: string }> }
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
    const searchId = resolvedParams.searchId;

    const progress = getSearchProgress(searchId);

    if (!progress) {
      console.error(
        `[getSearchProgress] Search ${searchId} not found in map. Map size: ${getSearchProgressMapSize()}`
      );
      return NextResponse.json({ error: "Search not found", searchId }, { status: 404 });
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error("Error getting search progress:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
