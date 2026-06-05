import { prisma } from "@/lib/prisma";
import { SentimentType } from "@prisma/client";
import { ulid as generateUlid } from "ulid";

/**
 * Extract primary brand name from full brand name
 * Removes common company suffixes and extracts the main brand word(s)
 * Examples:
 * - "Lovable Technology" -> ["Lovable", "Lovable Technology"]
 * - "Cursor Inc." -> ["Cursor", "Cursor Inc."]
 * - "Microsoft Corporation" -> ["Microsoft", "Microsoft Corporation"]
 */
function getBrandVariations(brandName: string): string[] {
  const variations: string[] = [];

  // Always include the full brand name
  variations.push(brandName);

  // Common company suffixes to remove
  const suffixes = [
    /\s+(Inc\.?|Incorporated)$/i,
    /\s+(LLC|L\.L\.C\.)$/i,
    /\s+(Corp\.?|Corporation)$/i,
    /\s+(Ltd\.?|Limited)$/i,
    /\s+(Technology|Technologies|Tech)$/i,
    /\s+(Company|Co\.)$/i,
    /\s+(Group)$/i,
    /\s+(International|Intl\.)$/i,
  ];

  let cleanedBrand = brandName;

  // Remove suffixes
  for (const suffix of suffixes) {
    if (suffix.test(cleanedBrand)) {
      cleanedBrand = cleanedBrand.replace(suffix, "").trim();
    }
  }

  // If we got a different name after removing suffix, add it
  if (cleanedBrand !== brandName && cleanedBrand.length > 0) {
    variations.push(cleanedBrand);

    // Also try extracting just the first word if it's a multi-word brand
    const words = cleanedBrand.split(/\s+/);
    if (words.length > 1) {
      // For brands like "Lovable Technology" or "Cursor Inc", use the first word
      const firstWord = words[0];
      if (firstWord.length > 2) {
        // Only if meaningful (more than 2 chars)
        variations.push(firstWord);
      }
    }
  }

  // Remove duplicates and empty strings
  return Array.from(new Set(variations.filter((v) => v.length > 0)));
}

/**
 * Heuristic function to check if a brand mention is in the correct context
 * Handles partial brand names (e.g., "Lovable" when brand is "Lovable Technology")
 */
function isBrandMentionValid(brandName: string, postContent: string): boolean {
  if (!postContent || !brandName) return false;

  // Get all variations of the brand name (full name + partial names)
  const brandVariations = getBrandVariations(brandName);

  // Check each variation
  for (const variation of brandVariations) {
    const variationLower = variation.toLowerCase();
    const contentLower = postContent.toLowerCase();

    // Quick check if variation appears in content
    if (!contentLower.includes(variationLower)) continue;

    // Use word boundary regex to ensure it's a complete word match
    const escapedVariation = variation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const variationRegex = new RegExp(`\\b${escapedVariation}\\b`, "i");

    if (!variationRegex.test(postContent)) continue;

    // Check if variation is a proper noun (capitalized)
    const variationWords = variation.split(/\s+/);
    const isProperNoun = variationWords.every((word) => {
      if (word.length === 0) return true;
      const firstChar = word[0];
      return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
    });

    // Strong indicators it's a valid brand mention
    const strongIndicators = [
      // Mentions with @ symbol (social media handles)
      new RegExp(`@${escapedVariation.replace(/\s+/g, "")}`, "i").test(postContent),
      // Brand name with possessive or followed by punctuation
      new RegExp(`${escapedVariation}['s.]`, "i").test(postContent),
      // Brand name with product/tech context words nearby
      new RegExp(
        `(${escapedVariation}).{0,50}\\b(app|platform|tool|software|service|product|website|company|startup|tech|build|create|use|using)\\b`,
        "i"
      ).test(postContent),
      // Brand name at start of sentence or after common verbs
      new RegExp(
        `(^|\\b(using|with|on|from|to|via|check|try|see|love|like|hate|dislike)\\s+)${escapedVariation}\\b`,
        "i"
      ).test(postContent),
    ];

    // Exclude common false positives for specific brands (check against original brand name for consistency)
    const brandLower = brandName.toLowerCase();
    const brandKey = brandLower.replace(/\s+/g, "");
    const variationKey = variationLower.replace(/\s+/g, "");

    const falsePositivePatterns: Record<string, RegExp[]> = {
      lovable: [
        /\blovable\s+(cat|dog|pet|animal|puppy|kitten)/i,
        /\bso\s+lovable/i,
        /\bvery\s+lovable/i,
        /\btoo\s+lovable/i,
      ],
      cursor: [
        /\bcursor\s+(position|movement|style|color)/i,
        /\bmouse\s+cursor/i,
        /\bcursor\s+(blink|blinking)/i,
      ],
      bolt: [/\bbolt\s+(of|from|the)\s+(lightning|light|fabric)/i, /\blightning\s+bolt/i],
    };

    // Check false positives for either the full brand or the variation
    const relevantPatterns = falsePositivePatterns[brandKey] || falsePositivePatterns[variationKey];
    if (relevantPatterns) {
      const isFalsePositive = relevantPatterns.some((pattern) => pattern.test(postContent));
      if (isFalsePositive) continue; // Try next variation
    }

    // If it's a proper noun and has strong indicators, it's likely valid
    if (isProperNoun && strongIndicators.some((indicator) => indicator)) {
      return true;
    }

    // For proper nouns without strong indicators, still consider valid (conservative approach)
    // For non-proper-nouns (lowercase brands), only accept if there are strong indicators
    if (isProperNoun) {
      return true;
    }
  }

  // None of the variations matched as valid
  return false;
}

/**
 * Populate BrandAnalysis table for a project
 * Analyzes all posts with sentiment to find brand mentions
 */
