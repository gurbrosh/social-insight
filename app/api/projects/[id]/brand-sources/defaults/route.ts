import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultSourcesForBrand } from "@/lib/projects/project-brand-sources-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[id]/brand-sources/defaults
 * Get default sources for a brand (from brand directory + taxonomy)
 * Query params: brandId (required)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brandId");

    if (!brandId) {
      return NextResponse.json({ error: "brandId query parameter is required" }, { status: 400 });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        deleted_at: null,
        user_id: session.user.id,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify brand exists and is linked to this project
    const projectBrand = await prisma.projectBrand.findFirst({
      where: {
        project_id: projectId,
        brand_id: brandId,
        deleted_at: null,
      },
    });

    if (!projectBrand) {
      return NextResponse.json({ error: "Brand not found in project" }, { status: 404 });
    }

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
