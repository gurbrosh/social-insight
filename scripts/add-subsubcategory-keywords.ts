import { prisma } from "../lib/prisma";

async function addSubSubcategoryKeywords() {
  console.log("🔍 Finding all brands...");

  // Get all active brands with their taxonomies and keywords
  const brands = await prisma.brand.findMany({
    where: { deleted_at: null },
    include: {
      businessTaxonomy: {
        select: {
          sub_subcategory: true,
        },
      },
      keywords: {
        where: { deleted_at: null },
        select: {
          keyword: true,
        },
      },
    },
  });

  console.log(`📊 Found ${brands.length} brands to process`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const brand of brands) {
    if (!brand.businessTaxonomy) {
      console.log(`⚠️  Brand ${brand.id} (${brand.brand_name}) has no taxonomy, skipping`);
      skippedCount++;
      continue;
    }

    const subSubcategoryLower = brand.businessTaxonomy.sub_subcategory.toLowerCase().trim();

    // Check if sub-subcategory is already in keywords
    const existingKeywords = brand.keywords.map((k) => k.keyword.toLowerCase());
    if (existingKeywords.includes(subSubcategoryLower)) {
      console.log(`✓ Brand ${brand.brand_name}: sub-subcategory already exists in keywords`);
      skippedCount++;
      continue;
    }

    // Add the sub-subcategory as a keyword
    try {
      await prisma.brandKeyword.create({
        data: {
          brand_id: brand.id,
          keyword: subSubcategoryLower,
        },
      });
      console.log(`✅ Added "${subSubcategoryLower}" to ${brand.brand_name}`);
      updatedCount++;
    } catch (error: any) {
      if (error.code === "P2002") {
        // Unique constraint - keyword already exists (might be a race condition)
        console.log(`⚠️  Keyword "${subSubcategoryLower}" already exists for ${brand.brand_name}`);
        skippedCount++;
      } else {
        console.error(`❌ Error adding keyword to ${brand.brand_name}:`, error);
      }
    }
  }

  console.log("\n📈 Summary:");
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Total: ${brands.length}`);
}

addSubSubcategoryKeywords()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
