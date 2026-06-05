/**
 * Discover brands for Financial Services and FinTech Software categories
 *
 * This script discovers brands for:
 * 1. All Financial Services sub-subcategories
 * 2. Technology → Software - Vertical → FinTech Software (and its sub-subcategories)
 *
 * It includes duplicate prevention and processes 10 brands per stage (ESTABLISHED, EMERGING, SMALL)
 *
 * SAFETY FEATURES:
 * - Requires confirmation before running
 * - Can limit number of taxonomies to process (set MAX_TAXONOMIES)
 * - Can limit brands per stage (set BRANDS_PER_STAGE)
 * - Stops early if too many errors occur
 */

import { prisma } from "../lib/prisma";
import { discoverBrandsForTaxonomy } from "../lib/brand-directory/openai-service";
import { generateKeywordsForBrand } from "../lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "../lib/brand-directory/brand-service";
import * as readline from "readline";

// SAFETY SETTINGS - Adjust these to limit costs
const BRANDS_PER_STAGE = 10;
const MAX_TAXONOMIES = process.env.MAX_TAXONOMIES
  ? parseInt(process.env.MAX_TAXONOMIES)
  : undefined; // Limit number of taxonomies to process
const MAX_ERRORS_BEFORE_STOP = 10; // Stop if we hit this many errors
const STAGES: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = ["ESTABLISHED", "EMERGING", "SMALL"];

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

