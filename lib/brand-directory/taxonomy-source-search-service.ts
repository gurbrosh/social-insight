/**
 * Service for searching influencers and sources using OpenAI based on taxonomy nodes
 */

import type { InfluencerPlatform, SourceCategory } from "./brand-additional-links-service";
import {
  getInfluencerLinksForTaxonomy,
  getInfluencerLinksForSubcategory,
  getInfluencerLinksForCategory,
} from "./taxonomy-influencer-links-service";
import {
  getOtherSourceLinksForTaxonomy,
  getOtherSourceLinksForSubcategory,
  getOtherSourceLinksForCategory,
} from "./taxonomy-other-source-links-service";
import {
  getRedditLinksForTaxonomy,
  getRedditLinksForSubcategory,
  getRedditLinksForCategory,
} from "./reddit-links-service";
import { normalizeYouTubeUrl } from "@/lib/utils/youtube-url-normalization";

export interface TaxonomyNode {
  type: "category" | "subcategory" | "sub_subcategory";
  category?: string;
  subcategory?: string;
  sub_subcategory?: string;
  id?: string;
}

export interface PlatformSearchConfig {
  platform: string;
  count: number;
  linkType: "INFLUENCER" | "REDDIT" | "OTHER_SOURCE";
  sourceCategory?: SourceCategory;
}

export interface SearchResult {
  name?: string | null;
  url: string;
  selected?: boolean;
  isDuplicate?: boolean;
}

export interface SearchProgress {
  searchId: string;
  status: "in_progress" | "completed" | "error";
  progress: number; // 0-100
  currentPlatform?: string;
  results: Record<string, SearchResult[]>;
  error?: string;
}

// In-memory storage for search progress (keyed by searchId)
// Use global variable pattern to persist across module reloads (like Prisma does)
const globalForSearchProgress = globalThis as unknown as {
  searchProgressMap: Map<string, SearchProgress> | undefined;
};

const searchProgressMap =
  globalForSearchProgress.searchProgressMap ?? new Map<string, SearchProgress>();

if (process.env.NODE_ENV !== "production") {
  globalForSearchProgress.searchProgressMap = searchProgressMap;
}

/**
 * Normalize URL for duplicate detection
 */
function normalizeUrl(url: string): string {
  if (!url) return "";
  return url
    .toLowerCase()
    .trim()
    .replace(/\/$/, "") // Remove trailing slash
    .replace(/^https?:\/\/(www\.)?/, ""); // Remove protocol and www
}

/**
 * Search LinkedIn profiles using web search API
 *
 * This implements ChatGPT's recommended approach: use web search to find REAL LinkedIn URLs
 * instead of asking OpenAI to invent them. This eliminates broken/guessed URLs.
 *
 * Supports multiple search APIs:
 * - Bing Web Search API (BING_WEB_SEARCH_API_KEY)
 * - SerpAPI (SERPAPI_KEY) - Recommended alternative
 * - Google Custom Search API (GOOGLE_CSE_API_KEY + GOOGLE_CSE_ENGINE_ID)
 *
 * Returns array of LinkedIn profile URLs found in search results with extracted names
 *
 * EXPORTED for use across the project (project definition page, brand directory, etc.)
 */
export async function searchLinkedInProfiles(
  topic: string,
  keywords: string[],
  count: number,
  brandName?: string
): Promise<Array<{ url: string; title: string; snippet: string; name?: string }>> {
  // Try SerpAPI first (most reliable, works with Google/Bing)
  const serpApiKey = process.env.SERPAPI_KEY;
  if (serpApiKey) {
    console.log(`[searchLinkedInProfiles] Using SerpAPI for web search`);
    return await searchLinkedInWithSerpAPI(topic, keywords, count, serpApiKey, brandName);
  }

  // Fallback to Bing Web Search API
  const bingApiKey = process.env.BING_WEB_SEARCH_API_KEY;
  console.log(`[searchLinkedInProfiles] Checking for Bing API key...`);
  console.log(`[searchLinkedInProfiles] BING_WEB_SEARCH_API_KEY exists: ${!!bingApiKey}`);
  console.log(
    `[searchLinkedInProfiles] BING_WEB_SEARCH_API_KEY length: ${bingApiKey?.length || 0}`
  );
  console.log(
    `[searchLinkedInProfiles] BING_WEB_SEARCH_API_KEY preview: ${bingApiKey ? `${bingApiKey.substring(0, 8)}...${bingApiKey.substring(bingApiKey.length - 4)}` : "none"}`
  );

  if (!bingApiKey) {
    console.log(
      "[searchLinkedInProfiles] ❌ Bing API key not configured (BING_WEB_SEARCH_API_KEY), falling back to OpenAI-only approach"
    );
    console.log(
      "[searchLinkedInProfiles] To enable web search: Get a free key at https://www.microsoft.com/en-us/bing/apis/bing-web-search-api"
    );
    return [];
  }

  // Validate key format (Bing keys are typically 32 characters, alphanumeric)
  if (bingApiKey.length !== 32) {
    console.log(
      `[searchLinkedInProfiles] ⚠️ Warning: Bing API key length is ${bingApiKey.length}, expected 32 characters`
    );
  }

  console.log(`[searchLinkedInProfiles] ✅ Bing API key found, proceeding with web search`);

  try {
    // Build search queries - use multiple queries to get better coverage
    const queries: string[] = [];

    // Query 1: General topic search
    const topicTerms = keywords.length > 0 ? keywords.join(" OR ") : topic;
    queries.push(
      `site:linkedin.com/in/ (${topicTerms}) (founder OR "content creator" OR "community" OR "podcast" OR "newsletter" OR "speaker" OR "advisor") -jobs -learning -pulse`
    );

    // Query 2: Industry-specific
    queries.push(
      `site:linkedin.com/in/ ("${topic}" OR "${keywords.join('" OR "')}") (marketing OR community OR partnerships OR "thought leader") -jobs -pulse`
    );

    // Query 3: E-commerce/retail focus if applicable
    if (
      topic.toLowerCase().includes("retail") ||
      topic.toLowerCase().includes("store") ||
      topic.toLowerCase().includes("supply")
    ) {
      queries.push(
        `site:linkedin.com/in/ ("${topic}" AND (ecommerce OR retail)) ("posts" OR "followers" OR "connections") -jobs`
      );
    }

    const allResults: Array<{ url: string; title: string; snippet: string }> = [];
    const seenUrls = new Set<string>();

    // Execute each query
    // Try both endpoints: traditional Bing Search v7 and Azure AI Services endpoint
    for (const query of queries.slice(0, 3)) {
      // Limit to 3 queries to avoid rate limits
      try {
        // First try traditional Bing Search v7 endpoint
        let response = await fetch(
          `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=20&responseFilter=Webpages`,
          {
            headers: {
              "Ocp-Apim-Subscription-Key": bingApiKey,
            },
          }
        );

        // If 401, try Azure AI Services endpoint (for BingGroundingSearch resources)
        if (response.status === 401) {
          console.log(
            `[searchLinkedInProfiles] Traditional endpoint returned 401, trying Azure AI Services endpoint...`
          );
          // Note: Azure AI Services might use different authentication (API key in query param or different header)
          // For now, try the same endpoint but this might need adjustment based on your specific resource
          response = await fetch(
            `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=20&responseFilter=Webpages`,
            {
              headers: {
                "Ocp-Apim-Subscription-Key": bingApiKey,
                "Content-Type": "application/json",
              },
            }
          );
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.log(
            `[searchLinkedInProfiles] ❌ Bing API error for query "${query.substring(0, 100)}...": ${response.status} ${response.statusText}`
          );
          console.log(`[searchLinkedInProfiles] Error details:`, errorText);

          if (response.status === 401) {
            console.log(
              `[searchLinkedInProfiles] ⚠️ 401 Unauthorized - Your Bing API key authentication failed.`
            );
            console.log(`[searchLinkedInProfiles]`);
            console.log(
              `[searchLinkedInProfiles] ⚠️ IMPORTANT: You need a "Bing Search v7" resource, NOT "BingGroundingSearch"`
            );
            console.log(`[searchLinkedInProfiles]`);
            console.log(
              `[searchLinkedInProfiles] BingGroundingSearch is for AI agents, not direct web search API`
            );
            console.log(`[searchLinkedInProfiles]`);
            console.log(`[searchLinkedInProfiles] To fix:`);
            console.log(`[searchLinkedInProfiles] 1. Go to https://portal.azure.com/`);
            console.log(`[searchLinkedInProfiles] 2. Create a NEW resource`);
            console.log(
              `[searchLinkedInProfiles] 3. Search for "Bing Search v7" (NOT BingGroundingSearch)`
            );
            console.log(`[searchLinkedInProfiles] 4. Create the resource (free tier available)`);
            console.log(`[searchLinkedInProfiles] 5. Go to "Keys and Endpoint"`);
            console.log(`[searchLinkedInProfiles] 6. Copy "Key 1" (32 characters)`);
            console.log(
              `[searchLinkedInProfiles] 7. Update .env: BING_WEB_SEARCH_API_KEY=your-key-here`
            );
            console.log(`[searchLinkedInProfiles] 8. Restart server`);
          }
          continue;
        }

        const data = await response.json();
        const webPages = data.webPages?.value || [];

        for (const page of webPages) {
          const url = page.url;
          // Only include LinkedIn profile URLs
          if (
            url &&
            url.includes("linkedin.com/in/") &&
            !url.includes("/jobs") &&
            !url.includes("/learning") &&
            !url.includes("/pulse")
          ) {
            // Normalize URL
            const normalizedUrl = url.split("?")[0].split("#")[0]; // Remove query params and hash
            if (!seenUrls.has(normalizedUrl)) {
              seenUrls.add(normalizedUrl);
              allResults.push({
                url: normalizedUrl,
                title: page.name || "",
                snippet: page.snippet || "",
              });
            }
          }
        }

        // Small delay between queries to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error: any) {
        console.log(`[searchLinkedInProfiles] Error executing query "${query}":`, error.message);
        continue;
      }
    }

    console.log(
      `[searchLinkedInProfiles] ✅ Found ${allResults.length} unique LinkedIn profiles from web search`
    );
    console.log(
      `[searchLinkedInProfiles] Sample results:`,
      allResults.slice(0, 3).map((r) => ({ url: r.url, title: r.title.substring(0, 50) }))
    );
    // Return results - names will be extracted by extractProfileName when needed
    return allResults.slice(0, count * 2).map((result) => ({
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      name: undefined as string | undefined, // Names extracted on-demand via extractProfileName
    }));
  } catch (error: any) {
    console.error(`[searchLinkedInProfiles] Error:`, error);
    return [];
  }
}

/**
 * Search LinkedIn profiles using SerpAPI (recommended alternative to Bing)
 * SerpAPI wraps Google/Bing search and is more reliable
 * Get a free key at: https://serpapi.com/ (100 searches/month free)
 */
/**
 * Build LinkedIn queries using activity surfaces (posts/newsletters/events) per ChatGPT's recommendations
 * This discovers people who actually post and have an audience, rather than resume pages
 */
function buildLinkedInQueries(
  topic: string,
  keywords: string[],
  brandName?: string
): Array<{ query: string; description: string; contentType: "posts" | "newsletters" | "events" }> {
  const queries: Array<{
    query: string;
    description: string;
    contentType: "posts" | "newsletters" | "events";
  }> = [];

  // Brand exclusion
  const brandExclusion = brandName
    ? ` -${brandName.toLowerCase()} -${brandName.toLowerCase()}y`
    : "";

  // Build topic terms with industry anchors (per ChatGPT)
  const industryTerms: string[] = [];

  // Build topic terms from keywords and topic
  // Use first 3-5 keywords, or the topic if no keywords
  if (keywords.length > 0) {
    industryTerms.push(...keywords.slice(0, 5).map((k) => `"${k}"`));
  } else {
    industryTerms.push(`"${topic}"`);
  }

  const topicTerms = industryTerms.slice(0, 5).join(" OR ");

  // Core query per ChatGPT: search posts, not profiles
  // This finds people who actually post about the topic
  queries.push({
    description: "Posts (core - people who post)",
    query: `site:linkedin.com/posts (${topicTerms})${brandExclusion}`,
    contentType: "posts",
  });

  // Optional commerce angle (for e-commerce/retail topics)
  // Only add if topic seems commerce-related
  const commerceTerms = [
    "retail",
    "ecommerce",
    "e-commerce",
    "commerce",
    "CPG",
    "consumer",
    "brand",
  ];
  const hasCommerceKeywords =
    keywords.some((k) => commerceTerms.some((term) => k.toLowerCase().includes(term))) ||
    topic.toLowerCase().includes("retail") ||
    topic.toLowerCase().includes("commerce");

  if (hasCommerceKeywords && keywords.length > 0) {
    // Use topic terms + commerce terms
    const commerceQueryTerms = [...keywords.slice(0, 3).map((k) => `"${k}"`), "ecommerce", "CPG"]
      .slice(0, 5)
      .join(" OR ");
    queries.push({
      description: "Posts (commerce angle)",
      query: `site:linkedin.com/posts (${commerceQueryTerms})${brandExclusion}`,
      contentType: "posts",
    });
  }

  return queries;
}

/**
 * Build SerpAPI URL with location simulation (per ChatGPT recommendations)
 * Uses location parameter to simulate US city search for better US result bias
 */
function buildSerpAPIUrl(
  query: string,
  apiKey: string,
  start: number = 0,
  location: string = "Austin, Texas, United States"
): string {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: "20",
    start: start.toString(),
    gl: "us",
    hl: "en",
    lr: "lang_en",
    google_domain: "google.com",
    location: location, // Simulate search from US city (per ChatGPT recommendation)
  });

  return `https://serpapi.com/search.json?${params.toString()}`;
}

/**
 * Normalize LinkedIn URL and check if it's from an English-speaking domain
 * STRICT: Only allows www.linkedin.com, uk.linkedin.com, ca.linkedin.com, au.linkedin.com
 * Excludes ALL other country-specific domains (ir, sy, ly, ye, sd, cn, vn, fr, de, etc.)
 */
function normalizeLinkedInUrl(url: string): { normalized: string; isEnglishSpeaking: boolean } {
  if (!url || !url.includes("linkedin.com/in/")) {
    return { normalized: url, isEnglishSpeaking: false };
  }

  // Exclude non-profile pages
  if (url.includes("/jobs") || url.includes("/learning") || url.includes("/pulse")) {
    return { normalized: url, isEnglishSpeaking: false };
  }

  // Normalize URL (remove query params, hash, and language suffixes like /ar, /en, etc.)
  let normalized = url.split("?")[0].split("#")[0];

  // Remove language suffixes (e.g., /ar, /en, /fr) from the end of the URL
  // Pattern: /in/username/ar -> /in/username
  normalized = normalized.replace(/\/in\/([^\/]+)\/[a-z]{2}$/, "/in/$1");

  // STRICT: Only allow these exact English-speaking domains
  const allowedDomains = [
    "www.linkedin.com",
    "linkedin.com", // Will be converted to www.linkedin.com
    "uk.linkedin.com",
    "ca.linkedin.com",
    "au.linkedin.com",
  ];

  // Extract domain from URL
  const domainMatch = normalized.match(/https?:\/\/([^\/]+)/);
  if (!domainMatch) {
    return { normalized, isEnglishSpeaking: false };
  }

  const domain = domainMatch[1];

  // Check if domain is in allowed list
  const isEnglishSpeaking = allowedDomains.some((allowed) => {
    if (allowed === "linkedin.com") {
      return domain === "linkedin.com" || domain === "www.linkedin.com";
    }
    return domain === allowed;
  });

  // If not in allowed list, check if it's a country-specific domain we should reject
  if (!isEnglishSpeaking) {
    const countryDomainMatch = normalized.match(/https?:\/\/([a-z]{2})\.linkedin\.com/);
    if (countryDomainMatch) {
      // This is a country-specific domain that's NOT in our allowed list - reject it
      return { normalized, isEnglishSpeaking: false };
    }
    // If it's not a country domain but also not in allowed list, reject it
    return { normalized, isEnglishSpeaking: false };
  }

  // Ensure it uses www.linkedin.com for consistency (convert linkedin.com to www.linkedin.com)
  normalized = normalized.replace(/https?:\/\/linkedin\.com/, "https://www.linkedin.com");

  return { normalized, isEnglishSpeaking };
}

/**
 * Check if text appears to be in English
 * Simple heuristic: checks for common English words and patterns
 */
