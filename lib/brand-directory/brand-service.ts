import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type BrandStage = "ESTABLISHED" | "EMERGING" | "SMALL";
import { DiscoveredBrand } from "./openai-service";
import { generateId } from "@/lib/utils/ulid";
import { syncRedditLinksToBrands } from "./reddit-links-service";
import { normalizeKeywords, normalizeKeyword } from "./keyword-utils";
import { validateBrandData } from "./brand-validation";

export interface BrandFilters {
  taxonomyId?: string;
  brandStage?: BrandStage;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: "company_name" | "brand_name" | "category" | "brand_stage";
  sortOrder?: "asc" | "desc";
}

export interface BrandWithTaxonomy {
  id: string;
  company_name: string;
  brand_name: string;
  brand_stage: BrandStage;
  website_url: string | null;
  careers_url: string | null;
  /** Optional for backward compatibility with Prisma result types. */
  blog_news_url?: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  discord_url: string | null;
  created_at: Date;
  updated_at: Date;
  businessTaxonomy: {
    id: string;
    category: string;
    subcategory: string;
    sub_subcategory: string;
  };
  keywords: Array<{
    id: string;
    keyword: string;
  }>;
  redditLinks?: Array<{
    id: string;
    url: string;
  }>;
}

/**
 * Check if a brand already exists (duplicate check)
 * Returns existing brand if found, null otherwise
 * Checks for exact matches of company_name OR brand_name (case-insensitive)
 */
