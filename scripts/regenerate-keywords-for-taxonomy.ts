#!/usr/bin/env tsx

/**
 * Regenerate keywords for all brands under a specific taxonomy node
 *
 * Usage:
 *   npx tsx scripts/regenerate-keywords-for-taxonomy.ts "Applied AI (Copilots/Agents)"
 *
 * Or with taxonomy ID:
 *   npx tsx scripts/regenerate-keywords-for-taxonomy.ts --taxonomy-id "01XXXXX..."
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

async function findTaxonomyByName(searchTerm: string) {
  const allTaxonomies = await (prisma as any).businessTaxonomy.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
  });

  // Filter in memory for case-insensitive matching (SQLite doesn't support mode: "insensitive")
  const searchLower = searchTerm.toLowerCase();
  const matching = allTaxonomies.filter((tax: any) => {
    return (
      tax.category.toLowerCase().includes(searchLower) ||
      tax.subcategory.toLowerCase().includes(searchLower) ||
      tax.sub_subcategory.toLowerCase().includes(searchLower) ||
      `${tax.category} > ${tax.subcategory} > ${tax.sub_subcategory}`
        .toLowerCase()
        .includes(searchLower)
    );
  });

  return matching;
}

async function getBrandsByTaxonomy(taxonomyId: string): Promise<BrandWithKeywords[]> {
  const brands = await (prisma as any).brand.findMany({
    where: {
      business_taxonomy_id: taxonomyId,
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
): Promise<{ success: boolean; keywordsGenerated: number; error?: string }> {
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
    const newKeywords = await generateKeywordsForBrand(
      discoveredBrand,
      taxonomyId,
      4 // Minimum 4 keywords
    );

    if (newKeywords.length === 0) {
      return {
        success: false,
        keywordsGenerated: 0,
        error: "No keywords generated",
      };
    }

    // Soft delete old keywords
    await softDeleteBrandKeywords(brand.id);

    // Create new keywords
    await createBrandKeywords(brand.id, newKeywords);

    return {
      success: true,
      keywordsGenerated: newKeywords.length,
    };
  } catch (error: any) {
    return {
      success: false,
      keywordsGenerated: 0,
      error: error.message || String(error),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  let taxonomyId: string | undefined;
  let searchTerm: string | undefined;

  // Parse arguments
  if (args.includes("--taxonomy-id")) {
    const index = args.indexOf("--taxonomy-id");
    taxonomyId = args[index + 1];
  } else if (args.length > 0) {
    searchTerm = args[0];
  } else {
    console.error("❌ Error: Please provide a taxonomy search term or --taxonomy-id");
    console.error(
      '   Usage: npx tsx scripts/regenerate-keywords-for-taxonomy.ts "Applied AI (Copilots/Agents)"'
    );
    console.error(
      '   Or:    npx tsx scripts/regenerate-keywords-for-taxonomy.ts --taxonomy-id "01XXXXX..."'
    );
    process.exit(1);
  }

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  try {
    // Find taxonomy
    let taxonomy: any;
    if (taxonomyId) {
      taxonomy = await (prisma as any).businessTaxonomy.findUnique({
        where: { id: taxonomyId, deleted_at: null },
        select: {
          id: true,
          category: true,
          subcategory: true,
          sub_subcategory: true,
        },
      });

      if (!taxonomy) {
        console.error(`❌ Error: Taxonomy with ID "${taxonomyId}" not found`);
        process.exit(1);
      }
    } else if (searchTerm) {
      const taxonomies = await findTaxonomyByName(searchTerm);

      if (taxonomies.length === 0) {
        console.error(`❌ Error: No taxonomy found matching "${searchTerm}"`);
        process.exit(1);
      }

      if (taxonomies.length > 1) {
        console.log(`⚠️  Found ${taxonomies.length} matching taxonomies:`);
        taxonomies.forEach((t: any, i: number) => {
          console.log(
            `   ${i + 1}. ${t.category} > ${t.subcategory} > ${t.sub_subcategory} (ID: ${t.id})`
          );
        });
        console.error(
          "\n❌ Error: Multiple taxonomies found. Please use --taxonomy-id with a specific ID"
        );
        process.exit(1);
      }

      taxonomy = taxonomies[0];
      taxonomyId = taxonomy.id;
    }

    if (!taxonomyId) {
      console.error("❌ Error: Could not determine taxonomy ID");
      process.exit(1);
    }

    console.log(`\n🎯 Target Taxonomy:`);
    console.log(`   ${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`);
    console.log(`   ID: ${taxonomyId}\n`);

    // Get all brands under this taxonomy
    console.log("📦 Fetching brands...");
    const brands = await getBrandsByTaxonomy(taxonomyId);

    if (brands.length === 0) {
      console.log("ℹ️  No brands found under this taxonomy");
      process.exit(0);
    }

    console.log(`   Found ${brands.length} brand(s)\n`);

    // Show current keywords
    console.log("📋 Current keywords summary:");
    brands.forEach((brand: BrandWithKeywords) => {
      const keywordList = brand.keywords.map((k) => k.keyword).join(", ");
      console.log(`   ${brand.brand_name}: ${keywordList || "(no keywords)"}`);
    });

    // Confirm before proceeding
    console.log(`\n⚠️  WARNING: This will:`);
    console.log(`   1. Delete all existing keywords for ${brands.length} brand(s)`);
    console.log(`   2. Regenerate keywords using the improved OpenAI prompt`);
    console.log(
      `   3. This will cost approximately $${(brands.length * 0.01).toFixed(2)} in OpenAI API calls\n`
    );

    // For non-interactive mode, add --yes flag support
    const shouldProceed = args.includes("--yes");

    if (!shouldProceed) {
      console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log("\n🔄 Starting keyword regeneration...\n");

    // Process each brand
    let successCount = 0;
    let errorCount = 0;
    let totalKeywordsGenerated = 0;

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      console.log(`[${i + 1}/${brands.length}] Processing: ${brand.brand_name}`);

      const result = await regenerateKeywordsForBrand(brand, taxonomyId);

      if (result.success) {
        console.log(`   ✅ Generated ${result.keywordsGenerated} new keywords`);
        successCount++;
        totalKeywordsGenerated += result.keywordsGenerated;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        errorCount++;
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