export type PopulateBrandAnalysisBounds = {
  minPostIdExclusive?: number;
  maxPostIdInclusive?: number;
  /** When set, only these post rows are analyzed (used by task worker batching). */
  postIds?: number[];
};

export async function populateBrandAnalysis(
  projectId: string,
  bounds?: PopulateBrandAnalysisBounds
): Promise<{
  processed: number;
  brandMentions: number;
  errors: number;
  maxProcessedPostId: number;
}> {
  let processed = 0;
  let brandMentions = 0;
  let errors = 0;
  const minPostIdExclusive = bounds?.minPostIdExclusive ?? 0;
  const maxPostIdInclusive =
    bounds?.maxPostIdInclusive !== undefined ? bounds.maxPostIdInclusive : Number.POSITIVE_INFINITY;
  const explicitPostIds =
    bounds?.postIds && bounds.postIds.length > 0
      ? Array.from(new Set(bounds.postIds.filter((id) => Number.isFinite(id))))
      : null;
  let maxProcessedPostId = explicitPostIds?.length
    ? Math.min(...explicitPostIds) - 1
    : minPostIdExclusive;

  try {
    // Get all brands for the project
    const brands = await prisma.projectBrand.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      select: {
        brand_name: true,
      },
    });

    if (brands.length === 0) {
      console.log(`[BrandAnalysis] No brands configured for project ${projectId}`);
      return { processed: 0, brandMentions: 0, errors: 0, maxProcessedPostId };
    }

    const brandNames = brands.map((b) => b.brand_name);

    const idFilter =
      explicitPostIds !== null
        ? { in: explicitPostIds }
        : {
            gt: minPostIdExclusive,
            ...(bounds?.maxPostIdInclusive !== undefined ? { lte: maxPostIdInclusive } : {}),
          };

    // Task-based runs pass explicit post IDs. Those rows may not have LLM sentiment yet (e.g. GitHub
    // skipped by sentiment, or BRAND-only rerun). Incremental / legacy runs still require sentiment
    // so stacked charts reflect analyzed tone.
    const taskBasedBatch = explicitPostIds !== null;

    const posts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        content: { not: null },
        NOT: { content: "" },
        id: idFilter,
        ...(taskBasedBatch ? {} : { sentiment: { not: null } }),
      },
      select: {
        id: true,
        content: true,
        sentiment: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    });

    if (posts.length === 0) {
      console.log(
        taskBasedBatch
          ? `[BrandAnalysis] No posts with content for project ${projectId} (batch of ${explicitPostIds!.length} id(s))`
          : `[BrandAnalysis] No posts with sentiment found for project ${projectId} after post ID ${minPostIdExclusive}`
      );
      return { processed: 0, brandMentions: 0, errors: 0, maxProcessedPostId };
    }

    const postsMissingSentiment = taskBasedBatch
      ? posts.filter((p) => p.sentiment == null).length
      : 0;
    if (postsMissingSentiment > 0) {
      console.log(
        `[BrandAnalysis] ${postsMissingSentiment}/${posts.length} post(s) in batch have no sentiment; mentions will use NEUTRAL for tone`
      );
    }

    console.log(
      taskBasedBatch
        ? `[BrandAnalysis] Processing ${posts.length} posts (batch of ${explicitPostIds!.length} task id(s)) with ${brandNames.length} brands for project ${projectId}`
        : `[BrandAnalysis] Processing ${posts.length} posts (IDs > ${minPostIdExclusive}${bounds?.maxPostIdInclusive !== undefined ? `, ≤ ${bounds.maxPostIdInclusive}` : ""}) with ${brandNames.length} brands for project ${projectId}`
    );

    // Process posts in batches for efficiency
    const batchSize = 100;
    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);

      const brandAnalysisRecords: Array<{
        id: string;
        project_id: string;
        post_id: number;
        brand_name: string;
        sentiment: SentimentType;
        mention_timestamp: Date;
      }> = [];

      for (const post of batch) {
        if (!post.content) continue;
        if (!taskBasedBatch && !post.sentiment) continue;

        const sentimentForMention: SentimentType = (post.sentiment ?? "NEUTRAL") as SentimentType;

        processed++;
        maxProcessedPostId = Math.max(maxProcessedPostId, post.id);

        for (const brandName of brandNames) {
          if (isBrandMentionValid(brandName, post.content)) {
            brandAnalysisRecords.push({
              id: generateUlid(),
              project_id: projectId,
              post_id: post.id,
              brand_name: brandName,
              sentiment: sentimentForMention,
              mention_timestamp: post.createdAt,
            });
            brandMentions++;
          }
        }
      }

      if (brandAnalysisRecords.length > 0) {
        try {
          for (const record of brandAnalysisRecords) {
            try {
              await prisma.brandAnalysis.create({
                data: record,
              });
            } catch (error: unknown) {
              const code =
                error && typeof error === "object" && "code" in error
                  ? (error as { code?: string }).code
                  : "";
              const message = error instanceof Error ? error.message : String(error);
              if (code === "P2002" || message.includes("UNIQUE constraint")) {
                continue;
              }
              console.error(
                `[BrandAnalysis] Error inserting record for post ${record.post_id}, brand ${record.brand_name}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(`[BrandAnalysis] Error inserting batch ${i}-${i + batch.length}:`, error);
          errors++;
        }
      }
    }

    console.log(
      `[BrandAnalysis] Completed for project ${projectId}: ${processed} posts processed, ${brandMentions} brand mentions found`
    );

    return { processed, brandMentions, errors, maxProcessedPostId };
  } catch (error) {
    errors++;
    console.error(`[BrandAnalysis] Error processing project ${projectId}:`, error);
    return { processed, brandMentions, errors, maxProcessedPostId };
  }
}
