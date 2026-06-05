import { prisma } from "@/lib/prisma";
import { getInfluencerLinksForTaxonomy } from "./taxonomy-influencer-links-service";
import { getRedditLinksForTaxonomy } from "./reddit-links-service";
import { getEffectiveSourcesForBrand } from "@/lib/projects/project-brand-sources-service";
import { normalizeYouTubeUrl } from "@/lib/utils/youtube-url-normalization";

export interface BrandDirectoryUrls {
  linkedinUrls: string[];
  redditUrls: string[];
  twitterUrls: string[];
  facebookUrls: string[];
  youtubeUrls: string[];
}

/**
 * Normalize URL for deduplication (remove trailing slashes, convert to lowercase)
 */
function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Deduplicate array of URLs
 */
function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    if (!url || !url.trim()) continue;
    const normalized = normalizeUrl(url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(url.trim()); // Keep original format
    }
  }

  return result;
}

/**
 * Get all brand directory URLs for a project
 * Fetches URLs from brands linked to the project via ProjectBrand.brand_id
 * Includes both brand-specific links and taxonomy-level inherited links
 */
export async function getBrandDirectoryUrlsForProject(
  projectId: string
): Promise<BrandDirectoryUrls> {
  const linkedinUrls: string[] = [];
  const redditUrls: string[] = [];
  const twitterUrls: string[] = [];
  const facebookUrls: string[] = [];
  const youtubeUrls: string[] = [];

  try {
    // Fetch all ProjectBrand entries for this project that have brand_id set
    const projectBrands = await prisma.projectBrand.findMany({
      where: {
        project_id: projectId,
        brand_id: { not: null },
        deleted_at: null,
      },
      select: {
        brand_id: true,
      },
    });

    if (projectBrands.length === 0) {
      return {
        linkedinUrls: [],
        redditUrls: [],
        twitterUrls: [],
        facebookUrls: [],
        youtubeUrls: [],
      };
    }

    const brandIds = projectBrands
      .map((pb) => pb.brand_id)
      .filter((id): id is string => id !== null);

    // Fetch all brands with their taxonomy and links, including primary URLs
    const brands = await prisma.brand.findMany({
      where: {
        id: { in: brandIds },
        deleted_at: null,
      },
      select: {
        id: true,
        facebook_url: true,
        linkedin_url: true,
        x_url: true,
        youtube_url: true,
        businessTaxonomy: {
          select: {
            id: true,
            category: true,
            subcategory: true,
            sub_subcategory: true,
          },
        },
        redditLinks: {
          where: { deleted_at: null },
          select: {
            url: true,
          },
        },
        additionalLinks: {
          where: { deleted_at: null },
          select: {
            url: true,
            link_type: true,
            platform: true,
          },
        },
      },
    });

    // Create a map of brand IDs to brand objects for quick lookup
    const brandMap = new Map(brands.map((b) => [b.id, b]));

    // Process each brand
    for (const brandId of brandIds) {
      const brand = brandMap.get(brandId);
      if (!brand) continue;

      // CRITICAL: Always include the brand's primary Facebook URL (top-level page)
      if (brand.facebook_url) {
        facebookUrls.push(brand.facebook_url);
        console.log(
          `[getBrandDirectoryUrlsForProject] Added brand primary Facebook URL: ${brand.facebook_url} for brand ${brandId}`
        );
      }

      // CRITICAL: Always include the brand's primary LinkedIn URL (from basic information)
      // This is added separately from additional sources to ensure it's always included
      if (brand.linkedin_url) {
        linkedinUrls.push(brand.linkedin_url);
        console.log(
          `[getBrandDirectoryUrlsForProject] Added brand primary LinkedIn URL: ${brand.linkedin_url} for brand ${brandId}`
        );
      }

      // Also include brand's primary Twitter URL
      if (brand.x_url) {
        twitterUrls.push(brand.x_url);
      }

      // Include brand's primary YouTube URL
      if (brand.youtube_url) {
        youtubeUrls.push(normalizeYouTubeUrl(brand.youtube_url));
      }

      // Get effective sources (project sources if they exist, otherwise defaults)
      // This includes additional links, taxonomy links, etc.
      const sources = await getEffectiveSourcesForBrand(projectId, brandId);

      // Process sources and categorize by platform
      for (const source of sources) {
        if (source.link_type === "REDDIT") {
          redditUrls.push(source.url);
        } else if (source.link_type === "DISCORD") {
          // Discord URLs are not used in current scrapers, but we can collect them for future use
          // For now, skip
        } else if (source.link_type === "INFLUENCER" && source.platform) {
          switch (source.platform) {
            case "LINKEDIN":
              linkedinUrls.push(source.url);
              break;
            case "TWITTER":
              twitterUrls.push(source.url);
              break;
            case "FACEBOOK":
              facebookUrls.push(source.url);
              break;
            case "YOUTUBE":
              youtubeUrls.push(normalizeYouTubeUrl(source.url));
              break;
            // Other platforms (INSTAGRAM, TIKTOK, BLUESKY) not used in current scrapers
          }
        } else if (source.link_type === "OTHER_SOURCE") {
          // Other sources (NEWS_OUTLET, BLOG, PODCAST) not used in current scrapers
          // For now, skip
        }
      }
    }

    // Deduplicate all URL arrays
    return {
      linkedinUrls: deduplicateUrls(linkedinUrls),
      redditUrls: deduplicateUrls(redditUrls),
      twitterUrls: deduplicateUrls(twitterUrls),
      facebookUrls: deduplicateUrls(facebookUrls),
      youtubeUrls: deduplicateUrls(youtubeUrls),
    };
  } catch (error) {
    console.error(
      `[getBrandDirectoryUrlsForProject] Error fetching brand directory URLs for project ${projectId}:`,
      error
    );
    return {
      linkedinUrls: [],
      redditUrls: [],
      twitterUrls: [],
      facebookUrls: [],
      youtubeUrls: [],
    };
  }
}
