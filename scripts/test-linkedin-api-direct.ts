/**
 * Test LinkedIn profile validation by directly importing API route logic
 */

// Import the extraction and analysis functions from the API route
// We'll copy the logic here since we can't easily import from API routes

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

const trackedCompanies = ["Peach", "Peach Finance"];

// Copy the extraction function from the API route
async function extractProfileData(profileUrl: string) {
  try {
    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : undefined;

    let name: string | undefined;
    let currentCompany: string | undefined;

    if (pageTitle) {
      const titleParts = pageTitle.split(" | ")[0];
      const dashMatch = titleParts.match(/^(.+?)\s*-\s*(.+)$/);
      if (dashMatch) {
        name = dashMatch[1].trim();
        currentCompany = dashMatch[2].trim();
      } else {
        name = titleParts.trim();
      }
    }

    return {
      name,
      currentCompany,
      pageTitle,
      rawHtml: html.substring(0, 50000),
      experienceItems: [],
    };
  } catch (error) {
    console.error(`Error extracting data from ${profileUrl}:`, error);
    return {};
  }
}

// Copy the OpenAI analysis function
async function analyzeProfileWithOpenAI(
  profileUrl: string,
  trackedCompanies: string[],
  profileHtml?: string
) {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const { configService } = await import("../lib/config-service");
    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

    let textContent = "";
    if (profileHtml) {
      textContent = profileHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 8000);
    }

    const prompt = `Analyze this LinkedIn profile and extract company information.

Profile URL: ${profileUrl}
${textContent ? `Profile page content (extracted text): ${textContent}` : "Note: Could not fetch page content, use your knowledge or try to access the profile."}

Tracked companies to check against: ${trackedCompanies.join(", ")}

Your task:
1. Determine the person's CURRENT company (most recent/current position)
2. Check if they currently work at any of the tracked companies: ${trackedCompanies.join(", ")}
3. Determine if they have MOVED to a different company (i.e., their current company is NOT in the tracked list)

Return a JSON object with:
{
  "name": "Full name of the person (if available)",
  "currentCompany": "The company they currently work at (most recent position)",
  "previousCompanies": ["List of previous companies if visible"],
  "hasRecentJobChange": true/false - true if they moved to a NEW company (not in tracked list),
  "mostRecentCompany": "The most recent company from their experience",
  "analysis": "Brief explanation: Are they still at a tracked company, or have they moved?"
}

IMPORTANT:
- If their current company is in the tracked list: hasRecentJobChange should be FALSE
- If their current company is NOT in the tracked list: hasRecentJobChange should be TRUE
- Be accurate - if you cannot determine, say so in the analysis field

Return ONLY valid JSON, no other text.`;

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a professional recruiter analyzing LinkedIn profiles. Extract company information accurately and determine if someone has changed companies. You have access to browse the web if needed to verify LinkedIn profile information.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("OpenAI analysis error:", error);
    throw error;
  }
}

async function testProfiles() {
  console.log("Testing LinkedIn Profile Validation\n");
  console.log(`Tracked companies: ${trackedCompanies.join(", ")}`);
  console.log(`Profiles to test: ${profileUrls.length}\n`);

  const results: any[] = [];
  const normalizedTracked = trackedCompanies.map((c) =>
    c
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "")
  );

  for (let i = 0; i < profileUrls.length; i++) {
    const profileUrl = profileUrls[i];
    console.log(`[${i + 1}/${profileUrls.length}] Processing: ${profileUrl}`);

    try {
      // Try browser extraction first
      const extractionResult = await extractProfileData(profileUrl);
      console.log(
        `  Browser extraction: name="${extractionResult.name}", company="${extractionResult.currentCompany}"`
      );

      let result: any;

      if (extractionResult.currentCompany) {
        const normalizedCurrent = extractionResult.currentCompany
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, "");
        const isAtTrackedCompany = normalizedTracked.some((tracked) => {
          return (
            normalizedCurrent.includes(tracked) ||
            tracked.includes(normalizedCurrent) ||
            extractionResult
              .currentCompany!.toLowerCase()
              .includes(
                trackedCompanies
                  .find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === tracked)
                  ?.toLowerCase() || ""
              )
          );
        });

        result = {
          profileUrl,
          name: extractionResult.name,
          currentCompany: extractionResult.currentCompany,
          hasMovedCompany: !isAtTrackedCompany,
          analysisMethod: "browser",
          confidence: "high",
          rawData: { pageTitle: extractionResult.pageTitle },
        };
      } else {
        // Try OpenAI
        console.log(`  Attempting OpenAI analysis...`);
        const openaiResult = await analyzeProfileWithOpenAI(
          profileUrl,
          trackedCompanies,
          extractionResult.rawHtml
        );
        console.log(
          `  OpenAI result: name="${openaiResult.name}", company="${openaiResult.currentCompany}"`
        );

        const currentCompany = openaiResult.currentCompany || openaiResult.mostRecentCompany;
        if (currentCompany) {
          const normalizedCurrent = currentCompany
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, "");
          const isAtTrackedCompany = normalizedTracked.some((tracked) => {
            return (
              normalizedCurrent.includes(tracked) ||
              tracked.includes(normalizedCurrent) ||
              currentCompany
                .toLowerCase()
                .includes(
                  trackedCompanies
                    .find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === tracked)
                    ?.toLowerCase() || ""
                )
            );
          });

          result = {
            profileUrl,
            name: openaiResult.name,
            currentCompany: currentCompany,
            hasMovedCompany: !isAtTrackedCompany,
            analysisMethod: "openai",
            confidence:
              openaiResult.hasRecentJobChange !== undefined
                ? openaiResult.hasRecentJobChange
                  ? "high"
                  : "medium"
                : "medium",
            rawData: {
              analysis: openaiResult.analysis,
              previousCompanies: openaiResult.previousCompanies,
            },
          };
        } else {
          result = {
            profileUrl,
            hasMovedCompany: false,
            analysisMethod: "error",
            confidence: "low",
            error: "Could not extract company information",
            rawData: { pageTitle: extractionResult.pageTitle },
          };
        }
      }

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
        profileUrl,
        hasMovedCompany: false,
        analysisMethod: "error",
        confidence: "low",
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
