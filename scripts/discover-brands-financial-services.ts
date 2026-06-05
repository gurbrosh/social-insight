/**
 * Discover brands for ALL Financial Services subcategories
 *
 * This script discovers brands for all 29 Financial Services sub-subcategories:
 * - Banking (4 sub-subcategories)
 * - Capital Markets & Investing (6 sub-subcategories)
 * - Fintech Infrastructure (3 sub-subcategories)
 * - Insurance (5 sub-subcategories)
 * - Lending & Credit (5 sub-subcategories)
 * - Payments & Money Movement (6 sub-subcategories)
 *
 * It processes 10 brands per stage (ESTABLISHED, EMERGING, SMALL) = 30 brands per sub-subcategory
 *
 * SAFETY FEATURES:
 * - Requires confirmation before running
 * - Shows cost estimation
 * - Stops early if too many errors occur
 * - Prevents duplicates across ALL brands (not just within taxonomy)
 * - Can skip already-completed taxonomies
 */

import { prisma } from "../lib/prisma";
import { discoverBrandsForTaxonomy } from "../lib/brand-directory/openai-service";
import { generateKeywordsForBrand } from "../lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "../lib/brand-directory/brand-service";
import * as readline from "readline";

// SAFETY SETTINGS
const BRANDS_PER_STAGE = 10;
const MAX_ERRORS_BEFORE_STOP = 5; // Stop if we hit this many consecutive errors
const STAGES: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = ["ESTABLISHED", "EMERGING", "SMALL"];
const SKIP_COMPLETED = true; // Skip taxonomies that already have enough brands

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

async function getBrandCountForTaxonomy(taxonomyId: string): Promise<number> {
  return await prisma.brand.count({
    where: {
      business_taxonomy_id: taxonomyId,
      deleted_at: null,
    },
  });
}

async function discoverBrandsForFinancialServices() {
  console.log("🚀 Brand Discovery Script for ALL Financial Services\n");
  console.log("⚠️  WARNING: This script will make OpenAI API calls which cost money!\n");

  // Step 1: Get all Financial Services sub-subcategories
  console.log("📋 Fetching Financial Services taxonomies...");
  const allTaxonomies = await prisma.businessTaxonomy.findMany({
    where: {
      category: "Financial Services",
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: [{ subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  console.log(`✅ Found ${allTaxonomies.length} Financial Services sub-subcategories\n`);

  // Group by subcategory for display
  const bySubcategory: Record<string, typeof allTaxonomies> = {};
  allTaxonomies.forEach((t) => {
    if (!bySubcategory[t.subcategory]) {
      bySubcategory[t.subcategory] = [];
    }
    bySubcategory[t.subcategory].push(t);
  });

  console.log("📊 Breakdown by subcategory:");
  Object.keys(bySubcategory).forEach((sub) => {
    console.log(`   ${sub}: ${bySubcategory[sub].length} sub-subcategories`);
  });
  console.log();

  // Check which taxonomies are already complete (if SKIP_COMPLETED is true)
  let taxonomiesToProcess = allTaxonomies;
  if (SKIP_COMPLETED) {
    console.log("🔍 Checking which taxonomies are already complete...");
    const taxonomiesWithCounts = await Promise.all(
      allTaxonomies.map(async (t) => {
        const count = await getBrandCountForTaxonomy(t.id);
        return { ...t, brandCount: count };
      })
    );

    const targetCount = BRANDS_PER_STAGE * STAGES.length; // 30 brands
    const incomplete = taxonomiesWithCounts.filter((t) => t.brandCount < targetCount);
    const complete = taxonomiesWithCounts.filter((t) => t.brandCount >= targetCount);

    console.log(`   ✅ Complete (≥${targetCount} brands): ${complete.length}`);
    console.log(`   ⏳ Incomplete (<${targetCount} brands): ${incomplete.length}`);

    if (complete.length > 0) {
      console.log("\n   Complete taxonomies:");
      complete.forEach((t) => {
        console.log(`     - ${t.subcategory} > ${t.sub_subcategory} (${t.brandCount} brands)`);
      });
    }

    taxonomiesToProcess = incomplete.map((t) => ({
      id: t.id,
      category: t.category,
      subcategory: t.subcategory,
      sub_subcategory: t.sub_subcategory,
    }));

    console.log(`\n📋 Will process ${taxonomiesToProcess.length} incomplete taxonomies\n`);
  }

  // Calculate estimated cost
  const totalTaxonomies = taxonomiesToProcess.length;
  const brandsPerTaxonomy = BRANDS_PER_STAGE * STAGES.length; // 10 × 3 = 30
  const totalBrands = totalTaxonomies * brandsPerTaxonomy;
  const estimatedCalls = totalTaxonomies * STAGES.length * 2; // taxonomies × stages × (discovery + keywords)
  console.log(`📊 Configuration:`);
  console.log(`   - Sub-subcategories to process: ${totalTaxonomies}`);
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

  const confirmed = await askConfirmation("Do you want to proceed?");
  if (!confirmed) {
    console.log("❌ Script cancelled by user");
    process.exit(0);
  }

  console.log("\n🚀 Starting automated brand discovery...\n");

  let totalDiscovered = 0;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let consecutiveErrors = 0;
  const errors: Array<{ taxonomy: string; stage: string; error: string }> = [];

  // Process each Financial Services sub-subcategory
  for (let i = 0; i < taxonomiesToProcess.length; i++) {
    const taxonomy = taxonomiesToProcess[i];

    console.log(`${"=".repeat(80)}`);
    console.log(`[${i + 1}/${taxonomiesToProcess.length}] Processing: ${taxonomy.sub_subcategory}`);
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

            // Save brand with keywords (duplicate check happens inside createBrandWithKeywords)
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

discoverBrandsForFinancialServices().catch((error) => {
  console.error("❌ Error in brand discovery:", error);
  process.exit(1);
});
