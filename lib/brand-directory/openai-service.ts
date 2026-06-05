import { prisma } from "@/lib/prisma";
import { normalizeKeywords, normalizeKeyword } from "./keyword-utils";

export interface DiscoveredBrand {
  company_name: string;
  brand_name: string;
  brand_stage: "ESTABLISHED" | "EMERGING" | "SMALL";
  website_url?: string;
  careers_url?: string;
  blog_news_url?: string;
  linkedin_url?: string;
  facebook_url?: string;
  x_url?: string;
  instagram_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
  discord_url?: string;
}

export interface BrandWithKeywords extends DiscoveredBrand {
  keywords: string[];
}

/**
 * Discover brands for a given taxonomy category using OpenAI
 */
export async function discoverBrandsForTaxonomy(
  taxonomyId: string,
  count: number = 10,
  brandStage?: "ESTABLISHED" | "EMERGING" | "SMALL",
  excludeBrands?: Array<{ company_name: string; brand_name: string }>
): Promise<DiscoveredBrand[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Get taxonomy details
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId, deleted_at: null },
  });

  if (!taxonomy) {
    throw new Error(`Taxonomy with id ${taxonomyId} not found`);
  }

  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  // Get existing brands for THIS taxonomy node to avoid duplicates
  const existingBrandsInTaxonomy = await prisma.brand.findMany({
    where: {
      business_taxonomy_id: taxonomyId,
      deleted_at: null,
    },
    select: {
      company_name: true,
      brand_name: true,
    },
    take: 500, // Get up to 500 existing brands for this taxonomy
  });

  const existingBrandNames = new Set<string>();
  existingBrandsInTaxonomy.forEach((b) => {
    existingBrandNames.add(b.company_name.toLowerCase().trim());
    existingBrandNames.add(b.brand_name.toLowerCase().trim());
  });

  // Add exclude brands (from previous attempts) to the set
  if (excludeBrands) {
    excludeBrands.forEach((b) => {
      existingBrandNames.add(b.company_name.toLowerCase().trim());
      existingBrandNames.add(b.brand_name.toLowerCase().trim());
    });
  }

  const existingBrandsList = Array.from(existingBrandNames).slice(0, 100); // Limit to 100 for prompt

  // Log deduplication info
  if (existingBrandsInTaxonomy.length > 0) {
    console.log(
      `[Brand Discovery] Found ${existingBrandsInTaxonomy.length} existing brands for taxonomy "${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}". Passing ${existingBrandsList.length} brand names to OpenAI to avoid duplicates.`
    );
  }

  // Build prompt for brand discovery
  const stageFilter = brandStage
    ? ` Focus on ${brandStage.toLowerCase()} companies.`
    : " Include a mix of established, emerging, and small companies.";

  const duplicateWarning =
    existingBrandsList.length > 0
      ? `\n\n🚨 CRITICAL - ABSOLUTELY NO DUPLICATES ALLOWED 🚨\n\nThe following ${existingBrandsList.length} brand names already exist in our database for this exact category (${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}).\n\nEXCLUDED BRANDS (DO NOT USE ANY OF THESE):\n${existingBrandsList.map((name, idx) => `${idx + 1}. ${name}`).join("\n")}\n\nMANDATORY REQUIREMENTS:\n1. You MUST return exactly ${count} NEW brands that are NOT in the excluded list above\n2. Check BOTH company_name AND brand_name against the excluded list (case-insensitive)\n3. If a company's name or brand name matches ANY entry in the excluded list, DO NOT include it\n4. If you cannot find ${count} new brands, return fewer but NEVER return duplicates\n5. This is critical - returning duplicates will cause errors\n\nIMPORTANT: Before including any brand in your response, verify that neither its company_name nor brand_name appears in the excluded list above. If there's any match, skip that brand and find a different one.`
      : "";

  const prompt = `You are a business intelligence expert. Find ${count} real companies/brands that operate in the following business category:

Category: ${taxonomy.category}
Subcategory: ${taxonomy.subcategory}
Sub-subcategory: ${taxonomy.sub_subcategory}
${stageFilter}${duplicateWarning}

For each company, provide:
1. Company name (official legal name)
2. Brand name (may differ from company name, e.g., "Meta" vs "Facebook Inc.")
3. Brand stage: ESTABLISHED, EMERGING, or SMALL
4. Website URL (if available)
5. Careers/jobs page URL (if available)
6. Blog/News URL (if available – company blog, newsroom, or press page)
7. LinkedIn company page URL (if available)
8. Facebook page URL (if available)
9. X/Twitter handle URL (if available)
10. Instagram page URL (if available)
11. TikTok account URL (if available)
12. YouTube channel URL (if available)
13. Discord server/channel URL (if available)

Return ONLY a valid JSON object with a "brands" array in this exact format:
{
  "brands": [
    {
      "company_name": "Example Corp",
      "brand_name": "Example",
      "brand_stage": "ESTABLISHED",
      "website_url": "https://example.com",
      "careers_url": "https://example.com/careers",
      "blog_news_url": "https://example.com/blog",
      "linkedin_url": "https://linkedin.com/company/example",
      "facebook_url": "https://facebook.com/example",
      "x_url": "https://x.com/example",
      "instagram_url": "https://instagram.com/example",
      "tiktok_url": null,
      "youtube_url": "https://youtube.com/@example",
      "discord_url": null
    }
  ]
}

Important:
- Only include real, existing companies
- URLs should be valid and accessible
- Use null for unavailable URLs
- Ensure brand_stage is one of: ESTABLISHED, EMERGING, SMALL
- Return exactly ${count} companies in the brands array (or fewer if you cannot find ${count} new ones)
- CRITICAL: Verify each brand name against the excluded list above - if ANY match is found (company_name OR brand_name), skip that brand entirely
- Quality over quantity: It's better to return fewer brands than to return duplicates`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a brand intelligence expert specializing in accurate brand discovery. Find real companies and return valid JSON only. Focus on accuracy and brand-specificity.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
        // Increase max_tokens based on count: ~200 tokens per brand, with buffer
        max_tokens: Math.max(4000, count * 250 + 2000),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    const finishReason = data.choices[0]?.finish_reason;

    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    // Check if response was truncated
    if (finishReason === "length") {
      console.warn(
        `OpenAI response was truncated (finish_reason: length). Consider increasing max_tokens or reducing count.`
      );
    }

    // Parse JSON response
    let brands: DiscoveredBrand[];
    try {
      const parsed = JSON.parse(content);
      // Handle both { brands: [...] } and [...] formats
      if (Array.isArray(parsed)) {
        brands = parsed;
      } else if (parsed.brands && Array.isArray(parsed.brands)) {
        brands = parsed.brands;
      } else if (parsed.companies && Array.isArray(parsed.companies)) {
        brands = parsed.companies;
      } else {
        // Try to find any array in the response
        const arrayValues = Object.values(parsed).find((v) => Array.isArray(v));
        brands = arrayValues ? (arrayValues as DiscoveredBrand[]) : [];
      }
    } catch (parseError: any) {
      // If JSON parsing fails, try to fix common issues
      let fixedContent = content;

      // Try to fix unterminated strings by finding the last complete brand entry
      if (parseError.message?.includes("Unterminated string")) {
        // Find the last complete brand object
        const brandMatches = fixedContent.match(/\{[^}]*"company_name"[^}]*\}/g);
        if (brandMatches && brandMatches.length > 0) {
          // Use only complete brand entries
          const lastCompleteMatch = brandMatches[brandMatches.length - 1];
          const lastIndex = fixedContent.lastIndexOf(lastCompleteMatch);
          if (lastIndex !== -1) {
            // Extract up to the last complete brand
            const truncated = fixedContent.substring(0, lastIndex + lastCompleteMatch.length);
            // Try to close the JSON structure
            fixedContent = truncated.replace(/(\s*)([,\s]*)$/, "]}");
          }
        }
      }

      // Try parsing the fixed content
      try {
        const parsed = JSON.parse(fixedContent);
        if (parsed.brands && Array.isArray(parsed.brands)) {
          brands = parsed.brands;
        } else if (Array.isArray(parsed)) {
          brands = parsed;
        } else {
          throw parseError; // Re-throw original error if fix didn't work
        }
      } catch (fixError) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
        if (jsonMatch) {
          brands = JSON.parse(jsonMatch[1]);
        } else {
          // Try to find JSON object with array (more lenient)
          const objMatch = content.match(/\{[\s\S]*"brands"[\s\S]*:[\s\S]*\[[\s\S]*\]/);
          if (objMatch) {
            try {
              const objParsed = JSON.parse(objMatch[0]);
              brands = objParsed.brands || [];
            } catch {
              throw new Error(
                `Failed to parse OpenAI response as JSON. Response may have been truncated. Original error: ${parseError.message}. Content length: ${content.length} characters. Finish reason: ${finishReason || "unknown"}.`
              );
            }
          } else {
            throw new Error(
              `Failed to parse OpenAI response as JSON: ${parseError.message}. Response may have been truncated. Content length: ${content.length} characters. Finish reason: ${finishReason || "unknown"}.`
            );
          }
        }
      }
    }

    // Validate and normalize brands
    return brands.map((brand) => ({
      company_name: brand.company_name || "",
      brand_name: brand.brand_name || brand.company_name || "",
      brand_stage: (brand.brand_stage || "ESTABLISHED").toUpperCase() as
        | "ESTABLISHED"
        | "EMERGING"
        | "SMALL",
      website_url: brand.website_url || undefined,
      careers_url: brand.careers_url || undefined,
      blog_news_url: brand.blog_news_url || undefined,
      linkedin_url: brand.linkedin_url || undefined,
      facebook_url: brand.facebook_url || undefined,
      x_url: brand.x_url || undefined,
      instagram_url: brand.instagram_url || undefined,
      tiktok_url: brand.tiktok_url || undefined,
      youtube_url: brand.youtube_url || undefined,
      discord_url: brand.discord_url || undefined,
    }));
  } catch (error) {
    console.error("Error discovering brands with OpenAI:", error);
    throw error;
  }
}

