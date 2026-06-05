import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDefaultSourcesForBrand } from "@/lib/projects/project-brand-sources-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/brand-directory/brands/[id]/default-sources
 * Get default sources for a brand (from brand directory + taxonomy)
 * This route doesn't require a project and can be used for new projects
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: brandId } = await params;

    // Get default sources
    const sources = await getDefaultSourcesForBrand(brandId);

    return NextResponse.json({
      sources,
    });
  } catch (error) {
    console.error("Error fetching default brand sources:", error);
    return NextResponse.json({ error: "Failed to fetch default brand sources" }, { status: 500 });
  }
}
