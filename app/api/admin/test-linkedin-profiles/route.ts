import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

interface ProfileTestRequest {
  profileUrls: string[];
  trackedCompanies: string[];
  useOpenAI?: boolean;
}

/**
 * Extract profile data from LinkedIn by fetching the page
 * Attempts to extract metadata from page title and HTML
 */
async function extractProfileData(profileUrl: string): Promise<{
  name?: string;
  currentCompany?: string;
  experienceItems?: Array<{
    company?: string;
    title?: string;
    isCurrent?: boolean;
  }>;
  pageTitle?: string;
  rawHtml?: string;
}> {
  try {
    // Fetch the LinkedIn profile page
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

    // Extract page title
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : undefined;

    // Extract name and company from title (format: "Name - Company | LinkedIn")
    let name: string | undefined;
    let currentCompany: string | undefined;

    if (pageTitle) {
      const titleParts = pageTitle.split(" | ")[0]; // Remove "| LinkedIn"
      const dashMatch = titleParts.match(/^(.+?)\s*-\s*(.+)$/);
      if (dashMatch) {
        name = dashMatch[1].trim();
        currentCompany = dashMatch[2].trim();
      } else {
        name = titleParts.trim();
      }
    }

    // Try to extract company from meta tags or structured data
    if (!currentCompany) {
      // Try Open Graph tags
      const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleMatch) {
        const ogTitle = ogTitleMatch[1];
        const ogDashMatch = ogTitle.match(/^(.+?)\s*-\s*(.+)$/);
        if (ogDashMatch) {
          name = ogDashMatch[1].trim();
          currentCompany = ogDashMatch[2].trim();
        }
      }

      // Try JSON-LD structured data
      const jsonLdMatches = html.match(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gi
      );
      if (jsonLdMatches) {
        for (const match of jsonLdMatches) {
          try {
            const jsonContent = match.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
            const data = JSON.parse(jsonContent);
            if (data["@type"] === "Person" && data.worksFor) {
              currentCompany =
                typeof data.worksFor === "string" ? data.worksFor : data.worksFor.name;
              if (!name && data.name) {
                name = data.name;
              }
              break;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    return {
      name,
      currentCompany,
      pageTitle,
      rawHtml: html.substring(0, 50000), // Store first 50KB for OpenAI analysis
      experienceItems: [],
    };
  } catch (error) {
    console.error(`Error extracting data from ${profileUrl}:`, error);
    // Return empty result - OpenAI will try to analyze
    return {};
  }
}

/**
 * Analyze profile using OpenAI
 * OpenAI can sometimes access LinkedIn profiles directly via URL
 */
async function analyzeProfileWithOpenAI(
  profileUrl: string,
  trackedCompanies: string[],
  profileHtml?: string
): Promise<{
  name?: string;
  currentCompany?: string;
  previousCompanies?: string[];
  hasRecentJobChange?: boolean;
  mostRecentCompany?: string;
  analysis?: string;
}> {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

    // Extract text content from HTML (simplified - in production would use proper HTML parsing)
    let textContent = "";
    if (profileHtml) {
      // Remove scripts and styles
      textContent = profileHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 8000); // Increased for better context
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
        temperature: 0.2, // Lower temperature for more accurate results
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

    const result = JSON.parse(content);
    return result;
  } catch (error) {
    console.error("OpenAI analysis error:", error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body: ProfileTestRequest = await request.json();
    const { profileUrls, trackedCompanies, useOpenAI = false } = body;

    if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
      return NextResponse.json({ error: "profileUrls array is required" }, { status: 400 });
    }

    if (!trackedCompanies || !Array.isArray(trackedCompanies) || trackedCompanies.length === 0) {
      return NextResponse.json({ error: "trackedCompanies array is required" }, { status: 400 });
    }

    const results = await Promise.all(
      profileUrls.map(async (profileUrl, index) => {
        try {
          console.log(`[${index + 1}/${profileUrls.length}] Processing: ${profileUrl}`);

          // Normalize tracked company names for fuzzy matching
          const normalizedTracked = trackedCompanies.map((c) =>
            c
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]/g, "")
          );

          // Try browser extraction first
          const extractionResult = await extractProfileData(profileUrl);
          console.log(
            `  Browser extraction: name="${extractionResult.name}", company="${extractionResult.currentCompany}"`
          );

          // If we got current company from extraction, use it
          if (extractionResult.currentCompany) {
            const normalizedCurrent = extractionResult.currentCompany
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]/g, "");
            const isAtTrackedCompany = normalizedTracked.some((tracked) => {
              // Fuzzy matching: check if tracked company appears in current company or vice versa
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

            console.log(`  Match result: isAtTrackedCompany=${isAtTrackedCompany}`);

            return {
              profileUrl,
              name: extractionResult.name,
              currentCompany: extractionResult.currentCompany,
              hasMovedCompany: !isAtTrackedCompany,
              analysisMethod: "browser",
              confidence: "high",
              rawData: { pageTitle: extractionResult.pageTitle },
            };
          }

          // If browser extraction didn't work and OpenAI is enabled, use OpenAI
          if (useOpenAI) {
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

              console.log(`  Match result: isAtTrackedCompany=${isAtTrackedCompany}`);

              return {
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
            }
          }

          // If we couldn't determine, return error
          console.log(`  Could not extract company information`);
          return {
            profileUrl,
            hasMovedCompany: false,
            analysisMethod: "error" as const,
            confidence: "low" as const,
            error: "Could not extract company information",
            rawData: { pageTitle: extractionResult.pageTitle },
          };
        } catch (error) {
          console.error(`  Error processing ${profileUrl}:`, error);
          return {
            profileUrl,
            hasMovedCompany: false,
            analysisMethod: "error",
            confidence: "low",
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error testing LinkedIn profiles:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
