import { prisma } from "../lib/prisma";

/**
 * Script to add AI & LLM Security taxonomy entries
 *
 * Adds a new subcategory under Technology → Cybersecurity:
 * - AI & LLM Security
 *   - Prompt & Input Security
 *   - Model & Inference Protection
 *   - Agent & Tool-Use Security
 *   - AI App Runtime Protection
 *   - AI Risk, Testing & Red Teaming
 *   - AI Identity & Access Control
 */

const newTaxonomyEntries = [
  {
    category: "Technology",
    subcategory: "Cybersecurity",
    sub_subcategory: "AI & LLM Security",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "Prompt & Input Security",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "Model & Inference Protection",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "Agent & Tool-Use Security",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "AI App Runtime Protection",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "AI Risk, Testing & Red Teaming",
  },
  {
    category: "Technology",
    subcategory: "AI & LLM Security",
    sub_subcategory: "AI Identity & Access Control",
  },
];

async function main() {
  console.log("🔐 Adding AI & LLM Security taxonomy entries...\n");

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of newTaxonomyEntries) {
    try {
      // Check if entry already exists
      const existing = await prisma.businessTaxonomy.findFirst({
        where: {
          category: entry.category,
          subcategory: entry.subcategory,
          sub_subcategory: entry.sub_subcategory,
          deleted_at: null,
        },
      });

      if (existing) {
        console.log(
          `⏭️  Skipping (already exists): ${entry.category} → ${entry.subcategory} → ${entry.sub_subcategory}`
        );
        skipped++;
        continue;
      }

      // Create new entry
      await prisma.businessTaxonomy.create({
        data: {
          category: entry.category,
          subcategory: entry.subcategory,
          sub_subcategory: entry.sub_subcategory,
        },
      });

      console.log(
        `✅ Created: ${entry.category} → ${entry.subcategory} → ${entry.sub_subcategory}`
      );
      created++;
    } catch (error: any) {
      if (error.code === "P2002") {
        // Unique constraint violation (duplicate)
        console.log(
          `⏭️  Skipping (duplicate): ${entry.category} → ${entry.subcategory} → ${entry.sub_subcategory}`
        );
        skipped++;
      } else {
        console.error(
          `❌ Error creating ${entry.category} → ${entry.subcategory} → ${entry.sub_subcategory}:`,
          error
        );
        errors++;
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total processed: ${newTaxonomyEntries.length}`);

  // Verify the entries were created
  const aiSecurityEntries = await prisma.businessTaxonomy.findMany({
    where: {
      category: "Technology",
      OR: [
        {
          subcategory: "AI & LLM Security",
        },
        {
          subcategory: "Cybersecurity",
          sub_subcategory: "AI & LLM Security",
        },
      ],
      deleted_at: null,
    },
    orderBy: [{ subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  console.log(`\n🔍 Verification: Found ${aiSecurityEntries.length} AI & LLM Security entries:`);
  aiSecurityEntries.forEach((entry) => {
    console.log(`   - ${entry.category} → ${entry.subcategory} → ${entry.sub_subcategory}`);
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
