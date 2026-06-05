/**
 * Service for managing hierarchical Reddit links for taxonomy nodes
 *
 * Links can be added at three levels:
 * - Category level (applies to all subcategories and sub-subcategories)
 * - Subcategory level (applies to all sub-subcategories under that subcategory)
 * - Sub-subcategory level (applies only to that specific taxonomy entry)
 *
 * When querying links for a taxonomy node, all parent-level links are inherited and combined.
 */

import { prisma } from "@/lib/prisma";
import { normalizeUrlForDedup } from "@/lib/utils/url-deduplication";

export interface RedditLink {
  id: string;
  url: string;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
  level: "category" | "subcategory" | "sub_subcategory";
  created_at: Date;
  updated_at: Date;
}

export interface RedditLinkInput {
  url: string;
  category: string;
  subcategory?: string | null;
  sub_subcategory?: string | null;
}

/**
 * Get all Reddit links for a taxonomy node, including inherited links from parent levels
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Array of all applicable Reddit links (including inherited ones)
 */
export async function getRedditLinksForTaxonomy(taxonomyId: string): Promise<RedditLink[]> {
  // Get the taxonomy entry
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId, deleted_at: null },
    select: {
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
  });

  if (!taxonomy) {
    return [];
  }

  // SIMPLE: Just get links by taxonomy_id (this is what we saved from projects)
  const links = await prisma.taxonomyRedditLink.findMany({
    where: {
      taxonomy_id: taxonomyId,
      deleted_at: null,
    },
    orderBy: [
      { category: "asc" },
      { subcategory: "asc" },
      { sub_subcategory: "asc" },
      { created_at: "asc" },
    ],
  });

  console.log(
    `[getRedditLinksForTaxonomy] Found ${links.length} Reddit links for taxonomy ${taxonomyId}`
  );

  // Deduplicate by URL (use consistent normalization)
  const seenUrls = new Set<string>();
  const uniqueLinks = links.filter((link) => {
    const normalizedUrl = normalizeUrlForDedup(link.url);
    if (seenUrls.has(normalizedUrl)) {
      console.log(
        `[getRedditLinksForTaxonomy] Removing duplicate: ${link.url} (normalized: ${normalizedUrl})`
      );
      return false;
    }
    seenUrls.add(normalizedUrl);
    return true;
  });

  console.log(
    `[getRedditLinksForTaxonomy] After deduplication: ${uniqueLinks.length} unique links`
  );

  // Transform to include level information
  return uniqueLinks.map((link) => ({
    id: link.id,
    url: link.url,
    category: link.category,
    subcategory: link.subcategory,
    sub_subcategory: link.sub_subcategory,
    level: link.sub_subcategory ? "sub_subcategory" : link.subcategory ? "subcategory" : "category",
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Get Reddit links for a category (all links at category level)
 */
export async function getRedditLinksForCategory(category: string): Promise<RedditLink[]> {
  const links = await prisma.taxonomyRedditLink.findMany({
    where: {
      deleted_at: null,
      category,
      subcategory: null,
      sub_subcategory: null,
    },
    orderBy: { created_at: "asc" },
  });

  return links.map((link) => ({
    id: link.id,
    url: link.url,
    category: link.category,
    subcategory: null,
    sub_subcategory: null,
    level: "category" as const,
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Get Reddit links for a subcategory (category + subcategory level links)
 */
export async function getRedditLinksForSubcategory(
  category: string,
  subcategory: string
): Promise<RedditLink[]> {
  const links = await prisma.taxonomyRedditLink.findMany({
    where: {
      deleted_at: null,
      category,
      OR: [
        // Category level links
        { subcategory: null, sub_subcategory: null },
        // Subcategory level links
        { subcategory, sub_subcategory: null },
      ],
    },
    orderBy: { created_at: "asc" },
  });

  return links.map((link) => ({
    id: link.id,
    url: link.url,
    category: link.category,
    subcategory: link.subcategory,
    sub_subcategory: null,
    level: link.subcategory ? ("subcategory" as const) : ("category" as const),
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Add Reddit links to a taxonomy node
 *
 * @param links - Array of Reddit link inputs
 * @param taxonomyId - Optional taxonomy ID (for sub-subcategory level)
 * @returns Array of created links
 */
export async function addRedditLinks(
  links: RedditLinkInput[],
  taxonomyId?: string
): Promise<RedditLink[]> {
  // If taxonomyId is provided, get the taxonomy to determine the level
  let category: string;
  let subcategory: string | null = null;
  let sub_subcategory: string | null = null;

  if (taxonomyId) {
    const taxonomy = await prisma.businessTaxonomy.findUnique({
      where: { id: taxonomyId, deleted_at: null },
      select: {
        category: true,
        subcategory: true,
        sub_subcategory: true,
      },
    });

    if (!taxonomy) {
      throw new Error(`Taxonomy with ID ${taxonomyId} not found`);
    }

    category = taxonomy.category;
    subcategory = taxonomy.subcategory;
    sub_subcategory = taxonomy.sub_subcategory;
  } else {
    // Use the first link's category (all should have the same category)
    if (links.length === 0) {
      throw new Error("No links provided");
    }
    category = links[0].category;
    subcategory = links[0].subcategory ?? null;
    sub_subcategory = links[0].sub_subcategory ?? null;
  }

  // Create all links (handle duplicates gracefully)
  console.log(
    `[addRedditLinks] Creating ${links.length} Reddit links for taxonomy ${taxonomyId || "N/A"} (${category}/${subcategory || "null"}/${sub_subcategory || "null"})`
  );

  const createdLinks: RedditLink[] = [];
  let skippedCount = 0;

  for (const link of links) {
    const linkData = {
      category,
      subcategory: subcategory ?? link.subcategory ?? null,
      sub_subcategory: sub_subcategory ?? link.sub_subcategory ?? null,
      url: link.url,
      taxonomy_id: taxonomyId ?? null,
    };

    try {
      const created = await prisma.taxonomyRedditLink.create({
        data: linkData,
      });

      console.log(
        `[addRedditLinks] Created Reddit link: ${created.url} with taxonomy_id=${created.taxonomy_id}, category=${created.category}, subcategory=${created.subcategory}, sub_subcategory=${created.sub_subcategory}`
      );

      createdLinks.push({
        id: created.id,
        url: created.url,
        category: created.category,
        subcategory: created.subcategory,
        sub_subcategory: created.sub_subcategory,
        level: created.sub_subcategory
          ? ("sub_subcategory" as const)
          : created.subcategory
            ? ("subcategory" as const)
            : ("category" as const),
        created_at: created.created_at,
        updated_at: created.updated_at,
      });
    } catch (error: any) {
      // Skip duplicates (P2002) or other expected errors
      if (error.code === "P2002") {
        skippedCount++;
        console.log(`[addRedditLinks] Skipping duplicate Reddit link: ${link.url}`);
        // Try to find existing link to return it
        const existing = await prisma.taxonomyRedditLink.findFirst({
          where: {
            url: link.url,
            category,
            subcategory: subcategory ?? link.subcategory ?? null,
            sub_subcategory: sub_subcategory ?? link.sub_subcategory ?? null,
            deleted_at: null,
          },
        });
        if (existing) {
          createdLinks.push({
            id: existing.id,
            url: existing.url,
            category: existing.category,
            subcategory: existing.subcategory,
            sub_subcategory: existing.sub_subcategory,
            level: existing.sub_subcategory
              ? ("sub_subcategory" as const)
              : existing.subcategory
                ? ("subcategory" as const)
                : ("category" as const),
            created_at: existing.created_at,
            updated_at: existing.updated_at,
          });
        }
      } else {
        // Re-throw unexpected errors
        console.error(`[addRedditLinks] Error creating Reddit link ${link.url}:`, error);
        throw error;
      }
    }
  }

  if (skippedCount > 0) {
    console.log(`[addRedditLinks] Skipped ${skippedCount} duplicate Reddit links`);
  }

  console.log(`[addRedditLinks] Successfully created ${createdLinks.length} Reddit links`);

  // Sync Reddit links to all brands under this taxonomy node
  // If taxonomyId is provided, sync for that specific taxonomy
  if (taxonomyId) {
    // Sync for the specific taxonomy node
    await syncRedditLinksToBrands(taxonomyId);
  } else {
    // For category/subcategory level, find all matching taxonomies and sync
    // Find all taxonomies that match this level
    const taxonomyWhere: any = {
      deleted_at: null,
      category: category,
    };

    if (subcategory) {
      taxonomyWhere.subcategory = subcategory;
    }
    if (sub_subcategory) {
      taxonomyWhere.sub_subcategory = sub_subcategory;
    }
    // For category/subcategory level, we want all sub-subcategories under this level
    // We'll filter for non-null sub_subcategory after the query

    const matchingTaxonomies = await prisma.businessTaxonomy
      .findMany({
        where: taxonomyWhere,
        select: {
          id: true,
          sub_subcategory: true,
        },
      })
      .then((taxonomies) =>
        // Filter to only include taxonomies with sub_subcategory (not null)
        sub_subcategory ? taxonomies : taxonomies.filter((t) => t.sub_subcategory !== null)
      );

    // Sync for each matching taxonomy
    for (const taxonomy of matchingTaxonomies) {
      try {
        await syncRedditLinksToBrands(taxonomy.id);
      } catch (error) {
        console.error(
          `[addRedditLinks] Error syncing Reddit links for taxonomy ${taxonomy.id}:`,
          error
        );
      }
    }
  }

  return createdLinks;
}

/**
 * Update Reddit links for a taxonomy node
 * Replaces all existing links with the new set
 *
 * @param links - Array of Reddit link inputs
 * @param taxonomyId - Optional taxonomy ID (for sub-subcategory level)
 */
export async function updateRedditLinks(
  links: RedditLinkInput[],
  taxonomyId?: string
): Promise<RedditLink[]> {
  // Determine the level and get existing links to delete
  let category: string;
  let subcategory: string | null = null;
  let sub_subcategory: string | null = null;

  if (taxonomyId) {
    const taxonomy = await prisma.businessTaxonomy.findUnique({
      where: { id: taxonomyId, deleted_at: null },
      select: {
        category: true,
        subcategory: true,
        sub_subcategory: true,
      },
    });

    if (!taxonomy) {
      throw new Error(`Taxonomy with ID ${taxonomyId} not found`);
    }

    category = taxonomy.category;
    subcategory = taxonomy.subcategory;
    sub_subcategory = taxonomy.sub_subcategory;
  } else {
    if (links.length === 0) {
      throw new Error("No links provided");
    }
    category = links[0].category;
    subcategory = links[0].subcategory ?? null;
    sub_subcategory = links[0].sub_subcategory ?? null;
  }

  return await prisma
    .$transaction(async (tx) => {
      // Soft delete existing links at this exact level
      await tx.taxonomyRedditLink.updateMany({
        where: {
          category,
          subcategory: subcategory ?? null,
          sub_subcategory: sub_subcategory ?? null,
          taxonomy_id: taxonomyId ?? null,
          deleted_at: null,
        },
        data: {
          deleted_at: new Date(),
        },
      });

      // Create new links
      const createdLinks = await Promise.all(
        links.map(async (link) => {
          const created = await tx.taxonomyRedditLink.create({
            data: {
              category,
              subcategory: subcategory ?? link.subcategory ?? null,
              sub_subcategory: sub_subcategory ?? link.sub_subcategory ?? null,
              url: link.url,
              taxonomy_id: taxonomyId ?? null,
            },
          });

          return {
            id: created.id,
            url: created.url,
            category: created.category,
            subcategory: created.subcategory,
            sub_subcategory: created.sub_subcategory,
            level: created.sub_subcategory
              ? ("sub_subcategory" as const)
              : created.subcategory
                ? ("subcategory" as const)
                : ("category" as const),
            created_at: created.created_at,
            updated_at: created.updated_at,
          };
        })
      );

      // Sync Reddit links to all brands under this taxonomy node
      // If taxonomyId is provided, sync for that specific taxonomy
      if (taxonomyId) {
        // Sync for the specific taxonomy node
        await syncRedditLinksToBrands(taxonomyId);
      } else {
        // For category/subcategory level, find all matching taxonomies and sync
        // Find all taxonomies that match this level
        const taxonomyWhere: any = {
          deleted_at: null,
          category: category,
        };

        if (subcategory) {
          taxonomyWhere.subcategory = subcategory;
        }
        if (sub_subcategory) {
          taxonomyWhere.sub_subcategory = sub_subcategory;
        }
        // For category/subcategory level, we want all sub-subcategories under this level
        // We'll filter for non-null sub_subcategory after the query

        const matchingTaxonomies = await prisma.businessTaxonomy
          .findMany({
            where: taxonomyWhere,
            select: {
              id: true,
              sub_subcategory: true,
            },
          })
          .then((taxonomies) =>
            // Filter to only include taxonomies with sub_subcategory (not null)
            sub_subcategory ? taxonomies : taxonomies.filter((t) => t.sub_subcategory !== null)
          );

        // Sync for each matching taxonomy
        for (const taxonomy of matchingTaxonomies) {
          try {
            await syncRedditLinksToBrands(taxonomy.id);
          } catch (error) {
            console.error(
              `[updateRedditLinks] Error syncing Reddit links for taxonomy ${taxonomy.id}:`,
              error
            );
          }
        }
      }

      return createdLinks;
    })
    .then(async (createdLinks) => {
      // Sync Reddit links to all brands under this taxonomy node after transaction completes
      // If taxonomyId is provided, sync for that specific taxonomy
      if (taxonomyId) {
        // Sync for the specific taxonomy node
        await syncRedditLinksToBrands(taxonomyId);
      } else {
        // For category/subcategory level, find all matching taxonomies and sync
        // Find all taxonomies that match this level
        const taxonomyWhere: any = {
          deleted_at: null,
          category: category,
        };

        if (subcategory) {
          taxonomyWhere.subcategory = subcategory;
        }
        if (sub_subcategory) {
          taxonomyWhere.sub_subcategory = sub_subcategory;
        }
        // For category/subcategory level, we want all sub-subcategories under this level
        // We'll filter for non-null sub_subcategory after the query

        const matchingTaxonomies = await prisma.businessTaxonomy
          .findMany({
            where: taxonomyWhere,
            select: {
              id: true,
              sub_subcategory: true,
            },
          })
          .then((taxonomies) =>
            // Filter to only include taxonomies with sub_subcategory (not null)
            sub_subcategory ? taxonomies : taxonomies.filter((t) => t.sub_subcategory !== null)
          );

        // Sync for each matching taxonomy
        for (const taxonomy of matchingTaxonomies) {
          try {
            await syncRedditLinksToBrands(taxonomy.id);
          } catch (error) {
            console.error(
              `[updateRedditLinks] Error syncing Reddit links for taxonomy ${taxonomy.id}:`,
              error
            );
          }
        }
      }

      return createdLinks;
    });
}

/**
 * Delete a Reddit link by ID
 */
export async function deleteRedditLink(linkId: string): Promise<void> {
  await prisma.taxonomyRedditLink.update({
    where: { id: linkId },
    data: { deleted_at: new Date() },
  });
}

/**
 * Sync Reddit links from a taxonomy node to all brands under that taxonomy
 * This propagates taxonomy-level Reddit links to brands hierarchically
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Number of brands updated
 */
export async function syncRedditLinksToBrands(taxonomyId: string): Promise<number> {
  // Get all applicable Reddit links for this taxonomy (including inherited ones)
  const taxonomyLinks = await getRedditLinksForTaxonomy(taxonomyId);

  if (taxonomyLinks.length === 0) {
    return 0;
  }

  // Get the taxonomy to determine which brands to update
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId, deleted_at: null },
    select: {
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
  });

  if (!taxonomy) {
    return 0;
  }

  // Find all brands under this taxonomy node
  // For sub-subcategory: exact match by taxonomy_id
  // For subcategory: all brands with matching category and subcategory
  // For category: all brands with matching category
  const brandWhere: any = {
    deleted_at: null,
  };

  // If this is a sub-subcategory (has all three levels), match by exact taxonomy_id
  if (taxonomy.sub_subcategory) {
    brandWhere.business_taxonomy_id = taxonomyId;
  } else {
    // For category/subcategory level, match by path
    brandWhere.business_taxonomy = {
      deleted_at: null,
      category: taxonomy.category,
    };

    if (taxonomy.subcategory) {
      brandWhere.business_taxonomy.subcategory = taxonomy.subcategory;
    }
  }

  const brands = await prisma.brand.findMany({
    where: brandWhere,
    select: {
      id: true,
      brand_name: true,
    },
  });

  if (brands.length === 0) {
    console.log(
      `[syncRedditLinksToBrands] No brands found for taxonomy ${taxonomyId} with query:`,
      JSON.stringify(brandWhere, null, 2)
    );
    return 0;
  }

  console.log(
    `[syncRedditLinksToBrands] Found ${brands.length} brands:`,
    brands.map((b) => `${b.brand_name} (${b.id})`).join(", ")
  );

  // Helper to normalize URLs for comparison
  const normalizeUrl = (url: string): string => {
    return url
      .toLowerCase()
      .trim()
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
  };

  // Extract unique URLs from taxonomy links
  const taxonomyUrls = taxonomyLinks.map((link) => link.url);
  console.log(
    `[syncRedditLinksToBrands] Taxonomy URLs to sync (first 5):`,
    taxonomyUrls.slice(0, 5)
  );

  // For each brand, add taxonomy Reddit links (if they don't already exist)
  // Add to BOTH BrandRedditLink (for backward compatibility) AND BrandAdditionalLink (for admin panel)
  let updatedCount = 0;
  let totalLinksAdded = 0;
  console.log(
    `[syncRedditLinksToBrands] Syncing ${taxonomyLinks.length} Reddit links to ${brands.length} brands for taxonomy ${taxonomyId}`
  );

  for (const brand of brands) {
    // Get existing brand Reddit links from BrandRedditLink
    const existingRedditLinks = await prisma.brandRedditLink.findMany({
      where: {
        brand_id: brand.id,
        deleted_at: null,
      },
      select: {
        url: true,
      },
    });

    // Get existing brand Reddit links from BrandAdditionalLink
    const existingAdditionalLinks = await prisma.brandAdditionalLink.findMany({
      where: {
        brand_id: brand.id,
        link_type: "REDDIT",
        deleted_at: null,
      },
      select: {
        url: true,
      },
    });

    // Combine and normalize existing URLs
    const existingUrls = new Set<string>();
    for (const link of existingRedditLinks) {
      const normalized = normalizeUrl(link.url);
      existingUrls.add(normalized);
    }
    for (const link of existingAdditionalLinks) {
      const normalized = normalizeUrl(link.url);
      existingUrls.add(normalized);
    }

    // Find URLs that need to be added
    const urlsToAdd = taxonomyUrls.filter((url) => {
      const normalized = normalizeUrl(url);
      const exists = existingUrls.has(normalized);
      if (!exists) {
        console.log(
          `[syncRedditLinksToBrands] Brand ${brand.id}: Will add URL: ${url} (normalized: ${normalized})`
        );
      }
      return !exists;
    });

    // Debug logging for first brand only to avoid spam
    if (brands.indexOf(brand) === 0) {
      console.log(
        `[syncRedditLinksToBrands] Brand ${brand.id} (${brand.brand_name}): Found ${existingRedditLinks.length} existing BrandRedditLinks, ${existingAdditionalLinks.length} existing BrandAdditionalLinks`
      );
      console.log(
        `[syncRedditLinksToBrands] Brand ${brand.id}: ${taxonomyUrls.length} taxonomy URLs, ${urlsToAdd.length} URLs to add`
      );
      if (urlsToAdd.length === 0 && taxonomyUrls.length > 0) {
        console.log(
          `[syncRedditLinksToBrands] Brand ${brand.id}: All URLs already exist. Sample taxonomy URLs:`,
          taxonomyUrls.slice(0, 3).map((u) => `${u} -> ${normalizeUrl(u)}`)
        );
        console.log(
          `[syncRedditLinksToBrands] Brand ${brand.id}: Sample existing normalized URLs:`,
          Array.from(existingUrls).slice(0, 5)
        );
      }
    }

    if (urlsToAdd.length > 0) {
      let brandLinksAdded = 0;
      // Add new links to BrandRedditLink (for backward compatibility)
      for (const url of urlsToAdd) {
        try {
          await prisma.brandRedditLink.create({
            data: {
              brand_id: brand.id,
              url: url.trim(),
            },
          });
        } catch (error: any) {
          // Skip if duplicate (unique constraint violation)
          if (error.code !== "P2002") {
            console.error(
              `[syncRedditLinksToBrands] Error adding Reddit link to BrandRedditLink for brand ${brand.id}:`,
              error
            );
          }
        }
      }

      // Add new links to BrandAdditionalLink (for admin panel)
      for (const url of urlsToAdd) {
        try {
          await prisma.brandAdditionalLink.create({
            data: {
              brand_id: brand.id,
              link_type: "REDDIT",
              platform: null,
              source_category: null,
              url: url.trim(),
              channel_name: null,
            },
          });
          brandLinksAdded++;
          totalLinksAdded++;
        } catch (error: any) {
          // Skip if duplicate (unique constraint violation)
          if (error.code !== "P2002") {
            console.error(
              `[syncRedditLinksToBrands] Error adding Reddit link to BrandAdditionalLink for brand ${brand.id}:`,
              error
            );
          }
        }
      }

      if (brandLinksAdded > 0) {
        console.log(
          `[syncRedditLinksToBrands] Added ${brandLinksAdded} Reddit links to brand ${brand.id}`
        );
      }
      updatedCount++;
    }
  }

  console.log(
    `[syncRedditLinksToBrands] Completed: synced to ${updatedCount} brands, added ${totalLinksAdded} total links`
  );
  return updatedCount;
}
