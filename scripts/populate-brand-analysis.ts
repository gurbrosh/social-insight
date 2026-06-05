import { populateBrandAnalysis } from "@/lib/brand-analysis";

// Get project ID from command line args
const projectId = process.argv[2];

if (!projectId) {
  console.error("Usage: npx tsx scripts/populate-brand-analysis.ts <projectId>");
  process.exit(1);
}

async function main() {
  try {
    console.log(`Starting brand analysis population for project: ${projectId}`);
    const result = await populateBrandAnalysis(projectId);
    console.log("\n✅ Brand Analysis Results:");
    console.log(`   Processed: ${result.processed} posts`);
    console.log(`   Brand Mentions: ${result.brandMentions}`);
    console.log(`   Errors: ${result.errors}`);
    console.log(`   Max Processed Post ID: ${result.maxProcessedPostId}`);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error populating brand analysis:", error);
    process.exit(1);
  }
}

main();
