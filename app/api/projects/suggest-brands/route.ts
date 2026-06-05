import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { suggestBrands } from "@/lib/brand-directory/brand-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const suggestBrandsSchema = z.object({
  selectedBrandIds: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
  // BrandsSection sends 100 when exactly one brand is selected (same category list)
  limit: z.number().int().min(1).max(100).optional().default(20),
});

/**
 * POST /api/projects/suggest-brands
 * Suggest brands based on selected brands and/or keywords
 * Works for both new projects (no projectId) and existing projects
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = suggestBrandsSchema.parse(body);

    // Validate that at least one of selectedBrandIds or keywords is provided
    if (validated.selectedBrandIds.length === 0 && validated.keywords.length === 0) {
      return NextResponse.json(
        { error: "Either selectedBrandIds or keywords must be provided" },
        { status: 400 }
      );
    }

    const suggestions = await suggestBrands(
      validated.selectedBrandIds.length > 0 ? validated.selectedBrandIds : undefined,
      validated.keywords.length > 0 ? validated.keywords : undefined,
      validated.limit
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error suggesting brands:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
