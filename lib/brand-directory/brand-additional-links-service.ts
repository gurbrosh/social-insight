/**
 * Service for managing additional links for brands (Reddit, Discord, Influencers)
 */

import { prisma } from "@/lib/prisma";
import { normalizeYouTubeUrl } from "@/lib/utils/youtube-url-normalization";

export type LinkType = "REDDIT" | "DISCORD" | "INFLUENCER" | "OTHER_SOURCE";
export type InfluencerPlatform =
  | "TWITTER"
  | "LINKEDIN"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "TIKTOK"
  | "BLUESKY"
  | "YOUTUBE";
export type SourceCategory = "NEWS_OUTLET" | "BLOG" | "PODCAST";

export interface BrandAdditionalLink {
  id: string;
  url: string;
  link_type: LinkType;
  platform: InfluencerPlatform | null;
  source_category: SourceCategory | null;
  channel_name: string | null;
  brand_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface AddLinksInput {
  link_type: LinkType;
  platform?: InfluencerPlatform;
  source_category?: SourceCategory;
  urls: Array<{ url: string; channel_name?: string }>;
}

/**
 * Get all additional links for a brand, optionally filtered by type and platform
 */
export async function getAdditionalLinksForBrand(
  brandId: string,
  linkType?: LinkType,
  platform?: InfluencerPlatform,
  sourceCategory?: SourceCategory
): Promise<BrandAdditionalLink[]> {
  const where: any = {
    brand_id: brandId,
    deleted_at: null,
  };

  if (linkType) {
    where.link_type = linkType;
  }

  if (platform) {
    where.platform = platform;
  }

  if (sourceCategory) {
    where.source_category = sourceCategory;
  }

  const links = await prisma.brandAdditionalLink.findMany({
    where,
    orderBy: { created_at: "asc" },
  });

  // Deduplicate by URL (normalize URLs for comparison)
  const seenUrls = new Set<string>();
  const uniqueLinks = links.filter((link) => {
    const normalizedUrl = link.url.toLowerCase().trim().replace(/\/+$/, "");
    // For influencers, also check platform; for other sources, check source_category
    let key = normalizedUrl;
    if (link.link_type === "INFLUENCER" && link.platform) {
      key = `${link.platform}:${normalizedUrl}`;
    } else if (link.link_type === "OTHER_SOURCE" && link.source_category) {
      key = `${link.source_category}:${normalizedUrl}`;
    }

    if (seenUrls.has(key)) {
      return false;
    }
    seenUrls.add(key);
    return true;
  });

  return uniqueLinks.map((link) => ({
    id: link.id,
    url: link.url,
    link_type: link.link_type as LinkType,
    platform: link.platform as InfluencerPlatform | null,
    source_category: link.source_category as SourceCategory | null,
    channel_name: link.channel_name,
    brand_id: link.brand_id,
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Add additional links to a brand
 */
export async function addBrandAdditionalLinks(
  brandId: string,
  inputs: AddLinksInput[]
): Promise<BrandAdditionalLink[]> {
  const createdLinks: BrandAdditionalLink[] = [];

  for (const input of inputs) {
    // Validate that platform is provided for INFLUENCER type
    if (input.link_type === "INFLUENCER" && !input.platform) {
      throw new Error(`Platform is required for INFLUENCER link type`);
    }

    // Validate that platform is NOT provided for non-INFLUENCER types
    if (input.link_type !== "INFLUENCER" && input.platform) {
      throw new Error(`Platform should not be provided for ${input.link_type} link type`);
    }

    // Validate that source_category is provided for OTHER_SOURCE type
    if (input.link_type === "OTHER_SOURCE" && !input.source_category) {
      throw new Error(`Source category is required for OTHER_SOURCE link type`);
    }

    // Validate that source_category is NOT provided for non-OTHER_SOURCE types
    if (input.link_type !== "OTHER_SOURCE" && input.source_category) {
      throw new Error(`Source category should not be provided for ${input.link_type} link type`);
    }

    for (const urlInput of input.urls) {
      if (!urlInput.url || !urlInput.url.trim()) continue;

      try {
        const link = await prisma.brandAdditionalLink.create({
          data: {
            brand_id: brandId,
            link_type: input.link_type,
            platform: input.link_type === "INFLUENCER" ? input.platform! : null,
            source_category: input.link_type === "OTHER_SOURCE" ? input.source_category! : null,
            url: urlInput.url.trim(),
            channel_name: urlInput.channel_name?.trim() || null,
          },
        });

        createdLinks.push({
          id: link.id,
          url: link.url,
          link_type: link.link_type as LinkType,
          platform: link.platform as InfluencerPlatform | null,
          source_category: link.source_category as SourceCategory | null,
          channel_name: link.channel_name,
          brand_id: link.brand_id,
          created_at: link.created_at,
          updated_at: link.updated_at,
        });
      } catch (error: any) {
        // Skip duplicate entries (unique constraint violation)
        if (error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
  }

  return createdLinks;
}

/**
 * Delete an additional link
 */
export async function deleteBrandAdditionalLink(linkId: string): Promise<void> {
  await prisma.brandAdditionalLink.update({
    where: { id: linkId },
    data: { deleted_at: new Date() },
  });
}

/**
 * Update additional links for a brand (replaces existing links of the same type/platform)
 */
export async function updateBrandAdditionalLinks(
  brandId: string,
  linkType: LinkType,
  platform: InfluencerPlatform | null,
  sourceCategory: SourceCategory | null,
  urls: Array<{ url: string; channel_name?: string }>
): Promise<BrandAdditionalLink[]> {
  // Validate platform requirement
  if (linkType === "INFLUENCER" && !platform) {
    throw new Error("Platform is required for INFLUENCER link type");
  }

  if (linkType !== "INFLUENCER" && platform) {
    throw new Error(`Platform should not be provided for ${linkType} link type`);
  }

  // Validate source_category requirement
  if (linkType === "OTHER_SOURCE" && !sourceCategory) {
    throw new Error("Source category is required for OTHER_SOURCE link type");
  }

  if (linkType !== "OTHER_SOURCE" && sourceCategory) {
    throw new Error(`Source category should not be provided for ${linkType} link type`);
  }

  // Soft delete existing links of this type/platform/source_category
  await prisma.brandAdditionalLink.updateMany({
    where: {
      brand_id: brandId,
      link_type: linkType,
      platform: platform,
      source_category: sourceCategory,
      deleted_at: null,
    },
    data: { deleted_at: new Date() },
  });

  // Create new links
  const createdLinks: BrandAdditionalLink[] = [];
  for (const urlInput of urls) {
    if (!urlInput.url || !urlInput.url.trim()) continue;

    // Normalize YouTube URLs to @ format
    let normalizedUrl = urlInput.url.trim();
    if (linkType === "INFLUENCER" && platform === "YOUTUBE") {
      normalizedUrl = normalizeYouTubeUrl(normalizedUrl);
    }

    try {
      const link = await prisma.brandAdditionalLink.create({
        data: {
          brand_id: brandId,
          link_type: linkType,
          platform: platform,
          source_category: sourceCategory,
          url: normalizedUrl,
          channel_name: urlInput.channel_name?.trim() || null,
        },
      });

      createdLinks.push({
        id: link.id,
        url: link.url,
        link_type: link.link_type as LinkType,
        platform: link.platform as InfluencerPlatform | null,
        source_category: link.source_category as SourceCategory | null,
        channel_name: link.channel_name,
        brand_id: link.brand_id,
        created_at: link.created_at,
        updated_at: link.updated_at,
      });
    } catch (error: any) {
      // Skip duplicate entries
      if (error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }

  return createdLinks;
}