export async function checkForDuplicateBrand(
  companyName: string,
  brandName: string
): Promise<BrandWithTaxonomy | null> {
  const companyLower = companyName.toLowerCase().trim();
  const brandLower = brandName.toLowerCase().trim();

  // Fetch all brands and check for exact matches (case-insensitive)
  // SQLite doesn't have great case-insensitive comparison, so we fetch and filter
  const candidates = await prisma.brand.findMany({
    where: {
      deleted_at: null,
      OR: [
        // Use contains as a first filter (will match many, but we'll filter precisely)
        { company_name: { contains: companyLower } },
        { brand_name: { contains: brandLower } },
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
      keywords: {
        where: { deleted_at: null },
        select: {
          id: true,
          keyword: true,
        },
      },
    },
  });

  // Check for exact match (case-insensitive)
  const duplicate = candidates.find((brand) => {
    const existingCompanyLower = brand.company_name.toLowerCase().trim();
    const existingBrandLower = brand.brand_name.toLowerCase().trim();

    // Match if company_name OR brand_name matches exactly (case-insensitive)
    return existingCompanyLower === companyLower || existingBrandLower === brandLower;
  });

  return duplicate || null;
}

/**
 * Create a brand with keywords in a transaction
 */
export async function createBrandWithKeywords(
  brandData: Omit<DiscoveredBrand, "keywords"> & { business_taxonomy_id: string },
  keywords: string[]
): Promise<BrandWithTaxonomy> {
  // Validate brand data for consistency
  // Note: We don't block on warnings here - they should be handled in the UI
  // Only block on actual errors (non-typo errors)
  const validation = validateBrandData({
    brand_name: brandData.brand_name,
    company_name: brandData.company_name,
    website_url: brandData.website_url,
    linkedin_url: brandData.linkedin_url,
    facebook_url: brandData.facebook_url,
    x_url: brandData.x_url,
    instagram_url: brandData.instagram_url,
    tiktok_url: brandData.tiktok_url,
    youtube_url: brandData.youtube_url,
    discord_url: brandData.discord_url,
    blog_news_url: brandData.blog_news_url,
  });

  // Log warnings (but don't block)
  if (validation.warnings.length > 0) {
    console.warn(
      `[createBrandWithKeywords] Validation warnings for "${brandData.brand_name}":`,
      validation.warnings
    );
  }

  // Only block on actual errors (not typo warnings)
  if (validation.errors.length > 0) {
    throw new Error(`Brand validation failed: ${validation.errors.join("; ")}`);
  }

  // Check for duplicate before creating
  const duplicate = await checkForDuplicateBrand(brandData.company_name, brandData.brand_name);

  if (duplicate) {
    throw new Error(`Brand already exists: "${brandData.company_name}" (${brandData.brand_name})`);
  }

  const brandWithRelations = await prisma.$transaction(async (tx) => {
    // Get taxonomy to extract sub-subcategory
    const taxonomy = await tx.businessTaxonomy.findUnique({
      where: { id: brandData.business_taxonomy_id },
    });

    // Create brand
    const brand = await tx.brand.create({
      data: {
        business_taxonomy_id: brandData.business_taxonomy_id,
        company_name: brandData.company_name,
        brand_name: brandData.brand_name,
        brand_stage: brandData.brand_stage,
        website_url: brandData.website_url,
        careers_url: brandData.careers_url,
        blog_news_url: brandData.blog_news_url,
        linkedin_url: brandData.linkedin_url,
        facebook_url: brandData.facebook_url,
        x_url: brandData.x_url,
        instagram_url: brandData.instagram_url,
        tiktok_url: brandData.tiktok_url,
        youtube_url: brandData.youtube_url,
        discord_url: brandData.discord_url,
      } as Prisma.BrandUncheckedCreateInput,
    });

    // Normalize all keywords according to social media best practices
    const allKeywords = new Set<string>();

    // Add sub-subcategory keywords (split if needed)
    if (taxonomy) {
      const subSubcategoryKeywords = normalizeKeyword(taxonomy.sub_subcategory);
      subSubcategoryKeywords.forEach((kw) => allKeywords.add(kw));
    }

    // Normalize and add provided keywords
    const normalizedProvided = normalizeKeywords(keywords);
    normalizedProvided.forEach((kw) => allKeywords.add(kw));

    // Create keywords (handle duplicates manually)
    if (allKeywords.size > 0) {
      for (const keyword of allKeywords) {
        try {
          await tx.brandKeyword.create({
            data: {
              id: generateId(), // Explicitly generate ULID
              brand_id: brand.id,
              keyword,
            },
          });
        } catch (error: any) {
          // Skip if duplicate (unique constraint violation)
          if (error.code !== "P2002") {
            console.error(`[createBrandWithKeywords] Error creating keyword "${keyword}":`, error);
            throw error;
          }
        }
      }
    }

    // Return brand with relations
    const brandWithRelations = await tx.brand.findUniqueOrThrow({
      where: { id: brand.id },
      include: {
        businessTaxonomy: {
          select: {
            id: true,
            category: true,
            subcategory: true,
            sub_subcategory: true,
          },
        },
        keywords: {
          where: { deleted_at: null },
          select: {
            id: true,
            keyword: true,
          },
        },
      },
    });

    return brandWithRelations;
  });

  // Sync Reddit links from taxonomy to this brand AFTER transaction completes
  // This ensures the brand exists before we try to sync links
  // The sync function will find all brands under this taxonomy and add applicable Reddit links
  try {
    const syncedCount = await syncRedditLinksToBrands(brandData.business_taxonomy_id);
    if (syncedCount > 0) {
      console.log(
        `[createBrandWithKeywords] Synced Reddit links from taxonomy to ${syncedCount} brand(s) including "${brandData.brand_name}"`
      );
    }
  } catch (error) {
    // Don't fail brand creation if Reddit link sync fails - just log the error
    console.error(
      `[createBrandWithKeywords] Error syncing Reddit links for brand "${brandData.brand_name}" (taxonomy: ${brandData.business_taxonomy_id}):`,
      error
    );
  }

  // Return the brand (Reddit links will be included in subsequent queries via include)
  return brandWithRelations;
}

/**
 * Find brands by taxonomy with filters
 *
 * NOTE: This searches ALL brands in the database - brands are shared across all projects.
 * No user or project restrictions are applied.
 */
export async function findBrandsByTaxonomy(
  filters: BrandFilters
): Promise<{ brands: BrandWithTaxonomy[]; total: number }> {
  const where: any = {
    deleted_at: null,
  };

  if (filters.taxonomyId) {
    where.business_taxonomy_id = filters.taxonomyId;
  }

  if (filters.brandStage) {
    where.brand_stage = filters.brandStage;
  }

  // Handle search: for fuzzy matching, we'll filter in memory after fetching
  // Don't add search to where clause - we'll handle it in memory for better fuzzy matching
  const searchLower = filters.search?.toLowerCase().trim() || "";
  const searchWords = searchLower.split(/\s+/).filter((w) => w.length > 0);
  const hasSearch = searchWords.length > 0;

  // Build orderBy clause
  let orderBy: any = { created_at: "desc" }; // Default
  if (filters.sortBy) {
    if (filters.sortBy === "category") {
      // For category sorting, sort by taxonomy ID which groups brands by taxonomy
      // This effectively sorts by category/subcategory/sub-subcategory
      orderBy = {
        business_taxonomy_id: filters.sortOrder || "asc",
      };
    } else {
      orderBy = {
        [filters.sortBy]: filters.sortOrder || "asc",
      };
    }
  }

  // Build base query
  const baseQuery = {
    where,
    include: {
      businessTaxonomy: {
        select: {
          id: true,
          category: true,
          subcategory: true,
          sub_subcategory: true,
        },
      },
      keywords: {
        where: { deleted_at: null },
        select: {
          id: true,
          keyword: true,
        },
      },
      redditLinks: {
        where: { deleted_at: null },
        select: {
          id: true,
          url: true,
        },
        orderBy: { created_at: Prisma.SortOrder.asc },
      },
    },
    orderBy,
  };

  // Handle search: fetch brands and filter in memory for fuzzy matching
  if (hasSearch) {
    // Fetch all brands matching taxonomy/stage filters, then filter by search
    const allBrands = await prisma.brand.findMany({
      ...baseQuery,
    });

    // Filter brands where all search words appear in company_name or brand_name (case-insensitive)
    const filteredBrands = allBrands.filter((brand) => {
      const companyNameLower = brand.company_name.toLowerCase();
      const brandNameLower = brand.brand_name.toLowerCase();

      // Check if all words appear in either company_name or brand_name
      return searchWords.every((word) => {
        return companyNameLower.includes(word) || brandNameLower.includes(word);
      });
    });

    // Apply pagination after filtering
    const total = filteredBrands.length;
    const paginatedBrands = filteredBrands.slice(
      filters.offset || 0,
      (filters.offset || 0) + (filters.limit || 50)
    );

    return { brands: paginatedBrands, total };
  }

  // No search: use standard query with pagination
  const [brands, total] = await Promise.all([
    prisma.brand.findMany({
      ...baseQuery,
      take: filters.limit || 50,
      skip: filters.offset || 0,
    }),
    prisma.brand.count({ where }),
  ]);

  return { brands, total };
}

/**
 * Find brands by keywords
 *
 * NOTE: This searches ALL brands in the database - brands are shared across all projects.
 * No user or project restrictions are applied.
 */
export async function findBrandsByKeywords(
  keywords: string[],
  limit: number = 50
): Promise<BrandWithTaxonomy[]> {
  if (keywords.length === 0) {
    return [];
  }

  const normalizedKeywords = keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length > 0);

  if (normalizedKeywords.length === 0) {
    return [];
  }

  // Find brands that have keywords matching any of the provided keywords (partial match)
  // Use OR conditions to match if keyword contains search term OR search term contains keyword
  const brandKeywords = await prisma.brandKeyword.findMany({
    where: {
      deleted_at: null,
      OR: normalizedKeywords.map((keyword) => ({
        keyword: {
          contains: keyword,
        },
      })),
    },
    select: {
      brand_id: true,
      keyword: true,
    },
  });

  // Also search by brand name for better matching (case-insensitive)
  // SQLite doesn't support mode: "insensitive", so we fetch and filter in memory
  const allBrandsForNameSearch = await prisma.brand.findMany({
    where: {
      deleted_at: null,
      OR: [
        ...normalizedKeywords.map((keyword) => ({
          brand_name: {
            contains: keyword,
          },
        })),
        ...normalizedKeywords.map((keyword) => ({
          company_name: {
            contains: keyword,
          },
        })),
      ],
    },
    select: {
      id: true,
      brand_name: true,
      company_name: true,
    },
  });

  // Filter for case-insensitive matching
  const brandsByName = allBrandsForNameSearch.filter((brand) => {
    const brandNameLower = brand.brand_name.toLowerCase();
    const companyNameLower = (brand.company_name || "").toLowerCase();
    return normalizedKeywords.some(
      (keyword) =>
        brandNameLower.includes(keyword) ||
        companyNameLower.includes(keyword) ||
        keyword.includes(brandNameLower) ||
        keyword.includes(companyNameLower)
    );
  });

  // ALSO search by taxonomy fields (category, subcategory, sub_subcategory)
  // This is critical - keywords might match taxonomy terms, not just brand keywords
  const allTaxonomies = await prisma.businessTaxonomy.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
  });

  // Find taxonomies that match any of the keywords
  // Use flexible word-level matching, not just substring matching
  const matchingTaxonomyIds = new Set<string>();
  for (const taxonomy of allTaxonomies) {
    const categoryLower = (taxonomy.category || "").toLowerCase();
    const subcategoryLower = (taxonomy.subcategory || "").toLowerCase();
    const subSubcategoryLower = (taxonomy.sub_subcategory || "").toLowerCase();

    // Extract words from taxonomy fields
    const taxonomyWords = new Set<string>();
    [categoryLower, subcategoryLower, subSubcategoryLower].forEach((field) => {
      if (field) {
        field.split(/\s+/).forEach((word) => {
          if (word.length > 0) {
            taxonomyWords.add(word);
          }
        });
      }
    });

    // Match if keywords share words with taxonomy - require coherent matches across keywords
    // For multiple keywords, require that at least one multi-word keyword matches well,
    // or that multiple keywords together create a coherent match
    const keywordMatches = normalizedKeywords.map((keyword) => {
      const keywordLower = keyword.toLowerCase();
      const keywordWords = keywordLower.split(/\s+/).filter((w) => w.length > 0);
      const isMultiWord = keywordWords.length > 1;

      // Check direct substring matches - only if taxonomy CONTAINS the full keyword phrase
      // For multi-word keywords, require the taxonomy to contain the full phrase (not just a word)
      if (isMultiWord) {
        // For multi-word keywords, only match if taxonomy contains the FULL phrase
        if (
          categoryLower.includes(keywordLower) ||
          subcategoryLower.includes(keywordLower) ||
          subSubcategoryLower.includes(keywordLower)
        ) {
          return { matched: true, strength: "strong" };
        }
        // Don't check reverse (keyword contains taxonomy) for multi-word - too permissive
      } else {
        // Single-word keywords - bidirectional substring match
        if (
          categoryLower.includes(keywordLower) ||
          keywordLower.includes(categoryLower) ||
          subcategoryLower.includes(keywordLower) ||
          keywordLower.includes(subcategoryLower) ||
          subSubcategoryLower.includes(keywordLower) ||
          keywordLower.includes(subSubcategoryLower)
        ) {
          return { matched: true, strength: "strong" };
        }
      }

      // Check word-level matches - require words to match directly in taxonomy fields
      // For multi-word keywords, both words must match in the SAME taxonomy to ensure context
      const matchingWords = keywordWords.filter((kw) => {
        // Direct word match in taxonomy fields
        if (
          taxonomyWords.has(kw) ||
          categoryLower.includes(kw) ||
          subcategoryLower.includes(kw) ||
          subSubcategoryLower.includes(kw)
        ) {
          return true;
        }
        return false;
      });

      // For multi-word keywords, require at least 2 words to match DIRECTLY in taxonomy
      // This ensures both words appear together, providing context
      if (isMultiWord) {
        // Require 2+ words to match directly in this taxonomy
        if (matchingWords.length >= 2) {
          return { matched: true, strength: "strong" };
        }
        // Single word match from multi-word keyword is not enough - too generic
        return { matched: false, strength: "none" };
      } else {
        // Single-word keyword - check direct match
        if (matchingWords.length > 0) {
          return { matched: true, strength: "weak" };
        }
        // For single-word, also check if taxonomy word appears in keyword (reverse match)
        const taxonomyWordsArray = Array.from(taxonomyWords);
        if (
          taxonomyWordsArray.some((tw) => keywordLower.includes(tw) || tw.includes(keywordLower))
        ) {
          return { matched: true, strength: "weak" };
        }
      }

      return { matched: false, strength: "none" };
    });

    // For brand suggestions, ONLY accept strong matches (multi-word keywords with 2+ words matching)
    // This prevents single generic words from matching unrelated taxonomies
    const strongMatches = keywordMatches.filter((m) => m.matched && m.strength === "strong");

    // Only include if we have at least one strong match
    // Ignore weak matches entirely for brand suggestions (too noisy)
    if (strongMatches.length > 0) {
      matchingTaxonomyIds.add(taxonomy.id);
    }

    // Weak matches are ignored - too generic and cause false positives
  }

  // Find brands in matching taxonomies
  const brandsByTaxonomy =
    matchingTaxonomyIds.size > 0
      ? await prisma.brand.findMany({
          where: {
            deleted_at: null,
            business_taxonomy_id: { in: Array.from(matchingTaxonomyIds) },
          },
          select: {
            id: true,
          },
        })
      : [];

  console.log(`[findBrandsByKeywords] Direct search results:`, {
    keywords: normalizedKeywords,
    brandKeywordsMatches: brandKeywords.length,
    brandNamesMatches: brandsByName.length,
    taxonomyMatches: matchingTaxonomyIds.size,
    brandsByTaxonomy: brandsByTaxonomy.length,
  });

  // Combine brand IDs from keyword matches, name matches, and taxonomy matches
  const brandIdsFromKeywords = new Set(brandKeywords.map((bk) => bk.brand_id));
  const brandIdsFromNames = new Set(brandsByName.map((b) => b.id));
  const brandIdsFromTaxonomy = new Set(brandsByTaxonomy.map((b) => b.id));
  const allBrandIds = Array.from(
    new Set([...brandIdsFromKeywords, ...brandIdsFromNames, ...brandIdsFromTaxonomy])
  );

  console.log(`[findBrandsByKeywords] Combined brand IDs: ${allBrandIds.length} total`);

  // If we found brands with direct matching, return them
  if (allBrandIds.length > 0) {
    return await prisma.brand.findMany({
      where: {
        id: { in: allBrandIds },
        deleted_at: null,
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
        keywords: {
          where: { deleted_at: null },
          select: {
            id: true,
            keyword: true,
          },
        },
      },
      take: limit,
    });
  }

  // No direct matches found - use OpenAI to generate synonyms and try again
  console.log(`[findBrandsByKeywords] No direct matches, generating synonyms with OpenAI...`);

  if (!process.env.OPENAI_API_KEY) {
    console.log(
      `[findBrandsByKeywords] OpenAI API key not configured, skipping synonym generation`
    );
    return [];
  }

  try {
    const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const synonymsPrompt = `Given these keywords: ${normalizedKeywords.join(", ")}

Generate 10-15 synonyms and related terms that would help find relevant business categories. Include:
- Alternative terms for the same concept
- Related industry/business terms
- Broader and narrower terms
- Common variations

Return ONLY a JSON object with a "synonyms" array of strings, no other text:
{"synonyms": ["term1", "term2", "term3", ...]}`;

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a business taxonomy expert. Generate synonyms and related terms for business keywords to help match them to business categories.",
          },
          {
            role: "user",
            content: synonymsPrompt,
          },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (content) {
        const parsed = JSON.parse(content);
        const synonyms = Array.isArray(parsed.synonyms) ? parsed.synonyms : [];

        console.log(
          `[findBrandsByKeywords] Generated ${synonyms.length} synonyms:`,
          synonyms.slice(0, 10)
        );

        // Combine original keywords with synonyms and try matching again
        const expandedKeywords = [
          ...normalizedKeywords,
          ...synonyms.map((s: string) => s.toLowerCase().trim()),
        ].filter((k) => k.length > 0);

        // Try matching synonyms against taxonomy (use simpler matching for synonyms)
        const synonymMatchingTaxonomyIds = new Set<string>();
        for (const taxonomy of allTaxonomies) {
          const categoryLower = (taxonomy.category || "").toLowerCase();
          const subcategoryLower = (taxonomy.subcategory || "").toLowerCase();
          const subSubcategoryLower = (taxonomy.sub_subcategory || "").toLowerCase();

          // Check if any synonym matches taxonomy fields
          const synonymMatches = expandedKeywords.some((synonym) => {
            const synonymLower = synonym.toLowerCase();
            return (
              categoryLower.includes(synonymLower) ||
              synonymLower.includes(categoryLower) ||
              subcategoryLower.includes(synonymLower) ||
              synonymLower.includes(subcategoryLower) ||
              subSubcategoryLower.includes(synonymLower) ||
              synonymLower.includes(subSubcategoryLower)
            );
          });

          if (synonymMatches) {
            synonymMatchingTaxonomyIds.add(taxonomy.id);
          }
        }

        if (synonymMatchingTaxonomyIds.size > 0) {
          console.log(
            `[findBrandsByKeywords] Found ${synonymMatchingTaxonomyIds.size} taxonomies matching synonyms`
          );

          const brandsBySynonyms = await prisma.brand.findMany({
            where: {
              deleted_at: null,
              business_taxonomy_id: { in: Array.from(synonymMatchingTaxonomyIds) },
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
              keywords: {
                where: { deleted_at: null },
                select: {
                  id: true,
                  keyword: true,
                },
              },
            },
            take: limit,
          });

          return brandsBySynonyms;
        }
      }
    }
  } catch (error) {
    console.error(`[findBrandsByKeywords] Error generating synonyms:`, error);
  }

  // No matches found even with synonyms
  return [];

  return await prisma.brand.findMany({
    where: {
      id: { in: allBrandIds },
      deleted_at: null,
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
      keywords: {
        where: { deleted_at: null },
        select: {
          id: true,
          keyword: true,
        },
      },
    },
    take: limit,
  });
}

