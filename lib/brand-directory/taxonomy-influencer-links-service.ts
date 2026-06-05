/**
 * Service for managing hierarchical influencer links for taxonomy nodes
 *
 * Links can be added at three levels:
 * - Category level (applies to all subcategories and sub-subcategories)
 * - Subcategory level (applies to all sub-subcategories under that subcategory)
 * - Sub-subcategory level (applies only to that specific taxonomy entry)
 *
 * When querying links for a taxonomy node, all parent-level links are inherited and combined.
 */

import { prisma } from "@/lib/prisma";
import { normalizeYouTubeUrl } from "@/lib/utils/youtube-url-normalization";
import type { InfluencerPlatform } from "./brand-additional-links-service";

export interface InfluencerLink {
  id: string;
  url: string;
  platform: InfluencerPlatform;
  channel_name: string | null;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
  level: "category" | "subcategory" | "sub_subcategory";
  created_at: Date;
  updated_at: Date;
}

export interface InfluencerLinkInput {
  url: string;
  platform: InfluencerPlatform;
  channel_name?: string | null;
  category: string;
  subcategory?: string | null;
  sub_subcategory?: string | null;
}

/**
 * Get all influencer links for a taxonomy node, including inherited links from parent levels
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Array of all applicable influencer links (including inherited ones)
 */
