import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { suggestKeywords } from "@/lib/brand-directory/keyword-suggestions-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const suggestKeywordsSchema = z.object({
  keywords: z.array(z.string()).optional().default([]),
  excludeKeywords: z.array(z.string()).optional().default([]),
  brandIds: z.array(z.string()).optional().default([]),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

/**
 * POST /api/projects/suggest-keywords
 * Suggest keywords based on user-provided keywords
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = suggestKeywordsSchema.parse(body);

    // Validate that at least one of keywords or brandIds is provided
    if (validated.keywords.length === 0 && validated.brandIds.length === 0) {
      return NextResponse.json(
        { error: "Either keywords or brandIds must be provided" },
        { status: 400 }
      );
    }

    const suggestions = await suggestKeywords(
      validated.keywords,
      validated.excludeKeywords,
      validated.brandIds.length > 0 ? validated.brandIds : undefined,
      validated.limit
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error suggesting keywords:", error);
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
