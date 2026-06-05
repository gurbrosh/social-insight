import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

// Initialize OpenAI client lazily
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { keywords } = await request.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "Keywords array is required" }, { status: 400 });
    }

    const keywordsText = keywords.join(", ");

    const prompt = `Based on these keywords: "${keywordsText}", identify and list the top 10 companies that directly operate in the same technology space, industry, or market as these keywords.

CRITICAL REQUIREMENTS:
1. FIRST: Include only keywords that are actual company names (e.g., "Cursor", "Lovable", "Bolt" - but NOT generic terms like "vibe coding")
2. THEN: Add companies that build, develop, or provide products/services in the same technology domain
3. Include direct competitors and alternatives to the technologies mentioned
4. Include industry leaders in the specific technology space represented by these keywords
5. Include emerging startups or well-funded companies in this exact technology area

Return exactly 10 company/brand names, one per line, without any additional text, explanations, or formatting.`;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that identifies relevant brands and companies based on keywords. Return only company names, one per line.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;

    if (!response) {
      throw new Error("No response from OpenAI");
    }

    // Parse the response into an array of brand names
    const brands = response
      .split("\n")
      .map((brand) => brand.trim())
      .filter((brand) => brand.length > 0)
      .filter((brand) => !brand.match(/^\d+\./)) // Remove numbered lists
      .slice(0, 10); // Limit to 10 brands

    return NextResponse.json({ brands });
  } catch (error) {
    console.error("Error extracting brands:", error);

    if (error instanceof Error) {
      if (error.message.includes("API key") || error.message.includes("not configured")) {
        return NextResponse.json(
          { error: "OpenAI API key is invalid or missing" },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({ error: "Failed to extract brands" }, { status: 500 });
  }
}
