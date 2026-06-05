import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  getAdditionalLinksForBrand,
  addBrandAdditionalLinks,
  type LinkType,
  type InfluencerPlatform,
  type SourceCategory,
} from "@/lib/brand-directory/brand-additional-links-service";
import { getRedditLinksForBrand } from "@/lib/brand-directory/brand-reddit-links-service";
import { z } from "zod";
import { createDedupKey } from "@/lib/utils/url-deduplication";

export const dynamic = "force-dynamic";

const linkTypeSchema = z.enum(["REDDIT", "DISCORD", "INFLUENCER", "OTHER_SOURCE"]);
const influencerPlatformSchema = z.enum([
  "TWITTER",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TIKTOK",
  "BLUESKY",
  "YOUTUBE",
]);
const sourceCategorySchema = z.enum(["NEWS_OUTLET", "BLOG", "PODCAST"]);

const addLinksSchema = z.object({
  links: z.array(
    z.object({
      link_type: linkTypeSchema,
      platform: influencerPlatformSchema.optional(),
      source_category: sourceCategorySchema.optional(),
      urls: z
        .array(
          z.object({
            url: z.string().url("Invalid URL format"),
            channel_name: z.string().optional(),
          })
        )
        .min(1),
    })
  ),
});

/**
 * GET /api/admin/brand-directory/brands/[id]/additional-links
 * Get all additional links for a brand, optionally filtered by type and platform
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const { searchParams } = new URL(request.url);
  const linkType = searchParams.get("link_type") as LinkType | null;
  const platform = searchParams.get("platform") as InfluencerPlatform | null;
  const sourceCategory = searchParams.get("source_category") as SourceCategory | null;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // For REDDIT links, also check BrandRedditLink table (legacy) and merge
    if (linkType === "REDDIT") {
      const [additionalLinks, redditLinks] = await Promise.all([
        getAdditionalLinksForBrand(resolvedParams.id, "REDDIT"),
        getRedditLinksForBrand(resolvedParams.id),
      ]);

      // Merge and deduplicate
      const seenUrls = new Set<string>();
      const merged: any[] = [];

      // Add from BrandAdditionalLink first
      additionalLinks.forEach((link) => {
        const normalizedUrl = link.url.toLowerCase().trim().replace(/\/+$/, "");
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          merged.push({
            id: link.id,
            url: link.url,
            link_type: "REDDIT",
            brand_id: link.brand_id,
            created_at: link.created_at,
            updated_at: link.updated_at,
          });
        }
      });

      // Add from BrandRedditLink (if not already present)
      redditLinks.forEach((link) => {
        const normalizedUrl = link.url.toLowerCase().trim().replace(/\/+$/, "");
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          merged.push({
            id: link.id,
            url: link.url,
            link_type: "REDDIT",
            brand_id: link.brand_id,
            created_at: link.created_at,
            updated_at: link.updated_at,
          });
        }
      });

      console.log(
        `[additional-links/GET] Reddit: ${additionalLinks.length} from BrandAdditionalLink, ${redditLinks.length} from BrandRedditLink, ${merged.length} merged`
      );
      return NextResponse.json({ links: merged });
    }

    const links = await getAdditionalLinksForBrand(
      resolvedParams.id,
      linkType || undefined,
      platform || undefined,
      sourceCategory || undefined
    );

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error fetching brand additional links:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      brandId: resolvedParams.id,
      linkType,
      platform,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.stack
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/brand-directory/brands/[id]/additional-links
 * Add additional links to a brand
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validated = addLinksSchema.parse(body);

    // Deduplicate links before saving (only within this save operation for this brand)
    // Note: Different brands can have the same links - this only prevents duplicates
    // within the current batch being saved
    const seen = new Set<string>();
    const deduplicatedLinks: typeof validated.links = [];
    let duplicateCount = 0;

    for (const linkGroup of validated.links) {
      const deduplicatedUrls: typeof linkGroup.urls = [];
      const seenInGroup = new Set<string>();

      for (const urlInput of linkGroup.urls) {
        if (!urlInput.url || !urlInput.url.trim()) {
          continue; // Skip empty URLs
        }

        const key = createDedupKey(
          urlInput.url,
          linkGroup.link_type,
          linkGroup.platform,
          linkGroup.source_category
        );

        if (seen.has(key) || seenInGroup.has(key)) {
          duplicateCount++;
          console.log(
            `[additional-links/POST] Skipping duplicate: ${urlInput.url} (${linkGroup.link_type}${linkGroup.platform ? ` - ${linkGroup.platform}` : ""}${linkGroup.source_category ? ` - ${linkGroup.source_category}` : ""})`
          );
          continue;
        }

        seen.add(key);
        seenInGroup.add(key);
        deduplicatedUrls.push(urlInput);
      }

      if (deduplicatedUrls.length > 0) {
        deduplicatedLinks.push({
          ...linkGroup,
          urls: deduplicatedUrls,
        });
      }
    }

    if (duplicateCount > 0) {
      console.log(
        `[additional-links/POST] Removed ${duplicateCount} duplicate links. Original: ${validated.links.reduce((sum, lg) => sum + lg.urls.length, 0)}, Deduplicated: ${deduplicatedLinks.reduce((sum, lg) => sum + lg.urls.length, 0)}`
      );
    }

    const createdLinks = await addBrandAdditionalLinks(resolvedParams.id, deduplicatedLinks);

    return NextResponse.json({ links: createdLinks });
  } catch (error) {
    console.error("Error adding brand additional links:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
