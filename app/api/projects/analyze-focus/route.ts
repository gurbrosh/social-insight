import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

/**
 * Analyze a monitoring focus description and/or provide a rewritten version
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      focusText,
      projectId,
      keywords: providedKeywords,
      rewrite,
    } = body as {
      focusText?: string;
      projectId?: string;
      keywords?: string[];
      rewrite?: boolean;
    };

    if (!focusText || focusText.trim().length === 0) {
      if (rewrite) {
        return NextResponse.json({ rewrittenText: "" });
      }
      return NextResponse.json({
        score: 0,
        issues: [{ type: "empty", message: "Monitoring focus cannot be empty", severity: "error" }],
        suggestions: [],
      });
    }

    // Get project context (brands, keywords)
    // Use provided keywords first (from UI), then fall back to database if projectId provided
    let projectBrands: string[] = [];
    let projectKeywords: string[] = providedKeywords || [];

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          brands: {
            where: { deleted_at: null, is_selected: true },
            select: { brand_name: true },
          },
          keywords: {
            where: { deleted_at: null },
            select: { keyword: true },
          },
        },
      });

      if (project) {
        projectBrands = project.brands.map((b) => b.brand_name);
        if (!providedKeywords || providedKeywords.length === 0) {
          projectKeywords = project.keywords.map((k) => k.keyword);
        }
      }
    }

    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

    // If rewrite requested, return a rewritten version and skip the full analysis
    if (rewrite) {
      const brandsList = projectBrands.length > 0 ? `\nBrands: ${projectBrands.join(", ")}` : "";
      const keywordsList =
        projectKeywords.length > 0 ? `\nKeywords: ${projectKeywords.join(", ")}` : "";

      const prompt = `Rewrite the following monitoring focus to be clear, specific, and semantically precise for an AI-based social listening system.

Constraints:
- Naturally incorporate provided keywords and brands when appropriate (do not force if irrelevant)
- Avoid generic terms ("platforms", "tools", "services") without specifics
- Keep user's original intent
- Be concise: 1-3 sentences
- Prefer brand/product and concrete use-cases over vague language

Context:${keywordsList}${brandsList}

Original:
"""
${focusText}
"""

Return ONLY the rewritten text with no extra commentary.`;

      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You rewrite text precisely to spec and return only the rewritten text.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        console.error("OpenAI rewrite API error:", response.status);
        return NextResponse.json({ rewrittenText: focusText });
      }

      const data = await response.json();
      let content: string = data.choices?.[0]?.message?.content?.trim() || "";
      content = content
        .replace(/```[a-zA-Z]*\n?/g, "")
        .replace(/```/g, "")
        .trim();
      if (!content) content = focusText;
      return NextResponse.json({ rewrittenText: content });
    }

    // ========== Existing ANALYSIS path (kept for compatibility) ==========
    const brandsList =
      projectBrands.length > 0 ? `\n- Configured Brands: ${projectBrands.join(", ")}` : "";
    const keywordsList =
      projectKeywords.length > 0 ? `\n- Current Keywords: ${projectKeywords.join(", ")}` : "";

    const prompt = `Analyze this monitoring focus description for a social media listening project:

Description to analyze:
"${focusText}"

Project context:${keywordsList}${brandsList}

🎯 PRIMARY GOAL: The monitoring focus should help the AI understand what semantic context to look for. Keywords have already been defined - use them to improve the description.

Critically evaluate this description and provide:

1. **Specificity Score (0-100)**: How specific and concrete is it?
   - Does it mention the KEYWORDS explicitly or reference what they represent? (good)
   - Does it use generic terms like "platforms", "tools", "services" without mentioning keywords? (bad)
   - Does it connect keywords to actual use cases, experiences, or discussions? (good)
   - Is it vague or too broad? (bad)

2. **Issues List**: Critical problems that will hurt relevance filtering:
   - Missing keywords: If keywords are defined but not mentioned/incorporated in the description → suggest incorporating them
   - Generic terms without keyword specificity (e.g., "current platforms" when keywords are "Cursor, Lovable" → should mention these)
   - Disconnect between keywords and description (keywords suggest one thing, description suggests another)
   - Missing configured brand names (if brands are configured but not mentioned)
   - Vague language that could match unrelated content
   - Potential false-positive keywords (words that might match generic meanings, e.g., "bolt" could mean hardware)

3. **Suggestions**: Specific, actionable improvements based on the KEYWORDS:
   - Incorporate keywords explicitly: "Include keyword references like: [keyword1], [keyword2]"
   - Replace generic terms with keyword-specific language
   - Connect keywords to actual monitoring scenarios: "Instead of 'tools', describe experiences with [keyword1], [keyword2]"
   - Add missing brand names if keywords represent brands
   - Clarify vague phrases by linking them to keywords

Return ONLY valid JSON:
{
  "score": 75,
  "issues": [
    {
      "type": "generic_term",
      "message": "Uses generic 'platforms' instead of specific brands",
      "severity": "warning",
      "suggestion": "Mention specific brands like 'Cursor, Lovable, Bolt' instead of 'platforms'"
    }
  ],
  "suggestions": [
    {
      "type": "add_keyword",
      "text": "Include concrete references to your keywords",
      "replacement": "Developer experiences with Cursor, Lovable, and Bolt"
    }
  ],
  "highlights": []
}`;

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a critical content quality analyst. Analyze monitoring focus descriptions and provide specific, actionable feedback. Return ONLY valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI API error:", response.status);
      return NextResponse.json(
        { error: "Analysis service unavailable", score: 0, issues: [], suggestions: [] },
        { status: 500 }
      );
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json(
        { error: "No analysis returned", score: 0, issues: [], suggestions: [] },
        { status: 500 }
      );
    }

    // Strip markdown code fences
    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    try {
      const analysis = JSON.parse(content);

      // Validate and normalize response
      const score = Math.max(0, Math.min(100, Number(analysis.score) || 0));
      const issues = Array.isArray(analysis.issues) ? analysis.issues : [];
      const suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
      const highlights = Array.isArray(analysis.highlights) ? analysis.highlights : [];

      return NextResponse.json({
        score,
        issues,
        suggestions,
        highlights,
      });
    } catch (parseError) {
      console.error("Error parsing analysis response:", parseError);
      return NextResponse.json(
        { error: "Invalid analysis response", score: 0, issues: [], suggestions: [] },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error analyzing monitoring focus:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to analyze monitoring focus",
        score: 0,
        issues: [],
        suggestions: [],
      },
      { status: 500 }
    );
  }
}
