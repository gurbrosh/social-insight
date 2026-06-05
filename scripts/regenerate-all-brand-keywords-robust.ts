#!/usr/bin/env tsx

/**
 * Regenerate keywords for ALL brands in the database (robust version with error handling)
 *
 * Usage:
 *   npx tsx scripts/regenerate-all-brand-keywords-robust.ts
 *   npx tsx scripts/regenerate-all-brand-keywords-robust.ts --skip-existing  # Skip brands that already have keywords
 */

import { prisma } from "../lib/prisma";
import {
  generateKeywordsForBrand,
  type DiscoveredBrand,
} from "../lib/brand-directory/openai-service";
import { generateId } from "../lib/utils/ulid";

interface BrandWithKeywords {
  id: string;
  company_name: string;
  brand_name: string;
  brand_stage: string;
  business_taxonomy_id: string;
  website_url: string | null;
  careers_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  discord_url: string | null;
  keywords: Array<{ id: string; keyword: string }>;
}

async function getAllBrands(skipExisting: boolean = false): Promise<BrandWithKeywords[]> {
  const where: any = {
    deleted_at: null,
  };

  const brands = await (prisma as any).brand.findMany({
    where,
    include: {
      keywords: {
        where: { deleted_at: null },
      },
    },
    orderBy: { brand_name: "asc" },
  });

  // Filter out brands that already have keywords if skipExisting is true
  if (skipExisting) {
    return brands.filter((brand: BrandWithKeywords) => brand.keywords.length === 0);
  }

  return brands;
}

