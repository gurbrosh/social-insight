/**
 * Update FinTech taxonomy tree based on ChatGPT recommendations:
 *
 * 1. Financial Services → Lending & Credit → Add "Lending Marketplaces & Aggregators"
 * 2. Financial Services → Payments & Money Movement → Rename "BNPL" to "BNPL & Embedded Credit"
 * 3. Technology → Software - Vertical → FinTech Software → Add sub-subcategories:
 *    - Lending Infrastructure & Servicing Platforms
 *    - Lending Origination Platforms
 *    - Underwriting & Credit Decisioning
 */

import { prisma } from "../lib/prisma";
import { generateId } from "../lib/utils/ulid";

async function updateFinTechTaxonomy() {
  console.log("🔍 Updating FinTech taxonomy tree...\n");

  // 1. Add "Lending Marketplaces & Aggregators" under Financial Services → Lending & Credit
  console.log("1️⃣ Adding 'Lending Marketplaces & Aggregators'...");
  const lendingCreditTaxonomy = await prisma.businessTaxonomy.findFirst({
    where: {
      category: "Financial Services",
      subcategory: "Lending & Credit",
      sub_subcategory: "Consumer Lending",
      deleted_at: null,
    },
  });

  if (lendingCreditTaxonomy) {
    // Check if it already exists
    const existing = await prisma.businessTaxonomy.findFirst({
      where: {
        category: "Financial Services",
        subcategory: "Lending & Credit",
        sub_subcategory: "Lending Marketplaces & Aggregators",
        deleted_at: null,
      },
    });

    if (!existing) {
      await prisma.businessTaxonomy.create({
        data: {
          id: generateId(),
          category: "Financial Services",
          subcategory: "Lending & Credit",
          sub_subcategory: "Lending Marketplaces & Aggregators",
        },
      });
      console.log("   ✅ Added 'Lending Marketplaces & Aggregators'");
    } else {
      console.log("   ⏭️  'Lending Marketplaces & Aggregators' already exists");
    }
  } else {
    console.log("   ⚠️  Could not find 'Financial Services → Lending & Credit' taxonomy");
  }

  // 2. Rename "BNPL" to "BNPL & Embedded Credit"
  console.log("\n2️⃣ Renaming 'BNPL' to 'BNPL & Embedded Credit'...");
  const bnplTaxonomy = await prisma.businessTaxonomy.findFirst({
    where: {
      category: "Financial Services",
      subcategory: "Payments & Money Movement",
      sub_subcategory: "BNPL",
      deleted_at: null,
    },
  });

  if (bnplTaxonomy) {
    // Check if the new name already exists
    const existing = await prisma.businessTaxonomy.findFirst({
      where: {
        category: "Financial Services",
        subcategory: "Payments & Money Movement",
        sub_subcategory: "BNPL & Embedded Credit",
        deleted_at: null,
      },
    });

    if (!existing) {
      // Update the existing entry
      await prisma.businessTaxonomy.update({
        where: { id: bnplTaxonomy.id },
        data: {
          sub_subcategory: "BNPL & Embedded Credit",
        },
      });
      console.log("   ✅ Renamed 'BNPL' to 'BNPL & Embedded Credit'");
    } else {
      console.log("   ⏭️  'BNPL & Embedded Credit' already exists, skipping rename");
    }
  } else {
    console.log("   ⚠️  Could not find 'BNPL' taxonomy");
  }

  // 3. Add FinTech Software sub-subcategories under Technology → Software - Vertical
  console.log("\n3️⃣ Adding FinTech Software sub-subcategories...");

  // First, check if "FinTech Software" exists as a single entry
  const fintechSoftwareTaxonomy = await prisma.businessTaxonomy.findFirst({
    where: {
      category: "Technology",
      subcategory: "Software - Vertical",
      sub_subcategory: "FinTech Software",
      deleted_at: null,
    },
  });

  if (fintechSoftwareTaxonomy) {
    // Check how many brands are using this taxonomy
    const brandCount = await prisma.brand.count({
      where: {
        business_taxonomy_id: fintechSoftwareTaxonomy.id,
        deleted_at: null,
      },
    });

    console.log(`   📊 Found ${brandCount} brands currently using 'FinTech Software'`);

    // Add new sub-subcategories
    const newSubCategories = [
      "Lending Infrastructure & Servicing Platforms",
      "Lending Origination Platforms",
      "Underwriting & Credit Decisioning",
    ];

    for (const subSubcategory of newSubCategories) {
      const existing = await prisma.businessTaxonomy.findFirst({
        where: {
          category: "Technology",
          subcategory: "Software - Vertical",
          sub_subcategory: subSubcategory,
          deleted_at: null,
        },
      });

      if (!existing) {
        await prisma.businessTaxonomy.create({
          data: {
            id: generateId(),
            category: "Technology",
            subcategory: "Software - Vertical",
            sub_subcategory: subSubcategory,
          },
        });
        console.log(`   ✅ Added '${subSubcategory}'`);
      } else {
        console.log(`   ⏭️  '${subSubcategory}' already exists`);
      }
    }

    // Note: We keep the original "FinTech Software" entry for backward compatibility
    // Brands can be manually moved to the more specific subcategories
    console.log("\n   ℹ️  Original 'FinTech Software' entry kept for backward compatibility");
    console.log("   ℹ️  Brands can be manually moved to more specific subcategories");
  } else {
    console.log(
      "   ⚠️  Could not find 'Technology → Software - Vertical → FinTech Software' taxonomy"
    );
  }

  console.log("\n✅ Taxonomy update complete!");
  await prisma.$disconnect();
}

updateFinTechTaxonomy().catch((error) => {
  console.error("❌ Error updating taxonomy:", error);
  process.exit(1);
});
