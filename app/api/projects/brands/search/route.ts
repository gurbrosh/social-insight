import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findBrandsByTaxonomy, BrandFilters } from "@/lib/brand-directory/brand-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/brands/search
 * Search brands (non-admin endpoint for project forms)
 * Brands are shared across all projects, so all authenticated users can search
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filters: BrandFilters = {
      taxonomyId: searchParams.get("taxonomyId") || undefined,
      brandStage: (searchParams.get("brandStage") as any) || undefined,
      search: searchParams.get("search") || undefined,
      limit: parseInt(searchParams.get("limit") || "20", 10),
      offset: parseInt(searchParams.get("offset") || "0", 10),
    };

    const result = await findBrandsByTaxonomy(filters);

    return NextResponse.json({
      brands: result.brands,
      total: result.total,
    });
  } catch (error) {
    console.error("Error searching brands:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