async function createBrandKeywords(brandId: string, keywords: string[]) {
  const created: string[] = [];
  const restored: string[] = [];

  for (const keyword of keywords) {
    const keywordTrimmed = keyword.trim().toLowerCase();

    // Check if keyword already exists (including soft-deleted)
    const existing = await (prisma as any).brandKeyword.findFirst({
      where: {
        brand_id: brandId,
        keyword: keywordTrimmed,
      },
    });

    if (existing) {
      if (existing.deleted_at) {
        // Restore soft-deleted keyword
        await (prisma as any).brandKeyword.update({
          where: { id: existing.id },
          data: {
            deleted_at: null,
            updated_at: new Date(),
          },
        });
        restored.push(keyword);
      }
      // If already exists and active, skip
    } else {
      // Create new keyword
      try {
        await (prisma as any).brandKeyword.create({
          data: {
            id: generateId(),
            brand_id: brandId,
            keyword: keywordTrimmed,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        created.push(keyword);
      } catch (error: any) {
        // Handle race condition
        if (error.code === "P2002") {
          // Try to restore if it exists
          const existingKeyword = await (prisma as any).brandKeyword.findFirst({
            where: {
              brand_id: brandId,
              keyword: keywordTrimmed,
            },
          });
          if (existingKeyword && existingKeyword.deleted_at) {
            await (prisma as any).brandKeyword.update({
              where: { id: existingKeyword.id },
              data: {
                deleted_at: null,
                updated_at: new Date(),
              },
            });
            restored.push(keyword);
          }
        } else {
          throw error;
        }
      }
    }
  }

  return { created, restored };
}

async function regenerateKeywordsForBrand(
  brand: BrandWithKeywords,
  taxonomyId: string
): Promise<{ success: boolean; keywordsGenerated: number; keywords: string[]; error?: string }> {
  try {
    // Convert brand to DiscoveredBrand format
    const discoveredBrand: DiscoveredBrand = {
      company_name: brand.company_name,
      brand_name: brand.brand_name,
      brand_stage: brand.brand_stage as "ESTABLISHED" | "EMERGING" | "SMALL",
      website_url: brand.website_url || undefined,
      careers_url: brand.careers_url || undefined,
      linkedin_url: brand.linkedin_url || undefined,
      facebook_url: brand.facebook_url || undefined,
      x_url: brand.x_url || undefined,
      instagram_url: brand.instagram_url || undefined,
      tiktok_url: brand.tiktok_url || undefined,
      youtube_url: brand.youtube_url || undefined,
      discord_url: brand.discord_url || undefined,
    };

    // Generate new keywords using improved prompt
    if (!taxonomyId) {
      throw new Error("Taxonomy ID is required");
    }

    const newKeywords = await generateKeywordsForBrand(
      discoveredBrand,
      taxonomyId,
      7 // Minimum 7 keywords for better coverage
    );

    if (newKeywords.length === 0) {
      return {
        success: false,
        keywordsGenerated: 0,
        keywords: [],
        error: "No keywords generated",
      };
    }

    // Create new keywords
    await createBrandKeywords(brand.id, newKeywords);

    return {
      success: true,
      keywordsGenerated: newKeywords.length,
      keywords: newKeywords,
    };
  } catch (error: any) {
    return {
      success: false,
      keywordsGenerated: 0,
      keywords: [],
      error: error.message || String(error),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldProceed = args.includes("--yes");
  const skipExisting = args.includes("--skip-existing");

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  try {
    // Get all brands
    console.log("\n📦 Fetching all brands...");
    const brands = await getAllBrands(skipExisting);

    if (brands.length === 0) {
      console.log("ℹ️  No brands found to process");
      process.exit(0);
    }

    console.log(`   Found ${brands.length} brand(s) to process\n`);

    // Confirm before proceeding
    if (!shouldProceed) {
      console.log(`⚠️  This will regenerate keywords for ${brands.length} brands`);
      console.log(`   Estimated cost: ~$${(brands.length * 0.01).toFixed(2)}`);
      console.log(`   Estimated time: ~${Math.ceil((brands.length * 0.5) / 60)} minutes\n`);
      console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Regenerate keywords for each brand
    console.log("🔄 Starting keyword regeneration...\n");

    let successCount = 0;
    let errorCount = 0;
    let totalKeywordsGenerated = 0;
    const errors: Array<{ brand: string; error: string }> = [];
    const startTime = Date.now();

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const rate = i > 0 ? (i / elapsed).toFixed(2) : "0";
      const remaining = i > 0 ? Math.ceil((brands.length - i) / parseFloat(rate)) : 0;

      console.log(
        `[${i + 1}/${brands.length}] (${Math.floor(elapsed / 60)}m ${elapsed % 60}s, ~${remaining}s remaining) Processing: ${brand.brand_name}`
      );

      try {
        const result = await regenerateKeywordsForBrand(brand, brand.business_taxonomy_id);

        if (result.success) {
          console.log(`   ✅ Generated ${result.keywordsGenerated} keywords`);
          successCount++;
          totalKeywordsGenerated += result.keywordsGenerated;
        } else {
          console.log(`   ❌ Failed: ${result.error}`);
          errorCount++;
          errors.push({ brand: brand.brand_name, error: result.error || "Unknown error" });
        }
      } catch (error: any) {
        console.log(`   ❌ Exception: ${error.message || String(error)}`);
        errorCount++;
        errors.push({ brand: brand.brand_name, error: error.message || String(error) });
      }

      // Small delay to avoid rate limiting (reduced to 300ms for faster processing)
      if (i < brands.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // Save progress every 50 brands
      if ((i + 1) % 50 === 0) {
        console.log(
          `\n📊 Progress checkpoint: ${i + 1}/${brands.length} processed (${successCount} success, ${errorCount} errors)\n`
        );
      }
    }

    // Summary
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log(`   Total brands: ${brands.length}`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total keywords generated: ${totalKeywordsGenerated}`);
    console.log(`   ⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    if (errors.length > 0 && errors.length <= 20) {
      console.log("\n❌ Errors:");
      errors.forEach((e) => {
        console.log(`   - ${e.brand}: ${e.error}`);
      });
    } else if (errors.length > 20) {
      console.log(`\n❌ ${errors.length} errors occurred (too many to display)`);
    }
    console.log("=".repeat(60) + "\n");

    if (errorCount > 0 && errorCount < brands.length) {
      console.log(
        "⚠️  Some brands failed. You can run again with --skip-existing to retry only failed brands."
      );
    }
  } catch (error: any) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
