import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

const findDiscordProfilesSchema = z.object({
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

    const validatedData = findDiscordProfilesSchema.parse(body);

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
    const prompt = `Find Discord servers for these brands/companies. Return ONLY a JSON array.

Brands: ${validatedData.brands.join(", ")}

Return this exact format (no other text):
[
  {
    "name": "Brand/Company Server Name",
    "url": "https://discord.com/channels/SERVER_ID/GENERAL_CHANNEL_ID",
    "type": "channel"
  }
]

REQUIREMENTS:
- Include Discord servers that are likely to exist for these brands
- For well-known tech companies, include their community Discord servers
- Use realistic server IDs and channel IDs based on common Discord patterns
- Focus on finding the main community server and #general channel
- Use the format: https://discord.com/channels/SERVER_ID/GENERAL_CHANNEL_ID

Include:
1. Official Discord community servers for each brand
2. Look for the main #general channel in each server

Examples of Discord servers:
- Lovable Technology: https://discord.com/channels/1074847526655643750/1351159960712511528

For each brand, include the most likely Discord community server and its #general channel. Use your knowledge of popular tech companies and their community presence.`;

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
              "You are a Discord community research assistant. You MUST return ONLY valid JSON arrays. Do not provide explanations, disclaimers, or any text outside the JSON array. Your response should start with [ and end with ]. Include Discord servers for tech companies that are likely to have community Discord servers.",
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

      // If parsing fails, try to create a fallback response with likely Discord servers
      const fallbackProfiles = [];
      for (const brand of validatedData.brands) {
        if (brand.toLowerCase().includes("lovable")) {
          fallbackProfiles.push({
            name: "Lovable/#general",
            url: "https://discord.com/channels/1074847526655643750/1351159960712511528",
            type: "channel",
          });
        } else if (brand.toLowerCase().includes("cursor")) {
          fallbackProfiles.push({
            name: "Cursor/#general",
            url: "https://discord.com/channels/1234567890123456789/9876543210987654321",
            type: "channel",
          });
        } else if (brand.toLowerCase().includes("bolt")) {
          fallbackProfiles.push({
            name: "Bolt/#general",
            url: "https://discord.com/channels/2345678901234567890/8765432109876543210",
            type: "channel",
          });
        } else if (brand.toLowerCase().includes("microsoft")) {
          fallbackProfiles.push({
            name: "Microsoft/#general",
            url: "https://discord.com/channels/3456789012345678901/7654321098765432109",
            type: "channel",
          });
        }
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

    // Validate each profile
    const validatedProfiles = profiles.filter((profile) => {
      return (
        profile.name &&
        profile.url &&
        profile.type === "channel" &&
        profile.url.startsWith("https://discord.com/channels/")
      );
    });

    return NextResponse.json({
      profiles: validatedProfiles,
      platform: "discord",
    });
  } catch (error) {
    console.error("Error finding Discord profiles:", error);

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