/**
 * Generate keywords for a brand based on what the brand actually does (brand-specific, not generic category terms)
 */
export async function generateKeywordsForBrand(
  brand: DiscoveredBrand,
  taxonomyId: string,
  minKeywords: number = 4
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Get taxonomy details
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId, deleted_at: null },
  });

  if (!taxonomy) {
    throw new Error(`Taxonomy with id ${taxonomyId} not found`);
  }

  // Get existing keywords from other brands in the same sub-subcategory
  const existingBrands = await prisma.brand.findMany({
    where: {
      business_taxonomy_id: taxonomyId,
      deleted_at: null,
    },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
    },
    take: 10, // Get up to 10 existing brands for reference
  });

  const existingKeywords = new Set<string>();
  existingBrands.forEach((b) => {
    b.keywords.forEach((k) => existingKeywords.add(k.keyword.toLowerCase()));
  });

  const existingKeywordsList = Array.from(existingKeywords).slice(0, 20); // Limit to 20 for prompt

  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  // Build website context - CRITICAL for accurate keyword generation
  const websiteContext = brand.website_url
    ? `\n\n🌐🌐🌐 WEBSITE URL: ${brand.website_url} 🌐🌐🌐\n\n🚨🚨🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY 🚨🚨🚨\n\nYou MUST analyze the website ${brand.website_url} and generate keywords based on WHAT THE PRODUCT ACTUALLY DOES:\n\n1. VISIT/ANALYZE THE WEBSITE: ${brand.website_url}\n   - Read the homepage headline and tagline\n   - Read the product description\n   - Identify the main features and capabilities\n   - Note how the website describes itself\n\n2. UNDERSTAND THE PRODUCT:\n   - What is the core product? (e.g., "app builder", "code generator", "payment processor")\n   - What are the main features? (e.g., "no-code", "prompt-based", "rapid prototyping")\n   - How do users describe it? (e.g., "build apps with prompts", "AI that writes code")\n   - What problem does it solve? (e.g., "build apps without coding", "generate code from text")\n\n3. GENERATE KEYWORDS BASED ON PRODUCT FEATURES:\n   - Use keywords that describe WHAT THE PRODUCT DOES (not abstract concepts)\n   - Match the terminology the website uses\n   - Think: "If I searched Google for '[keyword]', would I find this product?"\n   - Use 1-2 word phrases that describe the product's core functionality\n\n4. EXAMPLES:\n   - If website says "AI-powered app builder" → keywords: "app builder", "no-code development", "rapid prototyping"\n   - If website says "prompt-to-app platform" → keywords: "prompt to app", "natural language programming", "app builder"\n   - If website says "code generation tool" → keywords: "code generation", "ai coding", "automated coding"\n   - If website says "payment processing" → keywords: "payment processing", "payment gateway", "online payments"\n\n5. AVOID GENERIC TERMS:\n   ❌ "agents" (too generic, doesn't describe the product)\n   ❌ "experiences" (meaningless, doesn't describe the product)\n   ❌ "personalized ai" (too generic, doesn't match product features)\n   ❌ "user interaction" (too generic, doesn't describe the product)\n   ❌ "ai" alone (too broad)\n   ❌ "platform" alone (too generic)\n   ❌ "technology" (too generic)\n\n6. SPECIFIC EXAMPLE FOR LOVABLE (https://lovable.dev/):\n   The website describes Lovable as an "AI-powered app builder" that lets you "build apps with prompts".\n   CORRECT keywords: "app builder", "no-code development", "prompt to app", "rapid prototyping", "website builder", "natural language programming"\n   WRONG keywords: "agents", "experiences", "personalized ai", "user interaction"\n\nREMEMBER: Keywords must describe WHAT THE PRODUCT DOES, not abstract concepts or generic category terms!\n`
    : `\n\n⚠️  No website URL provided. Research "${brand.brand_name}" to understand:\n- What the product actually does\n- Its core features and capabilities\n- How users describe it\n- What problem it solves\n\nGenerate keywords based on the product's actual functionality, not generic category terms.\n`;

  // Build category context (optional, not forced) - REMOVED to avoid generic keywords
  // We don't want category context to influence keyword generation

  const prompt = `You are a brand intelligence expert. Your task is to generate accurate, product-specific keywords for this brand.

BRAND INFORMATION:
Company: ${brand.company_name}
Brand: ${brand.brand_name}
Category: ${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}
Stage: ${brand.brand_stage}${websiteContext}

STEP 1: ANALYZE THE PRODUCT
Based on the website URL (if provided) or your knowledge, describe what this product ACTUALLY DOES:
- What is the core product or service?
- What are the main features/capabilities?
- How do users describe this product?
- What problem does it solve?
- What makes it unique?

STEP 2: GENERATE KEYWORDS BASED ON PRODUCT FEATURES
Generate at least ${minKeywords} keywords that:
1. Describe WHAT THE PRODUCT DOES (e.g., "app builder", "code generation", "payment processing")
2. Match terminology users would search for on Google (e.g., "no-code development", "rapid prototyping")
3. Reflect the product's actual features/capabilities from the website
4. Use the exact terminology the website uses to describe itself
5. Are what people would type when looking for THIS specific product

EXAMPLES OF GOOD KEYWORDS (product-specific, describe what the product DOES):
✅ "app builder" (for an app building platform like Lovable)
✅ "no-code development" (for a no-code platform)
✅ "prompt to app" (for a prompt-to-app platform)
✅ "code generation" (for a code generation tool)
✅ "payment processing" (for a payment processor)
✅ "cloud storage" (for a cloud storage service)
✅ "rapid prototyping" (for a prototyping tool)
✅ "website builder" (for a website building platform)
✅ "natural language programming" (for an NLP-based coding tool)
✅ "full-stack engineer" (for an AI that writes full-stack code)
✅ "prompt engineering" (for a platform that uses prompts to build)

EXAMPLES OF BAD KEYWORDS (too generic or wrong):
❌ "agents" (too generic, doesn't describe what the product does)
❌ "experiences" (meaningless, doesn't describe the product)
❌ "personalized ai" (too generic, doesn't match product features)
❌ "user interaction" (too generic, doesn't describe the product)
❌ "ai" (too broad)
❌ "technology" (too generic)
❌ "software" (too generic)
❌ "platform" (too generic)
❌ "assistants" (if product doesn't do assistants)
❌ "chatbots" (if product doesn't do chatbots)

CRITICAL RULES:
- Keywords must be 1-3 words maximum (e.g., "app builder", "no-code development", "natural language programming", "payment processing")
- Keywords should describe WHAT THE PRODUCT DOES, not abstract concepts
- Use COMPLETE phrases - don't cut off words (e.g., use "prompt to app" not "prompt to")
- Use terminology from the website or how users describe the product
- Think: "If I searched Google for '[keyword]', would I find this product?"
- Match the language the website uses (e.g., if website says "no-code", use "no-code")
- Do NOT use generic category terms - use product-specific terms
- Do NOT use abstract concepts like "experiences", "interaction", "personalization" unless they're core product features
- Do NOT use single generic words like "natural language" - use complete phrases like "natural language programming"
- If a keyword is part of a phrase (e.g., "prompt to app"), include the full phrase, not just part of it

Return ONLY a valid JSON object with this structure:
{
  "brand_description": "1-2 sentence description of what this product does based on the website",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"]
}

Minimum ${minKeywords} keywords required. Each keyword should be 1-3 words maximum and describe what the product DOES.`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a brand intelligence expert specializing in accurate keyword generation. Your goal is to generate product-specific keywords that accurately describe what each product DOES, based on the website URL provided. Always analyze the website content first, then generate keywords that match the product's actual features and capabilities. Use terminology that users would search for on Google to find this specific product. Never use generic category terms - always use product-specific terms that describe what the product does.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
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

    // Parse JSON response
    let keywords: string[];
    let brandDescription: string | undefined;
    try {
      const parsed = JSON.parse(content);

      // Extract brand description if present (for logging/debugging)
      if (parsed.brand_description) {
        brandDescription = parsed.brand_description;
        console.log(
          `[Keyword Generation] Brand description for "${brand.brand_name}": ${brandDescription}`
        );
      }

      // Handle both { keywords: [...] } and [...] formats
      if (Array.isArray(parsed)) {
        keywords = parsed;
      } else if (parsed.keywords && Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords;
      } else {
        // Try to find any array in the response
        const arrayValues = Object.values(parsed).find((v) => Array.isArray(v));
        keywords = arrayValues ? (arrayValues as string[]) : [];
      }
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
      if (jsonMatch) {
        keywords = JSON.parse(jsonMatch[1]);
      } else {
        // Try to find JSON object with keywords array
        const objMatch = content.match(/\{[\s\S]*"keywords"[\s\S]*:[\s\S]*\[[\s\S]*\]/);
        if (objMatch) {
          const objParsed = JSON.parse(objMatch[0]);
          keywords = objParsed.keywords || [];
        } else {
          throw new Error(`Failed to parse OpenAI response as JSON: ${parseError}`);
        }
      }
    }

    // Normalize keywords according to social media best practices
    const normalizedKeywords = normalizeKeywords(keywords);

    // Post-process keywords to fix incomplete phrases
    const processedKeywords = normalizedKeywords.map((keyword) => {
      const keywordLower = keyword.toLowerCase().trim();

      // Fix incomplete phrases
      if (keywordLower === "prompt to") {
        return "prompt to app";
      }
      if (keywordLower === "natural language") {
        return "natural language programming";
      }
      if (keywordLower === "no-code" || keywordLower === "nocode") {
        return "no-code development";
      }
      if (
        keywordLower === "-use security" ||
        keywordLower === "-use monitoring" ||
        keywordLower === "-use compliance"
      ) {
        return "tool-use security";
      }
      if (keywordLower.startsWith("-use")) {
        return keyword.replace("-use", "tool-use");
      }

      return keyword;
    });

    // Validate keywords - filter out overly generic ones
    const validatedKeywords = processedKeywords.filter((keyword) => {
      const keywordLower = keyword.toLowerCase();

      // Filter out overly generic single-word keywords
      const genericWords = [
        "ai",
        "technology",
        "tech",
        "software",
        "platform",
        "platforms",
        "tool",
        "tools",
        "service",
        "services",
        "solution",
        "solutions",
        "system",
        "systems",
        "digital",
        "innovation",
        "innovations",
        "natural language", // Too generic without "programming"
      ];

      // Allow generic words only if they're part of a 2-word phrase
      if (keywordLower.split(/\s+/).length === 1 && genericWords.includes(keywordLower)) {
        console.log(
          `[Keyword Generation] Filtered out overly generic keyword: "${keyword}" for brand "${brand.brand_name}"`
        );
        return false;
      }

      // Filter out incomplete phrases
      if (keywordLower === "prompt to" || keywordLower === "natural language") {
        console.log(
          `[Keyword Generation] Filtered out incomplete keyword: "${keyword}" for brand "${brand.brand_name}"`
        );
        return false;
      }

      return true;
    });

    // DO NOT automatically add sub-subcategory - it's often too generic
    // Only add it if it's actually descriptive of what the product does
    // For now, skip adding category terms automatically

    // Combine validated keywords (without forcing category terms)
    const finalKeywords = new Set<string>();
    validatedKeywords.forEach((keyword) => finalKeywords.add(keyword));

    // Log final keywords for debugging
    if (brandDescription) {
      console.log(
        `[Keyword Generation] Final keywords for "${brand.brand_name}": ${Array.from(finalKeywords).join(", ")}`
      );
    }

    // Limit to reasonable number of keywords
    return Array.from(finalKeywords).slice(0, 15);
  } catch (error) {
    console.error("Error generating keywords with OpenAI:", error);
    throw error;
  }
}

