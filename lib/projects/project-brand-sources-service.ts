/**
 * Service for managing project-specific brand sources
 * Project sources completely override brand directory sources when they exist
 */

import { prisma } from "@/lib/prisma";
import {
  getInfluencerLinksForTaxonomy,
  addInfluencerLinks,
} from "@/lib/brand-directory/taxonomy-influencer-links-service";
import { syncInfluencerLinksToBrands } from "@/lib/brand-directory/taxonomy-influencer-links-service";
import {
  getRedditLinksForTaxonomy,
  addRedditLinks,
} from "@/lib/brand-directory/reddit-links-service";
import { syncRedditLinksToBrands } from "@/lib/brand-directory/reddit-links-service";
import {
  getOtherSourceLinksForTaxonomy,
  addOtherSourceLinks,
} from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { syncOtherSourceLinksToBrands } from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { getAdditionalLinksForBrand } from "@/lib/brand-directory/brand-additional-links-service";
import { getRedditLinksForBrand } from "@/lib/brand-directory/brand-reddit-links-service";
import type {
  LinkType,
  InfluencerPlatform,
  SourceCategory,
} from "@/lib/brand-directory/brand-additional-links-service";
import { normalizeYouTubeUrl } from "@/lib/utils/youtube-url-normalization";

export interface ProjectBrandSource {
  id: string;
  project_id: string;
  brand_id: string;
  link_type: LinkType;
  platform: InfluencerPlatform | null;
  source_category: SourceCategory | null;
  url: string;
  channel_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SourceInput {
  link_type: LinkType;
  platform?: InfluencerPlatform;
  source_category?: SourceCategory;
  url: string;
  channel_name?: string;
}

/**
 * Get default sources for a brand (from brand directory + taxonomy)
 * This includes:
 * - Brand direct URLs (linkedin_url, x_url, facebook_url)
 * - BrandAdditionalLink entries
 * - BrandRedditLink entries
 * - TaxonomyInfluencerLink (inherited)
 * - TaxonomyRedditLink (inherited)
 * - TaxonomyOtherSourceLink (inherited)
 */
export async function getDefaultSourcesForBrand(brandId: string): Promise<SourceInput[]> {
  const sources: SourceInput[] = [];

  try {
    // Fetch brand with taxonomy
    const brand = await prisma.brand.findUnique({
      where: { id: brandId, deleted_at: null },
      include: {
        businessTaxonomy: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!brand) {
      return [];
    }

    // Collect direct brand URLs
    if (brand.linkedin_url) {
      sources.push({
        link_type: "INFLUENCER",
        platform: "LINKEDIN",
        url: brand.linkedin_url,
      });
    }
    if (brand.x_url) {
      sources.push({
        link_type: "INFLUENCER",
        platform: "TWITTER",
        url: brand.x_url,
      });
    }
    if (brand.facebook_url) {
      sources.push({
        link_type: "INFLUENCER",
        platform: "FACEBOOK",
        url: brand.facebook_url,
      });
    }

    // Collect brand-specific Reddit links
    const brandRedditLinks = await getRedditLinksForBrand(brandId);
    for (const link of brandRedditLinks) {
      sources.push({
        link_type: "REDDIT",
        url: link.url,
      });
    }

    // Collect brand-specific additional links
    const brandAdditionalLinks = await getAdditionalLinksForBrand(brandId);
    for (const link of brandAdditionalLinks) {
      sources.push({
        link_type: link.link_type,
        platform: link.platform || undefined,
        source_category: link.source_category || undefined,
        url: link.url,
        channel_name: link.channel_name || undefined,
      });
    }

    // Get taxonomy-level links (inherited from taxonomy hierarchy)
    if (brand.businessTaxonomy) {
      const taxonomyId = brand.businessTaxonomy.id;

      // Get influencer links from taxonomy
      const taxonomyInfluencerLinks = await getInfluencerLinksForTaxonomy(taxonomyId);
      for (const link of taxonomyInfluencerLinks) {
        sources.push({
          link_type: "INFLUENCER",
          platform: link.platform,
          url: link.url,
          channel_name: link.channel_name || undefined,
        });
      }

      // Get Reddit links from taxonomy
      const taxonomyRedditLinks = await getRedditLinksForTaxonomy(taxonomyId);
      for (const link of taxonomyRedditLinks) {
        sources.push({
          link_type: "REDDIT",
          url: link.url,
        });
      }

      // Get other source links from taxonomy
      const taxonomyOtherSourceLinks = await getOtherSourceLinksForTaxonomy(taxonomyId);
      for (const link of taxonomyOtherSourceLinks) {
        sources.push({
          link_type: "OTHER_SOURCE",
          source_category: link.source_category,
          url: link.url,
          channel_name: link.channel_name || undefined,
        });
      }
    }

    return sources;
  } catch (error) {
    console.error(
      `[getDefaultSourcesForBrand] Error fetching default sources for brand ${brandId}:`,
      error
    );
    return [];
  }
}

/**
 * Get project-specific sources for a brand
 */
export async function getProjectSourcesForBrand(
  projectId: string,
  brandId: string
): Promise<ProjectBrandSource[]> {
  try {
    const sources = await prisma.projectBrandSource.findMany({
      where: {
        project_id: projectId,
        brand_id: brandId,
        deleted_at: null,
      },
      orderBy: { created_at: "asc" },
    });

    return sources.map((source) => ({
      id: source.id,
      project_id: source.project_id,
      brand_id: source.brand_id,
      link_type: source.link_type as LinkType,
      platform: source.platform as InfluencerPlatform | null,
      source_category: source.source_category as SourceCategory | null,
      url: source.url,
      channel_name: source.channel_name,
      created_at: source.created_at,
      updated_at: source.updated_at,
    }));
  } catch (error) {
    console.error(
      `[getProjectSourcesForBrand] Error fetching project sources for project ${projectId}, brand ${brandId}:`,
      error
    );
    return [];
  }
}

/**
 * Get effective sources for a brand (project sources if they exist, otherwise default sources)
 */
export async function getEffectiveSourcesForBrand(
  projectId: string,
  brandId: string
): Promise<SourceInput[]> {
  // Check if project-specific sources exist
  const projectSources = await getProjectSourcesForBrand(projectId, brandId);

  if (projectSources.length > 0) {
    // Return project sources (completely override defaults)
    return projectSources.map((source) => ({
      link_type: source.link_type,
      platform: source.platform || undefined,
      source_category: source.source_category || undefined,
      url: source.url,
      channel_name: source.channel_name || undefined,
    }));
  }

  // No project sources, return defaults
  return await getDefaultSourcesForBrand(brandId);
}

/**
 * Save project-specific sources for a brand
 * Replaces all existing project sources for that brand
 * Also saves sources to the taxonomy catalog
 */
import { createDedupKey } from "@/lib/utils/url-deduplication";

/**
 * Deduplicate sources by URL (and platform/source_category for specific types)
 */
function deduplicateSources(sources: SourceInput[]): SourceInput[] {
  const seen = new Set<string>();
  const deduplicated: SourceInput[] = [];
  let duplicateCount = 0;

  console.log(`[deduplicateSources] Starting deduplication of ${sources.length} sources`);

  for (const source of sources) {
    if (!source.url || !source.url.trim()) {
      console.log(`[deduplicateSources] Skipping empty URL source:`, source);
      continue; // Skip empty URLs
    }

    const key = createDedupKey(
      source.url,
      source.link_type,
      source.platform,
      source.source_category
    );

    console.log(
      `[deduplicateSources] Source: ${source.url} | Type: ${source.link_type} | Platform: ${source.platform || "MISSING"} | Category: ${source.source_category || "N/A"} | Key: ${key}`
    );

    if (seen.has(key)) {
      duplicateCount++;
      console.log(
        `[deduplicateSources] DUPLICATE DETECTED - Skipping: ${source.url} (${source.link_type}${source.platform ? ` - ${source.platform}` : " - NO PLATFORM"}${source.source_category ? ` - ${source.source_category}` : ""}) | Key: ${key}`
      );
      continue;
    }

    seen.add(key);
    deduplicated.push(source);
    console.log(`[deduplicateSources] KEEPING: ${source.url} | Key: ${key}`);
  }

  if (duplicateCount > 0) {
    console.log(
      `[deduplicateSources] SUMMARY: Removed ${duplicateCount} duplicate sources. Original: ${sources.length}, Deduplicated: ${deduplicated.length}`
    );
  } else {
    console.log(
      `[deduplicateSources] SUMMARY: No duplicates found. All ${sources.length} sources kept.`
    );
  }

  return deduplicated;
}

export async function saveProjectBrandSources(
  projectId: string,
  brandId: string,
  sources: SourceInput[]
): Promise<ProjectBrandSource[]> {
  console.log(
    `[saveProjectBrandSources] Starting save for project ${projectId}, brand ${brandId}, ${sources.length} sources`
  );

  // Deduplicate sources - only removes TRUE duplicates (same URL, platform, type)
  const deduplicatedSources = deduplicateSources(sources);
  console.log(
    `[saveProjectBrandSources] After deduplication: ${deduplicatedSources.length} sources (removed ${sources.length - deduplicatedSources.length} duplicates)`
  );

  // Get brand with taxonomy information
  const brand = await prisma.brand.findUnique({
    where: { id: brandId, deleted_at: null },
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

  if (!brand) {
    throw new Error(`Brand with ID ${brandId} not found`);
  }

  // Get taxonomy information for saving to taxonomy catalog
  const taxonomyId = brand.businessTaxonomy?.id;
  const category = brand.businessTaxonomy?.category;
  const subcategory = brand.businessTaxonomy?.subcategory;
  const sub_subcategory = brand.businessTaxonomy?.sub_subcategory;

  console.log(`[saveProjectBrandSources] Brand ${brandId} taxonomy info:`, {
    hasTaxonomy: !!brand.businessTaxonomy,
    taxonomyId,
    category,
    subcategory,
    sub_subcategory,
  });

  if (!taxonomyId || !category) {
    console.warn(
      `[saveProjectBrandSources] Brand ${brandId} has no taxonomy - skipping taxonomy catalog save`
    );
  }

  // Group sources by type for taxonomy catalog save
  const influencerLinksForTaxonomy: Array<{
    url: string;
    platform: InfluencerPlatform;
    channel_name?: string | null;
    category: string;
    subcategory?: string | null;
    sub_subcategory?: string | null;
  }> = [];
  const redditLinksForTaxonomy: Array<{
    url: string;
    category: string;
    subcategory?: string | null;
    sub_subcategory?: string | null;
  }> = [];
  const otherSourceLinksForTaxonomy: Array<{
    url: string;
    source_category: SourceCategory;
    channel_name?: string | null;
    category: string;
    subcategory?: string | null;
    sub_subcategory?: string | null;
  }> = [];

  // Save project sources first
  // Increase timeout for large batches (default is 5 seconds, increase to 30 seconds for large source lists)
  const createdSources = await prisma.$transaction(
    async (tx) => {
      // Soft delete existing project sources for this brand
      const deletedCount = await tx.projectBrandSource.updateMany({
        where: {
          project_id: projectId,
          brand_id: brandId,
          deleted_at: null,
        },
        data: { deleted_at: new Date() },
      });
      console.log(`[saveProjectBrandSources] Soft deleted ${deletedCount.count} existing sources`);

      // Create new sources (using deduplicated sources)
      const sourcesToReturn: ProjectBrandSource[] = [];
      let skippedCount = 0;
      let errorCount = 0;

      for (const source of deduplicatedSources) {
        if (!source.url || !source.url.trim()) {
          console.log(`[saveProjectBrandSources] Skipping source with empty URL:`, source);
          skippedCount++;
          continue;
        }

        // Validate platform requirement for INFLUENCER
        if (source.link_type === "INFLUENCER" && !source.platform) {
          console.error(
            `[saveProjectBrandSources] Missing platform for INFLUENCER source:`,
            source
          );
          errorCount++;
          throw new Error(`Platform is required for INFLUENCER link type. Source: ${source.url}`);
        }

        // Validate source_category requirement for OTHER_SOURCE
        if (source.link_type === "OTHER_SOURCE" && !source.source_category) {
          console.error(
            `[saveProjectBrandSources] Missing source_category for OTHER_SOURCE:`,
            source
          );
          errorCount++;
          throw new Error(
            `Source category is required for OTHER_SOURCE link type. Source: ${source.url}`
          );
        }

        // Prepare sources for taxonomy catalog BEFORE trying to create (so we save to taxonomy even if ProjectBrandSource is duplicate)
        // Skip DISCORD as there's no taxonomy table for it
        if (taxonomyId && category) {
          if (source.link_type === "INFLUENCER" && source.platform) {
            // Normalize YouTube URLs to @ format
            let normalizedUrl = source.url.trim();
            if (source.platform === "YOUTUBE") {
              normalizedUrl = normalizeYouTubeUrl(normalizedUrl);
            }

            influencerLinksForTaxonomy.push({
              url: normalizedUrl,
              platform: source.platform,
              channel_name: source.channel_name?.trim() || null,
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            });
            if (influencerLinksForTaxonomy.length <= 3) {
              console.log(
                `[saveProjectBrandSources] Added influencer link to taxonomy array: ${source.url} (${source.platform})`
              );
            }
          } else if (source.link_type === "REDDIT") {
            redditLinksForTaxonomy.push({
              url: source.url.trim(),
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            });
            if (redditLinksForTaxonomy.length <= 3) {
              console.log(
                `[saveProjectBrandSources] Added Reddit link to taxonomy array: ${source.url}`
              );
            }
          } else if (source.link_type === "OTHER_SOURCE" && source.source_category) {
            otherSourceLinksForTaxonomy.push({
              url: source.url.trim(),
              source_category: source.source_category,
              channel_name: source.channel_name?.trim() || null,
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            });
            if (otherSourceLinksForTaxonomy.length <= 3) {
              console.log(
                `[saveProjectBrandSources] Added other source link to taxonomy array: ${source.url} (${source.source_category})`
              );
            }
          }
        } else {
          if (deduplicatedSources.indexOf(source) < 3) {
            console.log(
              `[saveProjectBrandSources] Skipping taxonomy array add for ${source.url}: taxonomyId=${taxonomyId}, category=${category}`
            );
          }
        }

        try {
          // Use upsert to handle existing records (including soft-deleted ones)
          // The unique constraint is on (project_id, brand_id, url) and doesn't include deleted_at
          // So we need to update existing records instead of creating new ones
          const created = await tx.projectBrandSource.upsert({
            where: {
              project_id_brand_id_url: {
                project_id: projectId,
                brand_id: brandId,
                url: source.url.trim(),
              },
            },
            update: {
              link_type: source.link_type,
              platform: source.link_type === "INFLUENCER" ? source.platform! : null,
              source_category: source.link_type === "OTHER_SOURCE" ? source.source_category! : null,
              channel_name: source.channel_name?.trim() || null,
              deleted_at: null, // Restore if it was soft-deleted
              updated_at: new Date(),
            },
            create: {
              project_id: projectId,
              brand_id: brandId,
              link_type: source.link_type,
              platform: source.link_type === "INFLUENCER" ? source.platform! : null,
              source_category: source.link_type === "OTHER_SOURCE" ? source.source_category! : null,
              url: source.url.trim(),
              channel_name: source.channel_name?.trim() || null,
            },
          });

          console.log(`[saveProjectBrandSources] Created source:`, {
            id: created.id,
            link_type: created.link_type,
            platform: created.platform,
            url: created.url,
          });

          sourcesToReturn.push({
            id: created.id,
            project_id: created.project_id,
            brand_id: created.brand_id,
            link_type: created.link_type as LinkType,
            platform: created.platform as InfluencerPlatform | null,
            source_category: created.source_category as SourceCategory | null,
            url: created.url,
            channel_name: created.channel_name,
            created_at: created.created_at,
            updated_at: created.updated_at,
          });
        } catch (error: any) {
          // Skip duplicate entries (unique constraint violation)
          if (error.code === "P2002") {
            console.log(
              `[saveProjectBrandSources] Skipping duplicate project brand source: ${source.url}`,
              error.meta
            );
            skippedCount++;
            // Note: Source is already added to taxonomy arrays above, so it will still be saved to taxonomy catalog
            continue;
          }
          console.error(`[saveProjectBrandSources] Error creating source:`, source, error);
          errorCount++;
          throw error;
        }
      }

      console.log(
        `[saveProjectBrandSources] Completed: created ${sourcesToReturn.length}, skipped ${skippedCount}, errors ${errorCount}`
      );
      return sourcesToReturn;
    },
    {
      timeout: 30000, // 30 seconds timeout for large batches
    }
  );

  // Save to taxonomy catalog after transaction completes successfully
  console.log(
    `[saveProjectBrandSources] After transaction: taxonomyId=${taxonomyId}, category=${category}`
  );
  console.log(
    `[saveProjectBrandSources] Taxonomy arrays: ${influencerLinksForTaxonomy.length} influencer, ${redditLinksForTaxonomy.length} Reddit, ${otherSourceLinksForTaxonomy.length} other source links`
  );

  if (taxonomyId && category) {
    console.log(`[saveProjectBrandSources] Proceeding to save to taxonomy catalog`);
    try {
      if (influencerLinksForTaxonomy.length > 0) {
        console.log(
          `[saveProjectBrandSources] Saving ${influencerLinksForTaxonomy.length} influencer links to taxonomy catalog for taxonomy ${taxonomyId}`
        );
        let syncNeeded = false;

        // First, update any existing links that have taxonomy_id: null (match by URL + platform only)
        let updatedCount = 0;
        for (const link of influencerLinksForTaxonomy) {
          // Try to update ANY link with this URL + platform that has taxonomy_id: null
          const updated = await prisma.taxonomyInfluencerLink.updateMany({
            where: {
              url: link.url.trim(),
              platform: link.platform,
              deleted_at: null,
              taxonomy_id: null,
            },
            data: {
              taxonomy_id: taxonomyId,
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            },
          });
          if (updated.count > 0) {
            updatedCount += updated.count;
            console.log(
              `[saveProjectBrandSources] Updated ${updated.count} influencer link(s) with URL ${link.url} (${link.platform}) to set taxonomy_id=${taxonomyId}`
            );
          }
        }
        if (updatedCount > 0) {
          console.log(
            `[saveProjectBrandSources] Updated ${updatedCount} existing influencer links to set taxonomy_id`
          );
          syncNeeded = true;
        }

        try {
          const savedLinks = await addInfluencerLinks(influencerLinksForTaxonomy, taxonomyId);
          console.log(
            `[saveProjectBrandSources] Successfully saved ${savedLinks.length} influencer links to taxonomy catalog`
          );
          syncNeeded = true; // addInfluencerLinks should have synced, but we'll verify
        } catch (error: any) {
          // Handle duplicate errors gracefully - check if links already exist
          if (error.code === "P2002" || error.message?.includes("Unique constraint")) {
            console.log(
              `[saveProjectBrandSources] Some influencer links already exist in taxonomy catalog, updating taxonomy_id and syncing`
            );
            // Try to update existing links to set taxonomy_id if it's null, then create if needed
            let anyAdded = false;
            let anyUpdated = 0;
            for (const link of influencerLinksForTaxonomy) {
              try {
                // Update existing links with taxonomy_id: null
                const updated = await prisma.taxonomyInfluencerLink.updateMany({
                  where: {
                    url: link.url,
                    platform: link.platform,
                    category,
                    subcategory: subcategory || null,
                    sub_subcategory: sub_subcategory || null,
                    deleted_at: null,
                    taxonomy_id: null,
                  },
                  data: {
                    taxonomy_id: taxonomyId,
                  },
                });

                if (updated.count > 0) {
                  anyUpdated += updated.count;
                  console.log(
                    `[saveProjectBrandSources] Updated ${updated.count} existing influencer link(s) to set taxonomy_id: ${link.url}`
                  );
                }

                // Try to create if it doesn't exist
                try {
                  await prisma.taxonomyInfluencerLink.create({
                    data: {
                      category,
                      subcategory: subcategory || null,
                      sub_subcategory: sub_subcategory || null,
                      platform: link.platform,
                      url: link.url,
                      channel_name: link.channel_name,
                      taxonomy_id: taxonomyId,
                    },
                  });
                  anyAdded = true;
                } catch (createError: any) {
                  if (createError.code !== "P2002") {
                    throw createError;
                  }
                }
              } catch (dupError: any) {
                if (dupError.code !== "P2002") {
                  console.error(
                    `[saveProjectBrandSources] Error processing influencer link ${link.url}:`,
                    dupError
                  );
                }
              }
            }
            console.log(
              `[saveProjectBrandSources] Added ${anyAdded ? 1 : 0} new influencer links, updated ${anyUpdated} existing links`
            );
            syncNeeded = true; // Always sync, even if links already existed
          } else {
            throw error;
          }
        }
        // Always ensure sync happens
        if (syncNeeded) {
          console.log(`[saveProjectBrandSources] Ensuring sync to brands for influencer links`);
          const syncCount = await syncInfluencerLinksToBrands(taxonomyId);
          console.log(`[saveProjectBrandSources] Synced influencer links to ${syncCount} brands`);
        }
      }
      if (redditLinksForTaxonomy.length > 0) {
        console.log(
          `[saveProjectBrandSources] Saving ${redditLinksForTaxonomy.length} Reddit links to taxonomy catalog for taxonomy ${taxonomyId}`
        );
        let syncNeeded = false;

        // First, update any existing links that have taxonomy_id: null (match by URL only, not category path)
        let updatedCount = 0;
        for (const link of redditLinksForTaxonomy) {
          // Try to update ANY link with this URL that has taxonomy_id: null
          const updated = await prisma.taxonomyRedditLink.updateMany({
            where: {
              url: link.url.trim(),
              deleted_at: null,
              taxonomy_id: null,
            },
            data: {
              taxonomy_id: taxonomyId,
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            },
          });
          if (updated.count > 0) {
            updatedCount += updated.count;
            console.log(
              `[saveProjectBrandSources] Updated ${updated.count} Reddit link(s) with URL ${link.url} to set taxonomy_id=${taxonomyId}`
            );
          }
        }
        if (updatedCount > 0) {
          console.log(
            `[saveProjectBrandSources] Updated ${updatedCount} existing Reddit links to set taxonomy_id`
          );
          syncNeeded = true;
        }

        try {
          const savedLinks = await addRedditLinks(redditLinksForTaxonomy, taxonomyId);
          console.log(
            `[saveProjectBrandSources] Successfully saved ${savedLinks.length} Reddit links to taxonomy catalog`
          );
          syncNeeded = true;
        } catch (error: any) {
          if (error.code === "P2002" || error.message?.includes("Unique constraint")) {
            console.log(
              `[saveProjectBrandSources] Some Reddit links already exist in taxonomy catalog, updating taxonomy_id and syncing`
            );
            let individualAdded = 0;
            let individualUpdated = 0;
            for (const link of redditLinksForTaxonomy) {
              try {
                // Try to update existing link to set taxonomy_id if it's null
                const updated = await prisma.taxonomyRedditLink.updateMany({
                  where: {
                    url: link.url,
                    category,
                    subcategory: subcategory || null,
                    sub_subcategory: sub_subcategory || null,
                    deleted_at: null,
                    taxonomy_id: null, // Only update if taxonomy_id is null
                  },
                  data: {
                    taxonomy_id: taxonomyId,
                  },
                });

                if (updated.count > 0) {
                  individualUpdated += updated.count;
                  console.log(
                    `[saveProjectBrandSources] Updated ${updated.count} existing Reddit link(s) to set taxonomy_id: ${link.url}`
                  );
                }

                // Try to create if it doesn't exist
                try {
                  const created = await prisma.taxonomyRedditLink.create({
                    data: {
                      category,
                      subcategory: subcategory || null,
                      sub_subcategory: sub_subcategory || null,
                      url: link.url,
                      taxonomy_id: taxonomyId,
                    },
                  });
                  individualAdded++;
                  console.log(
                    `[saveProjectBrandSources] Created Reddit link: ${created.url} with taxonomy_id=${created.taxonomy_id}`
                  );
                } catch (createError: any) {
                  if (createError.code === "P2002") {
                    // Link already exists (maybe was just updated above, or has different taxonomy_id)
                    console.log(
                      `[saveProjectBrandSources] Reddit link ${link.url} already exists in taxonomy catalog`
                    );
                  } else {
                    throw createError;
                  }
                }
              } catch (dupError: any) {
                if (dupError.code !== "P2002") {
                  console.error(
                    `[saveProjectBrandSources] Error processing Reddit link ${link.url}:`,
                    dupError
                  );
                }
              }
            }
            console.log(
              `[saveProjectBrandSources] Added ${individualAdded} new Reddit links, updated ${individualUpdated} existing links in taxonomy catalog`
            );
            syncNeeded = true;
          } else {
            throw error;
          }
        }
        // Always ensure sync happens
        if (syncNeeded) {
          console.log(`[saveProjectBrandSources] Ensuring sync to brands for Reddit links`);
          const syncCount = await syncRedditLinksToBrands(taxonomyId);
          console.log(`[saveProjectBrandSources] Synced Reddit links to ${syncCount} brands`);
        }
      }
      if (otherSourceLinksForTaxonomy.length > 0) {
        console.log(
          `[saveProjectBrandSources] Saving ${otherSourceLinksForTaxonomy.length} other source links to taxonomy catalog for taxonomy ${taxonomyId}`
        );
        let syncNeeded = false;

        // First, update any existing links that have taxonomy_id: null (match by URL + source_category only)
        let updatedCount = 0;
        for (const link of otherSourceLinksForTaxonomy) {
          // Try to update ANY link with this URL + source_category that has taxonomy_id: null
          const updated = await prisma.taxonomyOtherSourceLink.updateMany({
            where: {
              url: link.url.trim(),
              source_category: link.source_category,
              deleted_at: null,
              taxonomy_id: null,
            },
            data: {
              taxonomy_id: taxonomyId,
              category,
              subcategory: subcategory || null,
              sub_subcategory: sub_subcategory || null,
            },
          });
          if (updated.count > 0) {
            updatedCount += updated.count;
            console.log(
              `[saveProjectBrandSources] Updated ${updated.count} other source link(s) with URL ${link.url} (${link.source_category}) to set taxonomy_id=${taxonomyId}`
            );
          }
        }
        if (updatedCount > 0) {
          console.log(
            `[saveProjectBrandSources] Updated ${updatedCount} existing other source links to set taxonomy_id`
          );
          syncNeeded = true;
        }

        try {
          const savedLinks = await addOtherSourceLinks(otherSourceLinksForTaxonomy, taxonomyId);
          console.log(
            `[saveProjectBrandSources] Successfully saved ${savedLinks.length} other source links to taxonomy catalog`
          );
          syncNeeded = true;
        } catch (error: any) {
          if (error.code === "P2002" || error.message?.includes("Unique constraint")) {
            console.log(
              `[saveProjectBrandSources] Some other source links already exist in taxonomy catalog, updating taxonomy_id and syncing`
            );
            let individualAdded = 0;
            let individualUpdated = 0;
            for (const link of otherSourceLinksForTaxonomy) {
              try {
                // Update existing links with taxonomy_id: null
                const updated = await prisma.taxonomyOtherSourceLink.updateMany({
                  where: {
                    url: link.url,
                    source_category: link.source_category,
                    category,
                    subcategory: subcategory || null,
                    sub_subcategory: sub_subcategory || null,
                    deleted_at: null,
                    taxonomy_id: null,
                  },
                  data: {
                    taxonomy_id: taxonomyId,
                  },
                });

                if (updated.count > 0) {
                  individualUpdated += updated.count;
                  console.log(
                    `[saveProjectBrandSources] Updated ${updated.count} existing other source link(s) to set taxonomy_id: ${link.url}`
                  );
                }

                // Try to create if it doesn't exist
                try {
                  const created = await prisma.taxonomyOtherSourceLink.create({
                    data: {
                      category,
                      subcategory: subcategory || null,
                      sub_subcategory: sub_subcategory || null,
                      source_category: link.source_category,
                      url: link.url,
                      channel_name: link.channel_name,
                      taxonomy_id: taxonomyId,
                    },
                  });
                  individualAdded++;
                  console.log(
                    `[saveProjectBrandSources] Created other source link: ${created.url} with taxonomy_id=${created.taxonomy_id}`
                  );
                } catch (createError: any) {
                  if (createError.code !== "P2002") {
                    throw createError;
                  }
                }
              } catch (dupError: any) {
                if (dupError.code !== "P2002") {
                  console.error(
                    `[saveProjectBrandSources] Error processing other source link ${link.url}:`,
                    dupError
                  );
                }
              }
            }
            console.log(
              `[saveProjectBrandSources] Added ${individualAdded} new other source links, updated ${individualUpdated} existing links in taxonomy catalog`
            );
            syncNeeded = true;
          } else {
            throw error;
          }
        }
        // Always ensure sync happens
        if (syncNeeded) {
          console.log(`[saveProjectBrandSources] Ensuring sync to brands for other source links`);
          const syncCount = await syncOtherSourceLinksToBrands(taxonomyId);
          console.log(`[saveProjectBrandSources] Synced other source links to ${syncCount} brands`);
        }
      }
    } catch (error) {
      // Log error but don't fail - project sources are already saved
      console.error(`[saveProjectBrandSources] Error saving to taxonomy catalog:`, error);
      console.error(`[saveProjectBrandSources] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        taxonomyId,
        category,
        subcategory,
        sub_subcategory,
      });
    }

    // VERIFICATION: Query back to verify links were saved
    console.log(
      `[saveProjectBrandSources] VERIFICATION: Querying taxonomy ${taxonomyId} to verify links were saved...`
    );
    try {
      const [verifyInfluencer, verifyReddit, verifyOther] = await Promise.all([
        prisma.taxonomyInfluencerLink.findMany({
          where: {
            taxonomy_id: taxonomyId,
            deleted_at: null,
          },
          select: { id: true, url: true, platform: true },
        }),
        prisma.taxonomyRedditLink.findMany({
          where: {
            taxonomy_id: taxonomyId,
            deleted_at: null,
          },
          select: { id: true, url: true },
        }),
        prisma.taxonomyOtherSourceLink.findMany({
          where: {
            taxonomy_id: taxonomyId,
            deleted_at: null,
          },
          select: { id: true, url: true, source_category: true },
        }),
      ]);
      console.log(
        `[saveProjectBrandSources] VERIFICATION: Found ${verifyInfluencer.length} influencer, ${verifyReddit.length} Reddit, ${verifyOther.length} other source links with taxonomy_id=${taxonomyId}`
      );
      if (verifyInfluencer.length > 0) {
        console.log(
          `[saveProjectBrandSources] Sample influencer links:`,
          verifyInfluencer.slice(0, 3).map((l) => `${l.platform}:${l.url}`)
        );
      }
      if (verifyReddit.length > 0) {
        console.log(
          `[saveProjectBrandSources] Sample Reddit links:`,
          verifyReddit.slice(0, 3).map((l) => l.url)
        );
      }
      if (verifyOther.length > 0) {
        console.log(
          `[saveProjectBrandSources] Sample other source links:`,
          verifyOther.slice(0, 3).map((l) => `${l.source_category}:${l.url}`)
        );
      }
    } catch (verifyError) {
      console.error(`[saveProjectBrandSources] Error during verification query:`, verifyError);
    }
  } else {
    console.log(
      `[saveProjectBrandSources] Skipping taxonomy catalog save: taxonomyId=${taxonomyId}, category=${category}`
    );
  }

  return createdSources;
}

/**
 * Delete all project-specific sources for a brand (revert to defaults)
 */
export async function deleteProjectBrandSources(projectId: string, brandId: string): Promise<void> {
  await prisma.projectBrandSource.updateMany({
    where: {
      project_id: projectId,
      brand_id: brandId,
      deleted_at: null,
    },
    data: { deleted_at: new Date() },
  });
}
