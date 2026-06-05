import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Import the comprehensive analysis functions directly
async function runAnalysisDirectly() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  console.log(`\n🔬 Starting comprehensive analysis for project ${projectId}...`);
  console.log("=".repeat(60));

  try {
    // Import and run the comprehensive analysis
    const { runComprehensiveAnalysis } = await import("../lib/comprehensive-analysis.ts");
    const result = await runComprehensiveAnalysis(projectId);

    if (!result.success) {
      console.error("❌ Analysis failed:", result.error);
      process.exit(1);
    }

    console.log("\n✅ Analysis completed successfully!");
    console.log("=".repeat(60));
    console.log("\n📊 Results:");
    console.log(`   - Conversations: ${result.stats?.conversations || 0}`);
    console.log(`   - Sentiment Analyzed: ${result.stats?.sentimentAnalyzed || 0}`);
    console.log(`   - Influential People: ${result.stats?.influentialPeople || 0}`);
    console.log(`   - News Items: ${result.stats?.newsItems || 0}`);
    console.log(`   - Themes Matched: ${result.stats?.themesMatched || 0}`);
    console.log(
      `   - Sanitized: ${result.stats?.sanitizationRemoved || 0} off-topic items removed`
    );
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("❌ Error running analysis:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAnalysisDirectly();