/**
 * Search for a single brand using OpenAI and match it to the best taxonomy location
 *
 * @param brandName - Brand name (required)
 * @param companyName - Company name (optional, helps improve accuracy)
 * @param websiteUrl - Website URL (optional, helps improve accuracy)
 * @returns Brand data with suggested taxonomy_id, or null if not found
 */
export async function searchBrandWithOpenAI(
  brandName: string,
  companyName?: string,
  websiteUrl?: string
): Promise<{
  brand: (DiscoveredBrand & { business_taxonomy_id: string; keywords: string[] }) | null;
  duplicate: any | null;
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Get all taxonomies to pass to OpenAI for matching
  const allTaxonomies = await prisma.businessTaxonomy.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  // Build taxonomy tree structure for OpenAI
  const taxonomyTree: Record<
    string,
    Record<string, Array<{ id: string; sub_subcategory: string }>>
  > = {};
  allTaxonomies.forEach((tax) => {
    if (!taxonomyTree[tax.category]) {
      taxonomyTree[tax.category] = {};
    }
    if (!taxonomyTree[tax.category][tax.subcategory]) {
      taxonomyTree[tax.category][tax.subcategory] = [];
    }
    taxonomyTree[tax.category][tax.subcategory].push({
      id: tax.id,
      sub_subcategory: tax.sub_subcategory,
    });
  });

  // Format taxonomy tree as text for prompt
  const taxonomyTreeText = Object.entries(taxonomyTree)
    .map(([category, subcategories]) => {
      const subcategoryList = Object.entries(subcategories)
        .map(([subcategory, subSubcategories]) => {
          const subSubcategoryList = subSubcategories
            .map((ss) => `    - ${ss.sub_subcategory} (ID: ${ss.id})`)
            .join("\n");
          return `  - ${subcategory}:\n${subSubcategoryList}`;
        })
        .join("\n");
      return `- ${category}:\n${subcategoryList}`;
    })
    .join("\n");

  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  // Check for duplicate first (using contains for initial filter, then exact match)
  const brandLower = brandName.toLowerCase().trim();
  const companyLower = companyName?.toLowerCase().trim() || "";

  const candidates = await prisma.brand.findMany({
    where: {
      deleted_at: null,
      OR: [
        { brand_name: { contains: brandLower } },
        { company_name: { contains: brandLower } },
        ...(companyLower
          ? [
              { brand_name: { contains: companyLower } },
              { company_name: { contains: companyLower } },
            ]
          : []),
      ],
    },
    include: {
      businessTaxonomy: {
        select: {
          id: true,
          category: true,
          subcategory: true,
          sub_subcategory: true,
        },
      },
    },
  });

  // Check for exact match (case-insensitive)
  const duplicateCheck = candidates.find((brand) => {
    const existingBrandLower = brand.brand_name.toLowerCase().trim();
    const existingCompanyLower = brand.company_name.toLowerCase().trim();

    return (
      existingBrandLower === brandLower ||
      existingCompanyLower === brandLower ||
      (companyLower &&
        (existingBrandLower === companyLower || existingCompanyLower === companyLower))
    );
  });

  if (duplicateCheck) {
    return {
      brand: null,
      duplicate: {
        id: duplicateCheck.id,
        company_name: duplicateCheck.company_name,
        brand_name: duplicateCheck.brand_name,
        website_url: duplicateCheck.website_url,
        businessTaxonomy: duplicateCheck.businessTaxonomy,
      },
    };
  }

  const prompt = `You are a business intelligence expert. Find information about this brand and match it to the best category in our taxonomy tree.

Brand Name: ${brandName}
${companyName ? `Company Name: ${companyName}` : ""}
${websiteUrl ? `Website URL: ${websiteUrl}` : ""}

${
  websiteUrl
    ? `CRITICAL: A website URL has been provided: ${websiteUrl}
- Use your knowledge about this website to find accurate brand information
- Research what this company does based on the website domain and your knowledge
- Find their social media profiles (LinkedIn, Twitter/X, Facebook, Instagram, etc.)
- Determine the company's official name, brand name, and business stage
- The website URL is a key reference point - use it to verify and find all available information`
    : ""
}

TAXONOMY TREE (find the best match):
${taxonomyTreeText}

Your task:
1. ${websiteUrl ? `🌐 CRITICAL: Website URL: ${websiteUrl}\n   - Use this website URL as your PRIMARY source of truth\n   - Visit this website or use your knowledge about this specific website\n   - Understand what this brand actually does based on the website\n   - Generate keywords based on what the website shows, NOT generic category assumptions\n\n` : ""}Find comprehensive information about this brand:
   - Official company name (legal entity name)
   - Brand name (may differ from company name)
   - Brand stage: ESTABLISHED (well-known, large company), EMERGING (growing startup/company), or SMALL (small business/startup)
   - All available URLs (website, careers, blog/news, LinkedIn, Facebook, X/Twitter, Instagram, TikTok, YouTube, Discord)
2. Determine the BEST matching taxonomy location from the tree above based on what the brand actually does
3. Return the taxonomy_id of the best match (must be an exact ID from the taxonomy tree)
4. Generate 4-6 relevant keywords (1-2 words each) that accurately describe what THIS SPECIFIC brand is really known for

CRITICAL KEYWORD REQUIREMENTS:
- Keywords must be brand-specific, not generic category terms
- Base keywords on what the brand actually does (use website URL if provided)
- Examples of GOOD keywords: "prompt to app", "code generation", "payment processing", "cloud storage"
- Examples of BAD keywords (too generic): "ai", "technology", "software", "platform", "solutions"
- Keywords should be what people would search for when looking for THIS specific brand
- Do NOT use generic words like "solutions", "services", "tools", "platforms", "software", "systems", "innovations", "technology", "digital", "ai", "tech" unless part of a specific phrase

Return ONLY a valid JSON object in this exact format:
{
  "company_name": "Official Company Name",
  "brand_name": "Brand Name",
  "brand_stage": "ESTABLISHED" | "EMERGING" | "SMALL",
  "business_taxonomy_id": "taxonomy-id-from-tree-above",
  "website_url": "https://example.com" or null,
  "careers_url": "https://example.com/careers" or null,
  "blog_news_url": "https://example.com/blog" or null,
  "linkedin_url": "https://linkedin.com/company/example" or null,
  "facebook_url": "https://facebook.com/example" or null,
  "x_url": "https://x.com/example" or null,
  "instagram_url": "https://instagram.com/example" or null,
  "tiktok_url": "https://tiktok.com/@example" or null,
  "youtube_url": "https://youtube.com/@example" or null,
  "discord_url": "https://discord.gg/example" or null,
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"]
}

CRITICAL REQUIREMENTS:
- business_taxonomy_id MUST be one of the IDs from the taxonomy tree above
- Match the brand to the MOST SPECIFIC and ACCURATE sub-subcategory
- Keywords must be 1-2 words maximum, focusing on what the brand is really known for
- Use null for unavailable URLs
- CRITICAL: Double-check brand names and company names for accuracy - verify spelling carefully
- CRITICAL: Ensure all URLs match the brand/company name - URLs should contain the brand name or company name in the domain or handle
- If URLs don't match the brand name, verify you have the correct brand before including them
- If you cannot find the brand, return null for all fields`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a brand intelligence expert specializing in accurate brand research and keyword generation. Your goal is to find accurate information about brands and generate brand-specific keywords that reflect what each brand is really known for, not generic category terms.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { brand: null, duplicate: null };
    }

    // Parse JSON response
    let result: any;
    try {
      result = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error(`Failed to parse OpenAI response as JSON: ${parseError}`);
      }
    }

    // Validate that taxonomy_id exists
    if (result.business_taxonomy_id) {
      const taxonomyExists = allTaxonomies.find((t) => t.id === result.business_taxonomy_id);
      if (!taxonomyExists) {
        console.error(
          `[searchBrandWithOpenAI] Invalid taxonomy_id returned: ${result.business_taxonomy_id}`
        );
        return { brand: null, duplicate: null };
      }
    }

    // Check if brand was found (all required fields present)
    if (
      result.company_name &&
      result.brand_name &&
      result.business_taxonomy_id &&
      result.keywords &&
      Array.isArray(result.keywords) &&
      result.keywords.length > 0
    ) {
      return {
        brand: {
          company_name: result.company_name,
          brand_name: result.brand_name,
          brand_stage: (result.brand_stage || "ESTABLISHED").toUpperCase() as
            | "ESTABLISHED"
            | "EMERGING"
            | "SMALL",
          business_taxonomy_id: result.business_taxonomy_id,
          keywords: result.keywords || [],
          website_url: result.website_url || undefined,
          careers_url: result.careers_url || undefined,
          blog_news_url: result.blog_news_url || undefined,
          linkedin_url: result.linkedin_url || undefined,
          facebook_url: result.facebook_url || undefined,
          x_url: result.x_url || undefined,
          instagram_url: result.instagram_url || undefined,
          tiktok_url: result.tiktok_url || undefined,
          youtube_url: result.youtube_url || undefined,
          discord_url: result.discord_url || undefined,
        },
        duplicate: null,
      };
    }

    return { brand: null, duplicate: null };
  } catch (error) {
    console.error("Error searching for brand with OpenAI:", error);
    throw error;
  }
}

