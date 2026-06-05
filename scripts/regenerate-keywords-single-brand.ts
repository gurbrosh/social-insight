#!/usr/bin/env tsx

/**
 * Regenerate keywords for a single brand (for testing)
 *
 * Usage:
 *   npx tsx scripts/regenerate-keywords-single-brand.ts "Lovable"
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

async function getBrandByName(brandName: string): Promise<BrandWithKeywords | null> {
  const brand = await (prisma as any).brand.findFirst({
    where: {
      brand_name: { contains: brandName },
      deleted_at: null,
    },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
    },
  });

  return brand;
}

async function softDeleteBrandKeywords(brandId: string) {
  await (prisma as any).brandKeyword.updateMany({
    where: {
      brand_id: brandId,
      deleted_at: null,
    },
    data: {
      deleted_at: new Date(),
    },
  });
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
        console.log(`   ♻️  Restored keyword: "${keyword}"`);
      } else {
        // Already exists and active, skip
        console.log(`   ⚠️  Keyword "${keyword}" already exists, skipping`);
      }
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
        console.log(`   ✅ Created keyword: "${keyword}"`);
      } catch (error: any) {
        // Handle race condition where keyword was created between check and create
        if (error.code === "P2002") {
          console.log(`   ⚠️  Keyword "${keyword}" already exists, skipping`);
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

    console.log(`\n📋 Brand Details:`);
    console.log(`   Company: ${brand.company_name}`);
    console.log(`   Brand: ${brand.brand_name}`);
    console.log(`   Website: ${brand.website_url || "(none)"}`);
    console.log(
      `   Current keywords: ${brand.keywords.map((k: any) => k.keyword).join(", ") || "(none)"}`
    );

    // Generate new keywords using improved prompt
    if (!taxonomyId) {
      throw new Error("Taxonomy ID is required");
    }

    console.log(`\n🔄 Generating new keywords...`);
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

    console.log(`\n📝 Generated keywords: ${newKeywords.join(", ")}`);

    // Soft delete old keywords
    console.log(`\n🗑️  Soft-deleting old keywords...`);
    await softDeleteBrandKeywords(brand.id);

    // Create new keywords
    console.log(`\n💾 Saving new keywords...`);
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

  if (args.length === 0) {
    console.error("❌ Error: Please provide a brand name");
    console.error('   Usage: npx tsx scripts/regenerate-keywords-single-brand.ts "Lovable"');
    process.exit(1);
  }

  const brandName = args[0];

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  try {
    // Find brand
    console.log(`\n🔍 Searching for brand: "${brandName}"...`);
    const brand = await getBrandByName(brandName);

    if (!brand) {
      console.error(`❌ Error: Brand "${brandName}" not found`);
      process.exit(1);
    }

    console.log(`✅ Found brand: ${brand.brand_name} (${brand.company_name})`);

    // Regenerate keywords
    const result = await regenerateKeywordsForBrand(brand, brand.business_taxonomy_id);

    if (result.success) {
      console.log(`\n✅ Success! Generated ${result.keywordsGenerated} keywords:`);
      console.log(`   ${result.keywords.join(", ")}`);
    } else {
      console.error(`\n❌ Failed: ${result.error}`);
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