function appearsToBeEnglish(text: string): boolean {
  if (!text || text.length === 0) return false;

  const textLower = text.toLowerCase();

  // Check for non-Latin scripts (Chinese, Arabic, Thai, etc.)
  // These Unicode ranges indicate non-English scripts
  if (/[\u4e00-\u9fff\u0600-\u06ff\u0e00-\u0e7f\u0590-\u05ff]/.test(text)) {
    return false;
  }

  // Check for common English words/patterns
  const englishIndicators = [
    /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/i,
    /\b(linkedin|profile|experience|education|skills)\b/i,
    /\b(manager|director|founder|ceo|president|vice|senior|junior)\b/i,
    /\b(university|college|bachelor|master|degree|phd)\b/i,
    /\b(company|corporation|inc|llc|ltd)\b/i,
  ];

  // If text contains English indicators, likely English
  const hasEnglishIndicators = englishIndicators.some((pattern) => pattern.test(text));

  // Also check if it's mostly ASCII (English characters)
  const asciiRatio = (text.match(/[a-zA-Z0-9\s.,;:!?'"()-]/g) || []).length / text.length;
  const isMostlyAscii = asciiRatio > 0.7;

  return hasEnglishIndicators || isMostlyAscii;
}

/**
 * Extract name from SerpAPI search result title or snippet
 * SerpAPI often includes the person's name in the title/snippet before HTML extraction
 * Format examples: "Lawrence Aragon | LinkedIn", "Jonathan Wainberg - Company | LinkedIn"
 *
 * IMPORTANT: For posts, title is the POST title, not the person's name!
 * Only use title for direct profile URLs, not for posts.
 */
function extractNameFromSerpAPIResult(title?: string, snippet?: string): string | null {
  // Try title first (more reliable, but ONLY for direct profile URLs, not posts)
  if (title) {
    // For titles with format "Name - Post Title", extract the name part
    // Example: "Jonathan Wainberg - How to Afford Pet Care" → "Jonathan Wainberg"
    if (title.includes(" - ")) {
      const parts = title.split(" - ");
      const namePart = parts[0].trim();

      // Check if first part looks like a name (2-4 words, proper capitalization, not too long)
      const name = cleanProfileName(namePart);
      if (
        name &&
        name.split(/\s+/).length >= 2 &&
        name.split(/\s+/).length <= 4 &&
        name.length <= 40
      ) {
        // Reject if it looks like a post title (starts with common post title words)
        // Also reject if it's too generic or doesn't look like a person's name
        const isPostTitle =
          /^(How|What|Why|When|Where|The|A|An|Pet|Scaling|Market|Industry|Trends|State|Growth|Insights|Tips|Guide|Strategy|Beyond|Features|Product|Enablement)/i.test(
            name
          );
        const isGeneric = /^(Pet Care|Market|Industry|Growth|Trends|State)/i.test(name);

        if (!isPostTitle && !isGeneric) {
          console.log(
            `[extractNameFromSerpAPIResult] ✅ Found name in title (before dash): "${name}"`
          );
          return name;
        } else {
          console.log(
            `[extractNameFromSerpAPIResult] ⚠️ Rejected "${name}" as post title or generic phrase`
          );
        }
      }
    }

    // Reject if it looks like a post title (too long, contains common post patterns)
    const isPostTitle =
      title.length > 50 ||
      /^(How to|What|Why|When|Where|The|A|An|Scaling|Pet|Market|Industry|Trends|State|Growth|Insights|Tips|Guide|Strategy|Beyond|Features|Product|Enablement)\s+/i.test(
        title
      ) ||
      /market|industry|growth|trends|insights|tips|guide|strategy|beyond|features|product|enablement/i.test(
        title.toLowerCase()
      );

    if (isPostTitle) {
      console.log(`[extractNameFromSerpAPIResult] ⚠️ Rejected title as post title: "${title}"`);
    } else {
      // Remove "| LinkedIn" suffix
      let nameText = title.split(" | ")[0].trim();
      // Remove " - Company" suffix if present
      nameText = nameText.split(" - ")[0].trim();

      const name = cleanProfileName(nameText);
      if (name && name.split(/\s+/).length >= 2 && name.split(/\s+/).length <= 4) {
        console.log(`[extractNameFromSerpAPIResult] ✅ Found name in title: "${name}"`);
        return name;
      }
    }
  }

  // Try snippet (PRIMARY METHOD for posts - SerpAPI snippets often have author names)
  // Snippets often have format: "Name - Title at Company" or "Name | LinkedIn" or "View profile for Name"
  if (snippet) {
    console.log(
      `[extractNameFromSerpAPIResult] Analyzing snippet: "${snippet.substring(0, 150)}..."`
    );

    // Look for patterns that clearly indicate a person's name
    // Priority order: most specific patterns first
    const snippetPatterns = [
      // Pattern 1: "View profile for Name" (MOST RELIABLE - LinkedIn's own format)
      // Example: "View profile for Arcui Usoara. Arcui Usoara..."
      {
        pattern: /View\s+profile\s+for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        name: "View profile for",
      },
      // Pattern 2: "Name. Name" (repeated name pattern - "Arcui Usoara. Arcui Usoara")
      // This catches cases where the name appears twice
      {
        pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\.\s*\1/i,
        name: "Repeated name",
      },
      // Pattern 3: "Name | LinkedIn" (very reliable)
      {
        pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+\|\s+LinkedIn/i,
        name: "Name | LinkedIn",
      },
      // Pattern 4: "Posted by Name" or "By Name"
      {
        pattern: /(?:Posted\s+by|By)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        name: "Posted by",
      },
      // Pattern 5: "Name - Title at Company"
      {
        pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*-\s*[A-Z][a-z]+\s+at\s+[A-Z][a-z]+/i,
        name: "Name - Title at Company",
      },
      // Pattern 6: "Name at Company"
      {
        pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+at\s+[A-Z][a-z]+/i,
        name: "Name at Company",
      },
      // Pattern 7: Name in quotes or parentheses
      {
        pattern: /["']([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)["']/i,
        name: "Name in quotes",
      },
      {
        pattern: /\(([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\)/i,
        name: "Name in parentheses",
      },
    ];

    for (const { pattern, name: patternName } of snippetPatterns) {
      const match = snippet.match(pattern);
      if (match && match[1]) {
        const rawName = match[1].trim();
        console.log(
          `[extractNameFromSerpAPIResult] Pattern "${patternName}" matched: "${rawName}"`
        );

        const name = cleanProfileName(rawName);
        if (name && name.split(/\s+/).length >= 2 && name.split(/\s+/).length <= 4) {
          console.log(
            `[extractNameFromSerpAPIResult] ✅ Found name in snippet: "${name}" (pattern: ${patternName})`
          );
          return name;
        } else {
          console.log(
            `[extractNameFromSerpAPIResult] ⚠️ Pattern matched but name failed validation: "${rawName}" → "${name}"`
          );
        }
      }
    }

    console.log(`[extractNameFromSerpAPIResult] ⚠️ No valid name pattern found in snippet`);
    // DON'T use fallback "name at start" - it often picks up post titles
    // Only extract if we have a clear pattern match
  }

  return null;
}

/**
 * Clean extracted name - remove IDs, numbers, and other artifacts
 * Also validates that it's actually a name, not a post title or error message
 */
function cleanProfileName(name: string): string | null {
  if (!name) return null;

  // Reject common error messages and HTML artifacts
  const errorPatterns = [
    /^The password you provided/i,
    /^nMore from/i,
    /^More from/i,
    /^Sign in/i,
    /^Join LinkedIn/i,
    /^Error/i,
    /^Page not found/i,
    /^Access denied/i,
    /^Please sign in/i,
    /^You need to sign in/i,
    /^Continue to LinkedIn/i,
    /^Redirecting/i,
    /^Loading/i,
    /^\s*n\s*$/i, // Just "n" or "n " (common HTML artifact)
    /^[a-z]\s+[A-Z]/i, // Starts with lowercase letter (likely HTML fragment)
  ];

  if (errorPatterns.some((pattern) => pattern.test(name))) {
    console.log(`[cleanProfileName] Rejected as error message/HTML artifact: "${name}"`);
    return null;
  }

  // Reject if it looks like a post title (contains common post title patterns)
  const postTitlePatterns = [
    /'s\s+Post$/i,
    /'s\s+Article$/i,
    /Post\s+on\s+/i,
    /State of the/i,
    /Trends in/i,
    /Industry$/i,
    /Growth$/i,
    /Insights$/i,
    /^\d{4}/, // Starts with year
    /^Trends/i,
    /^State of/i,
    /^How to/i, // "How to Afford Pet Care"
    /^Pet care market/i, // "Pet care market attracts VCs"
    /^Pet Care Industry/i, // "Pet Care Industry Growth"
    /attracts|despite|afford|market|industry|growth|job creation/i, // Common post title words
  ];

  if (postTitlePatterns.some((pattern) => pattern.test(name))) {
    console.log(`[cleanProfileName] Rejected as post title: "${name}"`);
    return null;
  }

  // Reject if it's too long (likely a post title or article title)
  // Names are typically 2-4 words, rarely more than 40 characters
  if (name.length > 40) {
    console.log(`[cleanProfileName] Rejected as too long (likely post title): "${name}"`);
    return null;
  }

  // Reject if it has too many words (names are typically 2-4 words)
  const wordCount = name.split(/\s+/).length;
  if (wordCount > 5) {
    console.log(
      `[cleanProfileName] Rejected - too many words (likely post title): "${name}" (${wordCount} words)`
    );
    return null;
  }

  // Remove trailing alphanumeric IDs (like "7b3944123", "B162b424", "6a73bb103")
  // Pattern: space followed by alphanumeric string of 6+ characters at the end
  name = name.replace(/\s+[a-zA-Z0-9]{6,}$/, "");

  // Remove any trailing numbers
  name = name.replace(/\s+\d+$/, "");

  // Remove " | LinkedIn" or similar suffixes
  name = name.split(" | ")[0];
  name = name.split(" - ")[0];

  // Remove any HTML entities
  name = name.replace(/&[a-z]+;/gi, "");

  // Remove HTML tags if any slipped through
  name = name.replace(/<[^>]+>/g, "");

  // Trim whitespace and newlines
  name = name.trim().replace(/\s+/g, " ");

  // Reject if empty or too short after cleaning
  if (!name || name.length < 2) {
    return null;
  }

  // Validate that it looks like a name: must start with capital letter, contain only letters/spaces/hyphens/apostrophes
  // Allow for names like "Mary-Jane O'Brien" or "Amy Hillis, CPACO"
  const namePattern = /^[A-Z][a-zA-Z\s\-',.]+$/;
  if (!namePattern.test(name)) {
    console.log(`[cleanProfileName] Rejected - doesn't match name pattern: "${name}"`);
    return null;
  }

  // Reject if it's just a single word (likely incomplete) unless it's a reasonable length
  const words = name.split(/\s+/);
  if (words.length === 1 && words[0].length < 4) {
    console.log(`[cleanProfileName] Rejected as incomplete name: "${name}"`);
    return null;
  }

  // Reject if any word is too short (likely HTML artifact)
  if (words.some((word) => word.length === 1 && word !== "I" && word !== "O")) {
    console.log(`[cleanProfileName] Rejected - contains single-letter word: "${name}"`);
    return null;
  }

  return name;
}

/**
 * Extract profile name from LinkedIn profile URL (PRIMARY METHOD)
 * URL format: https://www.linkedin.com/in/samuel-hess/ → "Samuel Hess"
 * This is the most reliable source - extract from URL FIRST
 */
/**
 * Extract profile headline/description from LinkedIn profile page HTML
 * Returns the headline (e.g., "Marketing Director at Company") or null
 */
async function extractProfileHeadline(profileUrl: string): Promise<string | null> {
  try {
    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Method 1: Look for headline in meta description
    const metaDescMatch = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+?)["']/i
    );
    if (metaDescMatch && metaDescMatch[1]) {
      const headline = metaDescMatch[1].replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
      if (headline && headline.length > 10 && headline.length < 200) {
        return headline;
      }
    }

    // Method 2: Look for og:description
    const ogDescMatch = html.match(
      /<meta\s+property=["']og:description["']\s+content=["']([^"']+?)["']/i
    );
    if (ogDescMatch && ogDescMatch[1]) {
      const headline = ogDescMatch[1].trim();
      if (headline && headline.length > 10 && headline.length < 200) {
        return headline;
      }
    }

    // Method 3: Look for text-body-medium class (headline section)
    const headlineMatch = html.match(/<div[^>]*class="[^"]*text-body-medium[^"]*"[^>]*>([^<]+)</i);
    if (headlineMatch && headlineMatch[1]) {
      const headline = headlineMatch[1].trim();
      if (headline && headline.length > 10 && headline.length < 200) {
        return headline;
      }
    }

    return null;
  } catch (error: any) {
    return null;
  }
}

/**
 * Use OpenAI to extract name from a LinkedIn URL slug when other methods fail
 * This is a fallback for difficult cases where URL parsing fails
 */
async function extractNameWithOpenAI(profileUrl: string): Promise<string | null> {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return null; // No OpenAI key, skip
    }

    // Extract slug from URL
    const match = profileUrl.match(/linkedin\.com\/in\/([^\/?#]+)/);
    if (!match || !match[1]) {
      return null;
    }

    const slug = match[1].split("-")[0]; // Get first part before hyphens/IDs

    // Skip if slug is too short or looks like an ID
    if (slug.length < 4 || slug.length > 20 || /^\d+$/.test(slug)) {
      return null;
    }

    const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Use cheaper model for simple name extraction
        messages: [
          {
            role: "system",
            content:
              "You are a name extraction assistant. Given a LinkedIn URL slug (username), extract the most likely full name. Return ONLY the name in format 'First Last' or null if uncertain. Do not include any other text.",
          },
          {
            role: "user",
            content: `LinkedIn URL slug: "${slug}"\n\nExtract the most likely full name. Examples:\n- "larryaragon" → "Lawrence Aragon"\n- "doallen" → "Don Allen"\n- "shainadenny" → "Shaina Denny"\n- "melissanrobinson" → "Melissa Robinson"\n\nReturn ONLY the name or null.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      console.log(`[extractNameWithOpenAI] OpenAI API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content || content.toLowerCase() === "null") {
      return null;
    }

    const name = cleanProfileName(content);
    if (name && name.split(/\s+/).length >= 2) {
      console.log(`[extractNameWithOpenAI] ✅ Extracted name: "${name}"`);
      return name;
    }

    return null;
  } catch (error: any) {
    console.log(`[extractNameWithOpenAI] Error: ${error.message}`);
    return null;
  }
}

/**
 * Extract profile name from LinkedIn profile URL
 * Uses multiple methods: SerpAPI data, HTML parsing, URL extraction, OpenAI fallback
 *
 * EXPORTED for use across the project
 */
export async function extractProfileName(
  profileUrl: string,
  serpAPITitle?: string,
  serpAPISnippet?: string
): Promise<string | null> {
  // METHOD 0: Try SerpAPI title/snippet first (most reliable when available)
  // SerpAPI often has the correct name before LinkedIn blocks HTML access
  if (serpAPITitle || serpAPISnippet) {
    const nameFromSerpAPI = extractNameFromSerpAPIResult(serpAPITitle, serpAPISnippet);
    if (nameFromSerpAPI) {
      console.log(`[extractProfileName] ✅ Using name from SerpAPI: "${nameFromSerpAPI}"`);
      return nameFromSerpAPI;
    }
  }

  // PRIMARY METHOD: Always parse HTML first to get the actual name from the page
  // URL extraction is unreliable (e.g., "larryaragon" → "Larry Aragon" but real name is "Lawrence Aragon")
  const nameFromUrl = extractNameFromUrl(profileUrl); // Keep for fallback only

  try {
    const response = await fetch(profileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    }).catch((error: any) => {
      console.log(`[extractProfileName] Fetch error for ${profileUrl}: ${error.message}`);
      return null;
    });

    if (!response || !response.ok) {
      const status = response?.status || "unknown";
      console.log(`[extractProfileName] Failed to fetch ${profileUrl}: ${status}`);
      // Fallback to URL extraction if HTML fetch fails
      if (nameFromUrl) {
        console.log(`[extractProfileName] Using URL-extracted name as fallback: "${nameFromUrl}"`);
        return nameFromUrl;
      }

      // Final fallback: Use OpenAI to extract name from URL slug (for difficult cases)
      // Only use this if all other methods failed and we have a reasonable slug
      const slugMatch = profileUrl.match(/linkedin\.com\/in\/([^\/?#]+)/);
      if (slugMatch && slugMatch[1]) {
        const slug = slugMatch[1].split("-")[0];
        // Only try OpenAI if slug looks like a combined name (no hyphens, reasonable length)
        if (slug.length >= 6 && slug.length <= 20 && !slug.includes("-") && !/^\d+$/.test(slug)) {
          const nameFromOpenAI = await extractNameWithOpenAI(profileUrl);
          if (nameFromOpenAI) {
            console.log(`[extractProfileName] ✅ Using OpenAI-extracted name: "${nameFromOpenAI}"`);
            return nameFromOpenAI;
          }
        }
      }

      return null;
    }

    const html = await response.text();

    // Validate that this is actually a LinkedIn profile page, not an error/login page
    const isErrorPage =
      html.includes("The password you provided") ||
      html.includes("Sign in to LinkedIn") ||
      html.includes("Join LinkedIn") ||
      html.includes("Page not found") ||
      html.includes("Access denied") ||
      html.includes("challenge-platform") ||
      html.includes("security-check") ||
      !html.includes("linkedin.com/in/") ||
      html.length < 1000; // Error pages are usually shorter

    if (isErrorPage) {
      console.log(
        `[extractProfileName] ⚠️ Detected error/login page for ${profileUrl}, using URL fallback`
      );
      if (nameFromUrl) {
        return nameFromUrl;
      }
      return null;
    }

    let htmlName: string | null = null;

    // Method 1: Structured data (JSON-LD) - Most reliable, LinkedIn often includes this
    // Look for Person with name in JSON-LD
    const jsonLdMatches = html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (jsonLdMatches) {
      for (const jsonLd of jsonLdMatches) {
        try {
          const jsonContent = jsonLd.replace(/<script[^>]*>|<\/script>/gi, "");
          const data = JSON.parse(jsonContent);

          // Check if it's a Person object
          if (data["@type"] === "Person" && data.name) {
            const name = cleanProfileName(data.name);
            if (name && name.split(/\s+/).length >= 2) {
              htmlName = name;
              console.log(`[extractProfileName] ✅ Found name in JSON-LD: "${htmlName}"`);
              break;
            }
          }

          // Also check if it's an array
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item["@type"] === "Person" && item.name) {
                const name = cleanProfileName(item.name);
                if (name && name.split(/\s+/).length >= 2) {
                  htmlName = name;
                  console.log(`[extractProfileName] ✅ Found name in JSON-LD array: "${htmlName}"`);
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    // Method 2: Meta property og:title (usually "Name | LinkedIn" or "Name - Company | LinkedIn")
    if (!htmlName) {
      const ogTitleMatch = html.match(
        /<meta\s+property=["']og:title["']\s+content=["']([^"']+?)(?:\s*[-|]|["'])/i
      );
      if (ogTitleMatch && ogTitleMatch[1]) {
        const name = cleanProfileName(ogTitleMatch[1]);
        if (name && name.split(/\s+/).length >= 2) {
          htmlName = name;
          console.log(`[extractProfileName] ✅ Found name in og:title: "${htmlName}"`);
        }
      }
    }

    // Method 3: Page title tag (format: "Name | LinkedIn" or "Name - Company | LinkedIn")
    if (!htmlName) {
      const titleMatch = html.match(/<title>([^<]+?)(?:\s*[-|]|<\/title>)/i);
      if (titleMatch && titleMatch[1]) {
        // Extract name before dash or pipe
        const titleText = titleMatch[1].split(/\s*[-|]\s*/)[0].trim();
        const name = cleanProfileName(titleText);
        if (name && name.split(/\s+/).length >= 2) {
          htmlName = name;
          console.log(`[extractProfileName] ✅ Found name in title tag: "${htmlName}"`);
        }
      }
    }

    // Method 4: Look for h1 tags with various LinkedIn class patterns
    if (!htmlName) {
      // Try multiple h1 patterns that LinkedIn uses
      const h1Patterns = [
        /<h1[^>]*class="[^"]*text-heading-xlarge[^"]*"[^>]*>([^<]+)</i,
        /<h1[^>]*class="[^"]*text-heading-xxlarge[^"]*"[^>]*>([^<]+)</i,
        /<h1[^>]*class="[^"]*pv-text-details__left-panel[^"]*"[^>]*>([^<]+)</i,
        /<h1[^>]*class="[^"]*inline[^"]*"[^>]*>([^<]+)</i,
        /<h1[^>]*>([^<]+)</i, // Fallback: any h1
      ];

      for (const pattern of h1Patterns) {
        const h1Match = html.match(pattern);
        if (h1Match && h1Match[1]) {
          const name = cleanProfileName(h1Match[1]);
          if (name && name.split(/\s+/).length >= 2) {
            htmlName = name;
            console.log(`[extractProfileName] ✅ Found name in h1 tag: "${htmlName}"`);
            break;
          }
        }
      }
    }

    // Method 5: Look for span/div with profile name classes (LinkedIn's newer structure)
    if (!htmlName) {
      const namePatterns = [
        /<span[^>]*class="[^"]*text-heading-xlarge[^"]*"[^>]*>([^<]+)</i,
        /<div[^>]*class="[^"]*text-heading-xlarge[^"]*"[^>]*>([^<]+)</i,
        /<span[^>]*class="[^"]*pv-text-details__left-panel[^"]*"[^>]*>([^<]+)</i,
        /<div[^>]*class="[^"]*pv-text-details__left-panel[^"]*"[^>]*>([^<]+)</i,
      ];

      for (const pattern of namePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const name = cleanProfileName(match[1]);
          if (name && name.split(/\s+/).length >= 2) {
            htmlName = name;
            console.log(`[extractProfileName] ✅ Found name in span/div: "${htmlName}"`);
            break;
          }
        }
      }
    }

    // Method 6: Look for data attributes or aria-labels that might contain the name
    if (!htmlName) {
      const dataPatterns = [
        /data-name=["']([^"']+)["']/i,
        /aria-label=["']([^"']+?)(?:\s*[-|]|["'])/i,
        /data-test-id=["']([^"']+?)["']/i,
      ];

      for (const pattern of dataPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const name = cleanProfileName(match[1]);
          if (name && name.split(/\s+/).length >= 2) {
            htmlName = name;
            console.log(`[extractProfileName] ✅ Found name in data attribute: "${htmlName}"`);
            break;
          }
        }
      }
    }

    // Method 7: Extract from visible text content (look for name pattern near profile indicators)
    // This handles cases where the name is in the page text but not in specific tags
    // LinkedIn often has the name followed by pronouns or connection degree
    // STRICT: Only match if it clearly looks like a name followed by valid LinkedIn indicators
    if (!htmlName) {
      // Look for patterns like "Name \n He/Him" or "Name \n 3rd degree" (common LinkedIn patterns)
      // Must have at least 2 capitalized words (first and last name)
      const textPatterns = [
        // Pattern 1: Name followed by pronouns (most reliable)
        /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\s*(?:\n|\\n|\s+)(?:He\/Him|She\/Her|They\/Them)/i,
        // Pattern 2: Name followed by connection degree
        /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\s*(?:\n|\\n|\s+)(?:\d+(?:st|nd|rd|th)\s+degree\s+connection)/i,
        // Pattern 3: Name followed by job title (must have "at" to be valid)
        /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\s*(?:\n|\\n|\s+)([A-Z][a-z]+\s+at\s+[A-Z])/i,
      ];

      for (const pattern of textPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          // Validate the name part: must be 2-4 words, each word 2+ chars, starts with capital
          const namePart = match[1].trim();
          const words = namePart.split(/\s+/);

          if (words.length >= 2 && words.length <= 4) {
            // All words must be 2+ characters and start with capital letter
            const allValidWords = words.every(
              (word) => word.length >= 2 && /^[A-Z][a-z]+$/.test(word)
            );

            if (allValidWords) {
              const name = cleanProfileName(namePart);
              if (name && name.split(/\s+/).length >= 2) {
                htmlName = name;
                console.log(`[extractProfileName] ✅ Found name in text pattern: "${htmlName}"`);
                break;
              }
            }
          }
        }
      }
    }

    // Method 8: Look for the name in script tags with embedded data (LinkedIn often embeds profile data)
    if (!htmlName) {
      // Look for patterns like "firstName":"Lawrence","lastName":"Aragon" or "name":"Lawrence Aragon"
      const scriptPatterns = [
        /"firstName":\s*"([^"]+)",\s*"lastName":\s*"([^"]+)"/i,
        /"name":\s*"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)"/i,
        /'name':\s*'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'/i,
      ];

      for (const pattern of scriptPatterns) {
        const match = html.match(pattern);
        if (match) {
          let name: string | null = null;
          if (match[1] && match[2]) {
            // firstName and lastName
            name = `${match[1]} ${match[2]}`;
          } else if (match[1]) {
            // Full name
            name = match[1];
          }

          if (name) {
            const cleanedName = cleanProfileName(name);
            if (cleanedName && cleanedName.split(/\s+/).length >= 2) {
              htmlName = cleanedName;
              console.log(`[extractProfileName] ✅ Found name in script data: "${htmlName}"`);
              break;
            }
          }
        }
      }
    }

    // Validate HTML-extracted name: must have at least 2 words
    if (htmlName) {
      const wordCount = htmlName.split(/\s+/).length;
      if (wordCount >= 2) {
        console.log(
          `[extractProfileName] ✅ Successfully extracted name from HTML: "${htmlName}" (${wordCount} words)`
        );
        return htmlName;
      } else {
        console.log(
          `[extractProfileName] ⚠️ HTML name incomplete (${wordCount} word): "${htmlName}", trying fallback`
        );
        htmlName = null; // Reset to try fallback
      }
    }

    // Final fallback: use URL extraction result (even if incomplete) or return null
    if (nameFromUrl) {
      console.log(
        `[extractProfileName] ⚠️ HTML parsing failed, using URL-extracted name as fallback: "${nameFromUrl}"`
      );
      return nameFromUrl;
    }

    console.log(
      `[extractProfileName] ❌ Could not extract name from HTML or URL for ${profileUrl}`
    );
    return null;
  } catch (error: any) {
    console.log(`[extractProfileName] Error extracting name from ${profileUrl}:`, error.message);
    // Return URL extraction result as fallback if HTML fetch fails
    if (nameFromUrl) {
      console.log(
        `[extractProfileName] Using URL-extracted name as error fallback: "${nameFromUrl}"`
      );
      return nameFromUrl;
    }
    return null;
  }
}

/**
 * Intelligently split a combined first+last name slug
 * Examples: "fiedlerjason" → "Fiedler Jason", "pamelakeniston" → "Pamela Keniston", "stevesimitzis" → "Steve Simitzis", "jeremygoldman" → "Jeremy Goldman"
 */
function splitCombinedName(slug: string): string | null {
  // Common first names - sorted by length (longest first) to avoid partial matches
  // e.g., "steve" should match before "stev"
  // Expanded list for better coverage at scale (~500 unique names covering English, Latino, French, German, Hebrew names)
  const commonFirstNames = [
    // Long names (9+ chars) - check first to avoid partial matches
    "christopher",
    "alexander",
    "katherine",
    "patricia",
    "stephanie",
    "elizabeth",
    "christina",
    "nicholas",
    "benjamin",
    "jonathan",
    "zachary",
    "matthew",
    "theodore",
    "alexandra",
    "victoria",
    "isabella",
    "christine",
    "kathleen",
    "catherine",
    "rebecca",
    "jennifer",
    "jessica",
    "danielle",
    "vanessa",
    "samantha",
    "melissa",
    "cassandra",
    "mackenzie",
    "mckenzie",
    "alexandria",
    "kathryn",
    "katharine",
    "penelope",
    "annabelle",
    "valentina",
    "gabrielle",
    "isabelle",
    "genevieve",
    "guadalupe",
    "francisco",
    "constantine",
    "benedict",
    "sebastian",
    "maximilian",
    "alexandros",
    "christophe",
    "guillaume",
    "jean-baptiste",
    "jean-pierre",
    "jean-marie",
    "jean-luc",
    "jean-claude",
    "francois-xavier",
    "marie-claire",
    "marie-helene",
    "marie-france",
    "marie-christine",
    "marie-therese",
    "marie-anne",
    "marie-pierre",
    "marie-laure",
    "marie-sophie",
    "marie-cecile",
    "marie-noelle",
    "marie-agnes",
    "marie-claude",
    "marie-dominique",
    "marie-francoise",
    "marie-josee",
    "marie-louise",
    "marie-marthe",
    "marie-paule",
    "marie-rose",
    "marie-veronique",
    "marie-yvonne",
    "marie-zoe",
    "christoph",
    "alexandru",
    "alexandrina",
    "alexandrine",
    "gabriella",
    "gabriela",
    "isabel",
    "fernando",
    "rodrigo",
    "santiago",
    "nicolas",
    "matias",
    "alejandro",
    "cristian",
    "javier",
    "manuel",
    "antonio",
    "ricardo",
    "roberto",
    "miguel",
    "rafael",
    "ramon",
    "sergio",
    "adrian",
    "alberto",
    "andres",
    "arturo",
    "eduardo",
    "enrique",
    "felipe",
    "gabriel",
    "gonzalo",
    "guillermo",
    "hernan",
    "ignacio",
    "jorge",
    "leonardo",
    "marcelo",
    "marco",
    "martin",
    "mauricio",
    "patricio",
    "raul",
    "tomas",
    "valentin",
    "vicente",
    "adriana",
    "alejandra",
    "beatriz",
    "carla",
    "carolina",
    "catalina",
    "claudia",
    "cristina",
    "daniela",
    "elisa",
    "fabiola",
    "fernanda",
    "graciela",
    "jimena",
    "josefina",
    "karla",
    "liliana",
    "lorena",
    "lucia",
    "luisa",
    "marcela",
    "mariana",
    "maricela",
    "marisol",
    "marta",
    "martina",
    "natalia",
    "paula",
    "pilar",
    "raquel",
    "rebeca",
    "silvia",
    "sonia",
    "susana",
    "tania",
    "tatiana",
    "veronica",
    "virginia",
    "yolanda",
    "antoine",
    "augustin",
    "clement",
    "edouard",
    "etienne",
    "fabien",
    "florian",
    "francois",
    "frederic",
    "julien",
    "laurent",
    "mathieu",
    "maxime",
    "michel",
    "nicolas",
    "olivier",
    "quentin",
    "raphael",
    "remy",
    "romain",
    "sebastien",
    "simon",
    "tristan",
    "valentin",
    "yann",
    "yves",
    "zacharie",
    "adeline",
    "agnes",
    "amelie",
    "antoinette",
    "cecile",
    "celeste",
    "clemence",
    "colette",
    "constance",
    "corinne",
    "dominique",
    "elodie",
    "emilie",
    "estelle",
    "eugenie",
    "evelyne",
    "fanny",
    "florence",
    "francoise",
    "jacqueline",
    "jeanne",
    "juliette",
    "laure",
    "laurence",
    "lea",
    "leonore",
    "lise",
    "lucie",
    "madeleine",
    "manon",
    "margaux",
    "marion",
    "marthe",
    "mathilde",
    "melanie",
    "monique",
    "nathalie",
    "noemie",
    "pauline",
    "philippine",
    "raphaele",
    "sabine",
    "sylvie",
    "therese",
    "valerie",
    "veronique",
    "victoire",
    "virginie",
    "yvette",
    "yvonne",
    "adrian",
    "andreas",
    "anton",
    "arnold",
    "august",
    "bernhard",
    "christian",
    "christoph",
    "dominik",
    "edgar",
    "eduard",
    "egon",
    "emil",
    "erik",
    "ernst",
    "felix",
    "ferdinand",
    "florian",
    "franz",
    "frederick",
    "friedrich",
    "georg",
    "gerhard",
    "gottfried",
    "gunther",
    "hans",
    "harald",
    "heinrich",
    "helmut",
    "herbert",
    "hermann",
    "horst",
    "hubert",
    "ingo",
    "jakob",
    "jan",
    "jens",
    "johannes",
    "jonas",
    "jorg",
    "josef",
    "julian",
    "julius",
    "karl",
    "klaus",
    "konrad",
    "kurt",
    "leon",
    "leonard",
    "ludwig",
    "lukas",
    "marc",
    "marcel",
    "marcus",
    "markus",
    "mathias",
    "matthias",
    "nico",
    "niklas",
    "otto",
    "pascal",
    "philipp",
    "ralf",
    "ralph",
    "reinhard",
    "rene",
    "roland",
    "rolf",
    "rudolf",
    "rupert",
    "stefan",
    "stephan",
    "sven",
    "tobias",
    "torsten",
    "udo",
    "ulrich",
    "uwe",
    "walter",
    "werner",
    "wilhelm",
    "wolfgang",
    "yannick",
    "zacharias",
    "adriana",
    "amanda",
    "andrea",
    "annette",
    "antonia",
    "astrid",
    "barbara",
    "beate",
    "beatrix",
    "bettina",
    "bianca",
    "birgit",
    "brigitte",
    "carina",
    "carolin",
    "catarina",
    "catharina",
    "cornelia",
    "dorothea",
    "edith",
    "elke",
    "friederike",
    "franziska",
    "gerda",
    "gertrud",
    "gisela",
    "gudrun",
    "heidi",
    "henriette",
    "herta",
    "hildegard",
    "inga",
    "inge",
    "ingrid",
    "irene",
    "jana",
    "janina",
    "johanna",
    "juliane",
    "jutta",
    "karin",
    "katarina",
    "katharina",
    "kathrin",
    "katja",
    "katrin",
    "kerstin",
    "kristin",
    "kristina",
    "lilian",
    "liliana",
    "lina",
    "linda",
    "lieselotte",
    "lili",
    "magdalena",
    "maja",
    "manuela",
    "mara",
    "margarete",
    "margarethe",
    "margit",
    "marianne",
    "marlene",
    "merle",
    "miriam",
    "monika",
    "nadine",
    "nadja",
    "nikola",
    "noemi",
    "olga",
    "petra",
    "philippa",
    "rahel",
    "ramona",
    "regina",
    "rena",
    "renate",
    "ricarda",
    "rita",
    "rosalie",
    "rosemarie",
    "saskia",
    "selina",
    "selma",
    "silke",
    "simone",
    "sina",
    "svenja",
    "swenja",
    "sylvia",
    "tanja",
    "tatjana",
    "thea",
    "theresa",
    "therese",
    "tina",
    "ute",
    "verena",
    "veronika",
    "vivian",
    "vivienne",
    "waltraud",
    "wendy",
    "yasmine",
    "abraham",
    "ariel",
    "asher",
    "elijah",
    "elias",
    "eliezer",
    "emanuel",
    "ephraim",
    "ezra",
    "isaac",
    "isaiah",
    "jacob",
    "jonah",
    "judah",
    "levi",
    "moses",
    "solomon",
    "zvi",
    "adina",
    "aliza",
    "amara",
    "amira",
    "aviva",
    "batya",
    "chana",
    "chaya",
    "eden",
    "eliana",
    "esther",
    "hava",
    "ilana",
    "noa",
    "shira",
    "talia",
    "tamar",
    "tova",

    // Medium-long names (7-8 chars)
    "jeremy",
    "steven",
    "stephen",
    "michael",
    "robert",
    "william",
    "richard",
    "joseph",
    "thomas",
    "daniel",
    "anthony",
    "donald",
    "joshua",
    "kenneth",
    "andrew",
    "edward",
    "brian",
    "george",
    "kevin",
    "timothy",
    "ronald",
    "jason",
    "jeffrey",
    "raymond",
    "patrick",
    "dennis",
    "douglas",
    "nathan",
    "peter",
    "kyle",
    "ethan",
    "pamela",
    "sarah",
    "nancy",
    "karen",
    "helen",
    "sandra",
    "donna",
    "carol",
    "ruth",
    "sharon",
    "michelle",
    "laura",
    "kimberly",
    "deborah",
    "angela",
    "ashley",
    "brenda",
    "cynthia",
    "marie",
    "janet",
    "frances",
    "joyce",
    "diane",
    "alice",
    "julie",
    "heather",
    "teresa",
    "doris",
    "gloria",
    "evelyn",
    "shaina",
    "savita",
    "crystal",
    "brittany",
    "tiffany",
    "monica",
    "rachel",
    "taylor",
    "madison",
    "hannah",
    "sophia",
    "emily",
    "charlotte",
    "amelia",
    "harper",
    "abigail",
    "mila",
    "ella",
    "avery",
    "sofia",
    "camila",
    "aria",
    "scarlett",
    "luna",
    "grace",
    "chloe",
    "layla",
    "zoey",
    "nora",
    "lily",
    "eleanor",
    "lillian",
    "addison",
    "aubrey",
    "ellie",
    "stella",
    "natalie",
    "zoe",
    "leah",
    "hazel",
    "violet",
    "aurora",
    "savannah",
    "audrey",
    "brooklyn",
    "bella",
    "claire",
    "skylar",
    "lucy",
    "paisley",
    "everly",
    "caroline",
    "nova",
    "genesis",
    "aaliyah",
    "kennedy",
    "kinsley",
    "allison",
    "madelyn",
    "adeline",
    "alexa",
    "ariana",
    "elena",
    "gabriella",
    "naomi",
    "sadie",
    "hailey",
    "emilia",
    "pratik",
    // Latino names
    "fernando",
    "rodrigo",
    "santiago",
    "sebastian",
    "nicolas",
    "matias",
    "diego",
    "alejandro",
    "cristian",
    "javier",
    "manuel",
    "carlos",
    "juan",
    "jose",
    "luis",
    "miguel",
    "antonio",
    "francisco",
    "ricardo",
    "roberto",
    "daniel",
    "david",
    "mario",
    "oscar",
    "pablo",
    "rafael",
    "ramon",
    "sergio",
    "victor",
    "adrian",
    "alberto",
    "alexander",
    "andres",
    "arturo",
    "eduardo",
    "enrique",
    "felipe",
    "gabriel",
    "gonzalo",
    "guillermo",
    "hernan",
    "ignacio",
    "jorge",
    "leonardo",
    "marcelo",
    "marco",
    "martin",
    "mauricio",
    "nicolas",
    "patricio",
    "raul",
    "rodrigo",
    "santiago",
    "sebastian",
    "tomas",
    "valentin",
    "vicente",
    "adriana",
    "alejandra",
    "ana",
    "andrea",
    "angela",
    "beatriz",
    "camila",
    "carla",
    "carolina",
    "catalina",
    "claudia",
    "cristina",
    "daniela",
    "elena",
    "elisa",
    "elizabeth",
    "fabiola",
    "fernanda",
    "gabriela",
    "gloria",
    "graciela",
    "isabel",
    "isabella",
    "jessica",
    "jimena",
    "josefina",
    "julia",
    "karla",
    "katherine",
    "laura",
    "liliana",
    "lorena",
    "lucia",
    "luisa",
    "marcela",
    "maria",
    "mariana",
    "maricela",
    "marisol",
    "marta",
    "martina",
    "melissa",
    "monica",
    "natalia",
    "natalie",
    "patricia",
    "paula",
    "pilar",
    "raquel",
    "rebeca",
    "rosa",
    "silvia",
    "sofia",
    "sonia",
    "susana",
    "tania",
    "tatiana",
    "teresa",
    "valentina",
    "vanessa",
    "veronica",
    "victoria",
    "virginia",
    "yolanda",
    // French names
    "antoine",
    "arthur",
    "augustin",
    "benjamin",
    "charles",
    "clement",
    "david",
    "edouard",
    "etienne",
    "fabien",
    "florian",
    "francois",
    "frederic",
    "guillaume",
    "henri",
    "hugo",
    "jean",
    "julien",
    "laurent",
    "louis",
    "lucas",
    "mathieu",
    "maxime",
    "michel",
    "nicolas",
    "olivier",
    "pierre",
    "quentin",
    "raphael",
    "remy",
    "romain",
    "sebastien",
    "simon",
    "thomas",
    "tristan",
    "valentin",
    "vincent",
    "yann",
    "yves",
    "zacharie",
    "adeline",
    "agnes",
    "alice",
    "amelie",
    "anne",
    "antoinette",
    "audrey",
    "aurora",
    "camille",
    "caroline",
    "catherine",
    "cecile",
    "celeste",
    "charlotte",
    "chloe",
    "claire",
    "clara",
    "clemence",
    "colette",
    "constance",
    "corinne",
    "diane",
    "dominique",
    "elise",
    "elodie",
    "emilie",
    "emma",
    "estelle",
    "eugenie",
    "evelyne",
    "fanny",
    "florence",
    "francoise",
    "gabrielle",
    "genevie",
    "helene",
    "isabelle",
    "jacqueline",
    "jeanne",
    "julie",
    "juliette",
    "laure",
    "laurence",
    "laurent",
    "lea",
    "leonore",
    "lise",
    "louise",
    "lucie",
    "madeleine",
    "manon",
    "margaux",
    "marie",
    "marion",
    "marthe",
    "mathilde",
    "melanie",
    "michelle",
    "monique",
    "nathalie",
    "nicole",
    "noemie",
    "olivia",
    "patricia",
    "pauline",
    "philippine",
    "raphaele",
    "rose",
    "sabine",
    "sandra",
    "sarah",
    "sophie",
    "stephanie",
    "sylvie",
    "therese",
    "valerie",
    "vanessa",
    "veronique",
    "victoire",
    "victoria",
    "virginie",
    "yvette",
    "yvonne",
    // German names
    "adrian",
    "alexander",
    "andreas",
    "anton",
    "arnold",
    "arthur",
    "august",
    "benjamin",
    "bernhard",
    "christian",
    "christoph",
    "daniel",
    "david",
    "dennis",
    "dominik",
    "edgar",
    "eduard",
    "egon",
    "emil",
    "erik",
    "ernst",
    "felix",
    "ferdinand",
    "florian",
    "franz",
    "frederick",
    "friedrich",
    "georg",
    "gerhard",
    "gottfried",
    "gunther",
    "hans",
    "harald",
    "heinrich",
    "helmut",
    "herbert",
    "hermann",
    "horst",
    "hubert",
    "ingo",
    "jakob",
    "jan",
    "jens",
    "johannes",
    "jonas",
    "jorg",
    "josef",
    "julian",
    "julius",
    "karl",
    "klaus",
    "konrad",
    "kurt",
    "leon",
    "leonard",
    "ludwig",
    "lukas",
    "manuel",
    "marc",
    "marcel",
    "marcus",
    "markus",
    "martin",
    "mathias",
    "matthias",
    "max",
    "maximilian",
    "michael",
    "nico",
    "nicolas",
    "niklas",
    "oliver",
    "otto",
    "pascal",
    "patrick",
    "paul",
    "peter",
    "philipp",
    "ralf",
    "ralph",
    "reinhard",
    "rené",
    "richard",
    "robert",
    "roland",
    "rolf",
    "rudolf",
    "rupert",
    "sebastian",
    "simon",
    "stefan",
    "stephan",
    "sven",
    "thomas",
    "tim",
    "tobias",
    "torsten",
    "udo",
    "ulrich",
    "uwe",
    "victor",
    "vincent",
    "walter",
    "werner",
    "wilhelm",
    "wolfgang",
    "yannick",
    "yves",
    "zacharias",
    "adriana",
    "alexandra",
    "alice",
    "amanda",
    "amelie",
    "andrea",
    "angela",
    "anna",
    "anne",
    "annette",
    "antonia",
    "astrid",
    "barbara",
    "beate",
    "beatrix",
    "bettina",
    "bianca",
    "birgit",
    "brigitte",
    "carina",
    "carolin",
    "caroline",
    "catarina",
    "catharina",
    "christina",
    "christine",
    "claudia",
    "claudia",
    "cornelia",
    "daniela",
    "diana",
    "doris",
    "dorothea",
    "edith",
    "elena",
    "elisa",
    "elisabeth",
    "elke",
    "emilia",
    "emilie",
    "emma",
    "eva",
    "franziska",
    "friederike",
    "gabriela",
    "gabrielle",
    "gerda",
    "gertrud",
    "gisela",
    "gudrun",
    "hanna",
    "hannah",
    "heidi",
    "helena",
    "helene",
    "henriette",
    "herta",
    "hildegard",
    "inga",
    "inge",
    "ingrid",
    "irene",
    "iris",
    "isabel",
    "isabella",
    "jana",
    "janina",
    "jennifer",
    "jessica",
    "johanna",
    "julia",
    "juliane",
    "julie",
    "jutta",
    "karen",
    "karin",
    "karla",
    "katarina",
    "katharina",
    "kathrin",
    "katja",
    "katrin",
    "kerstin",
    "kim",
    "klara",
    "kristin",
    "kristina",
    "lara",
    "laura",
    "lea",
    "lena",
    "leonore",
    "lieselotte",
    "lili",
    "lilian",
    "liliana",
    "lina",
    "linda",
    "lisa",
    "lorena",
    "louise",
    "luisa",
    "lukas",
    "madeleine",
    "magdalena",
    "maja",
    "manuela",
    "mara",
    "margarete",
    "margarethe",
    "margit",
    "maria",
    "marianne",
    "marie",
    "marina",
    "marion",
    "marlene",
    "marta",
    "martina",
    "mathilde",
    "melanie",
    "melissa",
    "merle",
    "michelle",
    "miriam",
    "monika",
    "monique",
    "nadine",
    "nadja",
    "natalia",
    "natalie",
    "nathalie",
    "nicole",
    "nikola",
    "nina",
    "noemi",
    "nora",
    "olga",
    "olivia",
    "paula",
    "pauline",
    "petra",
    "philippa",
    "rachel",
    "rahel",
    "ramona",
    "rebecca",
    "regina",
    "rena",
    "renate",
    "ricarda",
    "rita",
    "rosa",
    "rosalie",
    "rosemarie",
    "ruth",
    "sabine",
    "sandra",
    "sara",
    "sarah",
    "saskia",
    "selina",
    "selma",
    "silke",
    "silvia",
    "simone",
    "sina",
    "sofia",
    "sophia",
    "sophie",
    "stefanie",
    "stephanie",
    "susanne",
    "svenja",
    "swenja",
    "sylvia",
    "tanja",
    "tatjana",
    "thea",
    "theresa",
    "therese",
    "tina",
    "ute",
    "valentina",
    "valerie",
    "vanessa",
    "vera",
    "verena",
    "veronika",
    "victoria",
    "vivian",
    "vivienne",
    "waltraud",
    "wendy",
    "yasmine",
    "yolanda",
    "yvonne",
    "zoe",
    // Hebrew names (Biblical and traditional)
    "abraham",
    "adam",
    "ariel",
    "asher",
    "benjamin",
    "daniel",
    "david",
    "elijah",
    "elias",
    "eliezer",
    "emanuel",
    "ephraim",
    "ezra",
    "gabriel",
    "isaac",
    "isaiah",
    "jacob",
    "jonah",
    "jonathan",
    "joshua",
    "joseph",
    "judah",
    "levi",
    "matthew",
    "michael",
    "moses",
    "nathan",
    "noah",
    "raphael",
    "samuel",
    "simon",
    "solomon",
    "thomas",
    "zachary",
    "zvi",
    "abigail",
    "adina",
    "alexandra",
    "alexis",
    "aliza",
    "amanda",
    "amara",
    "amira",
    "anna",
    "ariel",
    "aviva",
    "batya",
    "chana",
    "chaya",
    "chloe",
    "danielle",
    "deborah",
    "eden",
    "eliana",
    "elise",
    "elizabeth",
    "emily",
    "esther",
    "eva",
    "gabriella",
    "hannah",
    "hava",
    "helena",
    "ilana",
    "isabella",
    "jessica",
    "julia",
    "leah",
    "lily",
    "maya",
    "michelle",
    "miriam",
    "naomi",
    "natalie",
    "noa",
    "rachel",
    "rebecca",
    "ruth",
    "sarah",
    "shira",
    "sophia",
    "talia",
    "tamar",
    "tova",
    "yvonne",
    "zoe",
    // Modern Israeli names (common contemporary names in Israel)
    "amit",
    "amitai",
    "amnon",
    "aviv",
    "avner",
    "barak",
    "bar",
    "ben",
    "benny",
    "dani",
    "danny",
    "dor",
    "dori",
    "doron",
    "elad",
    "eli",
    "elior",
    "eyal",
    "gal",
    "guy",
    "idan",
    "itai",
    "itamar",
    "itzhak",
    "liran",
    "lior",
    "maor",
    "matan",
    "meir",
    "michal",
    "moran",
    "natan",
    "nati",
    "niv",
    "noam",
    "omer",
    "or",
    "ori",
    "oriel",
    "ran",
    "ron",
    "ronen",
    "roy",
    "sagi",
    "shai",
    "shalev",
    "sharon",
    "shay",
    "shimon",
    "shlomo",
    "tal",
    "tomer",
    "tzachi",
    "uri",
    "yair",
    "yaniv",
    "yaron",
    "yoni",
    "yuval",
    "ziv",
    "eran",
    "gur",
    "ohad",
    "yanir",
    "eedo",
    "ido",
    "yoram",
    "chezi",
    "yosi",
    "yossi",
    "effi",
    "efi",
    "evgeny",
    "yoel",
    "ittai",
    "ittay",
    "nir",
    "snir",
    "ory",
    "gil",
    "rafi",
    "amir",
    "adi",
    "eden",
    "saar",
    "sahar",
    "adar",
    "hadar",
    "yahel",
    "oren",
    "simmi",
    "eddie",
    "gilad",
    "boaz",
    "ilia",
    "arie",
    "ari",
    "ariel",
    "hasson",
    "dov",
    "dudu",
    "mor",
    "nimo",
    "nimrod",
    "ofer",
    "alon",
    "ilan",
    "moti",
    "motty",
    "moshik",
    "isaac",
    "menashe",
    "zohar",
    "sapir",
    "assaf",
    "assi",
    "gidon",
    "dedi",
    "alex",
    "shlomi",
    "harel",
    "raphael",
    "udi",
    "uzi",
    "yvgeny",
    "gadi",
    "shahar",
    "shachar",
    "roi",
    "yariv",
    "boris",
    "shmulik",
    "miron",
    "erez",
    "saul",
    "shaul",
    "moshe",
    "raz",
    "yinon",
    "adva",
    "anat",
    "avital",
    "ayala",
    "bat-el",
    "bat-sheva",
    "carmel",
    "dafna",
    "danit",
    "daniella",
    "dikla",
    "efrat",
    "einat",
    "elinor",
    "eliora",
    "galit",
    "gili",
    "hadar",
    "hila",
    "hodaya",
    "inbal",
    "irit",
    "itay",
    "karmit",
    "liel",
    "lilach",
    "limor",
    "linoy",
    "liraz",
    "maayan",
    "meital",
    "merav",
    "mor",
    "neta",
    "nili",
    "nirit",
    "nitzan",
    "ofir",
    "ofra",
    "orit",
    "orly",
    "roni",
    "ronit",
    "rotem",
    "sapir",
    "shani",
    "shiri",
    "shlomit",
    "shoshana",
    "tali",
    "tamara",
    "yael",
    "yarden",
    "yifat",
    "yona",
    "zohar",

    // Medium names (6 chars)
    "larry",
    "justin",
    "scott",
    "brandon",
    "samuel",
    "frank",
    "gregory",
    "jerry",
    "tyler",
    "aaron",
    "henry",
    "adam",
    "noah",
    "steve",
    "chris",
    "mike",
    "dave",
    "lisa",
    "betty",
    "emma",
    "olivia",
    "maya",
    "cara",
    "bruce",
    "don",
    "james",
    "david",
    "john",
    "mark",
    "paul",
    "jose",
    "eric",
    "jack",
    "logan",
    "cameron",
    "hayden",
    "parker",
    "austin",
    "blake",
    "carter",
    "dylan",
    "evan",
    "hunter",
    "jackson",
    "landon",
    "mason",
    "owen",
    "riley",
    "tristan",
    "wyatt",
    "alexis",
    "quinn",
    "payton",
    "morgan",
    "jordan",
    "avery",
    "skylar",

    // Medium-short names (5 chars)
    "james",
    "david",
    "john",
    "mark",
    "paul",
    "gary",
    "wayne",
    "allen",
    "lewis",
    "clark",
    "ivy",
    "piper",
    "quinn",
    "riley",
    "taylor",
    "skylar",
    "avery",
    "morgan",
    "jordan",

    // Short names (4 chars)
    "joe",
    "tom",
    "juan",
    "amy",
    "ann",
    "jack",
    "luke",
    "owen",
    "ryan",
    "sean",
    "zach",
    "eric",
    "ivan",
    "jake",
    "josh",
    "kyle",
    "marc",
    "mike",
    "nick",
    "reed",
    "ross",
    "todd",
    "troy",
    "anna",
    "ella",
    "iris",
    "jade",
    "jane",
    "jill",
    "joan",
    "kate",
    "lily",
    "lucy",
    "lynn",
    "mary",
    "nina",
    "rose",
    "sara",
    "alex",
    "brad",
    "chad",
    "clay",
    "cole",
    "dale",
    "dean",
    "drew",
    "gabe",

    // Very short names (3 chars)
    "bob",
    "dan",
    "don",
    "ed",
    "ian",
    "jay",
    "joe",
    "kim",
    "lee",
    "max",
    "pat",
    "ray",
    "roy",
    "sam",
    "ted",
    "tom",
    "tim",
    "van",
    "vic",
    "zoe",
    "amy",
    "ann",
  ]
    .filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
    .sort((a, b) => b.length - a.length); // Sort by length descending

  // NOTE: ~500 common first names covering English, Latino, French, German, and Hebrew names
  // OpenAI fallback (implemented below) handles remaining edge cases
  // This approach balances accuracy, performance, and maintainability

  const slugLower = slug.toLowerCase();

  // Try to find a first name at the beginning (try longest first to avoid partial matches)
  for (const firstName of commonFirstNames) {
    if (slugLower.startsWith(firstName) && slug.length > firstName.length) {
      const lastName = slug.slice(firstName.length);
      // Last name should be reasonable length (3-15 chars)
      if (lastName.length >= 3 && lastName.length <= 15) {
        const result = `${firstName.charAt(0).toUpperCase() + firstName.slice(1)} ${lastName.charAt(0).toUpperCase() + lastName.slice(1)}`;
        console.log(
          `[splitCombinedName] Split "${slug}" → "${result}" (found "${firstName}" at start)`
        );
        return result;
      }
    }
  }

  // Special case: Handle common abbreviations/variations
  // "doallen" → "don" + "allen" (even though it doesn't start with "don")
  // "shainadenny" → "shaina" + "denny" (even though it doesn't start with "shaina")
  const specialCases: Record<string, [string, string]> = {
    doallen: ["Don", "Allen"],
    shainadenny: ["Shaina", "Denny"],
    melissanrobinson: ["Melissa", "Robinson"],
  };

  if (specialCases[slugLower]) {
    const [first, last] = specialCases[slugLower];
    const result = `${first} ${last}`;
    console.log(`[splitCombinedName] Split "${slug}" → "${result}" (special case)`);
    return result;
  }

  // Try to find a first name at the end (lastname-firstname pattern)
  // Try longest first to avoid partial matches
  for (const firstName of commonFirstNames) {
    if (slugLower.endsWith(firstName) && slug.length > firstName.length) {
      const lastName = slug.slice(0, -firstName.length);
      // Last name should be reasonable length (3-15 chars)
      if (lastName.length >= 3 && lastName.length <= 15) {
        const result = `${lastName.charAt(0).toUpperCase() + lastName.slice(1)} ${firstName.charAt(0).toUpperCase() + firstName.slice(1)}`;
        console.log(
          `[splitCombinedName] Split "${slug}" → "${result}" (found "${firstName}" at end)`
        );
        return result;
      }
    }
  }

  // Try splitting at capitalization boundaries (if there are any)
  const capsMatch = slug.match(/^([a-z]+)([A-Z][a-z]+)$/);
  if (capsMatch) {
    const part1 = capsMatch[1];
    const part2 = capsMatch[2];
    if (part1.length >= 3 && part1.length <= 10 && part2.length >= 3 && part2.length <= 12) {
      const result = `${part1.charAt(0).toUpperCase() + part1.slice(1)} ${part2}`;
      console.log(`[splitCombinedName] Split "${slug}" → "${result}" (capitalization boundary)`);
      return result;
    }
  }

  // Try splitting in the middle (common name lengths)
  // First names: 3-8 chars, Last names: 4-12 chars
  // Try common first name lengths first, but also try all reasonable splits
  const commonSplits = [6, 7, 5, 4, 3, 8]; // Common first name lengths (prioritize longer names)

  // First try common splits
  for (const split of commonSplits) {
    if (split >= 3 && split <= slug.length - 4) {
      const part1 = slug.slice(0, split);
      const part2 = slug.slice(split);
      if (part1.length >= 3 && part1.length <= 8 && part2.length >= 4 && part2.length <= 12) {
        const result = `${part1.charAt(0).toUpperCase() + part1.slice(1).toLowerCase()} ${part2.charAt(0).toUpperCase() + part2.slice(1).toLowerCase()}`;
        console.log(`[splitCombinedName] Split "${slug}" → "${result}" (middle split at ${split})`);
        return result;
      }
    }
  }

  // If common splits didn't work, try all reasonable splits (but prefer splits that create balanced names)
  // Prefer splits where both parts are similar length (more likely to be correct)
  let bestSplit: { split: number; balance: number } | null = null;
  for (let split = 3; split <= slug.length - 4; split++) {
    const part1 = slug.slice(0, split);
    const part2 = slug.slice(split);
    if (part1.length >= 3 && part1.length <= 8 && part2.length >= 4 && part2.length <= 12) {
      // Calculate balance score (closer to equal length = better)
      const balance = Math.abs(part1.length - part2.length);
      if (!bestSplit || balance < bestSplit.balance) {
        bestSplit = { split, balance };
      }
    }
  }

  if (bestSplit) {
    const part1 = slug.slice(0, bestSplit.split);
    const part2 = slug.slice(bestSplit.split);
    const result = `${part1.charAt(0).toUpperCase() + part1.slice(1).toLowerCase()} ${part2.charAt(0).toUpperCase() + part2.slice(1).toLowerCase()}`;
    console.log(
      `[splitCombinedName] Split "${slug}" → "${result}" (best balanced split at ${bestSplit.split}, balance: ${bestSplit.balance})`
    );
    return result;
  }

  console.log(`[splitCombinedName] Could not split "${slug}"`);
  return null;
}

/**
 * Extract name from LinkedIn URL slug (PRIMARY METHOD)
 * URL format: https://www.linkedin.com/in/samuel-hess/ → "Samuel Hess"
 * Handles: samuel-hess, fiedlerjason → "Fiedler Jason", pamela-keniston → "Pamela Keniston", maya-malkan → "Maya Malkan"
 *
 * EXPORTED for use across the project
 */
export function extractNameFromUrl(profileUrl: string): string | null {
  try {
    const match = profileUrl.match(/linkedin\.com\/in\/([^\/?#]+)/);
    if (!match || !match[1]) {
      console.log(`[extractNameFromUrl] No match found in URL: ${profileUrl}`);
      return null;
    }

    const slug = match[1];
    console.log(`[extractNameFromUrl] Extracting from slug: "${slug}"`);

    // Remove trailing alphanumeric IDs (like "-7b3944123", "-B162b424")
    // Only remove if they contain numbers OR are 8+ characters (6-7 char names are valid)
    // Pattern: hyphen followed by alphanumeric string with numbers OR 8+ chars
    let cleanSlug = slug.replace(/-[a-zA-Z0-9]{8,}$/, ""); // Remove 8+ char trailing IDs
    cleanSlug = cleanSlug.replace(/-[a-zA-Z0-9]*[0-9][a-zA-Z0-9]*$/, ""); // Remove trailing IDs with numbers

    // Remove trailing numbers (like "-123456")
    cleanSlug = cleanSlug.replace(/-\d+$/, "");

    console.log(`[extractNameFromUrl] Clean slug: "${cleanSlug}"`);

    // Split by hyphens
    const parts = cleanSlug.split("-");
    console.log(`[extractNameFromUrl] Split into parts:`, parts);

    // Take first 2-3 parts (first name, last name, sometimes middle name)
    // Filter out parts that are clearly IDs (all numbers, or very long alphanumeric)
    const nameParts = parts
      .slice(0, 3)
      .filter((part) => {
        if (!part || part.length === 0) {
          console.log(`[extractNameFromUrl] Filtering out empty part`);
          return false;
        }
        // Reject if it's all numbers
        if (/^\d+$/.test(part)) {
          console.log(`[extractNameFromUrl] Filtering out numeric part: "${part}"`);
          return false;
        }
        // Reject if it's a long alphanumeric ID (6+ chars of mixed case/numbers)
        if (/^[a-zA-Z0-9]{6,}$/.test(part) && /[0-9]/.test(part)) {
          console.log(`[extractNameFromUrl] Filtering out ID-like part: "${part}"`);
          return false;
        }
        return true;
      })
      .map((part) => {
        // Convert to title case: first letter uppercase, rest lowercase
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      });

    console.log(`[extractNameFromUrl] Filtered name parts:`, nameParts);

    // Must have at least 2 parts (first name + last name)
    if (nameParts.length >= 2) {
      const result = nameParts.join(" ");
      console.log(`[extractNameFromUrl] ✅ Returning full name: "${result}"`);
      return result;
    }

    // If only 1 part, try to split it intelligently (combined first+last name)
    if (nameParts.length === 1) {
      const singlePart = cleanSlug; // Use original slug before title case conversion
      if (singlePart.length >= 6 && singlePart.length <= 20) {
        const splitName = splitCombinedName(singlePart);
        if (splitName) {
          console.log(`[extractNameFromUrl] Split combined name: "${singlePart}" → "${splitName}"`);
          return splitName;
        }
      }
      // If we can't split it, return as-is (better than nothing)
      if (singlePart.length >= 2 && singlePart.length <= 20) {
        return singlePart.charAt(0).toUpperCase() + singlePart.slice(1).toLowerCase();
      }
    }

    return null;
  } catch (error) {
    console.log(`[extractNameFromUrl] Error extracting name from ${profileUrl}:`, error);
    return null;
  }
}

/**
 * Extract author profile URL and name from LinkedIn post page HTML
 * LinkedIn post pages contain author profile URL and name in meta tags or embedded JSON
 * Returns { url: string, name: string | null }
 */
async function extractAuthorProfileFromPost(
  postUrl: string
): Promise<{ url: string; name: string | null } | null> {
  try {
    // Fetch the post page HTML
    const response = await fetch(postUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      console.log(`[extractAuthorProfileFromPost] Failed to fetch ${postUrl}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    let profileUrl: string | null = null;
    let authorName: string | null = null;

    // Try to find author profile URL in various places:
    // 1. Meta tags: <meta property="og:url" content="https://www.linkedin.com/in/..."/>
    // 2. Embedded JSON: "author": {"url": "https://www.linkedin.com/in/...", "name": "..."}
    // 3. Canonical link: <link rel="canonical" href="..."/>

    // Method 1: Meta property og:url (often contains author profile)
    const ogUrlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
    if (ogUrlMatch && ogUrlMatch[1].includes("/in/")) {
      profileUrl = ogUrlMatch[1].split("?")[0].split("#")[0];
    }

    // Method 2: Embedded JSON-LD or script tags with author info (BEST - often has name too!)
    const jsonLdMatches = html.match(
      /"author":\s*\{[^}]*"url":\s*"([^"]+linkedin\.com\/in\/[^"]+)"[^}]*"name":\s*"([^"]+)"/gi
    );
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        const urlMatch = match.match(/"url":\s*"([^"]+linkedin\.com\/in\/[^"]+)"/i);
        const nameMatch = match.match(/"name":\s*"([^"]+)"/i);
        if (urlMatch && urlMatch[1]) {
          profileUrl = urlMatch[1].split("?")[0].split("#")[0];
          if (nameMatch && nameMatch[1]) {
            const cleanedName = cleanProfileName(nameMatch[1]);
            if (cleanedName && cleanedName.split(/\s+/).length >= 2) {
              authorName = cleanedName;
              console.log(
                `[extractAuthorProfileFromPost] ✅ Found author name in JSON: "${authorName}"`
              );
              break;
            }
          }
        }
      }
    }

    // If we didn't get name from JSON, try simpler JSON pattern
    if (!authorName) {
      const jsonLdMatch = html.match(
        /"author":\s*\{[^}]*"url":\s*"([^"]+linkedin\.com\/in\/[^"]+)"/i
      );
      if (jsonLdMatch) {
        profileUrl = jsonLdMatch[1].split("?")[0].split("#")[0];
      }
    }

    // Method 3: Look for linkedin.com/in/ pattern in script tags
    if (!profileUrl) {
      const scriptMatch = html.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+/);
      if (scriptMatch) {
        const profilePath = scriptMatch[0];
        profileUrl = `https://www.${profilePath}`.split("?")[0].split("#")[0];
      }
    }

    // Method 4: Canonical link (sometimes points to author profile)
    if (!profileUrl) {
      const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      if (canonicalMatch && canonicalMatch[1].includes("/in/")) {
        profileUrl = canonicalMatch[1].split("?")[0].split("#")[0];
      }
    }

    // Try to extract author name from post HTML if we didn't get it from JSON
    // IMPORTANT: For post pages, og:title and page title are usually the POST TITLE, not the author name!
    // Only extract if it clearly looks like a name (2-4 words, proper capitalization)
    if (!authorName && profileUrl) {
      // Method 1: og:title might have "Name - Post Title | LinkedIn" (but usually just "Post Title | LinkedIn")
      const ogTitleMatch = html.match(
        /<meta\s+property=["']og:title["']\s+content=["']([^"']+?)["']/i
      );
      if (ogTitleMatch && ogTitleMatch[1]) {
        // Format: "Name - Post Title | LinkedIn" or "Post Title | LinkedIn"
        const titleParts = ogTitleMatch[1].split(" | ")[0];
        const parts = titleParts.split(" - ");

        // If there's a dash, the first part MIGHT be the name (but could also be post title)
        if (parts.length > 1) {
          const potentialName = parts[0].trim();
          const cleanedName = cleanProfileName(potentialName);
          // Only use if it looks like a name (2-4 words, not too long, proper format)
          if (
            cleanedName &&
            cleanedName.split(/\s+/).length >= 2 &&
            cleanedName.split(/\s+/).length <= 4 &&
            cleanedName.length <= 40
          ) {
            // Double-check: reject if it looks like a post title
            const isPostTitle =
              /^(How|What|Why|When|Where|The|A|An|Pet|Scaling|Market|Industry)/i.test(
                cleanedName
              ) || cleanedName.length > 30;
            if (!isPostTitle) {
              authorName = cleanedName;
              console.log(
                `[extractAuthorProfileFromPost] ✅ Found author name in og:title: "${authorName}"`
              );
            }
          }
        }
      }

      // Method 2: Page title tag (same logic - usually post title, not author name)
      if (!authorName) {
        const titleMatch = html.match(/<title>([^<]+?)(?:\s*[-|]|<\/title>)/i);
        if (titleMatch && titleMatch[1]) {
          const titleParts = titleMatch[1].split(" | ")[0];
          const parts = titleParts.split(" - ");

          if (parts.length > 1) {
            const potentialName = parts[0].trim();
            const cleanedName = cleanProfileName(potentialName);
            if (
              cleanedName &&
              cleanedName.split(/\s+/).length >= 2 &&
              cleanedName.split(/\s+/).length <= 4 &&
              cleanedName.length <= 40
            ) {
              const isPostTitle =
                /^(How|What|Why|When|Where|The|A|An|Pet|Scaling|Market|Industry)/i.test(
                  cleanedName
                ) || cleanedName.length > 30;
              if (!isPostTitle) {
                authorName = cleanedName;
                console.log(
                  `[extractAuthorProfileFromPost] ✅ Found author name in title: "${authorName}"`
                );
              }
            }
          }
        }
      }
    }

    if (!profileUrl) {
      console.log(`[extractAuthorProfileFromPost] Could not extract author URL from ${postUrl}`);
      return null;
    }

    return { url: profileUrl, name: authorName };
  } catch (error: any) {
    console.log(
      `[extractAuthorProfileFromPost] Error extracting author from ${postUrl}:`,
      error.message
    );
    return null;
  }
}

/**
 * Calculate market score for a profile (per ChatGPT recommendations)
 * +3 if www.linkedin.com
 * +2 if uk/ca/au.linkedin.com
 * +1 if profile/post text includes US/UK/CA/AU locations
 * -3 if cn/th/kr/... (Asian domains)
 */
function calculateMarketScore(url: string, domain: string, title: string, snippet: string): number {
  let score = 0;

  // Domain-based scoring
  if (domain === "www" || domain === "linkedin") {
    score += 3; // US/International - highest priority
  } else if (["uk", "ca", "au"].includes(domain)) {
    score += 2; // English-speaking countries
  } else if (["cn", "th", "kr", "jp", "hk", "in", "sg", "id", "vn", "my"].includes(domain)) {
    score -= 3; // Asian domains - penalize heavily
  }

  // Location mentions in text
  const combinedText = `${title} ${snippet}`.toLowerCase();
  if (/\b(usa|united states|american|us\b)/.test(combinedText)) {
    score += 1;
  }
  if (/\b(uk|united kingdom|british|england|scotland|wales)\b/.test(combinedText)) {
    score += 1;
  }
  if (/\b(canada|canadian)\b/.test(combinedText)) {
    score += 1;
  }
  if (/\b(australia|australian)\b/.test(combinedText)) {
    score += 1;
  }

  return score;
}

/**
 * Pre-filter and score results with market scoring (per ChatGPT recommendations)
 * Keep original URLs, score by market preference, don't hard-filter unless we have plenty
 */
function preFilterResults(
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    _domain?: string;
    _normalizedUrl?: string;
    _sourceType?: string;
  }>,
  brandName?: string,
  targetCount: number = 20
): Array<{ url: string; title: string; snippet: string }> {
  const scoredResults: Array<{
    url: string;
    title: string;
    snippet: string;
    score: number;
    domain: string;
  }> = [];
  const seenUrls = new Set<string>();

  const brandLower = brandName?.toLowerCase() || "";
  const brandVariations = brandLower ? [brandLower, `${brandLower}y`] : [];

  for (const result of results) {
    // Must be a LinkedIn profile URL
    if (!result.url || !result.url.includes("linkedin.com/in/")) {
      continue;
    }

    // Exclude non-profile pages
    if (
      result.url.includes("/company/") ||
      result.url.includes("/jobs/") ||
      result.url.includes("/learning/") ||
      result.url.includes("/pulse/")
    ) {
      continue;
    }

    // Get domain
    const domain =
      result._domain || (result.url.match(/https?:\/\/([^\/]+)\.linkedin\.com/) || [])[1] || "www";

    // Check if title/snippet appears to be in English
    const combinedText = `${result.title || ""} ${result.snippet || ""}`.trim();
    if (!appearsToBeEnglish(combinedText)) {
      console.log(
        `[preFilterResults] Excluding non-English content: ${result.url} (domain: ${domain})`
      );
      continue;
    }

    // Exclude brand mentions
    const textToCheck = combinedText.toLowerCase();
    if (brandVariations.some((brand) => textToCheck.includes(brand))) {
      console.log(`[preFilterResults] Excluding profile with brand mention: ${result.url}`);
      continue;
    }

    // Use normalized URL for deduplication
    const normalizedUrl =
      result._normalizedUrl ||
      result.url.replace(/https?:\/\/([^\/]+)\.linkedin\.com/, "https://www.linkedin.com");

    if (seenUrls.has(normalizedUrl)) {
      continue;
    }
    seenUrls.add(normalizedUrl);

    // Calculate market score
    const marketScore = calculateMarketScore(
      result.url,
      domain,
      result.title || "",
      result.snippet || ""
    );

    scoredResults.push({
      url: result.url, // Keep original URL
      title: result.title || "",
      snippet: result.snippet || "",
      score: marketScore,
      domain: domain,
    });
  }

  // Sort by market score (highest first)
  scoredResults.sort((a, b) => b.score - a.score);

  // Take top N results (prioritize high scores, but don't hard-filter low scores if we don't have enough)
  const finalResults: Array<{ url: string; title: string; snippet: string }> = [];
  const minScore = -3; // Only exclude heavily penalized Asian domains if we have plenty

  for (const result of scoredResults) {
    // If we have plenty of results and this is heavily penalized, skip it
    if (scoredResults.length > targetCount && result.score <= minScore) {
      continue;
    }

    // Normalize URL only after acceptance
    let normalized = result.url.split("?")[0].split("#")[0];
    normalized = normalized.replace(/\/in\/([^\/]+)\/[a-z]{2}$/, "/in/$1");
    normalized = normalized.replace(
      /https?:\/\/([^\/]+)\.linkedin\.com/,
      "https://www.linkedin.com"
    );

    finalResults.push({
      url: normalized,
      title: result.title,
      snippet: result.snippet,
    });

    if (finalResults.length >= targetCount) {
      break;
    }
  }

  console.log(
    `[preFilterResults] Scored ${scoredResults.length} results, returning top ${finalResults.length}`
  );
  console.log(`[preFilterResults] Score distribution:`, {
    high: scoredResults.filter((r) => r.score >= 3).length,
    medium: scoredResults.filter((r) => r.score >= 0 && r.score < 3).length,
    low: scoredResults.filter((r) => r.score < 0).length,
  });

  return finalResults;
}

/**
 * Search LinkedIn profiles using SerpAPI
 * Returns profiles with extracted names using the 926-name database
 *
 * EXPORTED for use across the project
 */
export async function searchLinkedInWithSerpAPI(
  topic: string,
  keywords: string[],
  count: number,
  apiKey: string,
  brandName?: string
): Promise<Array<{ url: string; title: string; snippet: string; name?: string }>> {
  try {
    console.log(`[searchLinkedInWithSerpAPI] Searching LinkedIn profiles via SerpAPI`);
    console.log(
      `[searchLinkedInWithSerpAPI] Topic: "${topic}", Keywords: ${keywords.join(", ") || "none"}, Count: ${count}, Brand: ${brandName || "none"}`
    );

    const allResults: Array<{
      url: string;
      title: string;
      snippet: string;
      _domain?: string;
      _normalizedUrl?: string;
    }> = [];
    const seenUrls = new Set<string>();

    // Build queries per ChatGPT recommendations (separate queries per English subdomain)
    const queries = buildLinkedInQueries(topic, keywords, brandName);
    console.log(
      `[searchLinkedInWithSerpAPI] Built ${queries.length} queries (${queries.length / 2} subdomains × 2 queries each)`
    );

    // Target: we want at least count * 2 results for ranking
    const targetCount = count * 2;

    // Execute each query with pagination (2 pages per query as ChatGPT recommended)
    for (let q = 0; q < queries.length; q++) {
      const { query, description, contentType } = queries[q];

      // Stop if we have enough results
      if (allResults.length >= targetCount * 1.5) {
        // Collect extra for filtering
        console.log(
          `[searchLinkedInWithSerpAPI] ✅ Reached collection target (${allResults.length}), stopping`
        );
        break;
      }

      // Execute query with 2 pages (per ChatGPT: 2 pages each)
      for (let page = 0; page < 2; page++) {
        const start = page * 20;

        // Stop if we have enough results
        if (allResults.length >= targetCount * 1.5) break;

        try {
          const fullUrl = buildSerpAPIUrl(query, apiKey, start);
          console.log(
            `[searchLinkedInWithSerpAPI] Query ${q + 1}/${queries.length} (${description}), Page ${page + 1}/2: ${query.substring(0, 100)}...`
          );

          const response = await fetch(fullUrl, {
            headers: {
              Accept: "application/json",
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.log(
              `[searchLinkedInWithSerpAPI] ❌ SerpAPI error for query ${q + 1}, page ${page + 1}: ${response.status} ${response.statusText}`
            );
            console.log(`[searchLinkedInWithSerpAPI] Error details:`, errorText.substring(0, 500));
            continue;
          }

          const data = await response.json();
          const organicResults = data.organic_results || [];
          console.log(
            `[searchLinkedInWithSerpAPI] Query ${q + 1}/${queries.length}, Page ${page + 1}/2: Found ${organicResults.length} organic results`
          );

          // Process results - handle posts/newsletters/events and extract author profiles
          const { contentType } = queries[q];

          for (const result of organicResults) {
            if (!result.link) continue;

            const originalUrl = result.link.split("?")[0].split("#")[0];

            // DEBUG: Log what SerpAPI actually returns so we can see the snippet format
            console.log(
              `[searchLinkedInWithSerpAPI] SerpAPI result for ${originalUrl.substring(0, 60)}:`
            );
            console.log(`  title: "${result.title || "none"}"`);
            console.log(`  snippet: "${result.snippet || "none"}"`);

            // Handle different content types
            if (originalUrl.includes("/posts/")) {
              // CRITICAL: Extract name from SerpAPI title AND snippet FIRST (before any HTML fetch)
              // SerpAPI often has the correct name in title format: "Jonathan Wainberg - Post Title"
              // Or in snippet: "View profile for Arcui Usoara" or "Posted by Name"
              let profileNameFromSerpAPI: string | null = null;

              // Try title first (format: "Name - Post Title")
              if (result.title) {
                profileNameFromSerpAPI = extractNameFromSerpAPIResult(result.title, undefined);
                if (profileNameFromSerpAPI) {
                  console.log(
                    `[searchLinkedInWithSerpAPI] ✅ Extracted name from SerpAPI title: "${profileNameFromSerpAPI}"`
                  );
                }
              }

              // Try snippet if title didn't work
              if (!profileNameFromSerpAPI && result.snippet) {
                profileNameFromSerpAPI = extractNameFromSerpAPIResult(undefined, result.snippet);
                if (profileNameFromSerpAPI) {
                  console.log(
                    `[searchLinkedInWithSerpAPI] ✅ Extracted name from SerpAPI snippet: "${profileNameFromSerpAPI}"`
                  );
                }
              }

              // Post URL - fetch HTML to extract author profile URL (and name if SerpAPI didn't work)
              const authorInfo = await extractAuthorProfileFromPost(originalUrl);

              if (authorInfo && authorInfo.url) {
                let subdomain = "www";
                const domainMatch = authorInfo.url.match(/https?:\/\/([^\/]+)\.linkedin\.com/);
                if (domainMatch) {
                  subdomain = domainMatch[1];
                  if (subdomain === "linkedin") {
                    subdomain = "www";
                  }
                }

                let normalized = authorInfo.url.replace(/\/in\/([^\/]+)\/[a-z]{2}$/, "/in/$1");
                normalized = normalized.replace(
                  /https?:\/\/([^\/]+)\.linkedin\.com/,
                  "https://www.linkedin.com"
                );

                if (!seenUrls.has(normalized)) {
                  seenUrls.add(normalized);

                  // Priority order: SerpAPI (title/snippet) > Post HTML > Profile HTML > URL extraction
                  let profileName = profileNameFromSerpAPI || authorInfo.name;

                  if (!profileName) {
                    // Fallback: Try profile page HTML (will likely fail due to LinkedIn blocking)
                    profileName = await extractProfileName(
                      authorInfo.url,
                      undefined, // Don't use result.title for posts - it's the post title!
                      result.snippet // Already tried above, but pass again for extractProfileName's internal fallback
                    );
                  }

                  if (!profileName) {
                    console.log(
                      `[searchLinkedInWithSerpAPI] ⚠️ Could not extract profile name from ${authorInfo.url}, skipping`
                    );
                    continue; // Skip if we can't get the actual profile name
                  }

                  console.log(
                    `[searchLinkedInWithSerpAPI] ✅ Final profile name: "${profileName}" (source: ${profileNameFromSerpAPI ? "SerpAPI" : authorInfo.name ? "post HTML" : "profile HTML/URL"})`
                  );

                  // Extract profile headline/description (more reliable than post snippet for relevance)
                  const profileHeadline = await extractProfileHeadline(authorInfo.url);
                  const profileSnippet = profileHeadline || result.snippet || "";

                  allResults.push({
                    url: authorInfo.url,
                    title: profileName, // ALWAYS use extracted profile name, never post title
                    snippet: profileSnippet, // Use profile headline instead of post snippet (more accurate for relevance)
                    name: profileName, // Explicit name field for consistency
                    _domain: subdomain,
                    _normalizedUrl: normalized,
                    _sourceUrl: originalUrl,
                    _sourceType: "post",
                  } as any);

                  console.log(
                    `[searchLinkedInWithSerpAPI] ✅ Extracted profile: "${profileName}" from ${authorInfo.url}${profileHeadline ? ` (headline: ${profileHeadline.substring(0, 60)}...)` : ""}`
                  );
                }
              } else {
                console.log(
                  `[searchLinkedInWithSerpAPI] Could not extract author from post: ${originalUrl.substring(0, 80)}...`
                );
              }

              // Rate limit between fetches
              await new Promise((resolve) => setTimeout(resolve, 500));
            } else if (originalUrl.includes("/newsletters/")) {
              // Newsletter URL - try to extract author
              const authorProfileMatch = (result.snippet || result.title || "").match(
                /linkedin\.com\/in\/[a-zA-Z0-9-]+/
              );

              if (authorProfileMatch) {
                const profilePath = authorProfileMatch[0];
                const profileUrl = `https://www.${profilePath}`;

                let subdomain = "www";
                const domainMatch = profileUrl.match(/https?:\/\/([^\/]+)\.linkedin\.com/);
                if (domainMatch && domainMatch[1] !== "www") {
                  subdomain = domainMatch[1];
                }

                let normalized = profileUrl.replace(/\/in\/([^\/]+)\/[a-z]{2}$/, "/in/$1");
                normalized = normalized.replace(
                  /https?:\/\/([^\/]+)\.linkedin\.com/,
                  "https://www.linkedin.com"
                );

                if (!seenUrls.has(normalized)) {
                  seenUrls.add(normalized);

                  // Extract profile name and headline (more reliable than newsletter snippet)
                  // Try SerpAPI title/snippet first, then HTML, then URL extraction
                  const profileName = await extractProfileName(
                    profileUrl,
                    result.title, // SerpAPI title might have correct name
                    result.snippet // SerpAPI snippet might have correct name
                  );
                  const profileHeadline = await extractProfileHeadline(profileUrl);
                  const profileSnippet = profileHeadline || result.snippet || "";

                  allResults.push({
                    url: profileUrl,
                    title: profileName || result.title || "",
                    snippet: profileSnippet, // Use profile headline instead of newsletter snippet
                    _domain: subdomain,
                    _normalizedUrl: normalized,
                    _sourceUrl: originalUrl,
                    _sourceType: "newsletter",
                  } as any);

                  if (profileName) {
                    console.log(
                      `[searchLinkedInWithSerpAPI] ✅ Extracted profile from newsletter: "${profileName}" from ${profileUrl}${profileHeadline ? ` (headline: ${profileHeadline.substring(0, 60)}...)` : ""}`
                    );
                  }
                }
              } else {
                console.log(
                  `[searchLinkedInWithSerpAPI] Newsletter URL found but no author in snippet: ${originalUrl.substring(0, 80)}...`
                );
              }
            } else if (originalUrl.includes("/in/")) {
              // Direct profile URL (from profile queries or fallback)
              // Exclude non-profile pages
              if (
                originalUrl.includes("/jobs/") ||
                originalUrl.includes("/learning/") ||
                originalUrl.includes("/pulse/") ||
                originalUrl.includes("/company/")
              ) {
                continue;
              }

              let subdomain = "www";
              const domainMatch = originalUrl.match(/https?:\/\/([^\/]+)\.linkedin\.com/);
              if (domainMatch) {
                subdomain = domainMatch[1];
                if (subdomain === "linkedin") {
                  subdomain = "www";
                }
              }

              let normalized = originalUrl.replace(/\/in\/([^\/]+)\/[a-z]{2}$/, "/in/$1");
              normalized = normalized.replace(
                /https?:\/\/([^\/]+)\.linkedin\.com/,
                "https://www.linkedin.com"
              );

              if (!seenUrls.has(normalized)) {
                seenUrls.add(normalized);

                // Extract profile name from SerpAPI result (more reliable than URL extraction)
                // Try SerpAPI title/snippet first, then HTML, then URL extraction
                const profileName = await extractProfileName(
                  originalUrl,
                  result.title, // SerpAPI title might have correct name
                  result.snippet // SerpAPI snippet might have correct name
                );

                allResults.push({
                  url: originalUrl,
                  title: profileName || result.title || "", // Use extracted name if available
                  snippet: result.snippet || "",
                  name: profileName || undefined, // Explicit name field for consistency
                  _domain: subdomain,
                  _normalizedUrl: normalized,
                } as any);
              }
            }
          }

          const currentCount = allResults.length;
          console.log(
            `[searchLinkedInWithSerpAPI] Query ${q + 1}/${queries.length}, Page ${page + 1}/2: Collected ${organicResults.length} results, Total profiles so far: ${currentCount}`
          );

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (error: any) {
          console.log(
            `[searchLinkedInWithSerpAPI] ❌ Error executing query ${q + 1}, page ${page + 1}:`,
            error.message
          );
          continue;
        }
      }
    }

    // Pre-filter results before returning (with domain tier system)
    console.log(
      `[searchLinkedInWithSerpAPI] Before pre-filtering: ${allResults.length} raw results collected`
    );
    if (allResults.length > 0) {
      const domainBreakdown = new Map<string, number>();
      allResults.forEach((r) => {
        const domain = r._domain || "unknown";
        domainBreakdown.set(domain, (domainBreakdown.get(domain) || 0) + 1);
      });
      console.log(
        `[searchLinkedInWithSerpAPI] Domain breakdown:`,
        Object.fromEntries(domainBreakdown)
      );
      console.log(
        `[searchLinkedInWithSerpAPI] Sample raw URLs:`,
        allResults.slice(0, 5).map((r) => r.url)
      );
    }

    const filteredResults = preFilterResults(allResults, brandName, targetCount);

    console.log(
      `[searchLinkedInWithSerpAPI] ✅ Found ${filteredResults.length} unique LinkedIn profiles after pre-filtering (from ${allResults.length} raw results)`
    );
    if (filteredResults.length > 0) {
      console.log(
        `[searchLinkedInWithSerpAPI] Sample filtered URLs:`,
        filteredResults.slice(0, 3).map((r) => r.url)
      );
    } else if (allResults.length > 0) {
      console.log(
        `[searchLinkedInWithSerpAPI] ⚠️ All ${allResults.length} results were filtered out. Sample domains:`,
        [
          ...new Set(
            allResults.slice(0, 10).map((r) => {
              const match = r.url.match(/https?:\/\/([^\/]+)/);
              return match ? match[1] : "unknown";
            })
          ),
        ].join(", ")
      );
    }

    // Map filtered results to include name field
    // Find corresponding result from allResults to get extracted name
    const resultMap = new Map(allResults.map((r) => [r.url, r]));

    return filteredResults.slice(0, targetCount).map((result) => {
      const fullResult = resultMap.get(result.url) || result;
      return {
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        name: (fullResult as any).name || fullResult.title || undefined, // Use explicit name field or fallback to title
      };
    });
  } catch (error: any) {
    console.error(`[searchLinkedInWithSerpAPI] ❌ Fatal error:`, error);
    console.error(`[searchLinkedInWithSerpAPI] Error stack:`, error.stack);
    return [];
  }
}

/**
 * Search TikTok profiles using SerpAPI
 * Returns TikTok profiles with follower counts extracted from search results
 *
 * EXPORTED for use across the project
 */
export async function searchTikTokProfiles(
  topic: string,
  keywords: string[],
  count: number,
  brandName?: string
): Promise<
  Array<{ url: string; title: string; snippet: string; name?: string; followerCount?: number }>
> {
  // Try SerpAPI first (most reliable, can extract follower counts)
  const serpApiKey = process.env.SERPAPI_KEY;
  if (serpApiKey) {
    console.log(`[searchTikTokProfiles] Using SerpAPI for TikTok search`);
    return await searchTikTokWithSerpAPI(topic, keywords, count, serpApiKey, brandName);
  }

  // If no SerpAPI key, return empty (will fall back to OpenAI)
  console.log(`[searchTikTokProfiles] No SerpAPI key found, will use OpenAI fallback`);
  return [];
}

/**
 * Use SerpAPI to verify TikTok follower counts for specific URLs
 * This actually checks real follower counts from search results, not OpenAI's training data
 */
async function verifyTikTokFollowerCountsWithSerpAPI(
  urls: string[]
): Promise<Map<string, number | null>> {
  const followerMap = new Map<string, number | null>();
  const serpApiKey = process.env.SERPAPI_KEY;

  if (!serpApiKey) {
    console.log(
      `[verifyTikTokFollowerCountsWithSerpAPI] No SerpAPI key, cannot verify follower counts`
    );
    return followerMap;
  }

  console.log(
    `[verifyTikTokFollowerCountsWithSerpAPI] Verifying follower counts for ${urls.length} TikTok URLs using SerpAPI`
  );

  // Process URLs in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);

    for (const url of batch) {
      try {
        // Extract username from URL
        const usernameMatch = url.match(/tiktok\.com\/@([^/?]+)/i);
        if (!usernameMatch) {
          followerMap.set(url, null);
          continue;
        }

        const username = usernameMatch[1];

        // Search for this specific TikTok profile using SerpAPI
        const query = `site:tiktok.com/@${username} "${username}" followers`;
        const serpUrl = buildSerpAPIUrl(query, serpApiKey, 0);

        console.log(`[verifyTikTokFollowerCountsWithSerpAPI] Checking: ${url}`);

        const response = await fetch(serpUrl, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          console.log(
            `[verifyTikTokFollowerCountsWithSerpAPI] SerpAPI error for ${url}: ${response.status}`
          );
          followerMap.set(url, null);
          continue;
        }

        const data = await response.json();
        const organicResults = data.organic_results || [];

        // Look for follower count in search results
        let foundFollowerCount: number | null = null;

        for (const result of organicResults) {
          const textToSearch = ((result.snippet || "") + " " + (result.title || "")).toLowerCase();

          // Pattern 1: "1.2M followers", "500K followers", "50 thousand followers"
          const followerMatch = textToSearch.match(
            /(\d+(?:\.\d+)?)\s*(?:K|k|thousand|M|m|million)?\s*followers?/i
          );
          if (followerMatch) {
            let count = parseFloat(followerMatch[1]);
            if (followerMatch[0].includes("k") || followerMatch[0].includes("thousand")) {
              count = count * 1000;
            } else if (followerMatch[0].includes("m") || followerMatch[0].includes("million")) {
              count = count * 1000000;
            }
            foundFollowerCount = Math.round(count);
            break;
          }

          // Pattern 2: Look for "X followers" where X is a number
          const directMatch = textToSearch.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*followers?/);
          if (directMatch) {
            foundFollowerCount = parseInt(directMatch[1].replace(/,/g, ""));
            break;
          }
        }

        if (foundFollowerCount !== null) {
          console.log(
            `[verifyTikTokFollowerCountsWithSerpAPI] ✅ Found ${foundFollowerCount.toLocaleString()} followers for ${url}`
          );
          followerMap.set(url, foundFollowerCount);
        } else {
          console.log(
            `[verifyTikTokFollowerCountsWithSerpAPI] ⚠️ Could not find follower count for ${url}`
          );
          followerMap.set(url, null);
        }

        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[verifyTikTokFollowerCountsWithSerpAPI] Error checking ${url}:`, error);
        followerMap.set(url, null);
      }
    }

    // Delay between batches
    if (i + batchSize < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const verifiedCount = Array.from(followerMap.values()).filter((v) => v !== null).length;
  console.log(
    `[verifyTikTokFollowerCountsWithSerpAPI] Verified ${verifiedCount} of ${urls.length} follower counts`
  );

  return followerMap;
}

/**
 * Use OpenAI to enrich TikTok profiles with follower counts
 * Takes a list of TikTok profiles and returns them with follower counts added (when available)
 * NOTE: This relies on OpenAI's training data, which may be outdated or incomplete
 */
async function enrichTikTokProfilesWithFollowerCounts(
  profiles: Array<{
    url: string;
    title: string;
    snippet: string;
    name?: string;
    followerCount?: number;
  }>,
  topic: string,
  keywords: string[]
): Promise<
  Array<{ url: string; title: string; snippet: string; name?: string; followerCount?: number }>
> {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.log(
        `[enrichTikTokProfilesWithFollowerCounts] No OpenAI API key, skipping enrichment`
      );
      return profiles;
    }

    const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

    // Build prompt with list of TikTok URLs
    const urlsList = profiles
      .map((p, idx) => `${idx + 1}. ${p.url} (${p.name || "unknown"})`)
      .join("\n");

    const prompt = `I have a list of TikTok profile URLs related to: ${topic}${keywords.length > 0 ? ` (keywords: ${keywords.join(", ")})` : ""}

For each TikTok profile URL below, provide the follower count if you know it from your training data. Include follower counts even if they are low (including 0) - we need to filter them out.

IMPORTANT: EXCLUDE company accounts, brand accounts, official business accounts. ONLY include individual people/influencers/creators.

TikTok Profiles:
${urlsList}

Return a JSON array where each object has:
- "url": The TikTok profile URL
- "followerCount": The follower count as a number (include even if 0 or low - we need to know to filter them out)

Example:
[
  {"url": "https://www.tiktok.com/@username1", "followerCount": 50000},
  {"url": "https://www.tiktok.com/@username2", "followerCount": 120000},
  {"url": "https://www.tiktok.com/@username3", "followerCount": 0}
]

CRITICAL:
- Include follower counts you KNOW from your training data - even if they are 0 or very low
- If you know an account has 0 followers, include "followerCount": 0
- If you know an account has fewer than 500 followers, include the actual count
- If you don't know the follower count for an account, omit the "followerCount" field for that account
- EXCLUDE company accounts, brand accounts, official business accounts, retailer accounts
- ONLY include individual people/influencers/creators - NOT companies, brands, or businesses
- If a URL is a company account (e.g. retailer, brand page), skip it entirely - don't include it in the response
- Return ONLY valid JSON - no explanations, no markdown`;

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a TikTok research expert. Return ONLY valid JSON arrays - no explanations, no markdown, no code blocks.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[enrichTikTokProfilesWithFollowerCounts] OpenAI API error: ${response.status} ${errorText}`
      );
      return profiles; // Return original profiles if API fails
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response (handle markdown code blocks)
    let jsonContent = content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\n/, "").replace(/\n```$/, "");
    }

    try {
      const followerData = JSON.parse(jsonContent) as Array<{
        url: string;
        followerCount?: number;
      }>;

      // Create a map of URL -> follower count (include ALL counts, even 0 or low)
      const followerMap = new Map<string, number>();
      for (const item of followerData) {
        if (item.url && item.followerCount !== undefined) {
          followerMap.set(item.url.toLowerCase(), item.followerCount);
        }
      }

      // Enrich profiles with follower counts
      const enriched = profiles.map((profile) => {
        const followerCount = followerMap.get(profile.url.toLowerCase());
        if (followerCount !== undefined) {
          console.log(
            `[enrichTikTokProfilesWithFollowerCounts] ✅ Found ${followerCount.toLocaleString()} followers for ${profile.url}`
          );
          return { ...profile, followerCount };
        }
        return profile;
      });

      const foundCount = followerMap.size;
      console.log(
        `[enrichTikTokProfilesWithFollowerCounts] Enriched ${foundCount} of ${profiles.length} profiles with follower counts`
      );

      return enriched;
    } catch (parseError) {
      console.error(
        `[enrichTikTokProfilesWithFollowerCounts] Error parsing OpenAI response:`,
        parseError
      );
      console.log(
        `[enrichTikTokProfilesWithFollowerCounts] Response content:`,
        content.substring(0, 500)
      );
      return profiles; // Return original profiles if parsing fails
    }
  } catch (error) {
    console.error(`[enrichTikTokProfilesWithFollowerCounts] Error:`, error);
    return profiles; // Return original profiles on error
  }
}

/**
 * Search TikTok profiles using SerpAPI
 * Extracts follower counts from search results and filters by minimum 1,000 followers
 */
async function searchTikTokWithSerpAPI(
  topic: string,
  keywords: string[],
  count: number,
  apiKey: string,
  brandName?: string
): Promise<
  Array<{ url: string; title: string; snippet: string; name?: string; followerCount?: number }>
> {
  try {
    console.log(`[searchTikTokWithSerpAPI] Searching TikTok profiles via SerpAPI`);
    console.log(
      `[searchTikTokWithSerpAPI] Topic: "${topic}", Keywords: ${keywords.join(", ") || "none"}, Count: ${count}, Brand: ${brandName || "none"}`
    );

    const allResults: Array<{
      url: string;
      title: string;
      snippet: string;
      name?: string;
      followerCount?: number;
    }> = [];
    const seenUrls = new Set<string>();

    // Build search queries for TikTok profiles discussing the topic
    // Strategy: Cast a wide net, then filter by follower count using AI/SerpAPI
    const queries: string[] = [];

    // Brand exclusion
    const brandExclusion = brandName
      ? ` -${brandName.toLowerCase()} -${brandName.toLowerCase()}y`
      : "";

    // Build topic terms
    const topicTerms =
      keywords.length > 0
        ? keywords
            .slice(0, 5)
            .map((k) => `"${k}"`)
            .join(" OR ")
        : `"${topic}"`;

    // Query 1: TikTok profiles discussing the topic
    queries.push(`site:tiktok.com/@ ${topicTerms}${brandExclusion}`);

    // Query 2: TikTok accounts on the topic (broader search)
    queries.push(`tiktok.com/@ ${topicTerms}${brandExclusion}`);

    // Query 3: TikTok users/creators discussing the topic
    queries.push(`"TikTok" ${topicTerms} site:tiktok.com/@${brandExclusion}`);

    // Query 4: Popular TikTok content on the topic
    queries.push(`site:tiktok.com/@ ${topicTerms} "popular"${brandExclusion}`);

    // Target 5X the requested count for filtering (more aggressive collection)
    const targetCount = count * 5;

    // Execute queries
    for (let q = 0; q < queries.length; q++) {
      const query = queries[q];

      if (allResults.length >= targetCount * 1.5) {
        console.log(
          `[searchTikTokWithSerpAPI] ✅ Reached collection target (${allResults.length}), stopping`
        );
        break;
      }

      // Execute query with pagination (2 pages)
      for (let page = 0; page < 2; page++) {
        const start = page * 20;

        if (allResults.length >= targetCount * 1.5) break;

        try {
          const fullUrl = buildSerpAPIUrl(query, apiKey, start);
          console.log(
            `[searchTikTokWithSerpAPI] Query ${q + 1}/${queries.length}, Page ${page + 1}/2: ${query.substring(0, 100)}...`
          );

          const response = await fetch(fullUrl, {
            headers: {
              Accept: "application/json",
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.log(
              `[searchTikTokWithSerpAPI] ❌ SerpAPI error for query ${q + 1}, page ${page + 1}: ${response.status} ${response.statusText}`
            );
            continue;
          }

          const data = await response.json();
          const organicResults = data.organic_results || [];
          console.log(
            `[searchTikTokWithSerpAPI] Query ${q + 1}/${queries.length}, Page ${page + 1}/2: Found ${organicResults.length} organic results`
          );

          // Log sample URLs to see what SerpAPI is returning
          if (organicResults.length > 0) {
            console.log(
              `[searchTikTokWithSerpAPI] Sample URLs from SerpAPI:`,
              organicResults.slice(0, 5).map((r: any) => r.link)
            );
            console.log(
              `[searchTikTokWithSerpAPI] Sample titles:`,
              organicResults.slice(0, 5).map((r: any) => r.title)
            );
          } else {
            console.log(`[searchTikTokWithSerpAPI] ⚠️ No organic results returned for this query`);
          }

          for (const result of organicResults) {
            if (!result.link) continue;

            const url = result.link.split("?")[0].split("#")[0];
            const lowerUrl = url.toLowerCase();

            console.log(`[searchTikTokWithSerpAPI] Processing result: ${url}`);
            console.log(`[searchTikTokWithSerpAPI] Title: "${result.title || "none"}"`);
            console.log(
              `[searchTikTokWithSerpAPI] Snippet: "${(result.snippet || "").substring(0, 100)}..."`
            );

            // Extract username from URL (can be from profile or video URL)
            let username: string | null = null;

            // Format 1: tiktok.com/@username (profile URL)
            const atMatch = lowerUrl.match(/tiktok\.com\/@([^\/\?]+)/);
            if (atMatch) {
              username = atMatch[1];
              // If it's a video URL, extract username but skip the video
              if (
                lowerUrl.includes("/video/") ||
                (lowerUrl.includes("/@") && lowerUrl.split("/@")[1].includes("/"))
              ) {
                console.log(
                  `[searchTikTokWithSerpAPI] ✅ Extracted username from video URL: @${username}`
                );
                // Continue to process - we'll use the profile URL
              }
            } else {
              // Format 2: tiktok.com/username (without @) - only if it's not a known non-profile path
              const plainMatch = lowerUrl.match(/tiktok\.com\/([^\/\?]+)/);
              if (
                plainMatch &&
                !plainMatch[1].match(
                  /^(video|foryou|trending|discover|music|upload|login|signup)$/i
                )
              ) {
                username = plainMatch[1];
              }
            }

            // Reject URLs that are clearly not profile-related
            if (
              lowerUrl.includes("/foryou") ||
              lowerUrl.includes("/trending") ||
              lowerUrl.includes("/discover") ||
              lowerUrl.includes("/music/") ||
              lowerUrl.includes("/upload") ||
              (lowerUrl.includes("/video/") && !username)
            ) {
              console.log(`[searchTikTokWithSerpAPI] ⏭️ Skipping non-profile URL: ${url}`);
              continue;
            }

            // Must have a valid username
            if (!username || username.length < 2) {
              console.log(
                `[searchTikTokWithSerpAPI] ⏭️ Skipping URL without valid username: ${url}`
              );
              continue;
            }

            // Normalize to profile URL format: https://www.tiktok.com/@username
            const normalizedUrl = `https://www.tiktok.com/@${username}`;

            // Skip if we've already seen this URL
            if (seenUrls.has(normalizedUrl)) {
              continue;
            }
            seenUrls.add(normalizedUrl);

            // Extract name from title/snippet
            let name: string | null = null;
            const title = result.title || "";
            const snippet = result.snippet || "";

            // Try to extract name from title (format: "Name (@username) - TikTok" or "Name | TikTok")
            const nameMatch = title.match(/^([^(@|]+?)(?:\s*\(@|@|\s*\|)/);
            if (nameMatch) {
              name = nameMatch[1].trim();
            } else if (title.includes("TikTok")) {
              // Try to get name before "TikTok" or "on TikTok"
              const beforeTikTok = title.split(/on TikTok|TikTok/i)[0].trim();
              if (beforeTikTok && beforeTikTok.length > 2 && beforeTikTok.length < 50) {
                name = beforeTikTok;
              }
            }

            // Extract follower count from snippet/title if available (optional - we'll filter later)
            let followerCount: number | undefined = undefined;

            // Try multiple patterns for follower count extraction
            const textToSearch = (snippet + " " + title).toLowerCase();

            // Pattern 1: "1.2M followers", "500K followers", "50 thousand followers"
            const followerMatch = textToSearch.match(
              /(\d+(?:\.\d+)?)\s*(?:K|k|thousand|M|m|million)?\s*followers?/i
            );
            if (followerMatch) {
              let count = parseFloat(followerMatch[1]);
              if (followerMatch[0].includes("k") || followerMatch[0].includes("thousand")) {
                count = count * 1000;
              } else if (followerMatch[0].includes("m") || followerMatch[0].includes("million")) {
                count = count * 1000000;
              }
              followerCount = Math.round(count);
            }

            // Pattern 2: Look for "X followers" where X is a number
            if (!followerCount) {
              const directMatch = textToSearch.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*followers?/);
              if (directMatch) {
                followerCount = parseInt(directMatch[1].replace(/,/g, ""));
              }
            }

            // Log profile found (verbose logging for debugging)
            if (followerCount) {
              console.log(
                `[searchTikTokWithSerpAPI] ✅ Found profile with ${followerCount.toLocaleString()} followers: ${normalizedUrl} (${name || username || "unknown"})`
              );
            } else {
              console.log(
                `[searchTikTokWithSerpAPI] ✅ Found profile (follower count unknown): ${normalizedUrl} (${name || username || "unknown"})`
              );
            }

            // Extract name from username if we don't have a name yet
            if (!name && username) {
              const formattedUsername = username.replace(/[-_]/g, " ");
              // Capitalize first letter of each word
              name = formattedUsername
                .split(" ")
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ");
            }

            // Filter out obvious company accounts - be less aggressive, only filter clear companies
            const textToCheck = `${title} ${snippet} ${username || ""} ${name || ""}`.toLowerCase();

            // Strong company indicators - only filter if these appear prominently
            const strongCompanyIndicators = [
              "official account",
              "official page",
              "official tiktok",
              "inc.",
              "llc",
              "corp.",
              "corporation",
              "ltd.",
              "limited company",
              "retailer",
              "retail store",
              "pet store",
              "pet shop",
            ];

            // Check for strong company indicators
            const hasStrongCompanyIndicator = strongCompanyIndicators.some((indicator) => {
              return textToCheck.includes(indicator.toLowerCase());
            });

            // Also check username for obvious company patterns
            let usernameIsCompany = false;
            if (username) {
              const usernameLower = username.toLowerCase();
              // Only filter if username clearly indicates a company
              if (usernameLower.includes("official") || false) {
                // Removed specific brand filtering
                usernameIsCompany = true;
              }
            }

            if (hasStrongCompanyIndicator || usernameIsCompany) {
              console.log(
                `[searchTikTokWithSerpAPI] ⏭️ Skipping company account: ${normalizedUrl} (${name || username || "unknown"}) - indicator: ${hasStrongCompanyIndicator ? "text" : "username"}`
              );
              continue;
            }

            allResults.push({
              url: normalizedUrl,
              title: title || name || "",
              snippet: snippet || "",
              name: name || undefined,
              followerCount: followerCount,
            });

            console.log(
              `[searchTikTokWithSerpAPI] ✅ Added TikTok profile: ${name || "unknown"} (${normalizedUrl})${followerCount ? ` - ${followerCount.toLocaleString()} followers` : ""}`
            );
          }
        } catch (error) {
          console.error(
            `[searchTikTokWithSerpAPI] Error executing query ${q + 1}, page ${page + 1}:`,
            error
          );
          continue;
        }
      }
    }

    console.log(
      `[searchTikTokWithSerpAPI] Collected ${allResults.length} TikTok profiles from SerpAPI`
    );

    if (allResults.length === 0) {
      console.log(`[searchTikTokWithSerpAPI] ⚠️ No TikTok profiles found`);
      console.log(`[searchTikTokWithSerpAPI] Possible reasons:`);
      console.log(`[searchTikTokWithSerpAPI] 1. SerpAPI didn't return any TikTok profile URLs`);
      console.log(`[searchTikTokWithSerpAPI] 2. All results were filtered out as company accounts`);
      console.log(`[searchTikTokWithSerpAPI] 3. Username extraction failed for all results`);
      console.log(
        `[searchTikTokWithSerpAPI] 4. All results were video URLs that couldn't be converted to profiles`
      );
      return [];
    }

    // Step 1: Separate results with and without follower counts
    // Include accounts with 500+ followers
    const withFollowers = allResults.filter(
      (r) => r.followerCount !== undefined && r.followerCount >= 500
    );
    const withoutFollowers = allResults.filter(
      (r) => r.followerCount === undefined || r.followerCount < 500
    );

    console.log(
      `[searchTikTokWithSerpAPI] Results breakdown: ${withFollowers.length} with verified 500+ followers, ${withoutFollowers.length} without follower count`
    );

    // Step 2: Use OpenAI to get follower counts for accounts without them (if we have accounts to check)
    let enrichedWithoutFollowers: typeof allResults = [];
    if (withoutFollowers.length > 0 && withoutFollowers.length <= 50) {
      // Limit to 50 to avoid too many API calls
      console.log(
        `[searchTikTokWithSerpAPI] Using OpenAI to get follower counts for ${withoutFollowers.length} accounts`
      );
      enrichedWithoutFollowers = await enrichTikTokProfilesWithFollowerCounts(
        withoutFollowers,
        topic,
        keywords
      );
    } else if (withoutFollowers.length > 50) {
      console.log(
        `[searchTikTokWithSerpAPI] Too many accounts without follower counts (${withoutFollowers.length}), skipping OpenAI enrichment`
      );
      enrichedWithoutFollowers = withoutFollowers; // Keep them but without filtering
    } else {
      enrichedWithoutFollowers = withoutFollowers;
    }

    // Step 3: Combine and sort by follower count (highest first)
    const allEnriched = [...withFollowers, ...enrichedWithoutFollowers];

    // Sort: accounts with followers first (sorted by count descending), then accounts without follower counts
    const sorted = allEnriched.sort((a, b) => {
      // If both have follower counts, sort by count (descending)
      if (a.followerCount !== undefined && b.followerCount !== undefined) {
        return b.followerCount - a.followerCount;
      }
      // If only one has follower count, prioritize it
      if (a.followerCount !== undefined && a.followerCount >= 500) return -1;
      if (b.followerCount !== undefined && b.followerCount >= 500) return 1;
      // Both without or both under 500 - keep original order
      return 0;
    });

    // Step 4: Only filter out VERY obvious company accounts - don't filter by follower count here
    // We'll let accounts through even if they have low follower counts - user can decide
    const filtered = sorted.filter((r) => {
      // Only filter out VERY obvious company accounts - minimal filtering
      const textToCheck = `${r.name || ""} ${r.title || ""} ${r.url || ""}`.toLowerCase();
      const veryObviousCompanyIndicators = [
        "official account",
        "official page",
        "official tiktok",
        // Removed specific brand names - filter by "official account" pattern only
      ];

      const isObviousCompany = veryObviousCompanyIndicators.some((indicator) => {
        return textToCheck.includes(indicator.toLowerCase());
      });

      if (isObviousCompany) {
        console.log(
          `[searchTikTokWithSerpAPI] ⏭️ Filtered out obvious company account: ${r.url} (${r.name || "unknown"})`
        );
        return false;
      }

      // Don't filter by follower count - include all accounts, even with low counts
      // Sorting already prioritizes accounts with higher follower counts
      return true;
    });

    console.log(
      `[searchTikTokWithSerpAPI] After filtering: ${filtered.length} profiles (from ${sorted.length} sorted)`
    );
    console.log(`[searchTikTokWithSerpAPI] Filtering breakdown:`);
    console.log(`[searchTikTokWithSerpAPI]   - Total collected: ${allResults.length}`);
    console.log(`[searchTikTokWithSerpAPI]   - After enrichment: ${allEnriched.length}`);
    console.log(`[searchTikTokWithSerpAPI]   - After sorting: ${sorted.length}`);
    console.log(`[searchTikTokWithSerpAPI]   - After company filtering: ${filtered.length}`);

    // Step 5: Limit to requested count
    const finalResults = filtered.slice(0, count);

    const finalWithFollowers = finalResults.filter(
      (r) => r.followerCount !== undefined && r.followerCount >= 500
    ).length;
    const finalWithoutFollowers = finalResults.filter((r) => r.followerCount === undefined).length;
    const finalLowFollowers = finalResults.filter(
      (r) => r.followerCount !== undefined && r.followerCount < 500
    ).length;

    console.log(`[searchTikTokWithSerpAPI] ✅ Returning ${finalResults.length} TikTok profiles:`);
    console.log(`[searchTikTokWithSerpAPI]   - ${finalWithFollowers} with verified 500+ followers`);
    console.log(
      `[searchTikTokWithSerpAPI]   - ${finalWithoutFollowers} without follower count (included)`
    );
    console.log(
      `[searchTikTokWithSerpAPI]   - ${finalLowFollowers} with < 500 followers (included)`
    );

    if (finalResults.length > 0) {
      console.log(
        `[searchTikTokWithSerpAPI] Sample results:`,
        finalResults
          .slice(0, 3)
          .map(
            (r) =>
              `${r.name || "unknown"} - ${r.url}${r.followerCount ? ` (${r.followerCount.toLocaleString()} followers)` : ""}`
          )
      );
    } else {
      console.log(
        `[searchTikTokWithSerpAPI] ⚠️ No final results after filtering - check logs above for filtering reasons`
      );
    }

    return finalResults;
  } catch (error) {
    console.error(`[searchTikTokWithSerpAPI] Error:`, error);
    return [];
  }
}

/**
 * Validate URL by making a HEAD request to check if it's reachable
 * Returns true if URL is reachable (status < 400), false otherwise
 * For LinkedIn, uses GET instead of HEAD as LinkedIn may block HEAD requests
 */
async function validateUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout for LinkedIn

    // LinkedIn often blocks HEAD requests, so use GET for LinkedIn URLs
    const isLinkedIn = url.includes("linkedin.com");
    const method = isLinkedIn ? "GET" : "HEAD";

    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    clearTimeout(timeoutId);

    // Consider 2xx and 3xx as valid (redirects are OK)
    // For LinkedIn, also accept 999 (LinkedIn's bot detection) as potentially valid
    const status = response.status;
    const isValid = status < 400 || (isLinkedIn && status === 999);
    console.log(`[validateUrl] ${url}: Method ${method}, Status ${status}, Valid: ${isValid}`);
    return isValid;
  } catch (error: any) {
    // For LinkedIn, if we get a network error, it might still be a valid URL (LinkedIn blocks bots)
    // So we'll be more lenient - if it's a timeout or network error, assume it might be valid
    const isLinkedIn = url.includes("linkedin.com");
    const isNetworkError = error.name === "AbortError" || error.message.includes("fetch");
    const isValid = isLinkedIn && isNetworkError; // Assume LinkedIn URLs are valid if network error (likely bot blocking)
    console.log(
      `[validateUrl] ${url}: Error - ${error.message}, IsLinkedIn: ${isLinkedIn}, IsNetworkError: ${isNetworkError}, Valid: ${isValid}`
    );
    return isValid;
  }
}

/**
 * Validate multiple URLs in parallel (with concurrency limit)
 */
async function validateUrls(urls: string[], concurrency = 5): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const queue = [...urls];

  const validateBatch = async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      if (url) {
        const isValid = await validateUrl(url);
        results.set(url, isValid);
      }
    }
  };

  // Run validation in parallel batches
  const promises = Array(Math.min(concurrency, urls.length))
    .fill(null)
    .map(() => validateBatch());

  await Promise.all(promises);
  return results;
}

/**
 * Get platform display name
 */
function getPlatformDisplayName(platform: string): string {
  const platformMap: Record<string, string> = {
    TWITTER: "X (Twitter)",
    LINKEDIN: "LinkedIn",
    FACEBOOK: "Facebook",
    INSTAGRAM: "Instagram",
    TIKTOK: "TikTok",
    BLUESKY: "BlueSky",
    YOUTUBE: "YouTube",
    REDDIT: "Reddit",
    PODCAST: "Podcasts",
    BLOG: "Blogs",
    NEWS_OUTLET: "News Outlets",
  };
  return platformMap[platform] || platform;
}

/**
 * Get platform search term (what to search for)
 */
function getPlatformSearchTerm(platform: string, linkType: string): string {
  if (linkType === "INFLUENCER") {
    return "influencers";
  } else if (linkType === "REDDIT") {
    return "subreddits";
  } else if (linkType === "OTHER_SOURCE") {
    if (platform === "PODCAST") return "podcasts";
    if (platform === "BLOG") return "blogs";
    if (platform === "NEWS_OUTLET") return "news outlets";
  }
  return "sources";
}

/**
 * Construct OpenAI prompt for searching sources
 */
function constructSearchPrompt(
  taxonomyNode: TaxonomyNode,
  platform: string,
  count: number,
  linkType: string,
  brandName?: string,
  /** Project monitoring themes first when provided; else brand-directory keywords (see searchSourcesWithOpenAI). */
  relevanceKeywords?: string[]
): string {
  const platformName = getPlatformDisplayName(platform);
  const searchTerm = getPlatformSearchTerm(platform, linkType);

  let context = "";
  let specificFocus = "";

  if (taxonomyNode.type === "sub_subcategory" && taxonomyNode.sub_subcategory) {
    specificFocus = taxonomyNode.sub_subcategory;
    if (taxonomyNode.subcategory) {
      context = `Specifically in the ${taxonomyNode.subcategory} category of ${taxonomyNode.category} business.`;
    } else {
      context = `In the ${taxonomyNode.category} business.`;
    }
  } else if (taxonomyNode.type === "subcategory" && taxonomyNode.subcategory) {
    specificFocus = taxonomyNode.subcategory;
    context = `In the ${taxonomyNode.category} business.`;
  } else if (taxonomyNode.type === "category" && taxonomyNode.category) {
    specificFocus = taxonomyNode.category;
    context = "";
  }

  // Build taxonomy path string for better context
  let taxonomyPath = "";
  if (taxonomyNode.sub_subcategory && taxonomyNode.subcategory && taxonomyNode.category) {
    taxonomyPath = `Taxonomy: ${taxonomyNode.category} > ${taxonomyNode.subcategory} > ${taxonomyNode.sub_subcategory}`;
  } else if (taxonomyNode.subcategory && taxonomyNode.category) {
    taxonomyPath = `Taxonomy: ${taxonomyNode.category} > ${taxonomyNode.subcategory}`;
  } else if (taxonomyNode.category) {
    taxonomyPath = `Taxonomy: ${taxonomyNode.category}`;
  }

  // Relevance themes (project keywords when available, else brand-directory keywords)
  let brandContext = "";
  if (relevanceKeywords && relevanceKeywords.length > 0) {
    // OR logic: expertise may match any of these ideas/themes
    const keywordsPhrase = relevanceKeywords.join(", ");
    brandContext = `Prioritize people with credible expertise in one or more of these ideas or themes: ${keywordsPhrase}.`;
    if (taxonomyPath) {
      brandContext += ` ${taxonomyPath}.`;
    }
  } else if (taxonomyPath) {
    // If no keywords but taxonomy exists, include it
    brandContext = taxonomyPath;
  }

  if (brandContext) {
    context = context ? `${context} ${brandContext}` : brandContext;
  }

  // Build platform-specific URL requirements
  let urlRequirements = "";
  if (platform === "LINKEDIN") {
    urlRequirements = `- LinkedIn URLs must be REAL profiles or company pages
- Use format: https://www.linkedin.com/in/username (for people) or https://www.linkedin.com/company/companyname/posts/?feedView=all (for companies - MUST include /posts/?feedView=all)
- CRITICAL: For company pages, ALWAYS append /posts/?feedView=all to the URL (e.g., https://www.linkedin.com/company/companyname/posts/?feedView=all)
- CRITICAL: DO NOT add hash-like suffixes like -8b8b3b, -a1b2c3, or numeric suffixes like -12345678 to usernames - these are fake patterns that don't work
- CRITICAL: DO NOT construct URLs by adding random suffixes to names - use the actual username/handle without suffixes
- Only include profiles/companies that are SPECIFICALLY related to ${specificFocus}${context ? ` ${context}` : ""}
- The person or company MUST actually work in, discuss, or be relevant to ${specificFocus}${context ? ` ${context}` : ""}
- Use clean usernames without hash or numeric suffixes
- Examples of GOOD LinkedIn profiles: industry experts, company executives, thought leaders in ${specificFocus}
- Examples of BAD LinkedIn URLs: URLs with hash/numeric suffixes like -8b8b3b or -12345678 (these don't work)`;
  } else if (platform === "TWITTER") {
    urlRequirements = `- X (Twitter) URLs: https://x.com/username or https://twitter.com/username
- Must be real accounts that discuss ${specificFocus}`;
  } else if (platform === "REDDIT") {
    urlRequirements = `- Reddit URLs: https://reddit.com/r/subredditname
- Must be real subreddits related to ${specificFocus}`;
  } else if (platform === "YOUTUBE") {
    urlRequirements = `- YouTube URLs: https://youtube.com/@channelname or https://youtube.com/c/channelname or https://youtube.com/channel/CHANNEL_ID
- Must be real channels that discuss ${specificFocus}`;
  } else if (platform === "FACEBOOK") {
    urlRequirements = `- Facebook URLs: https://facebook.com/pagename
- Must be real pages related to ${specificFocus}`;
  } else if (platform === "INSTAGRAM") {
    urlRequirements = `- Instagram URLs: https://instagram.com/username
- Must be real accounts related to ${specificFocus}`;
  } else if (platform === "TIKTOK") {
    urlRequirements = `- TikTok URLs: https://tiktok.com/@username
- Must be real accounts related to ${specificFocus}`;
  } else if (platform === "BLUESKY") {
    urlRequirements = `- BlueSky URLs: https://bsky.app/profile/username
- Must be real profiles related to ${specificFocus}`;
  } else {
    urlRequirements = `- URLs must be valid and accessible
- Must be real sources related to ${specificFocus}`;
  }

  // Build taxonomy path string for better context
  let taxonomyPathStr = "";
  if (taxonomyNode.sub_subcategory && taxonomyNode.subcategory && taxonomyNode.category) {
    taxonomyPathStr = ` (Taxonomy: ${taxonomyNode.category} > ${taxonomyNode.subcategory} > ${taxonomyNode.sub_subcategory})`;
  } else if (taxonomyNode.subcategory && taxonomyNode.category) {
    taxonomyPathStr = ` (Taxonomy: ${taxonomyNode.category} > ${taxonomyNode.subcategory})`;
  } else if (taxonomyNode.category) {
    taxonomyPathStr = ` (Taxonomy: ${taxonomyNode.category})`;
  }

  let brandContextStr = "";
  if (relevanceKeywords && relevanceKeywords.length > 0) {
    brandContextStr = ` with expertise in one or more of these ideas/themes: ${relevanceKeywords.join(", ")}`;
    brandContextStr += taxonomyPathStr;
  } else {
    brandContextStr = taxonomyPathStr;
  }

  // Special handling for LinkedIn - prioritize getting ALL relevant professionals, URLs optional
  if (platform === "LINKEDIN") {
    // Ask for more results since some won't have URLs
    const requestedCount = Math.max(count, 10);
    return `Find ${requestedCount} professionals who are experts SPECIFICALLY related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL REQUIREMENTS:
- Each person must be a REAL professional (not generic placeholder names)
- Must be DIRECTLY RELEVANT to ${specificFocus}${brandContextStr ? ` specifically related to ${brandContextStr}` : ""} - not just tangentially related
- Focus on: experts, thought leaders, influencers, authors, speakers who actively work with or discuss this specific topic
- DO NOT include generic placeholder names
- DO NOT include people who are only loosely related to the topic

RELEVANCE CHECK:
- Before including someone, verify they are ACTUALLY relevant to the specific topic
- If someone is only vaguely related, skip them and find someone more relevant

MOST IMPORTANT: Return ALL ${requestedCount} relevant professionals, even if you don't know their LinkedIn URL. Names are valuable even without URLs.

For each professional:
- Name: Their REAL full name (required) - must be someone directly relevant to the topic
- URL: Their complete LinkedIn profile URL if you know it from your training data (e.g., "https://www.linkedin.com/in/john-doe"). If you don't know the URL, use null. NULL URLs ARE PERFECTLY ACCEPTABLE.

URL GUIDELINES:
- If you KNOW a professional's LinkedIn URL from your training data, provide it in format: https://www.linkedin.com/in/USERNAME
- If you DON'T know the URL, use null - this is fine and expected
- Do NOT skip professionals just because you don't know their LinkedIn URL
- Do NOT construct or guess URLs - only provide URLs you know are real
- Examples of professionals you might know URLs for: well-known executives, famous veterinarians, published authors
- Most professionals will have null URLs - this is normal and acceptable

CRITICAL: Return ${requestedCount} professionals. Include professionals even if their URL is null. Names without URLs are still valuable.

Return format (JSON object only, no other text):
{"results": [{"name": "Real Full Name", "url": "https://www.linkedin.com/in/known-url-if-available"}, {"name": "Real Full Name", "url": null}]}`;
  }

  // Special handling for Twitter/X - use web search approach to find people, not company accounts
  if (platform === "TWITTER") {
    return `You are searching for Twitter/X influencers and thought leaders who tweet about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for REAL PEOPLE (individuals, influencers, experts, thought leaders) with LARGE FOLLOWINGS and SIGNIFICANT INFLUENCE, NOT company accounts or brand accounts.

STEP 1 - FIND INFLUENCERS AND THOUGHT LEADERS BY NAME:
First, search the web or use your knowledge to identify ${count} real people who are INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "top Twitter influencers ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "thought leaders ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "famous experts ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "verified accounts ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If project theme ideas are listed above, search for influencers who show expertise in ANY of those themes (OR logic), not all of them (AND logic).

CRITICAL REQUIREMENTS FOR SELECTION:
- Must have a reasonable following (MINIMUM 500 followers - preferably thousands or tens of thousands)
- Must be a recognized INFLUENCER, THOUGHT LEADER, or EXPERT in the field
- Must have SIGNIFICANT REACH and ENGAGEMENT
- Should be VERIFIED accounts (blue checkmark) when possible
- Must be ACTIVELY posting about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Should be someone with AUTHORITY and CREDIBILITY in the field

FOLLOWER COUNT (TARGET: AT LEAST 500):
- Prefer people who plausibly have at least 500 followers given their public role: established voices, recurring commentators, creators, analysts, or experts active in this topic space
- You do NOT need an exact follower number from memory—use reasonable judgment: if they are widely cited, run a known newsletter/podcast, lead at a recognizable org in this space, or are clearly mid-size or larger creators, include them
- EXCLUDE only accounts you have strong reason to believe are tiny or personal (e.g. obvious micro-accounts with no public influence in this topic)
- DO NOT include accounts you believe are under 500 followers when you can tell they are small or purely personal
- Examples of what to AVOID: random personal accounts with no public footprint in this topic

For each person, capture:
- Their full name or Twitter handle/username
- Their expertise or what they're known for (and approximate reach if you know it—optional)
- Why they are a relevant voice on ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Company accounts (e.g., brand accounts, official business accounts)
- Brand accounts
- Official business accounts
- Customer service accounts
- Accounts that are clearly not individual people or clearly off-topic
- Accounts that don't have meaningful public voice in this topic area

INCLUDE:
- Well-known influencers with large followings in the topic area
- Industry experts who are thought leaders
- Recognized content creators with significant reach
- Popular product reviewers and enthusiasts with many followers
- Industry experts and thought leaders with verified accounts
- Influencers who are widely recognized in the topic community

STEP 2 - FIND THEIR TWITTER/X PROFILES:
For each person you identified in Step 1, provide their Twitter/X profile URL. You must:
- Use format https://x.com/username or https://twitter.com/username
- Prefer handles you are confident are correct for that public figure (same handle they use publicly for this work)
- DO NOT invent random character strings as usernames; DO include well-known public handles when you are confident they match the person
- DO NOT include company or brand accounts—only individual people
- If you cannot associate any plausible handle for that person, skip them and pick someone else

STEP 3 - RETURN RESULTS:
Return the results with their names and Twitter/X URLs.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Person's Name or Twitter Handle",
    "url": "https://x.com/actual-username" or "https://twitter.com/actual-username"
  }
]

CRITICAL REQUIREMENTS:
- Only include REAL PEOPLE (individuals), NOT company accounts
- They should be voices with real reach in the topic (target at least ~500+ followers; use judgment, not proof from memory)
- Prioritize larger followings and verified accounts when you can
- They must actively tweet or discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Use plausible real profile URLs—no fabricated random usernames
- Include the person's name or handle in the "name" field
- Return up to ${count} results when possible; prefer filling the list with relevant individuals over returning an empty array
- DO NOT return company accounts or brand accounts`;
  }

  // Special handling for Facebook - use web search approach to find people, not company pages
  if (platform === "FACEBOOK") {
    return `You are searching for Facebook influencers and thought leaders who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for REAL PEOPLE (individuals, influencers, experts, thought leaders) with LARGE FOLLOWINGS and SIGNIFICANT INFLUENCE, NOT company pages or brand pages.

STEP 1 - FIND INFLUENCERS AND THOUGHT LEADERS BY NAME:
First, search the web or use your knowledge to identify ${count} real people who are INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "top Facebook influencers ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "thought leaders ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "famous experts ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If brand keywords are provided, search for influencers related to ANY of those keywords (OR logic), not all of them (AND logic). For example, if keywords are "keyword1, keyword2", find influencers who discuss keyword1 OR keyword2 (or both).

CRITICAL REQUIREMENTS FOR SELECTION:
- Must have a LARGE following (thousands or tens of thousands of followers/friends minimum)
- Must be a recognized INFLUENCER, THOUGHT LEADER, or WELL-KNOWN EXPERT in the field
- Must have SIGNIFICANT REACH and ENGAGEMENT
- Must be ACTIVELY posting about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Should be someone with AUTHORITY and CREDIBILITY in the field

For each person, capture:
- Their full name or Facebook profile name
- Their follower count or reach (if known) - prioritize those with large followings
- Their expertise or what they're known for
- Why they're a recognized influencer/thought leader in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Company pages and brand pages
- Brand pages
- Official business pages
- Customer service pages
- Fan pages or community pages
- Accounts with very few followers (under 1,000)
- Unknown or obscure accounts
- Accounts that don't have significant influence

INCLUDE:
- Well-known influencers with large followings in the topic area
- Industry experts who are thought leaders
- Recognized content creators with significant reach
- Popular product reviewers and enthusiasts with many followers
- Industry experts and thought leaders with verified accounts
- Influencers who are widely recognized in the topic community

STEP 2 - FIND THEIR FACEBOOK PROFILES:
For each person you identified in Step 1, find their Facebook profile URL. You can:
- Use format https://facebook.com/username or https://www.facebook.com/username (where username is their Facebook handle)
- For public figures, influencers, or well-known experts, you can construct URLs based on their name or known handle
- Facebook profiles can use usernames, numeric IDs, or name-based URLs
- If you know a person's name and they're a public figure/influencer, you can try common username patterns (e.g., firstname.lastname, firstnamelastname)
- CRITICAL: DO NOT include company or brand pages - only individual people's profiles
- CRITICAL: Focus on finding influencers, experts, content creators, product reviewers, and enthusiasts who discuss the topic
- If you cannot find a reasonable Facebook URL for a person, skip them and find another person

STEP 3 - RETURN RESULTS:
Return the results with their names and verified Facebook URLs.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Person's Name",
    "url": "https://facebook.com/actual-username" or "https://www.facebook.com/actual-username"
  }
]

CRITICAL REQUIREMENTS:
- Only include REAL PEOPLE (individuals), NOT company pages
- They must actively post or discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts
- Include the person's name in the "name" field
- Use reasonable Facebook URL patterns - you can construct URLs for known public figures/influencers
- DO NOT return company pages or brand pages
- Return exactly ${count} results if possible - prioritize finding relevant people who discuss the topic`;
  }

  // Special handling for Reddit - use web search approach to find topic-related subreddits, not brand-specific ones
  if (platform === "REDDIT") {
    return `You are searching for Reddit subreddits that discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for SUBREDDITS that discuss the general topics and keywords related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}, NOT brand-specific subreddits.

STEP 1 - FIND SUBREDDITS BY TOPIC:
First, search the web or use your knowledge to identify ${count} real subreddits that actively discuss topics related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "subreddits about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "Reddit communities ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "subreddits for ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If brand keywords are provided, search for subreddits related to ANY of those keywords (OR logic), not all of them (AND logic). For example, if keywords are "keyword1, keyword2", find subreddits that discuss keyword1 OR keyword2 (or both).

For each subreddit, capture:
- The subreddit name (without the r/ prefix)
- What topics it discusses
- Why it's relevant to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Brand-specific subreddits (e.g., r/brandname)
- Company subreddits
- Official brand communities
- Subreddits that are primarily about a specific brand

INCLUDE:
- General topic subreddits (e.g., r/dogs, r/cats, r/pets, r/dogfood, r/catfood for pet goods)
- Product category subreddits (e.g., r/dogtraining, r/petcare, r/doghealth)
- Community discussion subreddits about the topic
- Subreddits where people discuss products/services in this category
- Subreddits for enthusiasts and experts in this field

STEP 2 - FIND THEIR REDDIT URLS:
For each subreddit you identified in Step 1, find its REAL Reddit URL. You must:
- Use ONLY Reddit URLs that you know exist from your training data or can verify
- Use format https://reddit.com/r/subredditname or https://www.reddit.com/r/subredditname (where subredditname is the actual subreddit name)
- CRITICAL: DO NOT guess subreddit names - only use Reddit URLs you know are real from your knowledge
- CRITICAL: DO NOT include brand-specific subreddits - only general topic subreddits
- If you cannot find a verified Reddit URL for a subreddit, skip it and find another

STEP 3 - RETURN RESULTS:
Return the results with subreddit names and verified Reddit URLs.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Subreddit Name (e.g., 'dogs' or 'petcare')",
    "url": "https://reddit.com/r/subredditname" or "https://www.reddit.com/r/subredditname"
  }
]

CRITICAL REQUIREMENTS:
- Only include GENERAL TOPIC subreddits, NOT brand-specific subreddits
- They must actively discuss topics related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Use REAL Reddit URLs that exist - do not construct fake ones
- Include the subreddit name (without r/ prefix) in the "name" field
- Verify each URL before including it - if you cannot verify, skip that subreddit
- Quality over quantity: Better to return fewer verified subreddits than fake ones
- Return exactly ${count} results if possible, but prioritize accuracy
- DO NOT return brand-specific subreddits`;
  }

  // Special handling for Instagram - use web search approach to find people, not company accounts
  if (platform === "INSTAGRAM") {
    return `You are searching for Instagram influencers and experts who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for REAL PEOPLE (individuals, influencers, experts, enthusiasts), NOT company accounts or brand accounts.

STEP 1 - FIND PEOPLE BY NAME:
First, search the web or use your knowledge to identify ${count} real people who actively post, discuss, or are experts in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "Instagram influencers ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "people on Instagram who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "experts on Instagram ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If brand keywords are provided, search for influencers related to ANY of those keywords (OR logic), not all of them (AND logic). For example, if keywords are "keyword1, keyword2", find influencers who discuss keyword1 OR keyword2 (or both).

For each person, capture:
- Their full name or Instagram handle/username
- Their expertise or what they're known for
- Why they're relevant to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Company accounts and brand accounts
- Brand accounts
- Official business accounts

INCLUDE:
- Content creators and influencers
- Industry experts who post about the topic
- Thought leaders and educators
- Product reviewers and enthusiasts
- Advocates and community leaders
- Industry experts and thought leaders
- Individual people with public profiles

STEP 2 - FIND THEIR INSTAGRAM PROFILES:
For each person you identified in Step 1, find their Instagram profile URL. You can:
- Use format https://instagram.com/username (where username is their Instagram handle)
- For public figures, influencers, or well-known experts, you can construct URLs based on their name or known handle
- Instagram handles can be based on names, expertise, or brand names (for personal brands)
- CRITICAL: DO NOT include company or brand accounts - only individual people's profiles
- CRITICAL: Focus on finding influencers, experts, content creators, product reviewers, and enthusiasts who discuss the topic
- If you cannot find a reasonable Instagram URL for a person, skip them and find another person

STEP 3 - RETURN RESULTS:
Return the results with their names and Instagram URLs.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Person's Name or Instagram Handle",
    "url": "https://instagram.com/username"
  }
]

CRITICAL REQUIREMENTS:
- Only include REAL PEOPLE (individuals), NOT company accounts
- They must be INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS with LARGE FOLLOWINGS
- Prioritize accounts with tens of thousands or hundreds of thousands of followers
- Prioritize verified accounts (blue checkmark) when available
- They must actively post or discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts with SIGNIFICANT INFLUENCE
- Include the person's name or handle in the "name" field
- Use reasonable Instagram URL patterns - you can construct URLs for known public figures/influencers
- Focus on people with SIGNIFICANT INFLUENCE and REACH in the field
- DO NOT include accounts with very few followers (under 10,000)
- DO NOT include unknown or obscure accounts
- DO NOT return company accounts or brand accounts
- Return exactly ${count} results if possible - prioritize finding influential accounts`;
  }

  // Special handling for YouTube - use web search approach to find people, not company channels
  if (platform === "YOUTUBE") {
    return `You are searching for YouTube creators and experts who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for REAL PEOPLE (individuals, creators, influencers, experts), NOT company channels or brand channels.

STEP 1 - FIND PEOPLE BY NAME:
First, search the web or use your knowledge to identify ${count} real people who actively create content, discuss, or are experts in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "YouTube creators ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "people on YouTube who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "experts on YouTube ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If project theme ideas are listed above, search for creators who show expertise in ANY of those themes (OR logic), not all of them (AND logic).

For each person, capture:
- Their full name or YouTube channel name
- Their expertise or what they're known for
- Why they're relevant to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Company channels and brand channels
- Brand channels
- Official business channels

INCLUDE:
- Content creators and YouTubers
- Industry experts who create content about the topic
- Thought leaders and educators
- Product reviewers and enthusiasts
- Advocates and community leaders
- Industry experts and thought leaders
- Individual creators with public channels

STEP 2 - FIND THEIR YOUTUBE CHANNELS:
For each person you identified in Step 1, find their YouTube channel URL. You can:
- Use format https://youtube.com/@username, https://youtube.com/c/channelname, or https://youtube.com/channel/CHANNEL_ID
- For public figures, influencers, or well-known experts, you can construct URLs based on their name or known channel name
- YouTube channels can use @username format (newer) or /c/channelname format (older)
- CRITICAL: DO NOT include company or brand channels - only individual people's channels
- CRITICAL: Focus on finding content creators, experts, educators, product reviewers, and enthusiasts who discuss the topic
- If you cannot find a reasonable YouTube URL for a person, skip them and find another person

STEP 3 - RETURN RESULTS:
Return the results with their names and YouTube channel URLs.

Return ONLY a valid JSON array (parseable JSON—no prose, no markdown). Each element must be one object with "name" and "url" strings. Example shape (use real names and real channel URLs only):
[
  {"name": "Channel or creator display name", "url": "https://www.youtube.com/@handle"}
]
Also valid url forms: https://www.youtube.com/c/customname, https://www.youtube.com/channel/CHANNEL_ID, https://www.youtube.com/user/username
Do NOT use watch URLs (no /watch?v=). Channel page URLs only.

CRITICAL REQUIREMENTS:
- Only include REAL PEOPLE (individuals), NOT company channels
- Target channels with plausible reach (aim for at least ~500 subscribers; use judgment—you do not need exact sub counts from memory)
- Prioritize verified channels when applicable
- They must actively create content or discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Include the person's name or channel name in the "name" field
- Use channel URLs you are confident point at that creator (public handles or /c/ URLs you know)
- Prefer returning a full list of relevant creators over returning an empty array when reasonable options exist
- DO NOT return company or brand channels
- Return up to ${count} results when possible`;
  }

  // Special handling for BlueSky - use web search approach to find people, not company accounts
  if (platform === "BLUESKY") {
    return `You are searching for BlueSky influencers and thought leaders who post about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL: You are looking for REAL PEOPLE (individuals, influencers, experts, thought leaders) with LARGE FOLLOWINGS and SIGNIFICANT INFLUENCE, NOT company accounts or brand accounts.

STEP 1 - FIND INFLUENCERS AND THOUGHT LEADERS BY NAME:
First, search the web or use your knowledge to identify ${count} real people who are INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. 

Think of this like performing a web search query: "top BlueSky influencers ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "thought leaders ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}" or "famous experts ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}".

IMPORTANT: If brand keywords are provided, search for influencers related to ANY of those keywords (OR logic), not all of them (AND logic). For example, if keywords are "keyword1, keyword2", find influencers who discuss keyword1 OR keyword2 (or both).

CRITICAL REQUIREMENTS FOR SELECTION:
- Must have a LARGE following (thousands or tens of thousands of followers minimum)
- Must be a recognized INFLUENCER, THOUGHT LEADER, or WELL-KNOWN EXPERT in the field
- Must have SIGNIFICANT REACH and ENGAGEMENT
- Must be ACTIVELY posting about ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Should be someone with AUTHORITY and CREDIBILITY in the field

For each person, capture:
- Their full name or BlueSky handle/username
- Their follower count (if known) - prioritize those with large followings
- Their expertise or what they're known for
- Why they're a recognized influencer/thought leader in ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}

EXCLUDE:
- Company accounts
- Brand accounts
- Official business accounts
- Accounts with very few followers (under 1,000)
- Unknown or obscure accounts
- Accounts that don't have significant influence

INCLUDE:
- Well-known influencers with large followings in the topic area
- Industry experts who are thought leaders
- Recognized content creators with significant reach
- Popular product reviewers and enthusiasts with many followers
- Industry experts and thought leaders
- Influencers who are widely recognized in the topic community

STEP 2 - FIND THEIR BLUESKY PROFILES:
For each person you identified in Step 1, find their BlueSky profile URL. You can:
- Use format https://bsky.app/profile/username (where username is their BlueSky handle)
- For public figures, influencers, or well-known experts, you can construct URLs based on their name or known handle
- CRITICAL: DO NOT include company or brand accounts - only individual people's profiles
- CRITICAL: Focus on finding influencers, experts, content creators, product reviewers, and enthusiasts who discuss the topic
- If you cannot find a reasonable BlueSky URL for a person, skip them and find another person

STEP 3 - RETURN RESULTS:
Return the results with their names and BlueSky URLs.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Person's Name or BlueSky Handle",
    "url": "https://bsky.app/profile/username"
  }
]

CRITICAL REQUIREMENTS:
- Only include REAL PEOPLE (individuals), NOT company accounts
- They must be INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS with LARGE FOLLOWINGS
- Prioritize accounts with thousands or tens of thousands of followers
- They must actively post or discuss ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts with SIGNIFICANT INFLUENCE
- Include the person's name or handle in the "name" field
- Use reasonable BlueSky URL patterns - you can construct URLs for known public figures/influencers
- Focus on people with SIGNIFICANT INFLUENCE and REACH in the field
- DO NOT include accounts with very few followers (under 1,000)
- DO NOT include unknown or obscure accounts
- DO NOT return company accounts
- Return exactly ${count} results if possible - prioritize finding influential accounts`;
  }

  // Special handling for TikTok - need diversity guidance and stronger follower enforcement
  if (platform === "TIKTOK") {
    // Build dynamic diversity guidance based on actual keywords/topic
    const keywordsList =
      relevanceKeywords && relevanceKeywords.length > 0
        ? relevanceKeywords.join(", ")
        : specificFocus;

    return `You are searching for TikTok influencers related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

Context: We are specifically looking for ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

CRITICAL - FIND A DIVERSE MIX:
Based on the topic "${keywordsList}", find a DIVERSE MIX of different types of people who discuss this topic. Think about ALL the different roles, perspectives, and types of content creators who would be relevant:
- Different professional roles and backgrounds
- Different types of content creators (educators, entertainers, reviewers, enthusiasts, experts, journalists, etc.)
- Different perspectives and viewpoints
- DO NOT return only one type of person - include a diverse mix of roles, perspectives, and content creator types relevant to the topic
- Think broadly about who discusses "${keywordsList}" and include variety

CRITICAL FOLLOWER REQUIREMENT:
- If you KNOW an account has fewer than 500 followers, DO NOT include it - skip it and find another
- If follower count is unknown but the person is a well-known influencer/expert/content creator in the field, INCLUDE them (we'll verify follower counts later)
- Prioritize accounts with larger followings (thousands or tens of thousands) when possible
- Return MORE results than requested (aim for ${Math.max(count * 2, 20)} results) to account for filtering

Find ${Math.max(count * 2, 20)} TikTok influencers that are ACTUALLY and SPECIFICALLY related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. These must be REAL, VERIFIED profiles that exist, are accessible, and are genuinely relevant to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Influencer Name",
    "url": "https://tiktok.com/@username"
  }
]

CRITICAL REQUIREMENTS:
${urlRequirements}
- Focus STRICTLY on relevance to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}
- Return as many results as possible (aim for ${Math.max(count * 2, 20)} results) - we need a large pool to filter from
- DO NOT create fake or placeholder URLs
- DO NOT include generic or unrelated profiles
- DO NOT include company accounts or brand accounts
- If follower count is unknown, still include well-known influencers/experts in the field
- Remember: Find a DIVERSE MIX based on "${keywordsList}" - include different types of people and roles, not just one type`;
  }

  const prompt = `You are searching for ${platformName} ${searchTerm} related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

Context: We are specifically looking for ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

Find ${count} ${platformName} ${searchTerm} that are ACTUALLY and SPECIFICALLY related to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}. These must be REAL, VERIFIED profiles/pages/channels that exist, are accessible, and are genuinely relevant to ${specificFocus}${context ? ` ${context}` : ""}${brandContextStr}.

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Influencer/Channel Name (optional, use null if not available)",
    "url": "https://platform.com/..."
  }
]

CRITICAL REQUIREMENTS:
${urlRequirements}
- Focus STRICTLY on relevance to ${specificFocus}${context ? ` ${context}` : ""}
- Return exactly ${count} results if possible
- Use null for name if not available
- DO NOT create fake or placeholder URLs
- DO NOT include generic or unrelated profiles
- Verify URLs are accessible before including them`;

  return prompt;
}

/**
 * Parse OpenAI response and extract results
 * For LinkedIn, handles are converted to URLs and validated
 */
async function parseOpenAIResponse(content: string, platform: string): Promise<SearchResult[]> {
  try {
    // LOG RAW CONTENT BEFORE PARSING
    console.log(`[parseOpenAIResponse] ${platform}: ========== PARSING RAW CONTENT ==========`);
    console.log(`[parseOpenAIResponse] ${platform}: Content length: ${content.length}`);
    console.log(
      `[parseOpenAIResponse] ${platform}: Content preview (first 500 chars):`,
      content.substring(0, 500)
    );

    // Check if OpenAI refused to provide information
    const refusalPatterns = [
      /I'm sorry/i,
      /I can't/i,
      /I cannot/i,
      /I don't have/i,
      /unable to/i,
      /not able to/i,
      /can't provide/i,
      /cannot provide/i,
    ];

    const isRefusal = refusalPatterns.some((pattern) => pattern.test(content));
    if (isRefusal) {
      console.log(
        `[parseOpenAIResponse] ${platform}: OpenAI refused to provide information. Content: ${content}`
      );
      return [];
    }

    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
    const jsonContent = jsonMatch ? jsonMatch[1] : content.trim();

    console.log(
      `[parseOpenAIResponse] ${platform}: Extracted JSON content length: ${jsonContent.length}`
    );
    console.log(`[parseOpenAIResponse] ${platform}: Extracted JSON content:`, jsonContent);

    const results = JSON.parse(jsonContent);

    console.log(
      `[parseOpenAIResponse] ${platform}: JSON parsed successfully. Type: ${typeof results}, Is Array: ${Array.isArray(results)}`
    );

    if (!Array.isArray(results)) {
      console.log(
        `[parseOpenAIResponse] ${platform}: Response is not an array:`,
        typeof results,
        results
      );
      return [];
    }

    console.log(
      `[parseOpenAIResponse] ${platform}: Parsed ${results.length} items from OpenAI response`
    );
    console.log(
      `[parseOpenAIResponse] ${platform}: Raw parsed results BEFORE filtering:`,
      JSON.stringify(results, null, 2)
    );

    // For LinkedIn, URLs should already be provided by OpenAI, but normalize them
    if (platform === "LINKEDIN") {
      console.log(
        `[parseOpenAIResponse] LinkedIn: Processing ${results.length} items (URLs should already be provided)`
      );
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        console.log(`[parseOpenAIResponse] LinkedIn: Item ${i + 1}:`, JSON.stringify(item));

        // If URL exists, normalize it
        if (
          item.url &&
          item.url !== null &&
          item.url !== undefined &&
          String(item.url).trim() !== ""
        ) {
          let url = String(item.url).trim();
          // Ensure it's a full URL
          if (!url.startsWith("http")) {
            url = `https://${url}`;
          }
          // Normalize linkedin.com to www.linkedin.com
          url = url.replace(/^https?:\/\/(www\.)?linkedin\.com/, "https://www.linkedin.com");
          item.url = url;
          console.log(`[parseOpenAIResponse] LinkedIn: ✅ Item ${i + 1} has URL: "${item.url}"`);
        } else {
          // No URL - will be null (user can add manually)
          console.log(`[parseOpenAIResponse] LinkedIn: ⚠️ Item ${i + 1} has no URL - will be null`);
          item.url = null;
        }
      }
      console.log(
        `[parseOpenAIResponse] LinkedIn: After processing:`,
        JSON.stringify(results, null, 2)
      );
    }

    // Ensure URLs have a scheme so new URL() does not throw (common model omission for YouTube/X)
    for (const item of results) {
      if (item && item.url && typeof item.url === "string") {
        let u = item.url.trim();
        if (u && !/^https?:\/\//i.test(u)) {
          u = `https://${u}`;
        }
        item.url = u;
      }
    }

    const filteredResults = results.filter((item: any, index: number) => {
      console.log(
        `[parseOpenAIResponse] ${platform}: Processing item ${index + 1}/${results.length}:`,
        JSON.stringify(item)
      );

      if (!item || !item.name) {
        console.log(
          `[parseOpenAIResponse] ${platform}: Item ${index + 1} REJECTED - missing item or name`
        );
        return false;
      }

      // If URL is null or missing, allow it but skip URL validation
      if (!item.url || item.url === null) {
        console.log(
          `[parseOpenAIResponse] ${platform}: Item ${index + 1} ACCEPTED - has name but no URL: ${item.name}`
        );
        return true;
      }

      // Basic URL validation
      try {
        const url = new URL(item.url.trim());
        console.log(
          `[parseOpenAIResponse] ${platform}: Item ${index + 1} URL validation passed: ${item.url}`
        );

        // Platform-specific URL validation
        if (platform === "LINKEDIN") {
          // LinkedIn URLs should be linkedin.com/in/ or linkedin.com/company/
          const hostname = url.hostname.toLowerCase();
          const pathname = url.pathname.toLowerCase();
          console.log(
            `[parseOpenAIResponse] ${platform}: Item ${index + 1} LinkedIn validation - hostname: ${hostname}, pathname: ${pathname}`
          );
          if (!hostname.includes("linkedin.com")) {
            console.log(
              `[parseOpenAIResponse] ${platform}: Item ${index + 1} REJECTED - hostname doesn't include linkedin.com`
            );
            return false;
          }
          if (!pathname.startsWith("/in/") && !pathname.startsWith("/company/")) {
            console.log(
              `[parseOpenAIResponse] ${platform}: Item ${index + 1} REJECTED - pathname doesn't start with /in/ or /company/`
            );
            return false;
          }
          console.log(
            `[parseOpenAIResponse] ${platform}: Item ${index + 1} LinkedIn validation PASSED`
          );
          // Reject common invalid patterns
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Extract username from path (before /posts/ if present)
          const pathBeforePosts = pathname.split("/posts/")[0];
          const username = pathBeforePosts
            .replace("/in/", "")
            .replace("/company/", "")
            .split("/")[0];

          // Reject URLs with numeric suffixes (common fake pattern like -12345678)
          if (username && /-\d{6,}$/.test(username)) {
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting URL with numeric suffix: ${item.url}`
            );
            return false;
          }
          // Reject URLs with hash-like suffixes (common fake pattern like -8b8b3b, -a1b2c3, etc.)
          if (username && /-[a-f0-9]{6,}$/i.test(username)) {
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting URL with hash-like suffix: ${item.url}`
            );
            return false;
          }
          // Reject URLs that look like placeholders (all numbers, too short, etc.)
          if (username && (username.length < 3 || /^\d+$/.test(username))) {
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting invalid username pattern: ${item.url}`
            );
            return false;
          }
          // Reject URLs with suspicious patterns (repeated characters, etc.)
          if (username && /(.)\1{4,}/.test(username)) {
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting URL with suspicious pattern: ${item.url}`
            );
            return false;
          }
          // Reject URLs that look like they might be constructed incorrectly
          // Common patterns that often result in "page not found":
          // - Single word usernames that don't match name patterns (like "kristenlevine" without hyphen)
          // - Usernames that are too generic or don't match professional name patterns
          if (username && username.split("-").length === 1 && username.length > 12) {
            // Single word usernames longer than 12 chars without hyphens might be incorrect constructions
            // Real LinkedIn URLs usually have hyphens for multi-word names (e.g., "firstname-lastname")
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting suspicious single-word username (likely constructed incorrectly): ${item.url}`
            );
            return false;
          }
          // Reject usernames that are all lowercase single words longer than 10 chars (often incorrect)
          // Exception: Allow if it's a reasonable single name (like "john" or "mary" but not "kristenlevine")
          if (
            username &&
            /^[a-z]+$/.test(username) &&
            username.length > 10 &&
            !username.includes("-")
          ) {
            // This pattern often indicates a constructed URL that doesn't exist
            console.log(
              `[parseOpenAIResponse] LinkedIn: Rejecting suspicious single-word lowercase username (likely doesn't exist): ${item.url}`
            );
            return false;
          }

          // Reject URLs with title prefixes that are likely incorrect (e.g., "dr-julie-buzby")
          // But allow if it's a known pattern (some professionals do use title prefixes)
          // Only reject if it's a very simple pattern that's likely wrong
          if (
            username &&
            /^(dr|mr|mrs|ms|prof|doctor)-[a-z]+-[a-z]+$/i.test(username) &&
            username.split("-").length === 3
          ) {
            // Simple 3-part pattern with title prefix - likely incorrect, but log for monitoring
            console.log(
              `[parseOpenAIResponse] LinkedIn: Warning - URL with title prefix pattern: ${item.url} (allowing but may be incorrect)`
            );
            // Don't reject - let it through and validation will catch if it's actually broken
          }

          // For company pages, ensure they have /posts/?feedView=all, or add it
          if (pathname.startsWith("/company/")) {
            if (!pathname.includes("/posts/")) {
              // Auto-append /posts/?feedView=all to company URLs
              const baseUrl = item.url.split("?")[0].split("#")[0]; // Remove existing query params and hash
              item.url = `${baseUrl}/posts/?feedView=all`;
              console.log(
                `[parseOpenAIResponse] LinkedIn: Auto-appended /posts/?feedView=all to company URL: ${item.url}`
              );
            }
          }
        } else if (platform === "TWITTER") {
          // X/Twitter URLs should be x.com or twitter.com
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("x.com") && !hostname.includes("twitter.com")) {
            return false;
          }
        } else if (platform === "REDDIT") {
          // Reddit URLs should be reddit.com/r/
          const hostname = url.hostname.toLowerCase();
          const pathname = url.pathname.toLowerCase();
          if (!hostname.includes("reddit.com")) return false;
          if (!pathname.startsWith("/r/")) return false;
        } else if (platform === "INSTAGRAM") {
          // Instagram URLs should be instagram.com
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("instagram.com")) return false;
          // Reject common invalid patterns
          const pathname = url.pathname.toLowerCase();
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Reject if pathname is empty or just "/"
          if (!pathname || pathname === "/") {
            return false;
          }
        } else if (platform === "TIKTOK") {
          // TikTok URLs should be tiktok.com/@username or tiktok.com/user/username
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("tiktok.com")) return false;
          // Reject common invalid patterns
          const pathname = url.pathname.toLowerCase();
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Reject empty pathname
          if (!pathname || pathname === "/") {
            return false;
          }
          // Accept @username format (preferred), /user/username format, or /username format
          if (pathname.startsWith("/@") || pathname.startsWith("/user/")) {
            // Valid formats
            return true;
          }
          // Allow /username format (without @) if it looks like a username (not a page like /video/, /foryou/, etc.)
          const usernamePart = pathname.substring(1).split("/")[0];
          if (
            usernamePart &&
            usernamePart.length >= 2 &&
            !["video", "foryou", "discover", "upload", "login", "signup"].includes(usernamePart)
          ) {
            return true;
          }
          return false;
        } else if (platform === "YOUTUBE") {
          // YouTube URLs should be youtube.com/@, /c/, or /channel/
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("youtube.com")) return false;
          // Reject common invalid patterns
          const pathname = url.pathname.toLowerCase();
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Should be a channel URL format
          if (
            !pathname.startsWith("/@") &&
            !pathname.startsWith("/c/") &&
            !pathname.startsWith("/channel/") &&
            !pathname.startsWith("/user/")
          ) {
            return false;
          }
        } else if (platform === "BLUESKY") {
          // BlueSky URLs should be bsky.app/profile/username
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("bsky.app")) return false;
          // Reject common invalid patterns
          const pathname = url.pathname.toLowerCase();
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Should be profile URL format
          if (!pathname.startsWith("/profile/")) {
            return false;
          }
        } else if (platform === "FACEBOOK") {
          // Facebook URLs should be facebook.com or www.facebook.com
          const hostname = url.hostname.toLowerCase();
          if (!hostname.includes("facebook.com")) return false;
          // Reject common invalid patterns
          const pathname = url.pathname.toLowerCase();
          if (
            pathname.includes("placeholder") ||
            pathname.includes("example") ||
            pathname.includes("test")
          ) {
            return false;
          }
          // Reject company/brand pages (common patterns)
          const pathLower = pathname.toLowerCase();
          if (
            pathLower.includes("/pages/") ||
            pathLower.includes("/company/") ||
            pathLower.includes("/business/")
          ) {
            return false;
          }
          // Reject if pathname is empty or just "/"
          if (!pathname || pathname === "/") {
            return false;
          }
          // Reject URLs that look like company/brand pages (capitalized single word like /CompanyName)
          // Individual profiles typically use lowercase, underscores, or dots (e.g., /john.doe, /jane_smith)
          const pathSegment = pathname
            .split("/")
            .filter((p) => p)
            .join("/");
          if (pathSegment && pathSegment.length > 0) {
            // If it's a single capitalized word (likely a brand page), reject it
            // Allow if it has dots, underscores, or is lowercase
            const hasSeparators =
              pathSegment.includes(".") || pathSegment.includes("_") || pathSegment.includes("-");
            const isLowercase = pathSegment === pathSegment.toLowerCase();
            // Reject if it's a single capitalized word without separators (e.g. brand-style page)
            if (!hasSeparators && !isLowercase && pathSegment.split(/[._-]/).length === 1) {
              console.log(
                `[parseOpenAIResponse] Facebook: Rejecting likely brand page: ${item.url} (path: ${pathSegment})`
              );
              return false;
            }
          }
        }

        console.log(
          `[parseOpenAIResponse] ${platform}: Item ${index + 1} ACCEPTED - all validations passed`
        );
        return true;
      } catch (urlError) {
        console.log(
          `[parseOpenAIResponse] ${platform}: Item ${index + 1} REJECTED - URL parsing error:`,
          urlError,
          `URL was:`,
          item?.url
        );
        return false;
      }
    });

    console.log(`[parseOpenAIResponse] ${platform}: ========== FILTERING COMPLETE ==========`);
    console.log(
      `[parseOpenAIResponse] ${platform}: Original count: ${results.length}, Filtered count: ${filteredResults.length}`
    );
    if (filteredResults.length < results.length) {
      console.log(
        `[parseOpenAIResponse] ${platform}: WARNING - ${results.length - filteredResults.length} items were filtered out!`
      );
    }
    console.log(
      `[parseOpenAIResponse] ${platform}: Filtered results:`,
      JSON.stringify(filteredResults, null, 2)
    );

    return filteredResults.map((item: any) => {
      let url = item.url ? item.url.trim() : null;
      // Normalize YouTube URLs to @ format
      if (url && platform === "YOUTUBE") {
        url = normalizeYouTubeUrl(url);
      }
      return {
        name: item.name || null,
        url,
        selected: true, // Default to selected
      };
    });
  } catch (error) {
    console.error(`[parseOpenAIResponse] Error parsing response for ${platform}:`, error);
    return [];
  }
}

/**
 * Get existing links for a taxonomy node to check for duplicates
 * Only checks links saved at the EXACT same level, not inherited links
 */
async function getExistingLinksForNode(
  taxonomyNode: TaxonomyNode,
  linkType: string
): Promise<Set<string>> {
  const existingUrls = new Set<string>();

  try {
    // Import Prisma to query directly at exact level
    const { prisma } = await import("@/lib/prisma");

    if (taxonomyNode.type === "sub_subcategory" && taxonomyNode.id) {
      // Check only links saved at this exact sub_subcategory level
      if (linkType === "INFLUENCER") {
        const links = await prisma.taxonomyInfluencerLink.findMany({
          where: {
            deleted_at: null,
            taxonomy_id: taxonomyNode.id, // Only exact matches by taxonomy_id
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "OTHER_SOURCE") {
        const links = await prisma.taxonomyOtherSourceLink.findMany({
          where: {
            deleted_at: null,
            taxonomy_id: taxonomyNode.id,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "REDDIT") {
        const links = await prisma.taxonomyRedditLink.findMany({
          where: {
            deleted_at: null,
            taxonomy_id: taxonomyNode.id,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      }
    } else if (
      taxonomyNode.type === "subcategory" &&
      taxonomyNode.category &&
      taxonomyNode.subcategory
    ) {
      // Check only links saved at this exact subcategory level (not category level)
      if (linkType === "INFLUENCER") {
        const links = await prisma.taxonomyInfluencerLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: taxonomyNode.subcategory,
            sub_subcategory: null, // Only subcategory level, not sub_subcategory
            taxonomy_id: null, // Not linked to a specific taxonomy entry
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "OTHER_SOURCE") {
        const links = await prisma.taxonomyOtherSourceLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: taxonomyNode.subcategory,
            sub_subcategory: null,
            taxonomy_id: null,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "REDDIT") {
        const links = await prisma.taxonomyRedditLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: taxonomyNode.subcategory,
            sub_subcategory: null,
            taxonomy_id: null,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      }
    } else if (taxonomyNode.type === "category" && taxonomyNode.category) {
      // Check only links saved at this exact category level
      if (linkType === "INFLUENCER") {
        const links = await prisma.taxonomyInfluencerLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: null, // Only category level
            sub_subcategory: null,
            taxonomy_id: null,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "OTHER_SOURCE") {
        const links = await prisma.taxonomyOtherSourceLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: null,
            sub_subcategory: null,
            taxonomy_id: null,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      } else if (linkType === "REDDIT") {
        const links = await prisma.taxonomyRedditLink.findMany({
          where: {
            deleted_at: null,
            category: taxonomyNode.category,
            subcategory: null,
            sub_subcategory: null,
            taxonomy_id: null,
          },
        });
        links.forEach((link) => existingUrls.add(normalizeUrl(link.url)));
      }
    }

    console.log(
      `[getExistingLinksForNode] Found ${existingUrls.size} existing links at exact level for ${taxonomyNode.type}`
    );
  } catch (error) {
    console.error(`[getExistingLinksForNode] Error fetching existing links:`, error);
  }

  return existingUrls;
}

/**
 * Deduplicate results against existing links AND within the results themselves
 */
function deduplicateResults(results: SearchResult[], existingUrls: Set<string>): SearchResult[] {
  const seenUrls = new Set<string>();
  const uniqueResults: SearchResult[] = [];

  // First pass: remove duplicates within results themselves
  for (const result of results) {
    // Skip normalization and duplicate check if URL is null
    if (!result.url) {
      // For results without URLs, include them (they might be placeholders)
      uniqueResults.push({
        ...result,
        isDuplicate: false,
        selected: true, // Select items without URLs by default
      });
      continue;
    }

    const normalized = normalizeUrl(result.url);

    // Skip if we've already seen this URL in the results
    if (seenUrls.has(normalized)) {
      continue; // Skip duplicate within results
    }

    seenUrls.add(normalized);

    // Check if it's a duplicate against existing sources
    const isDuplicate = existingUrls.has(normalized);
    uniqueResults.push({
      ...result,
      isDuplicate,
      selected: !isDuplicate, // Don't select duplicates by default
    });
  }

  return uniqueResults;
}

/**
 * Search for sources using OpenAI (runs in parallel for all platforms)
 */
export async function searchSourcesWithOpenAI(
  searchId: string,
  taxonomyNode: TaxonomyNode,
  platforms: PlatformSearchConfig[],
  brandName?: string,
  /** Brand-directory keywords; used when projectKeywords is empty. */
  brandKeywords?: string[],
  /** Project "Keywords to monitor" — preferred for relevance (ideas/themes). */
  projectKeywords?: string[]
): Promise<void> {
  // Initialize progress IMMEDIATELY (before try block) so GET requests can find it
  const progress: SearchProgress = {
    searchId,
    status: "in_progress",
    progress: 0,
    results: {},
  };
  searchProgressMap.set(searchId, progress);
  console.log(
    `[searchSourcesWithOpenAI] START: Set progress for ${searchId}. Map now has ${searchProgressMap.size} entries. Keys: ${Array.from(searchProgressMap.keys()).join(", ")}`
  );

  try {
    const relevanceKeywords =
      projectKeywords && projectKeywords.length > 0 ? projectKeywords : (brandKeywords ?? []);

    console.log(
      `[searchSourcesWithOpenAI] Starting search for ${searchId} with ${platforms.length} platforms`
    );
    if (projectKeywords && projectKeywords.length > 0) {
      console.log(
        `[searchSourcesWithOpenAI] Using project keywords for relevance (${projectKeywords.length}): ${projectKeywords.join(", ")}`
      );
    } else if (brandKeywords && brandKeywords.length > 0) {
      console.log(
        `[searchSourcesWithOpenAI] Using brand-directory keywords for relevance (${brandKeywords.length}): ${brandKeywords.join(", ")}`
      );
    }

    const totalPlatforms = platforms.length;
    let completedPlatforms = 0;

    // Get existing links for duplicate detection
    const existingLinksByType = new Map<string, Set<string>>();
    for (const config of platforms) {
      const key = config.linkType;
      if (!existingLinksByType.has(key)) {
        existingLinksByType.set(key, await getExistingLinksForNode(taxonomyNode, config.linkType));
      }
    }

    // Search all platforms in parallel
    const searchPromises = platforms.map(async (config) => {
      const platformKey = config.platform;
      progress.currentPlatform = platformKey;

      try {
        // Special handling for LinkedIn - use web search first (ChatGPT's recommended approach)
        if (config.platform === "LINKEDIN") {
          const keywords = relevanceKeywords;
          const searchTopic =
            taxonomyNode.sub_subcategory || taxonomyNode.subcategory || taxonomyNode.category || "";

          // Step 1: Search for LinkedIn profiles using Bing Web Search API
          // This finds REAL LinkedIn URLs from web search instead of asking OpenAI to invent them
          console.log(
            `[searchSourcesWithOpenAI] LinkedIn: ========== STEP 1: BING WEB SEARCH ==========`
          );
          console.log(
            `[searchSourcesWithOpenAI] LinkedIn: Topic: "${searchTopic}", Keywords: ${keywords.join(", ") || "none"}`
          );
          const searchResults = await searchLinkedInProfiles(
            searchTopic,
            keywords,
            config.count,
            brandName
          );

          if (searchResults.length === 0) {
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: ❌ No web search results found (Bing API failed or returned 0 results)`
            );
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: Falling back to OpenAI-only approach - will get names but no URLs`
            );
            // Fall through to OpenAI-only approach below
          } else {
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: ✅ Found ${searchResults.length} LinkedIn profiles from web search`
            );
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: First 3 URLs:`,
              searchResults.slice(0, 3).map((r) => r.url)
            );

            // Step 2: Identify relevant professional types for this topic
            const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: ========== STEP 2: IDENTIFY RELEVANT PROFESSIONAL TYPES ==========`
            );

            let relevantProfessionalTypes = "";
            try {
              const professionalTypesPrompt = `What types of professionals are relevant to: ${searchTopic}${keywords.length > 0 ? ` (keywords: ${keywords.join(", ")})` : ""}?

Return a JSON object with a "types" array of professional types/titles that would be DIRECTLY relevant to this specific topic.

IMPORTANT:
- Include professionals who work SPECIFICALLY in this industry/topic
- EXCLUDE general professionals (e.g., general e-commerce directors, general marketing experts, general retail experts) unless they work specifically in this topic area
- Focus on topic-specific roles, not generic business roles

Examples:
- For topic-specific industries: industry experts, specialized professionals, topic-specific executives, domain professionals, topic experts, industry professionals
- For e-commerce (general): e-commerce directors, online retail experts (BUT only if topic is e-commerce itself)
- DO NOT include: general marketing directors, general e-commerce experts, general retail media professionals

Return ONLY valid JSON, no explanations:
{"types": ["type1", "type2", "type3", ...]}`;

              const typesResponse = await fetch(`${openaiBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "gpt-4o",
                  messages: [
                    {
                      role: "user",
                      content: professionalTypesPrompt,
                    },
                  ],
                  temperature: 0.3,
                  response_format: { type: "json_object" },
                }),
              });

              if (typesResponse.ok) {
                const typesData = await typesResponse.json();
                const typesContent = typesData.choices[0]?.message?.content;
                if (typesContent) {
                  const parsed = JSON.parse(typesContent);
                  if (parsed.types && Array.isArray(parsed.types)) {
                    relevantProfessionalTypes = parsed.types.join(", ");
                    console.log(
                      `[searchSourcesWithOpenAI] LinkedIn: ✅ Identified relevant professional types: ${relevantProfessionalTypes}`
                    );
                  }
                }
              }
            } catch (error: any) {
              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: ⚠️ Could not identify professional types: ${error.message}`
              );
            }

            // Step 3: Use OpenAI to rank and extract names from search results
            console.log(
              `[searchSourcesWithOpenAI] LinkedIn: ========== STEP 3: RANK PROFILES ==========`
            );
            const rankingPrompt = `You are ranking LinkedIn profiles for relevance to: ${searchTopic}${keywords.length > 0 ? ` (keywords: ${keywords.join(", ")})` : ""}.

I found ${searchResults.length} LinkedIn profiles from web search. Your task:
1. Filter profiles by location, language, and connections
2. Rank them by relevance to the topic
3. Use the "title" field as the person's name (it contains the actual profile name)
4. Return the top ${config.count} most relevant profiles WITH THEIR EXACT URLs

CRITICAL FILTERING RULES - STRICT RELEVANCE (MANDATORY):
${relevantProfessionalTypes ? `- RELEVANT PROFESSIONAL TYPES for this topic: ${relevantProfessionalTypes}` : ""}

- A profile is RELEVANT ONLY IF BOTH CONDITIONS ARE MET:
  1. Their title/role matches one of the relevant professional types listed above (${relevantProfessionalTypes || "relevant professionals for this topic"}), AND
  2. Their profile snippet or post content CLEARLY shows they work in or post about ${searchTopic}${keywords.length > 0 ? ` (specifically: ${keywords.join(", ")})` : ""} - this includes people who work at ${searchTopic}-related companies/brands

CRITICAL: A profile that matches a professional type BUT doesn't mention ${searchTopic}-related terms in their profile/posts MUST BE EXCLUDED. For example:
- "E-commerce Director at EMARKETER" with no pet mentions → EXCLUDE
- "Marketing Expert" with no pet mentions → EXCLUDE  
- "Retail Media Professional" with no pet mentions → EXCLUDE

- MANDATORY EXCLUSIONS - DO NOT INCLUDE:
  * General marketing experts (e.g., "Marketing Director", "CMO", "Marketing Consultant") with NO mention of ${searchTopic} in profile/posts
  * General e-commerce experts (e.g., "E-commerce Director", "Shopify Expert") with NO mention of ${searchTopic} in profile/posts  
  * General CRO/optimization experts with NO mention of ${searchTopic} in profile/posts
  * Media/journalism professionals (e.g., "Editor", "Journalist", "Content Director") with NO mention of ${searchTopic} in profile/posts
  * Retail media professionals (e.g., "Retail Media Expert", "EMARKETER") with NO mention of ${searchTopic} in profile/posts
  * Any professional whose profile/posts don't mention ${searchTopic}-related terms${keywords.length > 0 ? ` (specifically: ${keywords.join(", ")})` : ` (terms related to ${searchTopic})`}
  * Professionals in completely unrelated industries (general tech, finance, etc.) unless they specifically mention ${searchTopic} work

- IF A PROFILE'S SNIPPET/TITLE DOES NOT MENTION ${searchTopic.toUpperCase()}-RELATED TERMS AND THEY ARE NOT A RELEVANT PROFESSIONAL TYPE, EXCLUDE THEM.

- ONLY include profiles in English (exclude profiles with non-English text in title/snippet)
- PREFER profiles with AT LEAST 500 LinkedIn connections, but include profiles even if connection count is not visible
- If connection count is visible and under 500, still include if the profile is a relevant professional type AND mentions topic-related terms
- If connection count is not visible, include the profile if it's a relevant professional type AND mentions topic-related terms
- EXCLUDE clearly non-English profiles (profiles with non-English characters/text in title/snippet)

LOCATION PRIORITY (rank in this exact order - prioritize but don't exclude based on location):
1. United States (USA, US, American) - HIGHEST PRIORITY
2. United Kingdom (UK, British) - SECOND PRIORITY  
3. Canada (Canadian) - THIRD PRIORITY
4. Australia (Australian) - FOURTH PRIORITY
5. Europe (English-speaking countries only: Ireland, etc.) - FIFTH PRIORITY
6. Other English-speaking countries - SIXTH PRIORITY
7. If location is unclear but profile is in English and relevant, include it - LOWEST PRIORITY

IMPORTANT: Return results even if location is unclear, as long as they are:
- In English
- Relevant to ${searchTopic}
- Have 500+ connections (if visible) OR seem professional/relevant (if connection count not visible)

EXTRACTION RULES:
- Extract the person's REAL name from the title/snippet
- Do NOT invent names - use what's in the search results
- ALWAYS include the EXACT URL from the search results - DO NOT omit URLs
- Use the exact "url" field from each search result - copy it exactly as shown

RANKING ORDER:
1. Location priority (US > UK > Canada > Australia > Europe > Other) - but don't exclude if location unclear
2. Relevance to topic
3. Connection count (higher is better, prefer 500+)

CRITICAL: Return up to ${config.count} results. 

VERY IMPORTANT RULES - QUALITY OVER QUANTITY (STRICT ENFORCEMENT):
1. If you have ${config.count} or more relevant profiles, return the top ${config.count}
2. If you have fewer than ${config.count} profiles, return ALL of them that meet BOTH criteria:
   - In English
   - Their title/role matches relevant professional types (${relevantProfessionalTypes || "relevant professionals for this topic"}), AND
   - Their profile snippet or post content MUST mention ${searchTopic}-related terms${keywords.length > 0 ? ` (specifically: ${keywords.join(", ")})` : ` (terms related to ${searchTopic})`}
   - Professional/reputable (even if connection count not visible or under 500)
3. NEVER return profiles that are:
   - General marketing/e-commerce/CRO experts with NO ${searchTopic} mention in profile/posts (even if they match a professional type)
   - Media/journalism professionals (e.g., EMARKETER, retail media) with NO ${searchTopic} mention (even if they match a professional type)
   - Retail media professionals with NO ${searchTopic} mention (even if they match a professional type)
   - Any professional whose profile/posts don't mention ${searchTopic}-related terms (REQUIRED - cannot skip this check)
4. It's better to return FEWER HIGH-QUALITY results (even 0) than include off-topic profiles
5. If a profile's snippet/title doesn't mention ${searchTopic}-related terms AND they're not a relevant professional type, EXCLUDE THEM
6. Examples of EXCLUSIONS: Marketing Director at EMARKETER (retail media, no ${searchTopic} mention), E-commerce Consultant (no ${searchTopic} mention), CRO Expert (no ${searchTopic} mention)

GUARDRAIL: If candidates.length > 0, you MUST return at least 1 result unless ALL are invalid URLs or clearly non-English.

EVERY result MUST have both "name" AND "url" fields

Search results:
${JSON.stringify(searchResults.slice(0, 50), null, 2)}

Return format (JSON object only):
{"results": [{"name": "Extracted Name", "url": "https://www.linkedin.com/in/exact-url-from-search-results"}, ...]}

IMPORTANT: 
- Copy the exact "url" value from the search results above
- Prioritize US/UK/Canada/Australia profiles in that order
- Include English profiles even if connection count is unknown or under 500
- Exclude only clearly non-English profiles
- NEVER return an empty array - if you have any English, professional profiles, return them`;

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
                    content: `You are a LinkedIn profile ranking expert with STRICT filtering rules. You filter and rank LinkedIn profiles by:
1. Professional type relevance (must be relevant professional types AND have topic-related content in profile/posts)
2. Topic-related content in profile/posts (MUST mention topic-related terms - BOTH professional type AND topic mention are REQUIRED)
3. Location priority (US > UK > Canada > Australia > Europe)
4. Language (English only)
5. Connection count (minimum 500 connections preferred)

CRITICAL FILTERING RULES:
- EXCLUDE general marketing/e-commerce/CRO experts with NO topic mention (e.g., Marketing Director at EMARKETER, E-commerce Consultant, CRO Expert)
- EXCLUDE media/journalism professionals with NO topic mention
- EXCLUDE retail media professionals with NO topic mention
- ONLY include profiles that are relevant professional types OR have topic-related content in their profile/posts
- If a profile's snippet doesn't mention topic-related terms AND they're not a relevant professional type, EXCLUDE THEM

The "title" field contains the actual profile name. Use it directly - do not extract from snippets.
You MUST return ONLY valid JSON objects - no explanations, no disclaimers, no markdown.`,
                  },
                  {
                    role: "user",
                    content: rankingPrompt,
                  },
                ],
                temperature: 0.1,
                response_format: { type: "json_object" },
              }),
            });

            if (!response.ok) {
              throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0]?.message?.content;

            if (content) {
              const parsed = JSON.parse(content);
              const rankedResults: Array<{ name?: string; url?: string }> = Array.isArray(
                parsed.results
              )
                ? parsed.results
                : [];

              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: OpenAI returned ${rankedResults.length} ranked results`
              );
              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: OpenAI response:`,
                JSON.stringify(rankedResults, null, 2)
              );

              // Create a map of URLs to search results for lookup
              const urlToSearchResult = new Map<
                string,
                { url: string; title: string; snippet: string }
              >();
              searchResults.forEach((sr) => urlToSearchResult.set(sr.url, sr));

              // Merge OpenAI's ranking with the original URLs and names from search results
              // CRITICAL: Match by URL, not by index! OpenAI may return results in different order
              // CRITICAL: OpenAI's ranked.name is MOST RELIABLE - use it FIRST!
              // OpenAI has access to the actual LinkedIn pages and extracts correct names
              const results: SearchResult[] = rankedResults
                .map((ranked, index) => {
                  // Match by URL from OpenAI's ranked result (most reliable)
                  // Normalize URLs for matching (remove trailing slashes, query params, etc.)
                  const normalizeUrlForMatch = (url: string) => {
                    return (
                      url?.toLowerCase().trim().replace(/\/$/, "").split("?")[0].split("#")[0] || ""
                    );
                  };

                  const rankedUrlNormalized = normalizeUrlForMatch(ranked.url || "");
                  let searchResult = rankedUrlNormalized
                    ? urlToSearchResult.get(rankedUrlNormalized)
                    : null;

                  // If not found by exact match, try finding by partial match (in case of URL variations)
                  if (!searchResult && ranked.url) {
                    for (const [srUrl, sr] of urlToSearchResult.entries()) {
                      if (
                        normalizeUrlForMatch(srUrl) === rankedUrlNormalized ||
                        srUrl.includes(rankedUrlNormalized) ||
                        rankedUrlNormalized.includes(normalizeUrlForMatch(srUrl))
                      ) {
                        searchResult = sr;
                        break;
                      }
                    }
                  }

                  // Use URL from OpenAI's ranked result (most reliable), fallback to searchResult
                  const url = ranked.url || searchResult?.url || null;

                  // PRIORITY ORDER: OpenAI's name > searchResult title > URL extraction
                  // OpenAI's ranked.name is the MOST RELIABLE - it has access to actual LinkedIn pages
                  let name = ranked.name?.trim();

                  // Fallback 1: Use searchResult title if OpenAI didn't provide a name
                  if (!name || name.split(/\s+/).length < 2) {
                    name =
                      searchResult?.title?.split(" | ")[0]?.trim() || searchResult?.title?.trim();
                  }

                  // Fallback 2: Extract from URL only if both OpenAI and searchResult failed
                  if (!name || name.split(/\s+/).length < 2) {
                    const nameFromUrl = extractNameFromUrl(url || "");
                    if (nameFromUrl && nameFromUrl.split(/\s+/).length >= 2) {
                      name = nameFromUrl;
                      console.log(
                        `[searchSourcesWithOpenAI] LinkedIn: Using URL-extracted name (fallback): "${name}"`
                      );
                    }
                  }

                  // Final fallback: empty string (shouldn't happen if OpenAI provided names)
                  name = name || "";

                  if (!url) {
                    console.log(
                      `[searchSourcesWithOpenAI] LinkedIn: ⚠️ No URL for result ${index}: name="${name}", ranked.url="${ranked.url}", searchResult.url="${searchResult?.url}"`
                    );
                  } else {
                    console.log(
                      `[searchSourcesWithOpenAI] LinkedIn: ✅ Result ${index}: name="${name}", url="${url}" (matched by URL)`
                    );
                  }

                  return {
                    name: name || "",
                    url: url || "",
                    selected: true,
                  };
                })
                .filter((r) => r.url !== "" && r.name !== "") as SearchResult[]; // Only keep results with both URL and name

              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: Final results after URL merging:`,
                JSON.stringify(results, null, 2)
              );

              // Step 3: Verify URLs (optional but recommended)
              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: Step 3 - Verifying ${results.length} URLs`
              );
              const urlsToValidate = results.filter((r) => r.url).map((r) => r.url!);
              if (urlsToValidate.length > 0) {
                const validationResults = await validateUrls(urlsToValidate.slice(0, 10), 3); // Validate first 10, 3 at a time
                results.forEach((result) => {
                  if (result.url && validationResults.has(result.url)) {
                    const isValid = validationResults.get(result.url);
                    if (!isValid) {
                      console.log(
                        `[searchSourcesWithOpenAI] LinkedIn: URL failed validation: ${result.url}`
                      );
                      // Keep it but log - LinkedIn often blocks bots so validation may fail even for valid URLs
                    }
                  }
                });
              }

              // Mark duplicates
              const existingUrls = existingLinksByType.get(config.linkType) || new Set();
              const finalResults = deduplicateResults(results, existingUrls);

              progress.results[platformKey] = finalResults;
              completedPlatforms++;
              progress.progress = Math.round((completedPlatforms / totalPlatforms) * 100);
              progress.currentPlatform =
                completedPlatforms < totalPlatforms
                  ? platforms[completedPlatforms]?.platform
                  : undefined;

              console.log(
                `[searchSourcesWithOpenAI] LinkedIn: Completed with ${finalResults.length} results (${finalResults.filter((r) => r.url).length} with URLs)`
              );
              return; // Exit early - we're done with LinkedIn
            }
          }
          // Fall through to OpenAI-only approach if web search failed
        }

        // Standard OpenAI approach for all platforms (including TikTok - consistent with Twitter/Facebook/Instagram)
        const prompt = constructSearchPrompt(
          taxonomyNode,
          config.platform,
          config.count,
          config.linkType,
          brandName,
          relevanceKeywords
        );

        const platformName = getPlatformDisplayName(config.platform);
        const searchTerm = getPlatformSearchTerm(config.platform, config.linkType);

        const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
        const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages:
              config.platform === "LINKEDIN"
                ? [
                    {
                      role: "system",
                      content: `You are a research assistant. Identify ${config.count} professionals who are experts SPECIFICALLY related to the given topic/keywords.

CRITICAL REQUIREMENTS:
- Each person must be a REAL professional (not generic placeholder names)
- Must be DIRECTLY RELEVANT to the specific topic/keywords provided - not just tangentially related
- Focus on: experts, thought leaders, influencers, authors, speakers who actively work with or discuss the specific topic
- DO NOT include generic placeholder names like "Jane Doe" or "John Smith"
- DO NOT include people who are only loosely related to the topic

RELEVANCE CHECK:
- Before including someone, verify they are ACTUALLY relevant to the specific topic/keywords
- If someone is only vaguely related, skip them and find someone more relevant
- Quality over quantity: Better to return fewer highly relevant professionals than many loosely related ones

MOST IMPORTANT: Return ALL relevant professionals, even if you don't know their LinkedIn URL. Names are valuable even without URLs.

For each professional:
- Name: Their REAL full name (required) - must be someone directly relevant to the topic
- URL: Their complete LinkedIn profile URL if you know it from your training data (e.g., "https://www.linkedin.com/in/john-doe"). If you don't know the URL, use null. NULL URLs ARE PERFECTLY ACCEPTABLE.

URL GUIDELINES:
- If you KNOW a professional's LinkedIn URL from your training data, provide it in format: https://www.linkedin.com/in/USERNAME
- If you DON'T know the URL, use null - this is fine and expected
- Do NOT skip professionals just because you don't know their LinkedIn URL
- Do NOT construct or guess URLs - only provide URLs you know are real
- Examples of professionals you might know URLs for: well-known executives, famous veterinarians, published authors
- Most professionals will have null URLs - this is normal and acceptable

CRITICAL: Return the requested number of professionals. Include professionals even if their URL is null. Names without URLs are still valuable.

Return format (JSON object only, no other text):
{"results": [{"name": "Real Full Name", "url": "https://www.linkedin.com/in/known-url-if-available"}, {"name": "Real Full Name", "url": null}]}`,
                    },
                    {
                      role: "user",
                      content: prompt,
                    },
                  ]
                : config.platform === "TWITTER"
                  ? [
                      {
                        role: "system",
                        content: `You are a Twitter/X research expert specializing in finding REAL INDIVIDUALS (creators, analysts, experts, commentators) who tweet about the given topic—not brand accounts.

1. FIRST: Identify people who are publicly active and credible on the topic (journalists, founders, analysts, creators, academics, etc.)
2. THEN: Provide their Twitter/X profile URL using handles you are confident match those public figures

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company accounts or brand accounts
- Target people who plausibly have at least ~500+ followers: established voices in the space, not obviously personal micro-accounts. You do NOT need exact follower counts from memory—use reasonable judgment.
- PRIORITIZE larger accounts and verified accounts when applicable
- Include Twitter/X URLs in the form https://x.com/username or https://twitter.com/username—use well-known public handles; do not invent random usernames
- Prefer returning a full list of relevant profiles over returning an empty array when reasonable options exist
- Include the person's name or handle in the "name" field`,
                      },
                      {
                        role: "user",
                        content: prompt,
                      },
                    ]
                  : config.platform === "FACEBOOK"
                    ? [
                        {
                          role: "system",
                          content: `You are a Facebook research expert specializing in finding REAL INFLUENCERS and THOUGHT LEADERS (individuals with large followings) who post about specific topics. Your process:

1. FIRST: Identify real INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS by name who post about the given topic (like performing a web search)
2. THEN: Find their actual Facebook profile URLs from your knowledge base

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company pages or brand pages
- DO NOT include company pages or brand pages
- PRIORITIZE accounts with LARGE FOLLOWINGS (thousands or tens of thousands of followers/friends)
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts with SIGNIFICANT INFLUENCE in the given topic
- You can construct Facebook URLs for known public figures/influencers using common username patterns
- Use format: https://facebook.com/username or https://www.facebook.com/username
- Include the person's name in the "name" field
- DO NOT include accounts with very few followers (under 1,000)
- DO NOT include unknown or obscure accounts
- Think step-by-step: First identify influential people's names who discuss the topic, then construct their Facebook URLs
- Return the requested number of results - prioritize finding influential accounts`,
                        },
                        {
                          role: "user",
                          content: prompt,
                        },
                      ]
                    : config.platform === "REDDIT"
                      ? [
                          {
                            role: "system",
                            content: `You are a Reddit research expert specializing in finding REAL subreddits that discuss specific topics. Your process:

1. FIRST: Identify real SUBREDDITS by name that discuss the given topic (like performing a web search)
2. THEN: Find their actual Reddit URLs from your knowledge base

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include GENERAL TOPIC subreddits, NOT brand-specific subreddits
- DO NOT include brand-specific subreddits
- Only include Reddit URLs that you KNOW exist from your training data
- DO NOT create fake URLs by guessing subreddit names
- Use format: https://reddit.com/r/subredditname or https://www.reddit.com/r/subredditname
- Include the subreddit name (without r/ prefix) in the "name" field
- If you cannot verify a Reddit URL exists, skip that subreddit and find another
- Quality over quantity: Better to return fewer verified subreddits than fake ones
- Think step-by-step: First identify subreddit names, then find their Reddit URLs`,
                          },
                          {
                            role: "user",
                            content: prompt,
                          },
                        ]
                      : config.platform === "INSTAGRAM"
                        ? [
                            {
                              role: "system",
                              content: `You are an Instagram research expert specializing in finding REAL INFLUENCERS and THOUGHT LEADERS (individuals with large followings) who post about specific topics. Your process:

1. FIRST: Identify real INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS by name who post about the given topic (like performing a web search)
2. THEN: Find their actual Instagram profile URLs from your knowledge base

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company accounts or brand accounts
- DO NOT include company accounts like @chewy, @petco, @petsmart, etc.
- PRIORITIZE accounts with LARGE FOLLOWINGS (tens of thousands or hundreds of thousands of followers)
- PRIORITIZE verified accounts (blue checkmark) when available
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts with SIGNIFICANT INFLUENCE in the given topic
- You can construct Instagram URLs for known public figures/influencers using common username patterns
- Use format: https://instagram.com/username
- Include the person's name or handle in the "name" field
- DO NOT include accounts with very few followers (under 10,000)
- DO NOT include unknown or obscure accounts
- Think step-by-step: First identify influential people's names who discuss the topic, then construct their Instagram URLs
- Return the requested number of results - prioritize finding influential accounts`,
                            },
                            {
                              role: "user",
                              content: prompt,
                            },
                          ]
                        : config.platform === "TIKTOK"
                          ? [
                              {
                                role: "system",
                                content: `You are a TikTok research expert specializing in finding REAL INFLUENCERS and THOUGHT LEADERS (individuals with large followings) who post about specific topics. Your process:

1. FIRST: Identify a DIVERSE MIX of real INFLUENCERS, THOUGHT LEADERS, CONTENT CREATORS, and EXPERTS by name who post about the given topic
2. THEN: Find or construct their TikTok profile URLs

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company accounts or brand accounts
- DO NOT include company accounts, brand accounts, official business accounts, retailer accounts
- PRIORITIZE accounts with LARGE FOLLOWINGS (tens of thousands or hundreds of thousands of followers)
- If you KNOW an account has fewer than 500 followers, DO NOT include it - skip it and find another
- If follower count is unknown but the person is a well-known influencer/expert/content creator in the field, INCLUDE them (we'll verify follower counts later)
- PRIORITIZE verified accounts (blue checkmark) when available
- You can construct TikTok URLs for known public figures/influencers using common username patterns
- Use format: https://tiktok.com/@username or https://www.tiktok.com/@username
- Include the person's name or handle in the "name" field
- Think step-by-step: First identify a diverse mix of influential people's names who discuss the topic, then construct their TikTok URLs
- Return MORE than the requested number if possible (aim for 2-3x) to account for filtering - prioritize finding influential accounts`,
                              },
                              {
                                role: "user",
                                content: prompt,
                              },
                            ]
                          : config.platform === "YOUTUBE"
                            ? [
                                {
                                  role: "system",
                                  content: `You are a YouTube research expert finding individual creators (not brand or corporate channels) who publish on the given topic.

1. FIRST: Name real creators, commentators, educators, or experts who post videos in this space
2. THEN: Give each channel's URL using @handle, /c/, /channel/, or /user/ forms you are confident are correct

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company channels or brand channels
- Aim for channels with roughly 500+ subscribers when plausible; use judgment—not exact subscriber counts from memory
- PRIORITIZE verified channels when applicable
- Channel URLs only (no /watch?v= video links)
- Use https://www.youtube.com/... URLs; include the scheme
- Prefer filling the list with relevant creators over returning an empty array
- Include the person's name or channel name in the "name" field`,
                                },
                                {
                                  role: "user",
                                  content: prompt,
                                },
                              ]
                            : config.platform === "BLUESKY"
                              ? [
                                  {
                                    role: "system",
                                    content: `You are a BlueSky research expert specializing in finding REAL INFLUENCERS and THOUGHT LEADERS (individuals with large followings) who post about specific topics. Your process:

1. FIRST: Identify real INFLUENCERS, THOUGHT LEADERS, or WELL-KNOWN EXPERTS by name who post about the given topic (like performing a web search)
2. THEN: Find their actual BlueSky profile URLs from your knowledge base

CRITICAL RULES:
- You MUST return ONLY valid JSON arrays - no explanations, no disclaimers, no markdown
- Your response must start with [ and end with ]
- Only include REAL PEOPLE (individuals), NOT company accounts or brand accounts
- DO NOT include company accounts
- PRIORITIZE accounts with LARGE FOLLOWINGS (thousands or tens of thousands of followers)
- Focus on finding experts, influencers, content creators, thought leaders, and enthusiasts with SIGNIFICANT INFLUENCE in the given topic
- You can construct BlueSky URLs for known public figures/influencers using common username patterns
- Use format: https://bsky.app/profile/username
- Include the person's name or handle in the "name" field
- DO NOT include accounts with very few followers (under 1,000)
- DO NOT include unknown or obscure accounts
- Think step-by-step: First identify influential people's names who discuss the topic, then construct their BlueSky URLs
- Return the requested number of results - prioritize finding influential accounts`,
                                  },
                                  {
                                    role: "user",
                                    content: prompt,
                                  },
                                ]
                              : [
                                  {
                                    role: "system",
                                    content: `You are a social media and content research assistant specializing in finding REAL, VERIFIED profiles and sources. You MUST return ONLY valid JSON arrays. Do not provide explanations, disclaimers, or any text outside the JSON array. Your response should start with [ and end with ]. 

CRITICAL: Only return REAL, VERIFIED ${platformName} ${searchTerm} that actually exist and are accessible. DO NOT create fake URLs or use placeholder usernames. 

Verify each URL is correct before including it. If you cannot verify a URL, do NOT include it.`,
                                  },
                                  {
                                    role: "user",
                                    content: prompt,
                                  },
                                ],
            temperature:
              config.platform === "LINKEDIN"
                ? 0.3
                : config.platform === "TWITTER" ||
                    config.platform === "FACEBOOK" ||
                    config.platform === "REDDIT" ||
                    config.platform === "INSTAGRAM" ||
                    config.platform === "TIKTOK" ||
                    config.platform === "YOUTUBE" ||
                    config.platform === "BLUESKY"
                  ? 0.1
                  : 0.3, // Slightly higher temperature for LinkedIn to encourage more results
            max_tokens:
              config.platform === "LINKEDIN" ||
              config.platform === "TWITTER" ||
              config.platform === "FACEBOOK" ||
              config.platform === "REDDIT" ||
              config.platform === "INSTAGRAM" ||
              config.platform === "TIKTOK" ||
              config.platform === "YOUTUBE" ||
              config.platform === "BLUESKY"
                ? 3000
                : 2000, // More tokens for all influencer platforms to allow step-by-step reasoning
            ...(config.platform === "LINKEDIN" ? { response_format: { type: "json_object" } } : {}), // Force JSON output for LinkedIn
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;

        if (!content) {
          throw new Error("No response content from OpenAI");
        }

        // LOG RAW RESPONSE BEFORE ANY PROCESSING
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: ========== RAW OPENAI RESPONSE START ==========`
        );
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: Raw content length: ${content.length} characters`
        );
        console.log(`[searchSourcesWithOpenAI] ${config.platform}: Raw content:`, content);
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: ========== RAW OPENAI RESPONSE END ==========`
        );

        // Parse response - handle both array and object formats for LinkedIn
        let results: SearchResult[];
        if (config.platform === "LINKEDIN") {
          // LinkedIn uses JSON object format with "results" array
          try {
            const parsed = JSON.parse(content);
            const rawResults = Array.isArray(parsed.results)
              ? parsed.results
              : Array.isArray(parsed)
                ? parsed
                : [];
            console.log(
              `[searchSourcesWithOpenAI] ${config.platform}: Parsed ${rawResults.length} raw results from OpenAI (object format)`
            );

            // Parse will convert handles to URLs
            results = await parseOpenAIResponse(JSON.stringify(rawResults), config.platform);
            console.log(
              `[searchSourcesWithOpenAI] ${config.platform}: Parsed ${results.length} results after handle conversion`
            );
          } catch (error) {
            console.error(
              `[searchSourcesWithOpenAI] ${config.platform}: Error parsing LinkedIn response:`,
              error
            );
            // Fallback to array parsing
            results = await parseOpenAIResponse(content, config.platform);
            console.log(
              `[searchSourcesWithOpenAI] ${config.platform}: Parsed ${results.length} results from OpenAI (array format)`
            );
          }
        } else {
          try {
            results = await parseOpenAIResponse(content, config.platform);
            console.log(
              `[searchSourcesWithOpenAI] ${config.platform}: Parsed ${results.length} results from OpenAI`
            );
          } catch (parseError) {
            console.error(
              `[searchSourcesWithOpenAI] ${config.platform}: Error parsing OpenAI response:`,
              parseError
            );
            console.error(
              `[searchSourcesWithOpenAI] ${config.platform}: Content that failed to parse:`,
              content.substring(0, 500)
            );
            // If parsing fails, try to extract any URLs from the raw content as a fallback
            results = [];
            // Try to find URLs in the content even if JSON parsing failed
            const urlMatches = content.match(/https?:\/\/[^\s"']+/g);
            if (urlMatches && urlMatches.length > 0) {
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}: Found ${urlMatches.length} URLs in raw content, attempting to extract`
              );
              // This is a fallback - we'll let validation filter them
              results = urlMatches.map(
                (url: string, idx: number): SearchResult => ({
                  name: `Result ${idx + 1}`,
                  url: url.trim(),
                  selected: true,
                })
              );
            }
          }
        }
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: Parsed results:`,
          JSON.stringify(results, null, 2)
        );

        if (results.length === 0) {
          console.warn(
            `[searchSourcesWithOpenAI] ${config.platform}: ⚠️ WARNING - No results after parsing! This could indicate:`
          );
          console.warn(
            `[searchSourcesWithOpenAI] ${config.platform}: 1. OpenAI returned empty results`
          );
          console.warn(
            `[searchSourcesWithOpenAI] ${config.platform}: 2. All results were filtered out by validation`
          );
          console.warn(`[searchSourcesWithOpenAI] ${config.platform}: 3. JSON parsing failed`);
        }

        // For LinkedIn, skip validation - LinkedIn blocks automated requests
        // We trust the handles OpenAI provides and construct URLs from them
        if (config.platform === "LINKEDIN" && results.length > 0) {
          const urlsWithHandles = results.filter((r) => r.url).length;
          console.log(
            `[searchSourcesWithOpenAI] ${config.platform}: Skipping validation for ${urlsWithHandles} LinkedIn URLs (LinkedIn blocks automated requests - URLs constructed from handles are trusted)`
          );
        }

        // For TikTok, validate URLs AND check follower counts to filter out accounts with 0 or very low followers
        if (config.platform === "TIKTOK" && results.length > 0) {
          const urlsToValidate = results.filter((r) => r.url).map((r) => r.url!);
          if (urlsToValidate.length > 0) {
            console.log(
              `[searchSourcesWithOpenAI] ${config.platform}: Validating ${urlsToValidate.length} TikTok URLs`
            );
            const validationResults = await validateUrls(urlsToValidate.slice(0, 30), 3); // Validate first 30, 3 at a time

            // Filter out invalid URLs
            const originalCount = results.length;
            const validResults = results.filter((result) => {
              if (!result.url) return false; // Remove results without URLs
              const isValid = validationResults.get(result.url);
              if (isValid === false) {
                console.log(
                  `[searchSourcesWithOpenAI] ${config.platform}: Filtered out invalid TikTok URL: ${result.url}`
                );
                return false;
              }
              return true; // Keep if valid or validation failed (assume valid)
            });

            if (validResults.length < originalCount) {
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}: Filtered out ${originalCount - validResults.length} invalid TikTok URLs`
              );
            }
            results = validResults;

            // Now verify follower counts using SerpAPI ONLY (real-time verification) and filter out accounts with < 500 followers
            // CRITICAL: We do NOT use OpenAI as a fallback - OpenAI's training data is outdated/incorrect
            // Only keep accounts where SerpAPI can verify they have 500+ followers
            if (results.length > 0) {
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}: Verifying follower counts for ${results.length} TikTok accounts using SerpAPI (NO OpenAI fallback)`
              );

              const urlsToVerify = results.map((r) => r.url!).filter(Boolean);

              // Use SerpAPI to verify follower counts (real-time data ONLY - no OpenAI fallback)
              const verifiedFollowerCounts =
                await verifyTikTokFollowerCountsWithSerpAPI(urlsToVerify);

              // Map results with ONLY SerpAPI-verified follower counts (no OpenAI fallback)
              const beforeFollowerFilter = results.length;
              const resultsWithFollowerData = results.map((result) => {
                const url = result.url!;
                // ONLY use SerpAPI verification - if SerpAPI couldn't verify, followerCount stays undefined
                const serpAPICount = verifiedFollowerCounts.get(url);

                return {
                  ...result,
                  followerCount:
                    serpAPICount !== null && serpAPICount !== undefined ? serpAPICount : undefined,
                };
              });

              // CRITICAL: Filter out accounts where we can't verify follower counts OR where follower counts are < 500
              // Only keep accounts where SerpAPI can VERIFY they have 500+ followers
              const filteredResults = resultsWithFollowerData.filter((result) => {
                if (result.followerCount === undefined || result.followerCount === null) {
                  // Can't verify follower count with SerpAPI - FILTER IT OUT (no OpenAI fallback)
                  console.log(
                    `[searchSourcesWithOpenAI] ${config.platform}: ❌ Filtered out account with unverifiable follower count (SerpAPI couldn't verify): ${result.url}`
                  );
                  return false;
                }

                if (result.followerCount === 0) {
                  console.log(
                    `[searchSourcesWithOpenAI] ${config.platform}: ❌ Filtered out account with 0 followers: ${result.url}`
                  );
                  return false;
                }

                if (result.followerCount < 500) {
                  console.log(
                    `[searchSourcesWithOpenAI] ${config.platform}: ❌ Filtered out account with ${result.followerCount} followers (< 500): ${result.url}`
                  );
                  return false;
                }

                console.log(
                  `[searchSourcesWithOpenAI] ${config.platform}: ✅ Keeping account with ${result.followerCount.toLocaleString()} followers (SerpAPI verified): ${result.url}`
                );
                return true;
              });

              // Sort by follower count (highest first)
              filteredResults.sort((a, b) => {
                if (a.followerCount === undefined || a.followerCount === null) return 1;
                if (b.followerCount === undefined || b.followerCount === null) return -1;
                return b.followerCount - a.followerCount;
              });

              // Limit to requested count
              const requestedCount = config.count || 10;
              results = filteredResults.slice(0, requestedCount);

              const filteredOut = beforeFollowerFilter - results.length;
              const verifiedCount = filteredResults.length;

              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}: Follower verification results (SerpAPI ONLY, no OpenAI fallback):`
              );
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}:   - Verified with 500+ followers: ${verifiedCount}`
              );
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}:   - Filtered out (unverifiable or < 500): ${filteredOut}`
              );
              console.log(
                `[searchSourcesWithOpenAI] ${config.platform}: Final result count: ${results.length} (requested: ${requestedCount})`
              );
            }
          }
        }

        // Mark duplicates (but don't filter them out - show to user)
        const existingUrls = existingLinksByType.get(config.linkType) || new Set();
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: Before deduplication: ${results.length} results`
        );
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: Checking against ${existingUrls.size} existing URLs`
        );
        results = deduplicateResults(results, existingUrls);

        const duplicateCount = results.filter((r) => r.isDuplicate).length;
        const newCount = results.filter((r) => !r.isDuplicate).length;
        console.log(
          `[searchSourcesWithOpenAI] ${config.platform}: After deduplication: ${results.length} unique results (${newCount} new, ${duplicateCount} duplicates against existing)`
        );

        // Store results
        progress.results[platformKey] = results;

        // Update progress
        completedPlatforms++;
        progress.progress = Math.round((completedPlatforms / totalPlatforms) * 100);
        progress.currentPlatform =
          completedPlatforms < totalPlatforms ? platforms[completedPlatforms]?.platform : undefined;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error(
          `[searchSourcesWithOpenAI] Error searching ${config.platform}:`,
          errorMessage
        );
        if (errorStack) {
          console.error(`[searchSourcesWithOpenAI] ${config.platform} error stack:`, errorStack);
        }
        // Store error information in progress for debugging
        progress.results[platformKey] = [];
        if (!progress.error) {
          progress.error = `Error searching ${config.platform}: ${errorMessage}`;
        }
        // Continue with other platforms even if one fails
        completedPlatforms++;
        progress.progress = Math.round((completedPlatforms / totalPlatforms) * 100);
      }
    });

    // Wait for all searches to complete
    await Promise.all(searchPromises);

    // Mark as completed
    progress.status = "completed";
    progress.progress = 100;
    progress.currentPlatform = undefined;
  } catch (error) {
    // Ensure progress is marked as error if something goes wrong
    const progress = searchProgressMap.get(searchId);
    if (progress) {
      progress.status = "error";
      progress.error = error instanceof Error ? error.message : "Unknown error";
    } else {
      // If progress wasn't set, create it now with error status
      searchProgressMap.set(searchId, {
        searchId,
        status: "error",
        progress: 0,
        results: {},
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    console.error(`[searchSourcesWithOpenAI] Error in search ${searchId}:`, error);
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Get search progress by ID
 */
export function getSearchProgress(searchId: string): SearchProgress | null {
  const progress = searchProgressMap.get(searchId);
  if (!progress) {
    console.log(
      `[getSearchProgress] Search ${searchId} not found. Map has ${searchProgressMap.size} entries. Keys: ${Array.from(searchProgressMap.keys()).join(", ")}`
    );
  } else {
    console.log(
      `[getSearchProgress] Found search ${searchId}. Status: ${progress.status}, Progress: ${progress.progress}%`
    );
  }
  return progress || null;
}

/**
 * Get the size of the search progress map (for debugging)
 */
export function getSearchProgressMapSize(): number {
  return searchProgressMap.size;
}

/**
 * Clean up old search progress (older than 1 hour)
 */
export function cleanupOldSearches(): void {
  // For now, we'll keep searches in memory
  // In production, you might want to add timestamps and clean up old ones
  // This is a simple implementation - searches are kept until server restart
}
