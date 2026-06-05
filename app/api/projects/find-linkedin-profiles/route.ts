import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import {
  searchLinkedInProfiles,
  extractProfileName,
} from "@/lib/brand-directory/taxonomy-source-search-service";

export const dynamic = "force-dynamic";

const findLinkedInProfilesSchema = z.object({
  keywords: z.array(z.string()).min(1),
  brands: z.array(z.string()).min(1),
});

/**
 * Find LinkedIn profiles for brands using the same web search approach as brand directory
 * Uses SerpAPI/Bing web search to find REAL LinkedIn URLs, then extracts names using the 926-name database
 * This ensures consistency across the project
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = findLinkedInProfilesSchema.parse(body);

    const allProfiles: Array<{ name: string; url: string; type: "company" | "person" }> = [];

    // Search for each brand using the same web search approach as brand directory
    for (const brand of validatedData.brands) {
      // Search for company page and person profiles together
      const searchTopic = `${brand} company executives leaders`;
      const searchKeywords = [
        ...validatedData.keywords,
        brand,
        "CEO",
        "founder",
        "executive",
        "leader",
      ];

      const searchResults = await searchLinkedInProfiles(
        searchTopic,
        searchKeywords,
        15, // Get more results to find both company and person profiles
        brand
      );

      // Separate company pages and person profiles
      const companyPages = searchResults.filter((result) => result.url.includes("/company/"));
      const personProfiles = searchResults.filter(
        (result) => result.url.includes("/in/") && !result.url.includes("/company/")
      );

      // Add company page (use first match or construct URL)
      if (companyPages.length > 0) {
        allProfiles.push({
          name: brand,
          url: companyPages[0].url,
          type: "company",
        });
      } else {
        // Fallback: construct company URL
        const brandSlug = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
        allProfiles.push({
          name: brand,
          url: `https://www.linkedin.com/company/${brandSlug}`,
          type: "company",
        });
      }

      // Extract names from person profiles using the shared name extraction (926-name database)
      for (const profile of personProfiles.slice(0, 10)) {
        // Extract name using the shared function (uses 926-name database + SerpAPI + HTML + OpenAI)
        const extractedName = await extractProfileName(profile.url, profile.title, profile.snippet);

        if (extractedName && extractedName.split(/\s+/).length >= 2) {
          allProfiles.push({
            name: `${extractedName} (${brand})`,
            url: profile.url,
            type: "person",
          });
        }
      }
    }

    // Remove duplicates by URL
    const uniqueProfiles = Array.from(
      new Map(allProfiles.map((profile) => [profile.url, profile])).values()
    );

    return NextResponse.json({
      profiles: uniqueProfiles,
      platform: "linkedin",
    });
  } catch (error) {
    console.error("Error finding LinkedIn profiles:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
