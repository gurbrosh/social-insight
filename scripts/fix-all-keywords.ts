import { prisma } from "../lib/prisma";
import { normalizeKeywords, normalizeKeyword } from "../lib/brand-directory/keyword-utils";
import { generateId } from "../lib/utils/ulid";

/**
 * Script to fix all existing keywords according to social media best practices:
 * - Split compound phrases (e.g., "prompt & input security" → ["prompt security", "input security"])
 * - Remove generic words like "solutions"
 * - Make keywords more natural/human-like
 */

async function fixAllKeywords() {
  console.log("🔧 Starting keyword normalization for all brands...\n");

  // Get all brands with their keywords
  const brands = await prisma.brand.findMany({
    where: { deleted_at: null },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
      businessTaxonomy: {
        select: {
          sub_subcategory: true,
        },
      },
    },
  });

  console.log(`📊 Found ${brands.length} brands to process\n`);

  let totalKeywordsProcessed = 0;
  let totalKeywordsFixed = 0;
  let brandsUpdated = 0;
  let errors = 0;

  for (const brand of brands) {
    try {
      const originalKeywords = brand.keywords.map((k) => k.keyword);
      const subSubcategory = brand.businessTaxonomy?.sub_subcategory || "";

      // Normalize all keywords
      const normalizedKeywords = normalizeKeywords(originalKeywords);

      // Also normalize sub-subcategory if it exists
      if (subSubcategory) {
        const subSubcategoryKeywords = normalizeKeyword(subSubcategory);
        subSubcategoryKeywords.forEach((kw) => {
          if (!normalizedKeywords.includes(kw)) {
            normalizedKeywords.push(kw);
          }
        });
      }

      // Remove duplicates
      const finalKeywords = Array.from(new Set(normalizedKeywords));

      // Check if keywords changed
      const originalSet = new Set(originalKeywords.map((k) => k.toLowerCase()));
      const finalSet = new Set(finalKeywords.map((k) => k.toLowerCase()));

      const keywordsChanged =
        originalSet.size !== finalSet.size ||
        !Array.from(originalSet).every((k) => finalSet.has(k));

      if (keywordsChanged) {
        // Update keywords
        await prisma.$transaction(async (tx) => {
          // Soft-delete all existing keywords
          await tx.brandKeyword.updateMany({
            where: {
              brand_id: brand.id,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
              updated_at: new Date(),
            },
          });

          // Create new normalized keywords
          for (const keyword of finalKeywords) {
            // Check if keyword already exists (soft-deleted)
            const existing = await tx.brandKeyword.findFirst({
              where: {
                brand_id: brand.id,
                keyword: keyword.toLowerCase(),
              },
            });

            if (existing) {
              // Restore soft-deleted keyword
              await tx.brandKeyword.update({
                where: { id: existing.id },
                data: {
                  deleted_at: null,
                  updated_at: new Date(),
                },
              });
            } else {
              // Create new keyword
              await tx.brandKeyword.create({
                data: {
                  id: generateId(),
                  brand_id: brand.id,
                  keyword: keyword.toLowerCase(),
                },
              });
            }
          }
        });

        totalKeywordsFixed += Math.abs(originalKeywords.length - finalKeywords.length);
        brandsUpdated++;

        console.log(
          `✅ ${brand.brand_name}: ${originalKeywords.length} → ${finalKeywords.length} keywords`
        );
        if (originalKeywords.length !== finalKeywords.length) {
          console.log(`   Before: ${originalKeywords.join(", ")}`);
          console.log(`   After:  ${finalKeywords.join(", ")}`);
        }
      } else {
        console.log(`⏭️  ${brand.brand_name}: No changes needed`);
      }

      totalKeywordsProcessed += originalKeywords.length;
    } catch (error: any) {
      console.error(`❌ Error processing ${brand.brand_name}:`, error.message);
      errors++;
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total brands processed: ${brands.length}`);
  console.log(`Brands updated: ${brandsUpdated}`);
  console.log(`Total keywords processed: ${totalKeywordsProcessed}`);
  console.log(`Keywords fixed: ${totalKeywordsFixed}`);
  console.log(`Errors: ${errors}`);
  console.log(`\n✅ Keyword normalization completed!`);
}

fixAllKeywords()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("\n❌ Fatal error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
