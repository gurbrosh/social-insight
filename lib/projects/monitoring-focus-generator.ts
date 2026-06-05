/**
 * Auto-generate monitoring focus string from keywords and brands
 */

export interface MonitoringFocusInput {
  keywords: string[];
  brands: string[];
}

/**
 * Generate monitoring focus description from keywords and brands
 * Format: "Searching and learning about [brand1], [brand2], [brand3] and topics relating to [keyword1], [keyword2], [keyword3]"
 */
export function generateMonitoringFocus(input: MonitoringFocusInput): string {
  const { keywords, brands } = input;

  const parts: string[] = [];

  // Add brands section
  if (brands.length > 0) {
    if (brands.length === 1) {
      parts.push(`Searching and learning about ${brands[0]}`);
    } else if (brands.length === 2) {
      parts.push(`Searching and learning about ${brands[0]} and ${brands[1]}`);
    } else if (brands.length <= 5) {
      const lastBrand = brands[brands.length - 1];
      const otherBrands = brands.slice(0, -1).join(", ");
      parts.push(`Searching and learning about ${otherBrands}, and ${lastBrand}`);
    } else {
      const firstFew = brands.slice(0, 3).join(", ");
      parts.push(`Searching and learning about ${firstFew} and ${brands.length - 3} other brands`);
    }
  }

  // Add keywords section
  if (keywords.length > 0) {
    if (brands.length === 0) {
      // No brands, start with "Searching and learning about topics"
      if (keywords.length === 1) {
        parts.push(`Searching and learning about topics relating to ${keywords[0]}`);
      } else if (keywords.length === 2) {
        parts.push(
          `Searching and learning about topics relating to ${keywords[0]} and ${keywords[1]}`
        );
      } else if (keywords.length <= 5) {
        const lastKeyword = keywords[keywords.length - 1];
        const otherKeywords = keywords.slice(0, -1).join(", ");
        parts.push(
          `Searching and learning about topics relating to ${otherKeywords}, and ${lastKeyword}`
        );
      } else {
        const firstFew = keywords.slice(0, 3).join(", ");
        parts.push(
          `Searching and learning about topics relating to ${firstFew} and ${keywords.length - 3} other keywords`
        );
      }
    } else {
      // Brands exist, add "and topics relating to"
      if (keywords.length === 1) {
        parts.push(`and topics relating to ${keywords[0]}`);
      } else if (keywords.length === 2) {
        parts.push(`and topics relating to ${keywords[0]} and ${keywords[1]}`);
      } else if (keywords.length <= 5) {
        const lastKeyword = keywords[keywords.length - 1];
        const otherKeywords = keywords.slice(0, -1).join(", ");
        parts.push(`and topics relating to ${otherKeywords}, and ${lastKeyword}`);
      } else {
        const firstFew = keywords.slice(0, 3).join(", ");
        parts.push(`and topics relating to ${firstFew} and ${keywords.length - 3} other keywords`);
      }
    }
  }

  // Fallback if both are empty (shouldn't happen, but handle it)
  if (parts.length === 0) {
    return "Monitoring social media for relevant content";
  }

  return parts.join(" ");
}