/**
 * Find Blog/News URL for an existing brand using OpenAI.
 * Uses the same instruction as brand search: company blog, newsroom, or press page.
 * Use this to enrich existing brands without running full search (which would hit duplicate).
 *
 * @param brandName - Brand name
 * @param companyName - Company name (optional)
 * @param websiteUrl - Website URL (optional, helps accuracy)
 * @returns blog_news_url or null if not found / API error
 */
export async function findBlogNewsUrlWithOpenAI(
  brandName: string,
  companyName?: string,
  websiteUrl?: string
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    return null;
  }

  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const prompt = `You are a business intelligence expert. Find the official Blog or News URL for this brand — the page that lists the company's own press releases, news, or blog posts.

Brand Name: ${brandName}
${companyName ? `Company Name: ${companyName}` : ""}
${websiteUrl ? `Website URL: ${websiteUrl}` : ""}

Find the company's official page that lists their news/press/blog. Common paths (use the one the company actually uses; do not guess):
- /newsroom (common for many companies, e.g. company.com/newsroom)
- /news
- /press or /press-room
- /blog
- /media or /media-room
- Subdomains: news.company.com, newsroom.company.com, blog.company.com

Return ONLY a valid JSON object in this exact format:
{ "blog_news_url": "https://..." }
Use null if you cannot find a reliable blog or news URL: { "blog_news_url": null }

Requirements:
- URL must be the official company page that lists articles/press releases, not a single article or third-party site.
- Return the exact path the company uses (e.g. if they use /newsroom return that URL, not /news).`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a brand research expert. Return only valid JSON with blog_news_url (string or null).",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[findBlogNewsUrlWithOpenAI] API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;

    let result: { blog_news_url?: string | null };
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      else return null;
    }

    const url = result.blog_news_url;
    if (typeof url === "string" && url.trim().length > 0) {
      return url.trim();
    }
    return null;
  } catch (error) {
    console.error("[findBlogNewsUrlWithOpenAI] Error:", error);
    return null;
  }
}
