import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  searchSourcesWithOpenAI,
  type PlatformSearchConfig,
} from "@/lib/brand-directory/taxonomy-source-search-service";
import { z } from "zod";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  brandId: z.string().min(1),
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
  projectKeywords: z.array(z.string()).optional(),
});

/**
 * POST /api/admin/brand-directory/brands/[id]/search-sources
 * Initiate a search for sources for a specific brand using OpenAI
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id: brandId } = await params;
    const body = await request.json();
    const validated = searchSchema.parse({ ...body, brandId });

    // Fetch brand with taxonomy and keywords
    const brand = await prisma.brand.findUnique({
      where: { id: brandId, deleted_at: null },
      include: {
        businessTaxonomy: {
          select: {
            category: true,
            subcategory: true,
            sub_subcategory: true,
          },
        },
        keywords: {
          where: { deleted_at: null },
          select: {
            keyword: true,
          },
        },
      },
    });

    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    // Construct taxonomy node from brand's taxonomy
    let taxonomyNode: {
      type: "category" | "subcategory" | "sub_subcategory";
      category?: string;
      subcategory?: string;
      sub_subcategory?: string;
    };

    if (brand.businessTaxonomy?.sub_subcategory) {
      taxonomyNode = {
        type: "sub_subcategory",
        category: brand.businessTaxonomy.category || undefined,
        subcategory: brand.businessTaxonomy.subcategory || undefined,
        sub_subcategory: brand.businessTaxonomy.sub_subcategory,
      };
    } else if (brand.businessTaxonomy?.subcategory) {
      taxonomyNode = {
        type: "subcategory",
        category: brand.businessTaxonomy.category || undefined,
        subcategory: brand.businessTaxonomy.subcategory,
      };
    } else if (brand.businessTaxonomy?.category) {
      taxonomyNode = {
        type: "category",
        category: brand.businessTaxonomy.category,
      };
    } else {
      return NextResponse.json({ error: "Brand has no taxonomy assigned" }, { status: 400 });
    }

    // Generate unique search ID
    const searchId = randomUUID();

    // Extract brand keywords (fallback when project keywords are empty)
    const brandKeywords = brand.keywords.map((kw) => kw.keyword);
    const projectKeywords = validated.projectKeywords ?? [];

    // Start search in background with brand name and keywords
    console.log(
      `[brand search POST] Starting search ${searchId} for brand ${brand.brand_name} with brand-directory keywords: ${brandKeywords.join(", ") || "none"}; project keywords: ${projectKeywords.join(", ") || "none"}; ${validated.platforms.length} platforms`
    );

    // Call the function and ensure it starts
    const searchPromise = searchSourcesWithOpenAI(
      searchId,
      taxonomyNode,
      validated.platforms as PlatformSearchConfig[],
      brand.brand_name,
      brandKeywords,
      projectKeywords
    );

    // Verify progress was set immediately
    const { getSearchProgress } = await import(
      "@/lib/brand-directory/taxonomy-source-search-service"
    );
    const initialProgress = getSearchProgress(searchId);
    if (initialProgress) {
      console.log(
        `[brand search POST] Progress set successfully for ${searchId}. Status: ${initialProgress.status}`
      );
    } else {
      console.error(
        `[brand search POST] WARNING: Progress NOT set for ${searchId} immediately after function call!`
      );
    }

    searchPromise.catch((error) => {
      console.error(`[brand search POST] Error in background search ${searchId}:`, error);
    });

    return NextResponse.json({
      searchId,
      status: "started",
    });
  } catch (error) {
    console.error("Error initiating brand search:", error);
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
