/**
 * Service for managing hierarchical other source links (News Outlets, Blogs, Podcasts) for taxonomy nodes
 *
 * Links can be added at three levels:
 * - Category level (applies to all subcategories and sub-subcategories)
 * - Subcategory level (applies to all sub-subcategories under that subcategory)
 * - Sub-subcategory level (applies only to that specific taxonomy entry)
 *
 * When querying links for a taxonomy node, all parent-level links are inherited and combined.
 */

import { prisma } from "@/lib/prisma";
import type { SourceCategory } from "./brand-additional-links-service";

export interface OtherSourceLink {
  id: string;
  url: string;
  source_category: SourceCategory;
  channel_name: string | null;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
  level: "category" | "subcategory" | "sub_subcategory";
  created_at: Date;
  updated_at: Date;
}

export interface OtherSourceLinkInput {
  url: string;
  source_category: SourceCategory;
  channel_name?: string | null;
  category: string;
  subcategory?: string | null;
  sub_subcategory?: string | null;
}

/**
 * Get all other source links for a taxonomy node, including inherited links from parent levels
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Array of all applicable other source links (including inherited ones)
 */
export async function getOtherSourceLinksForTaxonomy(
  taxonomyId: string
): Promise<OtherSourceLink[]> {
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
  const links = await prisma.taxonomyOtherSourceLink.findMany({
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
    `[getOtherSourceLinksForTaxonomy] Found ${links.length} other source links for taxonomy ${taxonomyId}`
  );

  // Deduplicate by URL + source_category (normalize URLs for comparison)
  const seenKeys = new Set<string>();
  const uniqueLinks = links.filter((link) => {
    const normalizedUrl = link.url.toLowerCase().trim().replace(/\/+$/, "");
    const key = `${link.source_category}:${normalizedUrl}`;
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });

  console.log(
    `[getOtherSourceLinksForTaxonomy] After deduplication: ${uniqueLinks.length} unique links`
  );

  // Transform to include level information
  return uniqueLinks.map((link) => ({
    id: link.id,
    url: link.url,
    source_category: link.source_category as SourceCategory,
    channel_name: link.channel_name,
    category: link.category,
    subcategory: link.subcategory,
    sub_subcategory: link.sub_subcategory,
    level: link.sub_subcategory ? "sub_subcategory" : link.subcategory ? "subcategory" : "category",
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Get other source links for a category (all links at category level)
 */
export async function getOtherSourceLinksForCategory(category: string): Promise<OtherSourceLink[]> {
  const links = await prisma.taxonomyOtherSourceLink.findMany({
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
    source_category: link.source_category as SourceCategory,
    channel_name: link.channel_name,
    category: link.category,
    subcategory: null,
    sub_subcategory: null,
    level: "category" as const,
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Get other source links for a subcategory (category + subcategory level links)
 */
export async function getOtherSourceLinksForSubcategory(
  category: string,
  subcategory: string
): Promise<OtherSourceLink[]> {
  const links = await prisma.taxonomyOtherSourceLink.findMany({
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
    source_category: link.source_category as SourceCategory,
    channel_name: link.channel_name,
    category: link.category,
    subcategory: link.subcategory,
    sub_subcategory: null,
    level: link.subcategory ? ("subcategory" as const) : ("category" as const),
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Add other source links to a taxonomy node
 *
 * @param links - Array of other source link inputs
 * @param taxonomyId - Optional taxonomy ID (for sub-subcategory level)
 * @returns Array of created links
 */
export async function addOtherSourceLinks(
  links: OtherSourceLinkInput[],
  taxonomyId?: string
): Promise<OtherSourceLink[]> {
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

  // Find-or-create per link so we never insert duplicates (same path + url + source_category).
  const createdLinks: OtherSourceLink[] = [];
  const sub = subcategory ?? null;
  const subSub = sub_subcategory ?? null;

  for (const link of links) {
    const linkSub = sub ?? link.subcategory ?? null;
    const linkSubSub = subSub ?? link.sub_subcategory ?? null;

    const existing = await prisma.taxonomyOtherSourceLink.findFirst({
      where: {
        category,
        subcategory: linkSub,
        sub_subcategory: linkSubSub,
        source_category: link.source_category,
        url: link.url.trim(),
        deleted_at: null,
      },
    });

    if (existing) {
      if (taxonomyId && existing.taxonomy_id !== taxonomyId) {
        await prisma.taxonomyOtherSourceLink.update({
          where: { id: existing.id },
          data: { taxonomy_id: taxonomyId },
        });
      }
      createdLinks.push({
        id: existing.id,
        url: existing.url,
        source_category: existing.source_category as SourceCategory,
        channel_name: existing.channel_name,
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
      continue;
    }

    const created = await prisma.taxonomyOtherSourceLink.create({
      data: {
        category,
        subcategory: linkSub,
        sub_subcategory: linkSubSub,
        source_category: link.source_category,
        url: link.url.trim(),
        channel_name: link.channel_name?.trim() || null,
        taxonomy_id: taxonomyId ?? null,
      },
    });

    createdLinks.push({
      id: created.id,
      url: created.url,
      source_category: created.source_category as SourceCategory,
      channel_name: created.channel_name,
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
  }

  // Sync other source links to all brands under this taxonomy node
  if (taxonomyId) {
    await syncOtherSourceLinksToBrands(taxonomyId);
  } else {
    // For category/subcategory level, find all matching taxonomies and sync
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
        await syncOtherSourceLinksToBrands(taxonomy.id);
      } catch (error) {
        console.error(
          `[addOtherSourceLinks] Error syncing other source links for taxonomy ${taxonomy.id}:`,
          error
        );
      }
    }
  }

  return createdLinks;
}

/**
 * Delete an other source link by ID
 */
export async function deleteOtherSourceLink(linkId: string): Promise<void> {
  await prisma.taxonomyOtherSourceLink.update({
    where: { id: linkId },
    data: { deleted_at: new Date() },
  });
}

/**
 * Sync other source links from a taxonomy node to all brands under that taxonomy
 * This propagates taxonomy-level other source links to brands hierarchically
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Number of brands updated
 */
export async function syncOtherSourceLinksToBrands(taxonomyId: string): Promise<number> {
  // Get all applicable other source links for this taxonomy (including inherited ones)
  const taxonomyLinks = await getOtherSourceLinksForTaxonomy(taxonomyId);

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
    },
  });

  if (brands.length === 0) {
    return 0;
  }

  // Group links by source category
  const linksByCategory = new Map<
    SourceCategory,
    Array<{ url: string; channel_name: string | null }>
  >();
  for (const link of taxonomyLinks) {
    if (!linksByCategory.has(link.source_category)) {
      linksByCategory.set(link.source_category, []);
    }
    linksByCategory.get(link.source_category)!.push({
      url: link.url,
      channel_name: link.channel_name,
    });
  }

  // Helper to normalize URLs for comparison
  const normalizeUrl = (url: string): string => {
    return url
      .toLowerCase()
      .trim()
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
  };

  // For each brand, add taxonomy other source links (if they don't already exist)
  let updatedCount = 0;
  let totalLinksAdded = 0;
  console.log(
    `[syncOtherSourceLinksToBrands] Syncing ${taxonomyLinks.length} other source links to ${brands.length} brands for taxonomy ${taxonomyId}`
  );

  for (const brand of brands) {
    // Get existing brand other source links
    const existingLinks = await prisma.brandAdditionalLink.findMany({
      where: {
        brand_id: brand.id,
        link_type: "OTHER_SOURCE",
        deleted_at: null,
      },
      select: {
        source_category: true,
        url: true,
      },
    });

    const existingUrlsByCategory = new Map<SourceCategory, Set<string>>();
    for (const link of existingLinks) {
      if (link.source_category) {
        const category = link.source_category as SourceCategory;
        if (!existingUrlsByCategory.has(category)) {
          existingUrlsByCategory.set(category, new Set());
        }
        // Normalize URL for comparison
        existingUrlsByCategory.get(category)!.add(normalizeUrl(link.url));
      }
    }

    // Add new links for each source category
    let brandLinksAdded = 0;
    for (const [sourceCategory, links] of linksByCategory.entries()) {
      const existingUrls = existingUrlsByCategory.get(sourceCategory) || new Set();

      for (const link of links) {
        const normalizedUrl = normalizeUrl(link.url);
        if (!existingUrls.has(normalizedUrl)) {
          try {
            await prisma.brandAdditionalLink.create({
              data: {
                brand_id: brand.id,
                link_type: "OTHER_SOURCE",
                source_category: sourceCategory,
                url: link.url.trim(),
                channel_name: link.channel_name?.trim() || null,
              },
            });
            brandLinksAdded++;
            totalLinksAdded++;
          } catch (error: any) {
            // Skip if duplicate (unique constraint violation)
            if (error.code !== "P2002") {
              console.error(
                `[syncOtherSourceLinksToBrands] Error adding other source link to brand ${brand.id}:`,
                error
              );
            }
          }
        }
      }
    }

    if (brandLinksAdded > 0) {
      console.log(
        `[syncOtherSourceLinksToBrands] Added ${brandLinksAdded} other source links to brand ${brand.id}`
      );
    }
    updatedCount++;
  }

  console.log(
    `[syncOtherSourceLinksToBrands] Completed: synced to ${updatedCount} brands, added ${totalLinksAdded} total links`
  );
  return updatedCount;
}
