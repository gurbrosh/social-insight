import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { addInfluencerLinks } from "@/lib/brand-directory/taxonomy-influencer-links-service";
import { addOtherSourceLinks } from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { addRedditLinks } from "@/lib/brand-directory/reddit-links-service";
import { z } from "zod";
import type {
  InfluencerPlatform,
  SourceCategory,
} from "@/lib/brand-directory/brand-additional-links-service";
import { createDedupKey } from "@/lib/utils/url-deduplication";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  taxonomyNode: z.object({
    type: z.enum(["category", "subcategory", "sub_subcategory"]),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    sub_subcategory: z.string().optional(),
    id: z.string().optional(),
  }),
  links: z
    .array(
      z.object({
        platform: z.string(),
        linkType: z.enum(["INFLUENCER", "REDDIT", "OTHER_SOURCE"]),
        sourceCategory: z.enum(["NEWS_OUTLET", "BLOG", "PODCAST"]).optional(),
        url: z.string().url(),
        channel_name: z.string().optional().nullable(),
      })
    )
    .min(1),
});

/**
 * POST /api/admin/brand-directory/taxonomy-sources/save
 * Save selected search results to taxonomy level
 */
export async function POST(request: NextRequest) {
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
    const validated = saveSchema.parse(body);

    const { taxonomyNode, links } = validated;

    // Deduplicate links before processing (only within this save operation for this taxonomy node)
    // Note: This prevents duplicate links within the current batch being saved to the taxonomy
    const seen = new Set<string>();
    const deduplicatedLinks: typeof links = [];
    let duplicateCount = 0;

    for (const link of links) {
      if (!link.url || !link.url.trim()) {
        continue; // Skip empty URLs
      }

      const key = createDedupKey(
        link.url,
        link.linkType,
        link.linkType === "INFLUENCER" ? link.platform : undefined,
        link.linkType === "OTHER_SOURCE" ? link.sourceCategory : undefined
      );

      if (seen.has(key)) {
        duplicateCount++;
        console.log(
          `[taxonomy-sources/save] Skipping duplicate: ${link.url} (${link.linkType}${link.platform ? ` - ${link.platform}` : ""}${link.sourceCategory ? ` - ${link.sourceCategory}` : ""})`
        );
        continue;
      }

      seen.add(key);
      deduplicatedLinks.push(link);
    }

    if (duplicateCount > 0) {
      console.log(
        `[taxonomy-sources/save] Removed ${duplicateCount} duplicate links. Original: ${links.length}, Deduplicated: ${deduplicatedLinks.length}`
      );
    }

    // Group links by type
    const influencerLinks: Array<{
      url: string;
      platform: InfluencerPlatform;
      channel_name?: string | null;
      category: string;
      subcategory?: string | null;
      sub_subcategory?: string | null;
    }> = [];
    const redditLinks: Array<{
      url: string;
      category: string;
      subcategory?: string | null;
      sub_subcategory?: string | null;
    }> = [];
    const otherSourceLinks: Array<{
      url: string;
      source_category: SourceCategory;
      channel_name?: string | null;
      category: string;
      subcategory?: string | null;
      sub_subcategory?: string | null;
    }> = [];

    // Determine taxonomy path
    let category: string;
    let subcategory: string | null = null;
    let sub_subcategory: string | null = null;

    if (taxonomyNode.type === "sub_subcategory" && taxonomyNode.id) {
      // Will be handled by service using taxonomyId
    } else {
      if (!taxonomyNode.category) {
        return NextResponse.json({ error: "Category is required" }, { status: 400 });
      }
      category = taxonomyNode.category;
      subcategory = taxonomyNode.subcategory ?? null;
      sub_subcategory = taxonomyNode.sub_subcategory ?? null;
    }

    // Categorize links (using deduplicated links)
    // If taxonomyId is provided, services will determine category/subcategory/sub_subcategory from DB
    // Otherwise, use provided values
    for (const link of deduplicatedLinks) {
      if (link.linkType === "INFLUENCER") {
        influencerLinks.push({
          url: link.url,
          platform: link.platform as InfluencerPlatform,
          channel_name: link.channel_name || null,
          category: taxonomyNode.category || "",
          subcategory: taxonomyNode.subcategory ?? null,
          sub_subcategory: taxonomyNode.sub_subcategory ?? null,
        });
      } else if (link.linkType === "REDDIT") {
        redditLinks.push({
          url: link.url,
          category: taxonomyNode.category || "",
          subcategory: taxonomyNode.subcategory ?? null,
          sub_subcategory: taxonomyNode.sub_subcategory ?? null,
        });
      } else if (link.linkType === "OTHER_SOURCE") {
        if (!link.sourceCategory) {
          return NextResponse.json(
            { error: "sourceCategory is required for OTHER_SOURCE links" },
            { status: 400 }
          );
        }
        otherSourceLinks.push({
          url: link.url,
          source_category: link.sourceCategory,
          channel_name: link.channel_name || null,
          category: taxonomyNode.category || "",
          subcategory: taxonomyNode.subcategory ?? null,
          sub_subcategory: taxonomyNode.sub_subcategory ?? null,
        });
      }
    }

    // Save links by type
    const savedLinks: any[] = [];

    if (influencerLinks.length > 0) {
      const result = await addInfluencerLinks(influencerLinks, taxonomyNode.id);
      savedLinks.push(...result);
    }

    if (redditLinks.length > 0) {
      const result = await addRedditLinks(redditLinks, taxonomyNode.id);
      savedLinks.push(...result);
    }

    if (otherSourceLinks.length > 0) {
      const result = await addOtherSourceLinks(otherSourceLinks, taxonomyNode.id);
      savedLinks.push(...result);
    }

    return NextResponse.json({
      success: true,
      savedCount: savedLinks.length,
      links: savedLinks,
    });
  } catch (error) {
    console.error("Error saving links:", error);
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
