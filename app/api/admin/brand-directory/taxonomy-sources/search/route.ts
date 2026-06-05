import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  searchSourcesWithOpenAI,
  type TaxonomyNode,
  type PlatformSearchConfig,
} from "@/lib/brand-directory/taxonomy-source-search-service";
import { z } from "zod";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  taxonomyNode: z.object({
    type: z.enum(["category", "subcategory", "sub_subcategory"]),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    sub_subcategory: z.string().optional(),
    id: z.string().optional(),
  }),
  platforms: z
    .array(
      z.object({
        platform: z.string(),
        count: z.number().int().positive(),
        linkType: z.enum(["INFLUENCER", "REDDIT", "OTHER_SOURCE"]),
        sourceCategory: z.enum(["NEWS_OUTLET", "BLOG", "PODCAST"]).optional(),
      })
    )
    .min(1),
  brandName: z.string().optional(),
  brandKeywords: z.array(z.string()).optional(),
  /** Project "Keywords to monitor" — preferred over brandKeywords for influencer relevance. */
  projectKeywords: z.array(z.string()).optional(),
});

/**
 * POST /api/admin/brand-directory/taxonomy-sources/search
 * Initiate a search for sources using OpenAI
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const body = await request.json();
    const validated = searchSchema.parse(body);

    // Generate unique search ID
    const searchId = randomUUID();

    // Start search in background (don't await)
    // The function sets progress immediately before any async operations
    console.log(
      `[search POST] Starting search ${searchId} with ${validated.platforms.length} platforms`
    );

    // Call the function and ensure it starts
    const searchPromise = searchSourcesWithOpenAI(
      searchId,
      validated.taxonomyNode as TaxonomyNode,
      validated.platforms as PlatformSearchConfig[],
      validated.brandName,
      validated.brandKeywords,
      validated.projectKeywords
    );

    // Verify progress was set immediately (synchronously)
    const { getSearchProgress } = await import(
      "@/lib/brand-directory/taxonomy-source-search-service"
    );
    const initialProgress = getSearchProgress(searchId);
    if (initialProgress) {
      console.log(
        `[search POST] Progress set successfully for ${searchId}. Status: ${initialProgress.status}`
      );
    } else {
      console.error(
        `[search POST] WARNING: Progress NOT set for ${searchId} immediately after function call!`
      );
    }

    searchPromise.catch((error) => {
      console.error(`[search POST] Error in background search ${searchId}:`, error);
    });

    return NextResponse.json({
      searchId,
      status: "started",
    });
  } catch (error) {
    console.error("Error initiating search:", error);
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
