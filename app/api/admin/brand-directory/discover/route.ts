import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  discoverBrandsForTaxonomy,
  generateKeywordsForBrand,
} from "@/lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "@/lib/brand-directory/brand-service";
import { ensureValidBlogNewsUrl } from "@/lib/brand-directory/blog-news-url";
import { z } from "zod";

export const dynamic = "force-dynamic";

const discoverSchema = z.object({
  taxonomyId: z.string().min(1),
  count: z.number().int().min(1).max(50).default(10),
  brandStage: z.enum(["ESTABLISHED", "EMERGING", "SMALL"]).optional(),
  saveToDatabase: z.boolean().default(true),
});

/**
 * POST /api/admin/brand-directory/discover
 * Discover brands using OpenAI and optionally save to database
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = discoverSchema.parse(body);

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // If no brandStage is specified (all stages), divide count by 3 and discover for each stage
    const stages: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = validatedData.brandStage
      ? [validatedData.brandStage]
      : ["ESTABLISHED", "EMERGING", "SMALL"];

    const brandsPerStage = validatedData.brandStage
      ? validatedData.count
      : Math.floor(validatedData.count / 3);

    // Discover brands for each stage with retry logic for duplicates
    const allDiscoveredBrands = [];
    const allExcludeBrands: Array<{ company_name: string; brand_name: string }> = [];

    for (const stage of stages) {
      const stageDiscoveredBrands: any[] = [];
      const stageExcludeBrands: Array<{ company_name: string; brand_name: string }> = [];
      let attempts = 0;
      const maxAttempts = 3; // Maximum retry attempts per stage
      const targetCount = brandsPerStage;

      while (stageDiscoveredBrands.length < targetCount && attempts < maxAttempts) {
        attempts++;
        const neededCount = targetCount - stageDiscoveredBrands.length;

        // Discover brands, excluding already found duplicates
        // Request exactly what we need - OpenAI should respect the exclude list
        const discovered = await discoverBrandsForTaxonomy(
          validatedData.taxonomyId,
          neededCount,
          stage,
          stageExcludeBrands.length > 0 ? stageExcludeBrands : undefined
        );

        // Try to save discovered brands and track duplicates
        const newBrands = [];
        const newDuplicates = [];

        for (const brand of discovered) {
          // Check if this brand is already in our exclude list
          const isDuplicate = stageExcludeBrands.some(
            (ex) =>
              ex.company_name.toLowerCase().trim() === brand.company_name.toLowerCase().trim() ||
              ex.brand_name.toLowerCase().trim() === brand.brand_name.toLowerCase().trim()
          );

          if (!isDuplicate) {
            // Try to save (will check for duplicates in database)
            try {
              if (validatedData.saveToDatabase) {
                const blogNewsUrl =
                  brand.blog_news_url != null
                    ? await ensureValidBlogNewsUrl(
                        brand.blog_news_url,
                        brand.brand_name,
                        brand.website_url ?? undefined
                      )
                    : undefined;
                const brandData = {
                  ...brand,
                  business_taxonomy_id: validatedData.taxonomyId,
                  blog_news_url: blogNewsUrl ?? brand.blog_news_url,
                };
                const keywords = await generateKeywordsForBrand(brand, validatedData.taxonomyId, 4);

                const savedBrand = await createBrandWithKeywords(brandData, keywords);

                newBrands.push(savedBrand);
              } else {
                // Just add to new brands list if not saving
                newBrands.push(brand);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Unknown error";
              if (errorMessage.includes("already exists") || errorMessage.includes("duplicate")) {
                newDuplicates.push({
                  company_name: brand.company_name,
                  brand_name: brand.brand_name,
                });
              }
            }
          } else {
            newDuplicates.push({
              company_name: brand.company_name,
              brand_name: brand.brand_name,
            });
          }
        }

        stageDiscoveredBrands.push(...newBrands);
        stageExcludeBrands.push(...newDuplicates);
        allExcludeBrands.push(...newDuplicates);

        // If we got duplicates, log and continue
        if (newDuplicates.length > 0 && attempts < maxAttempts) {
          console.log(
            `[Brand Discovery] Stage ${stage}: Found ${newDuplicates.length} duplicates, retrying to get ${neededCount - newBrands.length} more brands...`
          );
        }
      }

      allDiscoveredBrands.push(...stageDiscoveredBrands);

      if (stageDiscoveredBrands.length < targetCount) {
        console.log(
          `[Brand Discovery] Stage ${stage}: Only found ${stageDiscoveredBrands.length} out of ${targetCount} requested brands after ${attempts} attempts.`
        );
      }
    }

    // Count duplicates from exclude list
    const totalDuplicates = allExcludeBrands.length;
    const savedBrands = validatedData.saveToDatabase ? allDiscoveredBrands : [];
    const errors: Array<{ brand: string; error: string }> = [];

    if (!validatedData.saveToDatabase) {
      // Return discovered brands without saving
      return NextResponse.json({
        brands: allDiscoveredBrands,
        discovered: allDiscoveredBrands.length,
        saved: 0,
        duplicates: totalDuplicates,
        duplicateDetails: totalDuplicates > 0 ? allExcludeBrands : undefined,
        errors: errors.length > 0 ? errors : undefined,
        stages: stages.length,
        brandsPerStage: brandsPerStage,
        message: "Brands discovered but not saved to database",
      });
    }

    return NextResponse.json({
      brands: savedBrands,
      discovered: allDiscoveredBrands.length,
      saved: savedBrands.length,
      duplicates: totalDuplicates,
      duplicateDetails: totalDuplicates > 0 ? allExcludeBrands : undefined,
      errors: errors.length > 0 ? errors : undefined,
      stages: stages.length,
      brandsPerStage: brandsPerStage,
    });
  } catch (error) {
    console.error("Error discovering brands:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
