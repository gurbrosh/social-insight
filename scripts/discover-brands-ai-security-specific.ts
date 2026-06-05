/**
 * Discover brands for specific AI Security sub-subcategories
 *
 * This script discovers brands for:
 * - Agent & Tool-Use Security
 * - AI & LLM Security
 * - AI App Runtime Protection
 *
 * It processes 10 brands per stage (ESTABLISHED, EMERGING, SMALL) = 30 brands per sub-subcategory
 */

import { prisma } from "../lib/prisma";
import { discoverBrandsForTaxonomy } from "../lib/brand-directory/openai-service";
import { generateKeywordsForBrand } from "../lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "../lib/brand-directory/brand-service";

// Configuration
const BRANDS_PER_STAGE = 10;
const MAX_ERRORS_BEFORE_STOP = 5;
const STAGES: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = ["ESTABLISHED", "EMERGING", "SMALL"];

// Taxonomy IDs for the three sub-subcategories
const TAXONOMY_IDS = [
  "01KE8BZGG4FX4BAN9EKHTYP228", // Agent & Tool-Use Security
  "01KE8BZGFTV9C0577G1A3RXS47", // AI & LLM Security
  "01KE8BZGG69PRWJX55Q73FRAVT", // AI App Runtime Protection
];

async function discoverBrandsForAISecurity() {
  console.log("🚀 Brand Discovery Script for AI Security Sub-subcategories\n");
  console.log("⚠️  WARNING: This script will make OpenAI API calls which cost money!\n");

  // Fetch taxonomy details
  const taxonomies = await prisma.businessTaxonomy.findMany({
    where: {
      id: { in: TAXONOMY_IDS },
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: { sub_subcategory: "asc" },
  });

  console.log(`✅ Found ${taxonomies.length} taxonomies to process:\n`);
  taxonomies.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.sub_subcategory}`);
  });

  // Calculate estimated cost
  const totalTaxonomies = taxonomies.length;
  const brandsPerTaxonomy = BRANDS_PER_STAGE * STAGES.length; // 10 × 3 = 30
  const totalBrands = totalTaxonomies * brandsPerTaxonomy;
  const estimatedCalls = totalTaxonomies * STAGES.length * 2; // taxonomies × stages × (discovery + keywords)
  console.log(`\n📊 Configuration:`);
  console.log(`   - Sub-subcategories: ${totalTaxonomies}`);
  console.log(`   - Brands per stage: ${BRANDS_PER_STAGE}`);
  console.log(`   - Stages: ${STAGES.join(", ")}`);
  console.log(
    `   - Total brands to discover: ${totalBrands} (${brandsPerTaxonomy} per sub-subcategory)`
  );
  console.log(
    `   - Estimated API calls: ~${estimatedCalls} (${totalTaxonomies} taxonomies × ${STAGES.length} stages × 2 calls each)`
  );
  console.log(
    `   - Estimated cost: ~$${(estimatedCalls * 0.01).toFixed(2)} - $${(estimatedCalls * 0.05).toFixed(2)} (rough estimate)\n`
  );

  console.log("\n🚀 Starting automated brand discovery...\n");

  let totalDiscovered = 0;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let consecutiveErrors = 0;
  const errors: Array<{ taxonomy: string; stage: string; error: string }> = [];

  // Process each taxonomy
  for (let i = 0; i < taxonomies.length; i++) {
    const taxonomy = taxonomies[i];

    console.log(`${"=".repeat(80)}`);
    console.log(`[${i + 1}/${taxonomies.length}] Processing: ${taxonomy.sub_subcategory}`);
    console.log(
      `Category: ${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`
    );
    console.log(`${"=".repeat(80)}\n`);

    // Process each stage
    for (const stage of STAGES) {
      console.log(`\n  📦 Discovering ${BRANDS_PER_STAGE} ${stage} brands...`);

      try {
        const discoveredBrands = await discoverBrandsForTaxonomy(
          taxonomy.id,
          BRANDS_PER_STAGE,
          stage
        );

        console.log(`  ✅ Discovered ${discoveredBrands.length} brands`);
        totalDiscovered += discoveredBrands.length;

        // Process each discovered brand
        for (let j = 0; j < discoveredBrands.length; j++) {
          const brand = discoveredBrands[j];
          console.log(
            `\n    [${j + 1}/${discoveredBrands.length}] Processing: ${brand.company_name} (${brand.brand_name})`
          );

          try {
            // Generate keywords
            console.log(`    🔍 Generating keywords...`);
            const keywords = await generateKeywordsForBrand(brand, taxonomy.id, 4);
            console.log(
              `    ✅ Generated ${keywords.length} keywords: ${keywords.slice(0, 3).join(", ")}${keywords.length > 3 ? "..." : ""}`
            );

            // Save brand with keywords
            console.log(`    💾 Saving brand to database...`);
            const savedBrand = await createBrandWithKeywords(
              { ...brand, business_taxonomy_id: taxonomy.id },
              keywords
            );

            totalSaved++;
            consecutiveErrors = 0; // Reset error counter on success
            console.log(
              `    ✅ SUCCESS: Saved "${savedBrand.brand_name}" with ID: ${savedBrand.id}`
            );
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";

            if (errorMessage.includes("already exists") || errorMessage.includes("duplicate")) {
              totalSkipped++;
              console.log(`    ⏭️  Skipped duplicate: ${brand.company_name} (${brand.brand_name})`);
            } else {
              totalErrors++;
              consecutiveErrors++;
              console.error(`    ❌ Error saving brand ${brand.company_name}:`, errorMessage);
              errors.push({
                taxonomy: `${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`,
                stage,
                error: errorMessage,
              });

              if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
                console.log(`\n⚠️  Stopping early: ${consecutiveErrors} consecutive errors`);
                break;
              }
            }
          }
        }

        // Break out of stage loop if we hit too many errors
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
          console.log(`\n⚠️  Stopping early due to ${consecutiveErrors} consecutive errors`);
          break;
        }
      } catch (error: any) {
        totalErrors++;
        consecutiveErrors++;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`  ❌ Error discovering brands for ${stage} stage:`, errorMessage);
        errors.push({
          taxonomy: `${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`,
          stage,
          error: errorMessage,
        });

        if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
          console.log(`\n⚠️  Stopping early: ${consecutiveErrors} consecutive errors`);
          break;
        }
      }
    }

    // Break out of taxonomy loop if we hit too many errors
    if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
      console.log(`\n⚠️  Stopping early due to ${consecutiveErrors} consecutive errors`);
      break;
    }

    console.log(`\n✅ Completed: ${taxonomy.sub_subcategory}\n`);
  }

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 DISCOVERY SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total brands discovered: ${totalDiscovered}`);
  console.log(`Total brands saved: ${totalSaved}`);
  console.log(`Total duplicates skipped: ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(
    `Success rate: ${totalDiscovered > 0 ? ((totalSaved / totalDiscovered) * 100).toFixed(1) : 0}%`
  );

  if (errors.length > 0) {
    console.log(`\n❌ Errors encountered:`);
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.taxonomy} (${err.stage}): ${err.error}`);
    });
  }

  console.log(`\n✅ Brand discovery complete!`);
  await prisma.$disconnect();
}

discoverBrandsForAISecurity().catch((error) => {
  console.error("❌ Error in brand discovery:", error);
  process.exit(1);
});