export async function getInfluencerLinksForTaxonomy(taxonomyId: string): Promise<InfluencerLink[]> {
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
  const links = await prisma.taxonomyInfluencerLink.findMany({
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
    `[getInfluencerLinksForTaxonomy] Found ${links.length} influencer links for taxonomy ${taxonomyId}`
  );

  // Deduplicate by URL + platform (normalize URLs for comparison)
  const seenKeys = new Set<string>();
  const uniqueLinks = links.filter((link) => {
    const normalizedUrl = link.url.toLowerCase().trim().replace(/\/+$/, "");
    const key = `${link.platform}:${normalizedUrl}`;
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });

  console.log(
    `[getInfluencerLinksForTaxonomy] After deduplication: ${uniqueLinks.length} unique links`
  );

  // Transform to include level information
  return uniqueLinks.map((link) => ({
    id: link.id,
    url: link.url,
    platform: link.platform as InfluencerPlatform,
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
 * Get influencer links for a category (all links at category level)
 */
export async function getInfluencerLinksForCategory(category: string): Promise<InfluencerLink[]> {
  const links = await prisma.taxonomyInfluencerLink.findMany({
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
    platform: link.platform as InfluencerPlatform,
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
 * Get influencer links for a subcategory (category + subcategory level links)
 */
export async function getInfluencerLinksForSubcategory(
  category: string,
  subcategory: string
): Promise<InfluencerLink[]> {
  const links = await prisma.taxonomyInfluencerLink.findMany({
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
    platform: link.platform as InfluencerPlatform,
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
 * Add influencer links to a taxonomy node
 *
 * @param links - Array of influencer link inputs
 * @param taxonomyId - Optional taxonomy ID (for sub-subcategory level)
 * @returns Array of created links
 */
export async function addInfluencerLinks(
  links: InfluencerLinkInput[],
  taxonomyId?: string
): Promise<InfluencerLink[]> {
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

  // Create all links
  const createdLinks: InfluencerLink[] = [];
  let skippedCount = 0;

  for (const link of links) {
    try {
      // Normalize YouTube URLs to @ format
      let normalizedUrl = link.url;
      if (link.platform === "YOUTUBE") {
        normalizedUrl = normalizeYouTubeUrl(normalizedUrl);
      }

      const created = await prisma.taxonomyInfluencerLink.create({
        data: {
          category,
          subcategory: subcategory ?? link.subcategory ?? null,
          sub_subcategory: sub_subcategory ?? link.sub_subcategory ?? null,
          platform: link.platform,
          url: normalizedUrl,
          channel_name: link.channel_name?.trim() || null,
          taxonomy_id: taxonomyId ?? null,
        },
      });

      createdLinks.push({
        id: created.id,
        url: created.url,
        platform: created.platform as InfluencerPlatform,
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
    } catch (error: any) {
      // Skip duplicates (P2002) or other expected errors
      if (error.code === "P2002") {
        skippedCount++;
        console.log(
          `[addInfluencerLinks] Skipping duplicate influencer link: ${link.url} (${link.platform})`
        );
        // Try to find existing link to return it
        const existing = await prisma.taxonomyInfluencerLink.findFirst({
          where: {
            url: link.url,
            platform: link.platform,
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
            platform: existing.platform as InfluencerPlatform,
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
        }
      } else {
        // Re-throw unexpected errors
        console.error(`[addInfluencerLinks] Error creating influencer link ${link.url}:`, error);
        throw error;
      }
    }
  }

  if (skippedCount > 0) {
    console.log(`[addInfluencerLinks] Skipped ${skippedCount} duplicate influencer links`);
  }

  // Sync influencer links to all brands under this taxonomy node
  if (taxonomyId) {
    await syncInfluencerLinksToBrands(taxonomyId);
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
        await syncInfluencerLinksToBrands(taxonomy.id);
      } catch (error) {
        console.error(
          `[addInfluencerLinks] Error syncing influencer links for taxonomy ${taxonomy.id}:`,
          error
        );
      }
    }
  }

  return createdLinks;
}

/**
 * Delete an influencer link by ID
 */
export async function deleteInfluencerLink(linkId: string): Promise<void> {
  await prisma.taxonomyInfluencerLink.update({
    where: { id: linkId },
    data: { deleted_at: new Date() },
  });
}

/**
 * Sync influencer links from a taxonomy node to all brands under that taxonomy
 * This propagates taxonomy-level influencer links to brands hierarchically
 *
 * @param taxonomyId - The ID of the BusinessTaxonomy entry
 * @returns Number of brands updated
 */
export async function syncInfluencerLinksToBrands(taxonomyId: string): Promise<number> {
  // Get all applicable influencer links for this taxonomy (including inherited ones)
  const taxonomyLinks = await getInfluencerLinksForTaxonomy(taxonomyId);

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

  // Group links by platform
  const linksByPlatform = new Map<
    InfluencerPlatform,
    Array<{ url: string; channel_name: string | null }>
  >();
  for (const link of taxonomyLinks) {
    if (!linksByPlatform.has(link.platform)) {
      linksByPlatform.set(link.platform, []);
    }
    linksByPlatform.get(link.platform)!.push({
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

  // For each brand, add taxonomy influencer links (if they don't already exist)
  let updatedCount = 0;
  let totalLinksAdded = 0;
  console.log(
    `[syncInfluencerLinksToBrands] Syncing ${taxonomyLinks.length} influencer links to ${brands.length} brands for taxonomy ${taxonomyId}`
  );

  for (const brand of brands) {
    // Get existing brand influencer links
    const existingLinks = await prisma.brandAdditionalLink.findMany({
      where: {
        brand_id: brand.id,
        link_type: "INFLUENCER",
        deleted_at: null,
      },
      select: {
        platform: true,
        url: true,
      },
    });

    const existingUrlsByPlatform = new Map<InfluencerPlatform, Set<string>>();
    for (const link of existingLinks) {
      if (link.platform) {
        if (!existingUrlsByPlatform.has(link.platform as InfluencerPlatform)) {
          existingUrlsByPlatform.set(link.platform as InfluencerPlatform, new Set());
        }
        // Normalize URL for comparison
        existingUrlsByPlatform
          .get(link.platform as InfluencerPlatform)!
          .add(normalizeUrl(link.url));
      }
    }

    // Add new links for each platform
    let brandLinksAdded = 0;
    for (const [platform, links] of linksByPlatform.entries()) {
      const existingUrls = existingUrlsByPlatform.get(platform) || new Set();

      for (const link of links) {
        // Normalize YouTube URLs to @ format
        let urlToSave = link.url.trim();
        if (platform === "YOUTUBE") {
          urlToSave = normalizeYouTubeUrl(urlToSave);
        }

        const normalizedUrl = normalizeUrl(urlToSave);
        if (!existingUrls.has(normalizedUrl)) {
          try {
            await prisma.brandAdditionalLink.create({
              data: {
                brand_id: brand.id,
                link_type: "INFLUENCER",
                platform: platform,
                url: urlToSave,
                channel_name: link.channel_name?.trim() || null,
              },
            });
            brandLinksAdded++;
            totalLinksAdded++;
          } catch (error: any) {
            // Skip if duplicate (unique constraint violation)
            if (error.code !== "P2002") {
              console.error(
                `[syncInfluencerLinksToBrands] Error adding influencer link to brand ${brand.id}:`,
                error
              );
            }
          }
        }
      }
    }

    if (brandLinksAdded > 0) {
      console.log(
        `[syncInfluencerLinksToBrands] Added ${brandLinksAdded} influencer links to brand ${brand.id}`
      );
    }
    updatedCount++;
  }

  console.log(
    `[syncInfluencerLinksToBrands] Completed: synced to ${updatedCount} brands, added ${totalLinksAdded} total links`
  );
  return updatedCount;
}
