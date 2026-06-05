import { prisma } from "../lib/prisma";

/**
 * Script to add AI Application Builders taxonomy entry
 *
 * Based on ChatGPT analysis, AI application builders/generators (like Lovable, Bolt, AntiGravity)
 * should be distinguished from AI-augmented IDEs (like Cursor).
 *
 * Adds a new sub-subcategory under Technology → Software - Dev & DevOps:
 * - AI Application Builders (for tools that generate apps from natural language/intent)
 *
 * This distinguishes:
 * - IDEs & AI IDEs: Where developers write code (e.g., Cursor)
 * - AI Application Builders: Where apps are generated from prompts/intent (e.g., Lovable, Bolt, AntiGravity)
 */

const newTaxonomyEntry = {
  category: "Technology",
  subcategory: "Software - Dev & DevOps",
  sub_subcategory: "AI Application Builders",
};

async function main() {
  console.log("🔧 Adding AI Application Builders taxonomy entry...\n");

  try {
    // Check if entry already exists
    const existing = await prisma.businessTaxonomy.findFirst({
      where: {
        category: newTaxonomyEntry.category,
        subcategory: newTaxonomyEntry.subcategory,
        sub_subcategory: newTaxonomyEntry.sub_subcategory,
        deleted_at: null,
      },
    });

    if (existing) {
      console.log(
        `⏭️  Skipping (already exists): ${newTaxonomyEntry.category} → ${newTaxonomyEntry.subcategory} → ${newTaxonomyEntry.sub_subcategory}`
      );
      return;
    }

    // Create new entry
    await prisma.businessTaxonomy.create({
      data: {
        category: newTaxonomyEntry.category,
        subcategory: newTaxonomyEntry.subcategory,
        sub_subcategory: newTaxonomyEntry.sub_subcategory,
      },
    });

    console.log(
      `✅ Created: ${newTaxonomyEntry.category} → ${newTaxonomyEntry.subcategory} → ${newTaxonomyEntry.sub_subcategory}`
    );
  } catch (error: any) {
    if (error.code === "P2002") {
      // Unique constraint violation (duplicate)
      console.log(
        `⏭️  Skipping (duplicate): ${newTaxonomyEntry.category} → ${newTaxonomyEntry.subcategory} → ${newTaxonomyEntry.sub_subcategory}`
      );
    } else {
      console.error(`❌ Error creating taxonomy entry:`, error);
      throw error;
    }
  }

  // Verify the entry was created
  const devToolsEntries = await prisma.businessTaxonomy.findMany({
    where: {
      category: "Technology",
      subcategory: "Software - Dev & DevOps",
      deleted_at: null,
    },
    orderBy: {
      sub_subcategory: "asc",
    },
  });

  console.log(`\n🔍 Verification: Found ${devToolsEntries.length} Dev & DevOps sub-subcategories:`);
  devToolsEntries.forEach((entry) => {
    console.log(`   - ${entry.sub_subcategory}`);
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Script failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
