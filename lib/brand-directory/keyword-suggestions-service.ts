import { prisma } from "@/lib/prisma";

export interface KeywordSuggestion {
  keyword: string;
  source: "brand_keyword" | "taxonomy";
  relevanceScore: number;
  matchType: "exact" | "contains" | "fuzzy";
}

/**
 * Suggest keywords based on user-provided keywords and/or selected brands
 * Searches both BrandKeyword table and BusinessTaxonomy sub-subcategories
 * If brandIds are provided, extracts keywords from those brands
 */
export async function suggestKeywords(
  userKeywords: string[] = [],
  excludeKeywords: string[] = [],
  brandIds?: string[],
  limit: number = 20
): Promise<KeywordSuggestion[]> {
  // If no keywords and no brands, return empty
  if (userKeywords.length === 0 && (!brandIds || brandIds.length === 0)) {
    return [];
  }

  // If brands are provided but no keywords, extract keywords from brands
  let effectiveKeywords = [...userKeywords];
  if (brandIds && brandIds.length > 0 && userKeywords.length === 0) {
    // Get keywords from selected brands
    const brandsWithKeywords = await prisma.brand.findMany({
      where: {
        id: { in: brandIds },
        deleted_at: null,
      },
      include: {
        keywords: {
          where: { deleted_at: null },
          select: {
            keyword: true,
          },
        },
      },
    });

    // Extract unique keywords from brands
    const brandKeywordsSet = new Set<string>();
    brandsWithKeywords.forEach((brand) => {
      brand.keywords.forEach((kw) => {
        brandKeywordsSet.add(kw.keyword.toLowerCase().trim());
      });
    });

    effectiveKeywords = Array.from(brandKeywordsSet);
  }

  const suggestions = new Map<string, KeywordSuggestion>();
  const excludeSet = new Set(excludeKeywords.map((k) => k.toLowerCase().trim()));

  // Normalize effective keywords for matching
  const normalizedUserKeywords = effectiveKeywords.map((k) => k.toLowerCase().trim());

  // 1. Search BrandKeyword table for similar keywords
  const brandKeywords = await prisma.brandKeyword.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      keyword: true,
    },
    distinct: ["keyword"],
  });

  // Score and match brand keywords
  for (const bk of brandKeywords) {
    const keywordLower = bk.keyword.toLowerCase().trim();

    // Skip if already excluded or already in user keywords
    if (excludeSet.has(keywordLower) || normalizedUserKeywords.includes(keywordLower)) {
      continue;
    }

    let relevanceScore = 0;
    let matchType: "exact" | "contains" | "fuzzy" = "fuzzy";

    // Check against each user keyword
    for (const userKw of normalizedUserKeywords) {
      const userWords = userKw.split(/\s+/).filter((w) => w.length > 0);
      const keywordWords = keywordLower.split(/\s+/).filter((w) => w.length > 0);
      const isMultiWord = userWords.length > 1;

      // Exact match (shouldn't happen due to exclude check, but handle it)
      if (keywordLower === userKw) {
        relevanceScore += 100;
        matchType = "exact";
        break;
      }

      // For multi-word keywords, require full phrase match or meaningful word matches
      if (isMultiWord) {
        // Full phrase contains match - only if suggested keyword contains the FULL user keyword phrase
        // OR user keyword contains the FULL suggested keyword phrase (not just a word)
        if (keywordLower.includes(userKw)) {
          // Suggested keyword contains full user keyword phrase - strong match
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        } else if (userKw.includes(keywordLower) && keywordWords.length <= userWords.length) {
          // User keyword contains full suggested keyword phrase (and suggested isn't longer) - also strong match
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        } else {
          // Multi-word matching: check for word matches
          const commonWords = userWords.filter((w) => keywordWords.includes(w));

          if (commonWords.length >= 2) {
            // Multiple words match - excellent relevance
            relevanceScore += commonWords.length * 20;
            if (matchType === "fuzzy") {
              matchType = "fuzzy";
            }
          } else if (commonWords.length === 1) {
            // Single word match - only allow if it's a meaningful/domain-specific word
            // Filter out generic words like "commercial", "business", "market", etc.
            const genericWords = new Set([
              "commercial",
              "business",
              "market",
              "industry",
              "sector",
              "service",
              "services",
              "product",
              "products",
              "company",
              "companies",
              "enterprise",
              "enterprises",
            ]);
            const matchedWord = commonWords[0];

            if (!genericWords.has(matchedWord)) {
              // Meaningful word match (domain terms) - moderate relevance
              relevanceScore += 25;
              if (matchType === "fuzzy") {
                matchType = "fuzzy";
              }
            }
            // If it's a generic word, don't add score (filtered out)
          }
        }
      } else {
        // Single-word keyword - allow contains match and single word matches
        if (keywordLower.includes(userKw) || userKw.includes(keywordLower)) {
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        }

        // Single word fuzzy match
        const commonWords = userWords.filter((w) => keywordWords.includes(w));
        if (commonWords.length > 0) {
          relevanceScore += commonWords.length * 10;
          if (matchType === "fuzzy") {
            matchType = "fuzzy";
          }
        }
      }
    }

    if (relevanceScore > 0) {
      const existing = suggestions.get(keywordLower);
      // Cap relevance score at 100
      const cappedScore = Math.min(100, relevanceScore);
      if (!existing || existing.relevanceScore < cappedScore) {
        suggestions.set(keywordLower, {
          keyword: bk.keyword, // Use original case
          source: "brand_keyword",
          relevanceScore: cappedScore,
          matchType,
        });
      }
    }
  }

  // 2. Search BusinessTaxonomy sub-subcategories for similar terms
  const taxonomies = await prisma.businessTaxonomy.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      sub_subcategory: true,
      category: true,
      subcategory: true,
    },
  });

  // Score and match taxonomy terms
  for (const tax of taxonomies) {
    const subSubcategoryLower = tax.sub_subcategory.toLowerCase().trim();

    // Skip if already excluded or already in user keywords
    if (
      excludeSet.has(subSubcategoryLower) ||
      normalizedUserKeywords.includes(subSubcategoryLower)
    ) {
      continue;
    }

    // Skip very short taxonomy terms (≤3 characters) unless they're exact matches
    // These are often acronyms that can cause false positives (e.g., "CI" matching unrelated terms)
    if (subSubcategoryLower.length <= 3) {
      // Only include if it's an exact match with a user keyword (case-insensitive)
      const isExactMatch = normalizedUserKeywords.some(
        (kw) => kw.toLowerCase().trim() === subSubcategoryLower
      );
      if (!isExactMatch) {
        continue; // Skip short acronyms that aren't exact matches
      }
    }

    let relevanceScore = 0;
    let matchType: "exact" | "contains" | "fuzzy" = "fuzzy";

    // Check against each user keyword
    for (const userKw of normalizedUserKeywords) {
      const userWords = userKw.split(/\s+/).filter((w) => w.length > 0);
      const taxonomyWords = subSubcategoryLower.split(/\s+/).filter((w) => w.length > 0);
      const isMultiWord = userWords.length > 1;

      // Exact match
      if (subSubcategoryLower === userKw) {
        relevanceScore += 100;
        matchType = "exact";
        break;
      }

      // For multi-word keywords, require full phrase match or meaningful word matches
      if (isMultiWord) {
        // Full phrase contains match - only if taxonomy contains the FULL user keyword phrase
        // OR user keyword contains the FULL taxonomy phrase (not just a word)
        if (subSubcategoryLower.includes(userKw)) {
          // Taxonomy contains full user keyword phrase - strong match
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        } else if (
          userKw.includes(subSubcategoryLower) &&
          taxonomyWords.length <= userWords.length
        ) {
          // User keyword contains full taxonomy phrase (and taxonomy isn't longer) - also strong match
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        } else {
          // Multi-word matching: check for word matches
          const commonWords = userWords.filter((w) => taxonomyWords.includes(w));

          if (commonWords.length >= 2) {
            // Multiple words match - excellent relevance
            relevanceScore += commonWords.length * 20;
          } else if (commonWords.length === 1) {
            // Single word match - only allow if it's a meaningful/domain-specific word
            // Filter out generic words like "commercial", "business", "market", etc.
            const genericWords = new Set([
              "commercial",
              "business",
              "market",
              "industry",
              "sector",
              "service",
              "services",
              "product",
              "products",
              "company",
              "companies",
              "enterprise",
              "enterprises",
            ]);
            const matchedWord = commonWords[0];

            if (!genericWords.has(matchedWord)) {
              // Meaningful word match (domain terms) - moderate relevance
              relevanceScore += 25;
            }
            // If it's a generic word, don't add score (filtered out)
          }
        }
      } else {
        // Single-word keyword - allow contains match and single word matches
        if (subSubcategoryLower.includes(userKw) || userKw.includes(subSubcategoryLower)) {
          relevanceScore += 50;
          matchType = matchType === "fuzzy" ? "contains" : matchType;
        }

        // Single word fuzzy match
        const commonWords = userWords.filter((w) => taxonomyWords.includes(w));
        if (commonWords.length > 0) {
          relevanceScore += commonWords.length * 10;
        }
      }
    }

    if (relevanceScore > 0) {
      const existing = suggestions.get(subSubcategoryLower);
      // Cap relevance score at 100
      const cappedScore = Math.min(100, relevanceScore);
      if (!existing || existing.relevanceScore < cappedScore) {
        suggestions.set(subSubcategoryLower, {
          keyword: tax.sub_subcategory, // Use original case
          source: "taxonomy",
          relevanceScore: cappedScore,
          matchType,
        });
      }
    }
  }

  // Sort by relevance score (highest first) and return top results
  return Array.from(suggestions.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}