/**
 * Suggest brands for a project based on project configuration
 *
 * IMPORTANT: Brands are shared across ALL projects - this function searches the global
 * brand directory and returns suggestions based on project keywords. All users and projects
 * have access to the same brand database.
 */
export async function suggestBrandsForProject(
  projectId: string
): Promise<Array<BrandWithTaxonomy & { relevanceScore: number }>> {
  // Get project details
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted_at: null },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
      themes: {
        where: { deleted_at: null },
      },
    },
  });

  if (!project) {
    return [];
  }

  // Extract keywords from project
  const projectKeywords = project.keywords.map((k) => k.keyword.toLowerCase());

  if (projectKeywords.length === 0) {
    // No keywords, return empty suggestions
    return [];
  }

  // Find brands matching project keywords
  // NOTE: This searches ALL brands in the database - brands are shared across all projects
  const matchingBrands = await findBrandsByKeywords(projectKeywords, 100);

  // Calculate relevance scores based on keyword matches
  const brandsWithScores = matchingBrands.map((brand) => {
    const brandKeywords = brand.keywords.map((k) => k.keyword.toLowerCase());
    const matchingKeywords = projectKeywords.filter((pk) =>
      brandKeywords.some((bk) => bk.includes(pk) || pk.includes(bk))
    );
    const relevanceScore = (matchingKeywords.length / projectKeywords.length) * 100;

    return {
      ...brand,
      relevanceScore: Math.round(relevanceScore),
    };
  });

  // Sort by relevance score (highest first)
  return brandsWithScores
    .filter((b) => b.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 20); // Return top 20 suggestions
}

