/**
 * Diagnostic script to check why a specific chatter item passed relevance filtering
 *
 * Usage: npx tsx scripts/diagnose-chatter-relevance.ts <projectId> "search term"
 *
 * Example: npx tsx scripts/diagnose-chatter-relevance.ts 01K5ZN4CAGXGM9D1HART3Q0A8A "Motorcycle Taxi"
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function diagnoseChatterRelevance(projectId: string, searchTerm: string) {
  console.log("🔍 Chatter Relevance Diagnostic Tool\n");
  console.log("=".repeat(60));

  try {
    // Get project info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        description: true,
        keywords: {
          where: { deleted_at: null },
          select: { keyword: true },
        },
        brands: {
          where: { deleted_at: null },
          select: { brand_name: true },
        },
      },
    });

    if (!project) {
      console.error(`❌ Project ${projectId} not found`);
      return;
    }

    console.log(`\n📁 Project: ${project.name}`);
    console.log(`   Description: ${project.description || "None"}`);
    console.log(`   Keywords: ${project.keywords.map((k) => k.keyword).join(", ") || "None"}`);
    console.log(`   Brands: ${project.brands.map((b) => b.brand_name).join(", ") || "None"}`);

    // Search for chatter items
    const allChatter = await prisma.chatterAnalysis.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      select: {
        id: true,
        discussion_title: true,
        summary: true,
        topic_category: true,
        sentiment: true,
        importance_score: true,
        key_points_json: true,
        created_at: true,
        first_post_at: true,
        last_post_at: true,
        participant_count: true,
        total_messages: true,
        total_engagement: true,
      },
      orderBy: { created_at: "desc" },
      take: 100,
    });

    // Filter in memory (case-insensitive)
    const matchingChatter = allChatter.filter(
      (item) =>
        item.discussion_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.summary?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (matchingChatter.length === 0) {
      console.log(`\n❌ No chatter items found matching "${searchTerm}"`);
      console.log(`\n📊 Total chatter items: ${allChatter.length}`);
      if (allChatter.length > 0) {
        console.log(`\n📋 Recent chatter items (last 5):`);
        allChatter.slice(0, 5).forEach((item, i) => {
          console.log(
            `   ${i + 1}. "${item.discussion_title}" (${item.topic_category}, importance: ${item.importance_score})`
          );
        });
      }
      return;
    }

    console.log(`\n🔎 Found ${matchingChatter.length} matching chatter item(s):\n`);

    for (const item of matchingChatter) {
      console.log("─".repeat(60));
      console.log(`📌 Title: "${item.discussion_title}"`);
      console.log(`   Category: ${item.topic_category}`);
      console.log(`   Sentiment: ${item.sentiment || "N/A"}`);
      console.log(`   Importance Score: ${item.importance_score}`);
      console.log(`   Participants: ${item.participant_count}`);
      console.log(`   Messages: ${item.total_messages}`);
      console.log(`   Engagement: ${item.total_engagement}`);
      console.log(`   Created: ${item.created_at.toISOString()}`);

      if (item.summary) {
        console.log(
          `\n   Summary: ${item.summary.substring(0, 200)}${item.summary.length > 200 ? "..." : ""}`
        );
      }

      let keyPoints: string[] = [];
      try {
        if (item.key_points_json) {
          keyPoints = JSON.parse(item.key_points_json);
        }
      } catch {
        // Invalid JSON
      }

      if (keyPoints.length > 0) {
        console.log(`\n   Key Points:`);
        keyPoints.slice(0, 5).forEach((point, i) => {
          console.log(
            `     ${i + 1}. ${point.substring(0, 100)}${point.length > 100 ? "..." : ""}`
          );
        });
      }

      // Check relevance to project
      console.log(`\n   🔍 Relevance Analysis:`);
      const projectKeywords = project.keywords.map((k) => k.keyword.toLowerCase());
      const projectBrands = project.brands.map((b) => b.brand_name.toLowerCase());
      const titleLower = item.discussion_title?.toLowerCase() || "";
      const summaryLower = item.summary?.toLowerCase() || "";

      const keywordMatches = projectKeywords.filter(
        (kw) => titleLower.includes(kw) || summaryLower.includes(kw)
      );
      const brandMatches = projectBrands.filter(
        (brand) => titleLower.includes(brand) || summaryLower.includes(brand)
      );

      if (keywordMatches.length > 0) {
        console.log(`     ✅ Keyword matches: ${keywordMatches.join(", ")}`);
      } else {
        console.log(`     ❌ No keyword matches found`);
      }

      if (brandMatches.length > 0) {
        console.log(`     ✅ Brand matches: ${brandMatches.join(", ")}`);
      } else {
        console.log(`     ❌ No brand matches found`);
      }

      if (keywordMatches.length === 0 && brandMatches.length === 0) {
        console.log(`\n   ⚠️  WARNING: This chatter item has no direct keyword or brand matches!`);
        console.log(`      It may have passed due to:`);
        console.log(`      1. Semantic similarity scoring (embedding-based prefilter)`);
        console.log(`      2. Low relevance threshold (30 for most platforms, 15 for Facebook)`);
        console.log(
          `      3. Top-10 fallback mechanism (keeps top 10 even if none pass threshold)`
        );
        console.log(`      4. Sanitization not running yet or being too lenient`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Diagnostic complete");
    console.log("\n💡 To remove off-topic items, run sanitization:");
    console.log(
      "   The sanitization process should catch items like this if they're truly off-topic."
    );
    console.log("   Check if sanitization has run recently by looking at analysis progress.");
  } catch (error) {
    console.error("❌ Error running diagnostic:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const projectId = process.argv[2];
const searchTerm = process.argv[3];

if (!projectId || !searchTerm) {
  console.error('Usage: npx tsx scripts/diagnose-chatter-relevance.ts <projectId> "search term"');
  console.error("\nExample:");
  console.error(
    '  npx tsx scripts/diagnose-chatter-relevance.ts 01K5ZN4CAGXGM9D1HART3Q0A8A "Motorcycle Taxi"'
  );
  process.exit(1);
}

diagnoseChatterRelevance(projectId, searchTerm).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
