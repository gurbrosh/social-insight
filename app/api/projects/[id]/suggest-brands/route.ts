import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suggestBrandsForProject } from "@/lib/brand-directory/brand-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[id]/suggest-brands
 * Suggest brands for a project based on project configuration
 *
 * NOTE: Brands are shared across ALL projects. This endpoint searches the global
 * brand directory and returns suggestions based on the project's keywords.
 * All users can get brand suggestions for their own projects.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: resolvedParams.id,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get brand suggestions
    const suggestions = await suggestBrandsForProject(resolvedParams.id);

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error suggesting brands:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