/**
 * Suggest brands based on selected brands and/or keywords
 * If brands are provided, finds brands in same taxonomy branch with similar stage
 * If only keywords are provided, uses keyword matching
 *
 * IMPORTANT: Brands are shared across ALL projects - this function searches the global
 * brand directory. All users and projects have access to the same brand database.
 */
export async function suggestBrands(
  selectedBrandIds?: string[],
  keywords?: string[],
  limit: number = 20
): Promise<Array<BrandWithTaxonomy & { relevanceScore: number }>> {
  // If brands are selected, prioritize taxonomy-based suggestions
  if (selectedBrandIds && selectedBrandIds.length > 0) {
    // Get selected brands with their taxonomy info
    const selectedBrands = await prisma.brand.findMany({
      where: {
        id: { in: selectedBrandIds },
        deleted_at: null,
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

    if (selectedBrands.length > 0) {
      // Group by taxonomy and brand stage
      const taxonomyGroups = new Map<string, Set<string>>(); // taxonomy_id -> Set<brand_stage>
      const taxonomyIds = new Set<string>();

      selectedBrands.forEach((brand) => {
        const taxonomyId = brand.business_taxonomy_id;
        taxonomyIds.add(taxonomyId);

        if (!taxonomyGroups.has(taxonomyId)) {
          taxonomyGroups.set(taxonomyId, new Set());
        }
        taxonomyGroups.get(taxonomyId)!.add(brand.brand_stage);
      });

      // Get taxonomy details to find parent taxonomies
      const taxonomies = await prisma.businessTaxonomy.findMany({
        where: {
          id: { in: Array.from(taxonomyIds) },
          deleted_at: null,
        },
        select: {
          id: true,
          category: true,
          subcategory: true,
          sub_subcategory: true,
        },
      });

      // Find brands in same taxonomy branches
      const suggestedBrands = new Map<string, BrandWithTaxonomy & { relevanceScore: number }>();
      const selectedBrandIdsSet = new Set(selectedBrandIds);

      // For each selected brand's taxonomy, find other brands in same taxonomy
      for (const taxonomy of taxonomies) {
        // Find ALL brands in same taxonomy (exact match) - NO LIMIT when brand is selected
        const sameTaxonomyBrands = await prisma.brand.findMany({
          where: {
            business_taxonomy_id: taxonomy.id,
            deleted_at: null,
            id: { notIn: Array.from(selectedBrandIdsSet) }, // Exclude already selected
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
            keywords: {
              where: { deleted_at: null },
              select: {
                id: true,
                keyword: true,
              },
            },
          },
          // NO LIMIT - return ALL brands in same taxonomy
        });

        // Also find ALL brands in same category/subcategory (broader match) - NO LIMIT
        const sameCategoryBrands = await prisma.brand.findMany({
          where: {
            businessTaxonomy: {
              category: taxonomy.category,
              subcategory: taxonomy.subcategory,
              deleted_at: null,
            },
            deleted_at: null,
            id: { notIn: Array.from(selectedBrandIdsSet) },
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
            keywords: {
              where: { deleted_at: null },
              select: {
                id: true,
                keyword: true,
              },
            },
          },
          // NO LIMIT - return ALL brands in same category/subcategory
        });

        // Score brands based on taxonomy match, brand stage, and keywords
        const allCandidates = [...sameTaxonomyBrands, ...sameCategoryBrands];
        const normalizedKeywords =
          keywords && keywords.length > 0 ? keywords.map((k) => k.toLowerCase()) : [];

        for (const brand of allCandidates) {
          if (suggestedBrands.has(brand.id)) {
            continue; // Already added
          }

          let relevanceScore = 0;

          // Exact taxonomy match = higher score
          if (brand.business_taxonomy_id === taxonomy.id) {
            relevanceScore += 100;
          } else {
            // Same category/subcategory = lower score
            relevanceScore += 50;
          }

          // Brand stage match = bonus
          const selectedStages = taxonomyGroups.get(taxonomy.id);
          if (selectedStages && selectedStages.has(brand.brand_stage)) {
            relevanceScore += 20;
          }

          // Keyword match bonus (if keywords provided)
          if (normalizedKeywords.length > 0) {
            const brandKeywords = brand.keywords.map((k) => k.keyword.toLowerCase());
            const matchingKeywords = normalizedKeywords.filter((pk) =>
              brandKeywords.some((bk) => bk.includes(pk) || pk.includes(bk))
            );
            if (matchingKeywords.length > 0) {
              // Add bonus score for keyword matches (up to 30 points)
              relevanceScore += Math.min(
                30,
                (matchingKeywords.length / normalizedKeywords.length) * 30
              );
            }
          }

          // Cap relevance score at 100
          const cappedScore = Math.min(100, relevanceScore);

          suggestedBrands.set(brand.id, {
            ...brand,
            relevanceScore: Math.round(cappedScore),
          });
        }
      }

      // Sort by relevance
      // When a brand is selected, return ALL brands in same taxonomy (prioritize exact taxonomy matches)
      // Only apply limit if no brands are selected (keyword-only search)
      const sorted = Array.from(suggestedBrands.values()).sort((a, b) => {
        // First sort by exact taxonomy match (higher score)
        if (a.relevanceScore >= 100 && b.relevanceScore < 100) return -1;
        if (b.relevanceScore >= 100 && a.relevanceScore < 100) return 1;
        // Then by relevance score
        return b.relevanceScore - a.relevanceScore;
      });

      // If brands are selected, return ALL results (no limit)
      // If only keywords, apply limit
      return selectedBrandIds && selectedBrandIds.length > 0 ? sorted : sorted.slice(0, limit);
    }
  }

  // Fallback to keyword-based suggestions if no brands selected
  if (keywords && keywords.length > 0) {
    const normalizedKeywords = keywords.map((k) => k.toLowerCase());
    const matchingBrands = await findBrandsByKeywords(normalizedKeywords, 100);

    // Calculate relevance scores based on keyword matches AND taxonomy matches
    const brandsWithScores = matchingBrands.map((brand) => {
      let relevanceScore = 0;

      // Check brand keyword matches
      const brandKeywords = brand.keywords.map((k) => k.keyword.toLowerCase());
      const matchingKeywords = normalizedKeywords.filter((pk) =>
        brandKeywords.some((bk) => bk.includes(pk) || pk.includes(bk))
      );

      if (matchingKeywords.length > 0) {
        // Brand keywords match - higher score
        relevanceScore = (matchingKeywords.length / normalizedKeywords.length) * 100;
      } else {
        // No brand keyword match, but brand was found via taxonomy match - give base score
        // This ensures brands found through taxonomy matching aren't filtered out
        relevanceScore = 30; // Base score for taxonomy matches
      }

      // Cap relevance score at 100
      const cappedScore = Math.min(100, relevanceScore);

      return {
        ...brand,
        relevanceScore: Math.round(cappedScore),
      };
    });

    // Sort by relevance score (highest first)
    return brandsWithScores
      .filter((b) => b.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  return [];
}

/**
 * Get brand by ID
 */
export async function getBrandById(brandId: string): Promise<BrandWithTaxonomy | null> {
  return await prisma.brand.findFirst({
    where: {
      id: brandId,
      deleted_at: null,
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
      keywords: {
        where: { deleted_at: null },
        select: {
          id: true,
          keyword: true,
        },
      },
      redditLinks: {
        where: { deleted_at: null },
        select: {
          id: true,
          url: true,
        },
        orderBy: { created_at: Prisma.SortOrder.asc },
      },
    },
  });
}

/**
 * Update brand
 */
export async function updateBrand(
  brandId: string,
  data: Partial<Omit<DiscoveredBrand, "keywords"> & { business_taxonomy_id?: string }>
): Promise<BrandWithTaxonomy> {
  // Get current brand to validate against
  const currentBrand = await getBrandById(brandId);
  if (!currentBrand) {
    throw new Error("Brand not found");
  }

  // Validate brand data if name or URLs are being updated
  if (
    data.brand_name !== undefined ||
    data.company_name !== undefined ||
    data.website_url !== undefined ||
    data.linkedin_url !== undefined ||
    data.facebook_url !== undefined ||
    data.x_url !== undefined ||
    data.instagram_url !== undefined
  ) {
    const validation = validateBrandData({
      brand_name: data.brand_name ?? currentBrand.brand_name,
      company_name: data.company_name ?? currentBrand.company_name,
      website_url: data.website_url ?? currentBrand.website_url ?? null,
      linkedin_url: data.linkedin_url ?? currentBrand.linkedin_url ?? null,
      facebook_url: data.facebook_url ?? currentBrand.facebook_url ?? null,
      x_url: data.x_url ?? currentBrand.x_url ?? null,
      instagram_url: data.instagram_url ?? currentBrand.instagram_url ?? null,
      tiktok_url: data.tiktok_url ?? currentBrand.tiktok_url ?? null,
      youtube_url: data.youtube_url ?? currentBrand.youtube_url ?? null,
      discord_url: data.discord_url ?? currentBrand.discord_url ?? null,
    });

    // Log warnings (but don't block)
    if (validation.warnings.length > 0) {
      console.warn(
        `[updateBrand] Validation warnings for "${data.brand_name ?? currentBrand.brand_name}":`,
        validation.warnings
      );
    }

    // Only block on actual errors (not typo warnings)
    if (validation.errors.length > 0) {
      throw new Error(`Brand validation failed: ${validation.errors.join("; ")}`);
    }
  }

  const updateData: any = {};

  // Use nested relation syntax for foreign key updates
  if (data.business_taxonomy_id !== undefined) {
    updateData.businessTaxonomy = {
      connect: { id: data.business_taxonomy_id },
    };
  }
  if (data.company_name !== undefined) {
    updateData.company_name = data.company_name;
  }
  if (data.brand_name !== undefined) {
    updateData.brand_name = data.brand_name;
  }
  if (data.brand_stage !== undefined) {
    updateData.brand_stage = data.brand_stage;
  }
  if ((data as any).approved !== undefined) {
    updateData.approved = (data as any).approved;
  }
  if (data.website_url !== undefined) {
    updateData.website_url = data.website_url || null;
  }
  if (data.careers_url !== undefined) {
    updateData.careers_url = data.careers_url || null;
  }
  if (data.blog_news_url !== undefined) {
    updateData.blog_news_url = data.blog_news_url || null;
  }
  if (data.linkedin_url !== undefined) {
    updateData.linkedin_url = data.linkedin_url || null;
  }
  if (data.facebook_url !== undefined) {
    updateData.facebook_url = data.facebook_url || null;
  }
  if (data.x_url !== undefined) {
    updateData.x_url = data.x_url || null;
  }
  if (data.instagram_url !== undefined) {
    updateData.instagram_url = data.instagram_url || null;
  }
  if (data.tiktok_url !== undefined) {
    updateData.tiktok_url = data.tiktok_url || null;
  }
  if (data.youtube_url !== undefined) {
    updateData.youtube_url = data.youtube_url || null;
  }
  if (data.discord_url !== undefined) {
    updateData.discord_url = data.discord_url || null;
  }

  await prisma.brand.update({
    where: { id: brandId },
    data: updateData,
  });

  const updatedBrand = await getBrandById(brandId);
  if (!updatedBrand) {
    throw new Error("Brand not found after update");
  }
  return updatedBrand;
}

/**
 * Update brand keywords
 */
export async function updateBrandKeywords(brandId: string, keywords: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Get brand to find taxonomy ID
    const brand = await tx.brand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        business_taxonomy_id: true,
      },
    });

    if (!brand) {
      throw new Error("Brand not found");
    }

    // Get taxonomy to get sub-subcategory
    let subSubcategory: string | null = null;
    if (brand.business_taxonomy_id) {
      const taxonomy = await tx.businessTaxonomy.findUnique({
        where: { id: brand.business_taxonomy_id },
        select: {
          sub_subcategory: true,
        },
      });
      if (taxonomy) {
        subSubcategory = taxonomy.sub_subcategory;
      }
    }

    // Normalize all keywords according to social media best practices
    const allKeywords = new Set<string>();

    // Add sub-subcategory keywords (split if needed)
    if (subSubcategory) {
      const subSubcategoryKeywords = normalizeKeyword(subSubcategory);
      subSubcategoryKeywords.forEach((kw) => allKeywords.add(kw));
    }

    // Normalize and add provided keywords
    const normalizedProvidedKeywords = normalizeKeywords(keywords);
    normalizedProvidedKeywords.forEach((kw) => allKeywords.add(kw));

    // Log for debugging
    console.log(
      `[updateBrandKeywords] Brand ${brandId}: Updating with ${allKeywords.size} keywords (${normalizedProvidedKeywords.length} provided, sub-subcategory: ${subSubcategory})`
    );

    // Get all existing keywords (including soft-deleted ones) for this brand
    const existingKeywords = await tx.brandKeyword.findMany({
      where: { brand_id: brandId },
      select: { keyword: true, deleted_at: true },
    });

    const existingKeywordsMap = new Map<string, boolean>();
    existingKeywords.forEach((kw) => {
      existingKeywordsMap.set(kw.keyword.toLowerCase(), kw.deleted_at === null);
    });

    // Process each keyword: restore if exists, create if new
    if (allKeywords.size > 0) {
      for (const keyword of allKeywords) {
        const keywordLower = keyword.toLowerCase();
        const exists = existingKeywordsMap.has(keywordLower);
        const isActive = exists && existingKeywordsMap.get(keywordLower) === true;

        if (exists && !isActive) {
          // Restore soft-deleted keyword
          await tx.brandKeyword.updateMany({
            where: {
              brand_id: brandId,
              keyword: keywordLower,
            },
            data: { deleted_at: null },
          });
        } else if (!exists) {
          // Create new keyword
          try {
            await tx.brandKeyword.create({
              data: {
                id: generateId(), // Explicitly generate ULID
                brand_id: brandId,
                keyword: keywordLower,
              },
            });
          } catch (error: any) {
            // If we get a unique constraint error, try to restore instead
            if (error.code === "P2002") {
              await tx.brandKeyword.updateMany({
                where: {
                  brand_id: brandId,
                  keyword: keywordLower,
                },
                data: { deleted_at: null },
              });
            } else {
              console.error(`[updateBrandKeywords] Error creating keyword "${keyword}":`, error);
              throw error;
            }
          }
        }
        // If keyword exists and is active, do nothing (already correct)
      }
    }

    // Soft delete keywords that are not in the new list
    const keywordsToKeep = Array.from(allKeywords).map((k) => k.toLowerCase());
    await tx.brandKeyword.updateMany({
      where: {
        brand_id: brandId,
        deleted_at: null,
        keyword: {
          notIn: keywordsToKeep,
        },
      },
      data: { deleted_at: new Date() },
    });
  });
}

