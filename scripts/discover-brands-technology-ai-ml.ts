import { prisma } from "../lib/prisma";
import { discoverBrandsForTaxonomy } from "../lib/brand-directory/openai-service";
import { generateKeywordsForBrand } from "../lib/brand-directory/openai-service";
import { createBrandWithKeywords } from "../lib/brand-directory/brand-service";

const BRANDS_PER_STAGE = 10;
const STAGES: Array<"ESTABLISHED" | "EMERGING" | "SMALL"> = ["ESTABLISHED", "EMERGING", "SMALL"];

async function discoverBrandsForTechnologyAIML() {
  console.log("🚀 Starting automated brand discovery for Technology > AI/ML & Data Science\n");

  // Step 1: Find Technology category
  const technologyCategory = await prisma.businessTaxonomy.findFirst({
    where: {
      category: "Technology",
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
    },
  });

  if (!technologyCategory) {
    throw new Error("Technology category not found");
  }

  console.log(`✅ Found category: ${technologyCategory.category}`);

  // Step 2: Find AI/ML & Data Science subcategory
  const aiMlSubcategory = await prisma.businessTaxonomy.findFirst({
    where: {
      category: "Technology",
      subcategory: "AI/ML & Data Science",
      deleted_at: null,
    },
    select: {
      id: true,
      subcategory: true,
    },
  });

  if (!aiMlSubcategory) {
    throw new Error("AI/ML & Data Science subcategory not found");
  }

  console.log(`✅ Found subcategory: ${aiMlSubcategory.subcategory}\n`);

  // Step 3: Get all sub-subcategories under AI/ML & Data Science
  const subSubcategories = await prisma.businessTaxonomy.findMany({
    where: {
      category: "Technology",
      subcategory: "AI/ML & Data Science",
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

  console.log(`📋 Found ${subSubcategories.length} sub-subcategories to process\n`);

  let totalDiscovered = 0;
  let totalSaved = 0;
  let totalErrors = 0;
  const errors: Array<{ taxonomy: string; stage: string; error: string }> = [];

  // Step 4: Process each sub-subcategory (stop after 3rd one - Data Orchestration)
  const maxSubSubcategories = Math.min(3, subSubcategories.length);
  console.log(`⚠️  Limiting to first ${maxSubSubcategories} sub-subcategories for testing\n`);

  for (let i = 0; i < maxSubSubcategories; i++) {
    const taxonomy = subSubcategories[i];
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${i + 1}/${subSubcategories.length}] Processing: ${taxonomy.sub_subcategory}`);
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
          console.log(`  ⚠️  No brands discovered for ${stage} stage, skipping...`);
          continue;
        }

        totalDiscovered += discoveredBrands.length;

        // Save each brand with keywords
        for (let j = 0; j < discoveredBrands.length; j++) {
          const brand = discoveredBrands[j];
          try {
            console.log(
              `    💾 Saving brand ${j + 1}/${discoveredBrands.length}: ${brand.brand_name}...`
            );

            // Generate keywords for the brand
            const keywords = await generateKeywordsForBrand(brand, taxonomy.id, 4);

            // Create brand with keywords
            await createBrandWithKeywords(
              {
                ...brand,
                business_taxonomy_id: taxonomy.id,
              },
              keywords
            );

            console.log(`    ✅ Saved: ${brand.brand_name} (${keywords.length} keywords)`);
            totalSaved++;
          } catch (brandError: any) {
            console.error(`    ❌ Error saving brand ${brand.brand_name}:`, brandError.message);
            totalErrors++;
            errors.push({
              taxonomy: taxonomy.sub_subcategory,
              stage,
              error: `Brand ${brand.brand_name}: ${brandError.message}`,
            });
          }

          // Add a small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (stageError: any) {
        console.error(`  ❌ Error discovering ${stage} brands:`, stageError.message);
        totalErrors++;
        errors.push({
          taxonomy: taxonomy.sub_subcategory,
          stage,
          error: stageError.message,
        });
      }

      // Add a delay between stages to avoid rate limiting
      console.log(`  ⏳ Waiting 2 seconds before next stage...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Add a delay between sub-subcategories
    if (i < maxSubSubcategories - 1) {
      console.log(`\n  ⏳ Waiting 3 seconds before next sub-subcategory...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(
    `Total sub-subcategories processed: ${maxSubSubcategories} (out of ${subSubcategories.length} total)`
  );
  console.log(`Total brands discovered: ${totalDiscovered}`);
  console.log(`Total brands saved: ${totalSaved}`);
  console.log(`Total errors: ${totalErrors}`);

  if (errors.length > 0) {
    console.log(`\n❌ ERRORS:`);
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.taxonomy} (${err.stage}): ${err.error}`);
    });
  }

  console.log(`\n✅ Brand discovery automation completed!`);
}

discoverBrandsForTechnologyAIML()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("\n❌ Fatal error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
