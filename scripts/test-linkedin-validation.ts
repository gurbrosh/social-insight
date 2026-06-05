/**
 * Direct test script for LinkedIn profile validation
 * Bypasses HTTP layer to test the core logic
 */

import { validateLinkedInProfile } from "../lib/linkedin-profile-validator";

const profileUrls = [
  "https://www.linkedin.com/in/craytonmontei/",
  "https://www.linkedin.com/in/rymterbeche/",
  "https://www.linkedin.com/in/arash-saeidpour/",
  "https://www.linkedin.com/in/juliamatsieva/",
  "https://www.linkedin.com/in/mattcreatore/",
  "https://www.linkedin.com/in/cschel/",
  "https://www.linkedin.com/in/chriskruse/",
  "https://www.linkedin.com/in/joseph-thomas-3aa46344/",
  "https://www.linkedin.com/in/tynorf/",
];

const trackedCompanies = ["Lovable", "Aro Homes"];

async function testProfiles() {
  console.log("Testing LinkedIn Profile Validation\n");
  console.log(`Tracked companies: ${trackedCompanies.join(", ")}`);
  console.log(`Profiles to test: ${profileUrls.length}\n`);

  const results = [];

  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    console.log(`[${i + 1}/${profileUrls.length}] Processing: ${url}`);

    try {
      const result = await validateLinkedInProfile(url, trackedCompanies, {
        useOpenAI: true,
      });

      results.push(result);
      console.log(`  ✓ ${result.analysisMethod} - ${result.confidence} confidence`);
      if (result.name) console.log(`    Name: ${result.name}`);
      if (result.currentCompany) {
        console.log(`    Company: ${result.currentCompany}`);
        console.log(`    Has moved: ${result.hasMovedCompany ? "YES" : "NO"}`);
      }
      if (result.error) console.log(`    Error: ${result.error}`);
      console.log("");
    } catch (error) {
      console.error(`  ✗ Error: ${error}`);
      results.push({
        profileUrl: url,
        hasMovedCompany: false,
        analysisMethod: "error" as const,
        confidence: "low" as const,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.log("");
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  const success = results.filter((r) => !r.error).length;
  const moved = results.filter((r) => r.hasMovedCompany).length;
  const browser = results.filter((r) => r.analysisMethod === "browser").length;
  const openai = results.filter((r) => r.analysisMethod === "openai").length;
  const errors = results.filter((r) => r.analysisMethod === "error").length;

  console.log(`Total profiles: ${results.length}`);
  console.log(`Successfully analyzed: ${success}`);
  console.log(`  - Browser extraction: ${browser}`);
  console.log(`  - OpenAI analysis: ${openai}`);
  console.log(`Moved to new company: ${moved}`);
  console.log(`Still at tracked company: ${success - moved}`);
  console.log(`Errors: ${errors}`);
  console.log(`Success rate: ${((success / results.length) * 100).toFixed(1)}%`);

  // Detailed results
  console.log("\n=== DETAILED RESULTS ===");
  results.forEach((result, index) => {
    const status = result.error
      ? "❌ ERROR"
      : result.hasMovedCompany
        ? "⚠️  MOVED"
        : "✅ AT COMPANY";
    console.log(`${index + 1}. ${status} - ${result.profileUrl}`);
    if (result.name) console.log(`   Name: ${result.name}`);
    if (result.currentCompany) console.log(`   Company: ${result.currentCompany}`);
    console.log(`   Method: ${result.analysisMethod} (${result.confidence})`);
  });
}

testProfiles().catch(console.error);
