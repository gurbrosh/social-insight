import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { searchBrandWithOpenAI } from "@/lib/brand-directory/openai-service";
import { checkForDuplicateBrand } from "@/lib/brand-directory/brand-service";
import { validateBrandData } from "@/lib/brand-directory/brand-validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  brand_name: z.string().min(1, "Brand name is required"),
  company_name: z.string().optional(),
  website_url: z.string().url().optional().or(z.literal("")),
});

/**
 * POST /api/admin/brand-directory/brands/search
 * Search for a brand using OpenAI
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

    const body = await request.json();
    const validated = searchSchema.parse(body);

    // Check for duplicate first (before OpenAI call to save costs)
    const duplicate = await checkForDuplicateBrand(
      validated.company_name || validated.brand_name,
      validated.brand_name
    );

    if (duplicate) {
      return NextResponse.json({
        brand: null,
        duplicate: {
          id: duplicate.id,
          company_name: duplicate.company_name,
          brand_name: duplicate.brand_name,
          website_url: duplicate.website_url,
          businessTaxonomy: duplicate.businessTaxonomy,
        },
      });
    }

    // Search with OpenAI
    const result = await searchBrandWithOpenAI(
      validated.brand_name,
      validated.company_name,
      validated.website_url || undefined
    );

    if (!result) {
      return NextResponse.json({
        brand: null,
        duplicate: null,
      });
    }

    // Check for duplicate again after OpenAI search (in case OpenAI returned a brand that exists)
    if (result.brand) {
      const duplicateAfterSearch = await checkForDuplicateBrand(
        result.brand.company_name,
        result.brand.brand_name
      );

      if (duplicateAfterSearch) {
        return NextResponse.json({
          brand: null,
          duplicate: {
            id: duplicateAfterSearch.id,
            company_name: duplicateAfterSearch.company_name,
            brand_name: duplicateAfterSearch.brand_name,
            website_url: duplicateAfterSearch.website_url,
            businessTaxonomy: duplicateAfterSearch.businessTaxonomy,
          },
        });
      }

      // Validate brand data for consistency (warnings only, don't block)
      const validation = validateBrandData({
        brand_name: result.brand.brand_name,
        company_name: result.brand.company_name,
        website_url: result.brand.website_url,
        blog_news_url: result.brand.blog_news_url,
        linkedin_url: result.brand.linkedin_url,
        facebook_url: result.brand.facebook_url,
        x_url: result.brand.x_url,
        instagram_url: result.brand.instagram_url,
        tiktok_url: result.brand.tiktok_url,
        youtube_url: result.brand.youtube_url,
        discord_url: result.brand.discord_url,
      });

      // Include validation warnings/errors in response
      return NextResponse.json({
        ...result,
        validation: {
          warnings: validation.warnings,
          errors: validation.errors,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error searching for brand:", error);
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
