import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

const findTwitterProfilesSchema = z.object({
  keywords: z.array(z.string()).min(1),
  brands: z.array(z.string()).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const validatedData = findTwitterProfilesSchema.parse(body);

    // Check if OpenAI API key is configured
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        {
          error: "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.",
        },
        { status: 500 }
      );
    }

    // Create the prompt for OpenAI
    const prompt = `Find Twitter/X company pages AND real Twitter/X profiles of actual company leaders for these brands. Return ONLY a JSON array.

Brands: ${validatedData.brands.join(", ")}

Return this exact format (no other text):
[
  {
    "name": "Company Name",
    "url": "https://twitter.com/companyname",
    "type": "company"
  },
  {
    "name": "Real Leader Full Name (Company)",
    "url": "https://twitter.com/realleaderhandle",
    "type": "person"
  }
]

CRITICAL REQUIREMENTS:
- ONLY include REAL Twitter/X profiles of actual company leaders that you KNOW exist
- Do NOT create fake profiles or use placeholder names like "John Doe", "Jane Doe", "Mark Doe", etc.
- Do NOT use generic names - only use actual known executives and leaders
- If you don't know the real Twitter/X profile of a leader, do NOT include ANY person profile for that company
- It's better to return only company pages than to include fake person profiles
- ONLY include person profiles for leaders whose real Twitter handles you are certain about

Include:
1. Official Twitter/X company pages
2. REAL public Twitter/X profiles of actual CEOs, founders, and key executives

Examples of REAL profiles:
- Microsoft company page: https://twitter.com/Microsoft
- Satya Nadella (Microsoft): https://twitter.com/satyanadella
- Apple company page: https://twitter.com/Apple
- Tim Cook (Apple): https://twitter.com/tim_cook
- Google company page: https://twitter.com/Google
- Sundar Pichai (Google): https://twitter.com/sundarpichai

For person profiles, include the company name in parentheses after the person's name. For each brand, include the company page and only REAL Twitter/X profiles of actual leaders. If you don't know the real Twitter/X profile of a leader, don't include a fake one.`;

    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
    const openaiResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are a social media research assistant. You MUST return ONLY valid JSON arrays. Do not provide explanations, disclaimers, or any text outside the JSON array. Your response should start with [ and end with ].",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error("OpenAI API error:", errorData);
      return NextResponse.json(
        {
          error: "Failed to query OpenAI API",
          details: errorData,
        },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();

    const content = openaiData.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        {
          error: "No response content from OpenAI",
        },
        { status: 500 }
      );
    }

    // Parse the JSON response from OpenAI
    let profiles;
    try {
      // Try to extract JSON from the response if it's wrapped in text
      let jsonContent = content.trim();

      // Look for JSON array in the content
      const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonContent = jsonMatch[0];
      }

      profiles = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error("Failed to parse OpenAI response:", parseError);
      console.error("Raw content:", content);

      // If parsing fails, try to create a fallback response with known companies and leaders
      const fallbackProfiles = [];
      for (const brand of validatedData.brands) {
        const brandLower = brand.toLowerCase().replace(/[^a-z0-9]/g, "");

        // Add company page
        fallbackProfiles.push({
          name: brand,
          url: `https://twitter.com/${brandLower}`,
          type: "company",
        });

        // Only add well-known leader profiles that we're absolutely certain about
        if (brand.toLowerCase().includes("microsoft")) {
          fallbackProfiles.push({
            name: "Satya Nadella (Microsoft)",
            url: "https://twitter.com/satyanadella",
            type: "person",
          });
        } else if (brand.toLowerCase().includes("apple")) {
          fallbackProfiles.push({
            name: "Tim Cook (Apple)",
            url: "https://twitter.com/tim_cook",
            type: "person",
          });
        } else if (brand.toLowerCase().includes("google")) {
          fallbackProfiles.push({
            name: "Sundar Pichai (Google)",
            url: "https://twitter.com/sundarpichai",
            type: "person",
          });
        } else if (brand.toLowerCase().includes("meta")) {
          fallbackProfiles.push({
            name: "Mark Zuckerberg (Meta)",
            url: "https://twitter.com/finkd",
            type: "person",
          });
        } else if (brand.toLowerCase().includes("tesla")) {
          fallbackProfiles.push({
            name: "Elon Musk (Tesla)",
            url: "https://twitter.com/elonmusk",
            type: "person",
          });
        } else if (brand.toLowerCase().includes("amazon")) {
          fallbackProfiles.push({
            name: "Jeff Bezos (Amazon)",
            url: "https://twitter.com/jeffbezos",
            type: "person",
          });
        }
        // Note: For smaller companies like Cursor, Lovable, Bolt - we don't have verified Twitter handles
        // so we'll only include company pages, not person profiles
      }

      profiles = fallbackProfiles;
    }

    // Validate the structure of the response
    if (!Array.isArray(profiles)) {
      return NextResponse.json(
        {
          error: "AI response is not an array",
          rawContent: content,
        },
        { status: 500 }
      );
    }

    // Validate each profile and filter out fake profiles
    const validatedProfiles = profiles.filter((profile) => {
      const name = profile.name?.toLowerCase() || "";

      // Filter out obviously fake profiles
      const isFakeProfile =
        name.includes("doe") ||
        name.includes("john smith") ||
        name.includes("jane smith") ||
        name.includes("joe smith") ||
        name.includes("ceo name") ||
        name.includes("founder name") ||
        name.includes("leader name");

      return (
        profile.name &&
        profile.url &&
        (profile.type === "company" || profile.type === "person") &&
        profile.url.startsWith("https://twitter.com/") &&
        !isFakeProfile
      );
    });

    return NextResponse.json({
      profiles: validatedProfiles,
      platform: "twitter",
    });
  } catch (error) {
    console.error("Error finding Twitter profiles:", error);

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