async function discoverBrandsForFinTech() {
  console.log("🚀 Brand Discovery Script for Financial Services and FinTech Software\n");
  console.log("⚠️  WARNING: This script will make OpenAI API calls which cost money!\n");

  // Calculate estimated cost
  const estimatedTaxonomies = MAX_TAXONOMIES || 33;
  const estimatedCalls = estimatedTaxonomies * 3 * 2; // taxonomies × stages × (discovery + keywords)
  console.log(
    `📊 Estimated API calls: ~${estimatedCalls} (${estimatedTaxonomies} taxonomies × 3 stages × 2 calls each)`
  );
  console.log(
    `💰 Estimated cost: ~$${(estimatedCalls * 0.01).toFixed(2)} - $${(estimatedCalls * 0.05).toFixed(2)} (rough estimate)\n`
  );

  if (MAX_TAXONOMIES) {
    console.log(
      `⚠️  Processing limited to ${MAX_TAXONOMIES} taxonomies (set MAX_TAXONOMIES env var to change)\n`
    );
  }

  const confirmed = await askConfirmation("Do you want to proceed?");
  if (!confirmed) {
    console.log("❌ Script cancelled by user");
    process.exit(0);
  }

  console.log("\n🚀 Starting automated brand discovery...\n");

  // Step 1: Get all Financial Services sub-subcategories
  console.log("📋 Fetching Financial Services taxonomies...");
  const financialServicesTaxonomies = await prisma.businessTaxonomy.findMany({
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

  console.log(
    `✅ Found ${financialServicesTaxonomies.length} Financial Services sub-subcategories\n`
  );

  // Step 2: Get all FinTech Software sub-subcategories
  console.log("📋 Fetching FinTech Software taxonomies...");
  const fintechSoftwareTaxonomies = await prisma.businessTaxonomy.findMany({
    where: {
      category: "Technology",
      subcategory: "Software - Vertical",
      sub_subcategory: {
        in: [
          "FinTech Software",
          "Lending Infrastructure & Servicing Platforms",
          "Lending Origination Platforms",
          "Underwriting & Credit Decisioning",
        ],
      },
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: {
      sub_subcategory: "asc",
    },
  });

  console.log(`✅ Found ${fintechSoftwareTaxonomies.length} FinTech Software sub-subcategories\n`);

  // Combine all taxonomies
  const allTaxonomies = [...financialServicesTaxonomies, ...fintechSoftwareTaxonomies];

  if (allTaxonomies.length === 0) {
    console.log("⚠️  No taxonomies found");
    return;
  }

  // Limit taxonomies if MAX_TAXONOMIES is set
  const taxonomiesToProcess = MAX_TAXONOMIES
    ? allTaxonomies.slice(0, MAX_TAXONOMIES)
    : allTaxonomies;

  console.log(
    `📊 Total taxonomies to process: ${taxonomiesToProcess.length}${MAX_TAXONOMIES ? ` (limited from ${allTaxonomies.length})` : ""}\n`
  );

  let totalDiscovered = 0;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let consecutiveErrors = 0; // Track consecutive errors to stop early
  const errors: Array<{ taxonomy: string; stage: string; error: string }> = [];

  // Step 3: Process each taxonomy
  for (let i = 0; i < taxonomiesToProcess.length; i++) {
    // Stop if too many consecutive errors
    if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
      console.log(
        `\n⚠️  Stopping early: ${consecutiveErrors} consecutive errors (max: ${MAX_ERRORS_BEFORE_STOP})`
      );
      break;
    }

    const taxonomy = taxonomiesToProcess[i];
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${i + 1}/${allTaxonomies.length}] Processing: ${taxonomy.sub_subcategory}`);
    console.log(
      `Category: ${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`
    );
    console.log(`${"=".repeat(80)}\n`);

    // Process each stage
    for (const stage of STAGES) {
      console.log(`\n  📦 Discovering ${BRANDS_PER_STAGE} ${stage} brands...`);

      try {
        // Discover brands for this taxonomy and stage
        const discoveredBrands = await discoverBrandsForTaxonomy(
          taxonomy.id,
          BRANDS_PER_STAGE,
          stage
        );

        console.log(`  ✅ Discovered ${discoveredBrands.length} brands`);

        if (discoveredBrands.length === 0) {
          console.log(`  ⚠️  No brands discovered for ${stage} stage`);
          continue;
        }

        totalDiscovered += discoveredBrands.length;

        // Save each brand with keywords
        for (const brand of discoveredBrands) {
          try {
            // Generate keywords for this brand
            const keywords = await generateKeywordsForBrand(brand, taxonomy.id, 4);

            // Save brand with keywords (will throw if duplicate)
            const savedBrand = await createBrandWithKeywords(
              {
                ...brand,
                business_taxonomy_id: taxonomy.id,
              },
              keywords
            );

            totalSaved++;
            consecutiveErrors = 0; // Reset error counter on success
            console.log(`    ✅ Saved: ${savedBrand.brand_name}`);
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";

            // If it's a duplicate error, log it but don't treat it as a critical error
            if (errorMessage.includes("already exists")) {
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

              // Stop if too many errors
              if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
                console.log(`\n⚠️  Stopping early: ${consecutiveErrors} consecutive errors`);
                break;
              }
            }
          }
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

        // Stop if too many consecutive errors
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
          console.log(`\n⚠️  Stopping early: ${consecutiveErrors} consecutive errors`);
          break;
        }
      }
    }
  }

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 DISCOVERY SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(
    `Total taxonomies processed: ${taxonomiesToProcess.length}${MAX_TAXONOMIES ? ` (of ${allTaxonomies.length} available)` : ""}`
  );
  console.log(`Total brands discovered: ${totalDiscovered}`);
  console.log(`Total brands saved: ${totalSaved}`);
  console.log(`Total duplicates skipped: ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(
    `Success rate: ${totalDiscovered > 0 ? ((totalSaved / totalDiscovered) * 100).toFixed(1) : 0}%`
  );

  if (totalErrors > 0 && totalSaved === 0) {
    console.log(`\n⚠️  WARNING: ${totalErrors} errors occurred and NO brands were saved!`);
    console.log(
      `   This suggests a systematic issue. Please check the errors below before running again.`
    );
  }

  if (errors.length > 0) {
    console.log(`\n❌ Errors encountered (showing first 20):`);
    errors.slice(0, 20).forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.taxonomy} (${err.stage}): ${err.error}`);
    });
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more errors`);
    }
  }

  console.log(`\n✅ Brand discovery complete!`);
  await prisma.$disconnect();
}

discoverBrandsForFinTech().catch((error) => {
  console.error("❌ Error in brand discovery:", error);
  process.exit(1);
});
