/**
 * TEST SCRIPT - Discover brands for a SINGLE taxonomy subcategory
 *
 * This is a safe test script that processes only ONE subcategory at a time
 * to verify the discovery and saving process works correctly before running
 * on larger datasets.
 *
 * Usage:
 *   npm run discover-brands:test
 *   Or: TAXONOMY_ID="your-taxonomy-id" npm run discover-brands:test
 */

import { prisma } from "../lib/prisma";
import { discoverBrandsForTaxonomy } from "../lib/brand-directory/openai-service";
import { generateKeywordsForBrand } from "../lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "../lib/brand-directory/brand-service";
import * as readline from "readline";

const BRANDS_PER_STAGE = 2; // Small number for testing
const STAGES: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = ["ESTABLISHED"]; // Only one stage for testing

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

async function testBrandDiscovery() {
  console.log("🧪 TEST MODE: Brand Discovery Script\n");
  console.log("⚠️  This will test with a SINGLE taxonomy subcategory only\n");

  // Get a single taxonomy to test with
  const taxonomyId = process.env.TAXONOMY_ID;

  let taxonomy;

  if (taxonomyId) {
    // Use provided taxonomy ID
    taxonomy = await prisma.businessTaxonomy.findUnique({
      where: { id: taxonomyId, deleted_at: null },
      select: {
        id: true,
        category: true,
        subcategory: true,
        sub_subcategory: true,
      },
    });

    if (!taxonomy) {
      console.error(`❌ Taxonomy with ID "${taxonomyId}" not found`);
      process.exit(1);
    }
  } else {
    // Find a Financial Services or FinTech taxonomy to test with
    taxonomy = await prisma.businessTaxonomy.findFirst({
      where: {
        OR: [
          { category: "Financial Services", deleted_at: null },
          {
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
        ],
      },
      select: {
        id: true,
        category: true,
        subcategory: true,
        sub_subcategory: true,
      },
      orderBy: { sub_subcategory: "asc" },
    });

    if (!taxonomy) {
      console.error("❌ No suitable taxonomy found for testing");
      process.exit(1);
    }
  }

  console.log(`📋 Selected taxonomy for testing:`);
  console.log(`   Category: ${taxonomy.category}`);
  console.log(`   Subcategory: ${taxonomy.subcategory}`);
  console.log(`   Sub-subcategory: ${taxonomy.sub_subcategory}`);
  console.log(`   ID: ${taxonomy.id}\n`);

  // Calculate estimated cost
  const estimatedCalls = STAGES.length * 2; // stages × (discovery + keywords)
  console.log(`📊 Test configuration:`);
  console.log(`   Brands per stage: ${BRANDS_PER_STAGE}`);
  console.log(`   Stages: ${STAGES.join(", ")}`);
  console.log(`   Estimated API calls: ~${estimatedCalls}`);
  console.log(
    `   Estimated cost: ~$${(estimatedCalls * 0.01).toFixed(2)} - $${(estimatedCalls * 0.05).toFixed(2)}\n`
  );

  const confirmed = await askConfirmation("Do you want to proceed with this test?");
  if (!confirmed) {
    console.log("❌ Test cancelled by user");
    process.exit(0);
  }

  console.log("\n🚀 Starting test discovery...\n");

  let totalDiscovered = 0;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errors: Array<{ stage: string; error: string }> = [];

  // Process each stage
  for (const stage of STAGES) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📦 Testing ${stage} stage (${BRANDS_PER_STAGE} brands)...`);
    console.log(`${"=".repeat(80)}\n`);

    try {
      // Discover brands for this taxonomy and stage
      console.log("  🔍 Calling OpenAI to discover brands...");
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
      for (let i = 0; i < discoveredBrands.length; i++) {
        const brand = discoveredBrands[i];
        console.log(`\n  [${i + 1}/${discoveredBrands.length}] Processing: ${brand.brand_name}`);

        try {
          // Generate keywords for this brand
          console.log(`    🔍 Generating keywords...`);
          const keywords = await generateKeywordsForBrand(brand, taxonomy.id, 4);
          console.log(
            `    ✅ Generated ${keywords.length} keywords: ${keywords.slice(0, 3).join(", ")}${keywords.length > 3 ? "..." : ""}`
          );

          // Save brand with keywords (will throw if duplicate)
          console.log(`    💾 Saving brand to database...`);
          const savedBrand = await createBrandWithKeywords(
            {
              ...brand,
              business_taxonomy_id: taxonomy.id,
            },
            keywords
          );

          totalSaved++;
          console.log(`    ✅ SUCCESS: Saved "${savedBrand.brand_name}" with ID: ${savedBrand.id}`);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";

          // If it's a duplicate error, log it but don't treat it as a critical error
          if (errorMessage.includes("already exists")) {
            totalSkipped++;
            console.log(`    ⏭️  Skipped duplicate: ${brand.company_name} (${brand.brand_name})`);
          } else {
            totalErrors++;
            console.error(`    ❌ ERROR saving brand: ${errorMessage}`);
            errors.push({
              stage,
              error: errorMessage,
            });

            // Stop on first error in test mode
            console.log(`\n    ⚠️  Stopping test due to error (test mode)`);
            break;
          }
        }
      }
    } catch (error: any) {
      totalErrors++;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`  ❌ ERROR discovering brands: ${errorMessage}`);
      errors.push({
        stage,
        error: errorMessage,
      });

      // Stop on first error in test mode
      console.log(`\n  ⚠️  Stopping test due to error (test mode)`);
      break;
    }
  }

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 TEST RESULTS");
  console.log(`${"=".repeat(80)}`);
  console.log(
    `Taxonomy tested: ${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}`
  );
  console.log(`Total brands discovered: ${totalDiscovered}`);
  console.log(`Total brands saved: ${totalSaved}`);
  console.log(`Total duplicates skipped: ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(
    `Success rate: ${totalDiscovered > 0 ? ((totalSaved / totalDiscovered) * 100).toFixed(1) : 0}%`
  );

  if (totalSaved === 0 && totalErrors > 0) {
    console.log(`\n❌ TEST FAILED: No brands were saved!`);
    console.log(`   Please fix the errors before running on larger datasets.`);
  } else if (totalSaved > 0) {
    console.log(`\n✅ TEST PASSED: ${totalSaved} brand(s) saved successfully!`);
    console.log(`   You can now run the full script with confidence.`);
  }

  if (errors.length > 0) {
    console.log(`\n❌ Errors encountered:`);
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.stage}: ${err.error}`);
    });
  }

  console.log(`\n✅ Test complete!`);
  await prisma.$disconnect();
}

testBrandDiscovery().catch((error) => {
  console.error("❌ Error in test:", error);
  process.exit(1);
});