/**
 * Soft delete brand
 */
export async function deleteBrand(brandId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Soft delete brand
    await tx.brand.update({
      where: { id: brandId },
      data: { deleted_at: new Date() },
    });

    // Soft delete all keywords
    await tx.brandKeyword.updateMany({
      where: { brand_id: brandId },
      data: { deleted_at: new Date() },
    });
  });
}

/**
 * Sync project keywords to selected brands
 * Adds user-entered keywords to brands, checking for duplicates and fixing typos
 */
export async function syncProjectKeywordsToBrands(
  keywords: string[],
  brandIds: string[]
): Promise<void> {
  if (!keywords || keywords.length === 0 || !brandIds || brandIds.length === 0) {
    return; // Nothing to sync
  }

  // Import typo fixing function
  const { fixKeywordTypos } = await import("./keyword-utils");

  // Fix typos in keywords
  const fixedKeywords = keywords
    .map((kw) => fixKeywordTypos(kw.trim()))
    .filter((kw) => kw.length > 0);

  if (fixedKeywords.length === 0) {
    return; // No valid keywords after fixing
  }

  await prisma.$transaction(async (tx) => {
    for (const brandId of brandIds) {
      // Get existing keywords for this brand (including soft-deleted ones)
      const existingKeywords = await tx.brandKeyword.findMany({
        where: { brand_id: brandId },
        select: { keyword: true, deleted_at: true },
      });

      const existingKeywordsMap = new Map<string, boolean>();
      existingKeywords.forEach((kw) => {
        existingKeywordsMap.set(kw.keyword.toLowerCase(), kw.deleted_at === null);
      });

      // Add each fixed keyword if it doesn't already exist
      for (const keyword of fixedKeywords) {
        const keywordLower = keyword.toLowerCase();
        const exists = existingKeywordsMap.has(keywordLower);
        const isActive = exists && existingKeywordsMap.get(keywordLower) === true;

        if (!isActive) {
          if (exists) {
            // Restore soft-deleted keyword
            await tx.brandKeyword.updateMany({
              where: {
                brand_id: brandId,
                keyword: keywordLower,
              },
              data: { deleted_at: null },
            });
          } else {
            // Create new keyword
            try {
              await tx.brandKeyword.create({
                data: {
                  id: generateId(),
                  brand_id: brandId,
                  keyword: keywordLower,
                },
              });
            } catch (error: any) {
              // If we get a unique constraint error, try to restore instead
              if (error.code === "P2002") {
                await tx.brandKeyword.updateMany({
                  where: {
                    brand_id: brandId,
                    keyword: keywordLower,
                  },
                  data: { deleted_at: null },
                });
              } else {
                console.error(
                  `[syncProjectKeywordsToBrands] Error creating keyword "${keyword}" for brand ${brandId}:`,
                  error
                );
                // Continue with other keywords instead of failing completely
              }
            }
          }
        }
        // If keyword exists and is active, skip (no duplicate)
      }
    }
  });

  console.log(
    `[syncProjectKeywordsToBrands] Synced ${fixedKeywords.length} keyword(s) to ${brandIds.length} brand(s)`
  );
}
