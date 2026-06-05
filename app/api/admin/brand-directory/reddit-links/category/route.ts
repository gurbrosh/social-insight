import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getRedditLinksForCategory } from "@/lib/brand-directory/reddit-links-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-directory/reddit-links/category?category=...
 * Get all Reddit links for a category
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");

    if (!category) {
      return NextResponse.json({ error: "Category parameter is required" }, { status: 400 });
    }

    const links = await getRedditLinksForCategory(category);

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error fetching Reddit links for category:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
