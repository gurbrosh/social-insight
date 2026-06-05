/**
 * Language Detection Script
 * Detects and updates language for all existing posts using franc-min
 */

import { PrismaClient } from "@prisma/client";
import { franc } from "franc-min";

const prisma = new PrismaClient();

// ISO 639-3 to ISO 639-1 mapping for common languages
const languageMap = {
  eng: "en", // English
  spa: "es", // Spanish
  fra: "fr", // French
  deu: "de", // German
  ita: "it", // Italian
  por: "pt", // Portuguese
  rus: "ru", // Russian
  jpn: "ja", // Japanese
  kor: "ko", // Korean
  cmn: "zh", // Chinese
  ara: "ar", // Arabic
  hin: "hi", // Hindi
  nld: "nl", // Dutch
  pol: "pl", // Polish
  tur: "tr", // Turkish
  vie: "vi", // Vietnamese
  tha: "th", // Thai
  swe: "sv", // Swedish
  dan: "da", // Danish
  fin: "fi", // Finnish
  nor: "no", // Norwegian
  und: null, // Undefined/Unknown
};

async function detectLanguages() {
  console.log("🌍 Starting language detection for existing posts...\n");

  try {
    // Get all posts with content that don't have language set
    const posts = await prisma.post.findMany({
      where: {
        content: { not: null },
        language: null,
      },
      select: {
        id: true,
        content: true,
        platform: true,
      },
    });

    console.log(`Found ${posts.length} posts to process\n`);

    if (posts.length === 0) {
      console.log("✅ No posts need language detection");
      return;
    }

    let updated = 0;
    let skipped = 0;
    const languageStats = {};

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);

      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, posts.length)} of ${posts.length})...`
      );

      for (const post of batch) {
        if (!post.content || post.content.trim().length < 10) {
          skipped++;
          continue;
        }

        // Detect language using franc (returns ISO 639-3 code)
        const detected = franc(post.content, { minLength: 10 });
        const languageCode = languageMap[detected] || null;

        if (languageCode) {
          // Update the post
          await prisma.post.update({
            where: { id: post.id },
            data: { language: languageCode },
          });

          // Track stats
          languageStats[languageCode] = (languageStats[languageCode] || 0) + 1;
          updated++;
        } else {
          skipped++;
        }
      }
    }

    console.log("\n✅ Language detection complete!");
    console.log(`\nResults:`);
    console.log(`  Updated: ${updated} posts`);
    console.log(`  Skipped: ${skipped} posts (too short or unknown language)`);
    console.log(`\nLanguage breakdown:`);

    const sortedLanguages = Object.entries(languageStats).sort((a, b) => b[1] - a[1]);

    for (const [lang, count] of sortedLanguages) {
      const percentage = ((count / updated) * 100).toFixed(1);
      console.log(`  ${lang}: ${count} posts (${percentage}%)`);
    }
  } catch (error) {
    console.error("❌ Error during language detection:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
detectLanguages()
  .then(() => {
    console.log("\n🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
