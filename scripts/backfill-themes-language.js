#!/usr/bin/env node
/**
 * Backfill language field for themes analysis records
 * This script detects language from the post_content field for records where language is NULL
 */

const { PrismaClient } = require("@prisma/client");
const { detectLanguage } = require("../lib/utils/language-detector");
const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Starting language backfill for themes analysis...");

  try {
    // Get all themes analysis records with NULL language
    const recordsWithoutLanguage = await prisma.themesAnalysis.findMany({
      where: {
        language: null,
        deleted_at: null,
      },
      select: {
        id: true,
        post_content: true,
      },
    });

    console.log(`Found ${recordsWithoutLanguage.length} records without language`);

    if (recordsWithoutLanguage.length === 0) {
      console.log("✅ No records need updating");
      return;
    }

    let updated = 0;
    let errors = 0;

    // Process in batches of 100
    for (let i = 0; i < recordsWithoutLanguage.length; i += 100) {
      const batch = recordsWithoutLanguage.slice(i, i + 100);

      for (const record of batch) {
        try {
          // Detect language from post content
          const language = record.post_content ? detectLanguage(record.post_content) : null;

          if (language) {
            await prisma.themesAnalysis.update({
              where: { id: record.id },
              data: { language },
            });
            updated++;
          } else {
            // Could not detect language - leave as null
            console.log(`⚠️  Could not detect language for record ${record.id}`);
          }
        } catch (error) {
          console.error(`Error processing record ${record.id}:`, error);
          errors++;
        }
      }

      // Log progress
      if (i + 100 < recordsWithoutLanguage.length) {
        console.log(`Processed ${i + 100} of ${recordsWithoutLanguage.length} records...`);
      }
    }

    console.log(`✅ Backfill complete:`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Errors: ${errors}`);
    console.log(`   - Remaining NULL: ${recordsWithoutLanguage.length - updated - errors}`);
  } catch (error) {
    console.error("❌ Error during backfill:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
