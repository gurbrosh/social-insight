#!/usr/bin/env tsx

/**
 * Regenerate keywords for brands with fewer than 7 keywords
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
  keywords: Array<{ id: string; keyword: string }>;
}

async function getBrandsWithLowKeywordCount(minKeywords: number = 7): Promise<BrandWithKeywords[]> {
  const allBrands = await (prisma as any).brand.findMany({
    where: { deleted_at: null },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
    },
  });

  return allBrands.filter((brand: BrandWithKeywords) => brand.keywords.length < minKeywords);
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

    const existing = await (prisma as any).brandKeyword.findFirst({
      where: {
        brand_id: brandId,
        keyword: keywordTrimmed,
      },
    });

    if (existing) {
      if (existing.deleted_at) {
        await (prisma as any).brandKeyword.update({
          where: { id: existing.id },
          data: {
            deleted_at: null,
            updated_at: new Date(),
          },
        });
      }
    } else {
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
        if (error.code !== "P2002") {
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
    const discoveredBrand: DiscoveredBrand = {
      company_name: brand.company_name,
      brand_name: brand.brand_name,
      brand_stage: brand.brand_stage as "ESTABLISHED" | "EMERGING" | "SMALL",
      website_url: brand.website_url || undefined,
    };

    if (!taxonomyId) {
      throw new Error("Taxonomy ID is required");
    }

    const newKeywords = await generateKeywordsForBrand(discoveredBrand, taxonomyId, 7);

    if (newKeywords.length === 0) {
      return {
        success: false,
        keywordsGenerated: 0,
        keywords: [],
        error: "No keywords generated",
      };
    }

    await softDeleteBrandKeywords(brand.id);
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
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  try {
    console.log("\n📦 Finding brands with fewer than 7 keywords...");
    const brands = await getBrandsWithLowKeywordCount(7);

    if (brands.length === 0) {
      console.log("✅ All brands have 7+ keywords!");
      process.exit(0);
    }

    console.log(`   Found ${brands.length} brand(s) with fewer than 7 keywords\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      console.log(
        `[${i + 1}/${brands.length}] Processing: ${brand.brand_name} (currently has ${brand.keywords.length} keywords)`
      );

      const result = await regenerateKeywordsForBrand(brand, brand.business_taxonomy_id);

      if (result.success) {
        console.log(`   ✅ Generated ${result.keywordsGenerated} keywords`);
        successCount++;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        errorCount++;
      }

      if (i < brands.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log("=".repeat(60) + "\n");
  } catch (error: any) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
