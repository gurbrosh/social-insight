import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  getProjectSourcesForBrand,
  saveProjectBrandSources,
  deleteProjectBrandSources,
  type SourceInput,
} from "@/lib/projects/project-brand-sources-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const saveSourcesSchema = z.object({
  brandId: z.string().min(1),
  sources: z.array(
    z.object({
      link_type: z.enum(["REDDIT", "DISCORD", "INFLUENCER", "OTHER_SOURCE"]),
      platform: z
        .enum(["TWITTER", "LINKEDIN", "FACEBOOK", "INSTAGRAM", "TIKTOK", "BLUESKY", "YOUTUBE"])
        .optional(),
      source_category: z.enum(["NEWS_OUTLET", "BLOG", "PODCAST"]).optional(),
      url: z.string().url(),
      channel_name: z.string().optional(),
    })
  ),
});

/**
 * GET /api/projects/[id]/brand-sources
 * Get all project-specific sources for a project
 * Query params: brandId (optional) - filter by brand
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

    // If brandId is provided, get sources for that brand only
    if (brandId) {
      const sources = await getProjectSourcesForBrand(projectId, brandId);
      return NextResponse.json({ sources });
    }

    // Get all project sources for all brands in the project
    const projectBrands = await prisma.projectBrand.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      select: {
        brand_id: true,
      },
    });

    const allSources = await Promise.all(
      projectBrands
        .map((pb) => pb.brand_id)
        .filter((id): id is string => id !== null)
        .map((brandId) => getProjectSourcesForBrand(projectId, brandId))
    );

    return NextResponse.json({
      sources: allSources.flat(),
    });
  } catch (error) {
    console.error("Error fetching project brand sources:", error);
    return NextResponse.json({ error: "Failed to fetch project brand sources" }, { status: 500 });
  }
}

/**
 * POST /api/projects/[id]/brand-sources
 * Save project-specific sources for a brand
 * Body: { brandId: string, sources: SourceInput[] }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const body = await request.json();

    // Validate request body
    const validated = saveSourcesSchema.parse(body);
    const { brandId, sources } = validated;

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

    // Save project sources
    const savedSources = await saveProjectBrandSources(projectId, brandId, sources);

    return NextResponse.json({
      success: true,
      sources: savedSources,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error saving project brand sources:", error);
    return NextResponse.json({ error: "Failed to save project brand sources" }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id]/brand-sources
 * Remove project-specific sources for a brand (revert to defaults)
 * Query params: brandId (required)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Delete project sources
    await deleteProjectBrandSources(projectId, brandId);

    return NextResponse.json({
      success: true,
      message: "Project sources deleted, reverting to defaults",
    });
  } catch (error) {
    console.error("Error deleting project brand sources:", error);
    return NextResponse.json({ error: "Failed to delete project brand sources" }, { status: 500 });
  }
}
