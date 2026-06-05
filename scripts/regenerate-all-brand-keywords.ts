#!/usr/bin/env tsx

/**
 * Regenerate keywords for ALL brands in the database
 *
 * Usage:
 *   npx tsx scripts/regenerate-all-brand-keywords.ts
 *   npx tsx scripts/regenerate-all-brand-keywords.ts --yes  # Skip confirmation
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

async function getAllBrands(): Promise<BrandWithKeywords[]> {
  const brands = await (prisma as any).brand.findMany({
    where: {
      deleted_at: null,
    },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
    },
    orderBy: { brand_name: "asc" },
  });

  return brands;
}

async function softDeleteAllKeywords() {
  console.log("\n🗑️  Soft-deleting ALL existing keywords...");
  const result = await (prisma as any).brandKeyword.updateMany({
    where: {
      deleted_at: null,
    },
    data: {
      deleted_at: new Date(),
    },
  });
  console.log(`   ✅ Soft-deleted ${result.count} keywords\n`);
  return result.count;
}

async function createBrandKeywords(brandId: string, keywords: string[]) {
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
      }
      // If already exists and active, skip (shouldn't happen after soft-delete, but just in case)
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
          }
        } else {
          throw error;
        }
      }
    }
  }
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

    // Create new keywords (old ones already soft-deleted)
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

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  try {
    // Get all brands
    console.log("\n📦 Fetching all brands...");
    const brands = await getAllBrands();

    if (brands.length === 0) {
      console.log("ℹ️  No brands found in database");
      process.exit(0);
    }

    console.log(`   Found ${brands.length} brand(s)\n`);

    // Count total keywords
    const totalKeywords = brands.reduce((sum, brand) => sum + brand.keywords.length, 0);
    console.log(`📊 Current state:`);
    console.log(`   Total brands: ${brands.length}`);
    console.log(`   Total keywords: ${totalKeywords}`);

    // Confirm before proceeding
    console.log(`\n⚠️  WARNING: This will:`);
    console.log(`   1. Soft-delete ALL existing keywords (${totalKeywords} keywords)`);
    console.log(
      `   2. Regenerate keywords for ALL ${brands.length} brands using the improved OpenAI prompt`
    );
    console.log(
      `   3. This will cost approximately $${(brands.length * 0.01).toFixed(2)} in OpenAI API calls\n`
    );

    if (!shouldProceed) {
      console.log("Press Ctrl+C to cancel, or wait 10 seconds to continue...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    // Step 1: Soft-delete all keywords
    await softDeleteAllKeywords();

    // Step 2: Regenerate keywords for each brand
    console.log("🔄 Starting keyword regeneration for all brands...\n");

    let successCount = 0;
    let errorCount = 0;
    let totalKeywordsGenerated = 0;
    const errors: Array<{ brand: string; error: string }> = [];

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      console.log(`[${i + 1}/${brands.length}] Processing: ${brand.brand_name}`);

      const result = await regenerateKeywordsForBrand(brand, brand.business_taxonomy_id);

      if (result.success) {
        console.log(
          `   ✅ Generated ${result.keywordsGenerated} keywords: ${result.keywords.join(", ")}`
        );
        successCount++;
        totalKeywordsGenerated += result.keywordsGenerated;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        errorCount++;
        errors.push({ brand: brand.brand_name, error: result.error || "Unknown error" });
      }

      // Small delay to avoid rate limiting
      if (i < brands.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log(`   Total brands: ${brands.length}`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total keywords generated: ${totalKeywordsGenerated}`);
    if (errors.length > 0) {
      console.log("\n❌ Errors:");
      errors.forEach((e) => {
        console.log(`   - ${e.brand}: ${e.error}`);
      });
    }
    console.log("=".repeat(60) + "\n");

    if (errorCount > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
