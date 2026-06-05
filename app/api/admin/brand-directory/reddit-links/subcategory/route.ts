import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getRedditLinksForSubcategory } from "@/lib/brand-directory/reddit-links-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-directory/reddit-links/subcategory?category=...&subcategory=...
 * Get all Reddit links for a subcategory (including inherited category-level links)
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
    const subcategory = searchParams.get("subcategory");

    if (!category || !subcategory) {
      return NextResponse.json(
        { error: "Category and subcategory parameters are required" },
        { status: 400 }
      );
    }

    const links = await getRedditLinksForSubcategory(category, subcategory);

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error fetching Reddit links for subcategory:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
