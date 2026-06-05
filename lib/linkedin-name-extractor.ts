/**
 * Shared utility for extracting names from LinkedIn profile URLs
 * Used across the project for consistent name extraction
 *
 * This module re-exports the name extraction functions from taxonomy-source-search-service
 * so they can be used throughout the project with the improved 926-name database.
 */

export {
  extractProfileName,
  extractNameFromUrl,
} from "./brand-directory/taxonomy-source-search-service";

/**
 * Convenience function: Extract name from LinkedIn profile URL
 * Uses multiple methods: SerpAPI data, HTML parsing, URL extraction, OpenAI fallback
 *
 * @param profileUrl - LinkedIn profile URL
 * @param serpAPITitle - Optional SerpAPI title (if available)
 * @param serpAPISnippet - Optional SerpAPI snippet (if available)
 * @returns Extracted name or null
 */
export async function extractLinkedInProfileName(
  profileUrl: string,
  serpAPITitle?: string,
  serpAPISnippet?: string
): Promise<string | null> {
  const { extractProfileName } = await import("./brand-directory/taxonomy-source-search-service");
  return extractProfileName(profileUrl, serpAPITitle, serpAPISnippet);
}

/**
 * Convenience function: Extract name from LinkedIn URL slug only (fast, no network calls)
 * Useful when you only have the URL and don't have SerpAPI data
 *
 * @param profileUrl - LinkedIn profile URL
 * @returns Extracted name or null
 */
export function extractNameFromLinkedInUrl(profileUrl: string): string | null {
  const { extractNameFromUrl } = require("./brand-directory/taxonomy-source-search-service");
  return extractNameFromUrl(profileUrl);
}
