import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  getInfluencerLinksForTaxonomy,
  getInfluencerLinksForCategory,
  getInfluencerLinksForSubcategory,
} from "@/lib/brand-directory/taxonomy-influencer-links-service";
import {
  getRedditLinksForTaxonomy,
  getRedditLinksForCategory,
  getRedditLinksForSubcategory,
} from "@/lib/brand-directory/reddit-links-service";
import {
  getOtherSourceLinksForTaxonomy,
  getOtherSourceLinksForCategory,
  getOtherSourceLinksForSubcategory,
} from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const getSchema = z.object({
  taxonomyNode: z.object({
    type: z.enum(["category", "subcategory", "sub_subcategory"]),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    sub_subcategory: z.string().optional(),
    id: z.string().optional(),
  }),
});

/**
 * POST /api/admin/brand-directory/taxonomy-sources/get
 * Get all existing sources for a taxonomy node
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
    console.log(`[taxonomy-sources/get] Received request:`, JSON.stringify(body, null, 2));
    const validated = getSchema.parse(body);
    const { taxonomyNode } = validated;
    console.log(
      `[taxonomy-sources/get] Parsed taxonomyNode:`,
      JSON.stringify(taxonomyNode, null, 2)
    );

    let influencerLinks: any[] = [];
    let redditLinks: any[] = [];
    let otherSourceLinks: any[] = [];
    let debugInfo: any = null;

    // Fetch links based on taxonomy level
    if (taxonomyNode.type === "sub_subcategory" && taxonomyNode.id) {
      // Use taxonomy ID for sub-subcategory
      console.log(
        `[taxonomy-sources/get] Fetching sources for taxonomy ${taxonomyNode.id} (sub_subcategory)`
      );

      // Direct database check
      const [directReddit, directInfluencer, directOther] = await Promise.all([
        prisma.taxonomyRedditLink.findMany({
          where: { taxonomy_id: taxonomyNode.id, deleted_at: null },
          take: 5,
        }),
        prisma.taxonomyInfluencerLink.findMany({
          where: { taxonomy_id: taxonomyNode.id, deleted_at: null },
          take: 5,
        }),
        prisma.taxonomyOtherSourceLink.findMany({
          where: { taxonomy_id: taxonomyNode.id, deleted_at: null },
          take: 5,
        }),
      ]);
      console.log(
        `[taxonomy-sources/get] DIRECT DB CHECK: Found ${directReddit.length} Reddit, ${directInfluencer.length} Influencer, ${directOther.length} Other links with taxonomy_id=${taxonomyNode.id}`
      );

      [influencerLinks, redditLinks, otherSourceLinks] = await Promise.all([
        getInfluencerLinksForTaxonomy(taxonomyNode.id),
        getRedditLinksForTaxonomy(taxonomyNode.id),
        getOtherSourceLinksForTaxonomy(taxonomyNode.id),
      ]);
      console.log(
        `[taxonomy-sources/get] FUNCTION RESULTS: Found ${influencerLinks.length} influencer links, ${redditLinks.length} Reddit links, ${otherSourceLinks.length} other source links for taxonomy ${taxonomyNode.id}`
      );

      // Store debug info for response
      debugInfo = {
        taxonomyId: taxonomyNode.id,
        taxonomyPath: `${taxonomyNode.category}/${taxonomyNode.subcategory}/${taxonomyNode.sub_subcategory}`,
        directDbCheck: {
          reddit: directReddit.length,
          influencer: directInfluencer.length,
          other: directOther.length,
        },
        functionResults: {
          reddit: redditLinks.length,
          influencer: influencerLinks.length,
          other: otherSourceLinks.length,
        },
        sampleReddit: directReddit
          .slice(0, 3)
          .map((l) => ({ url: l.url, taxonomy_id: l.taxonomy_id })),
        sampleInfluencer: directInfluencer
          .slice(0, 3)
          .map((l) => ({ url: l.url, platform: l.platform, taxonomy_id: l.taxonomy_id })),
        sampleOther: directOther.slice(0, 3).map((l) => ({
          url: l.url,
          source_category: l.source_category,
          taxonomy_id: l.taxonomy_id,
        })),
        actualRedditLinks: redditLinks.slice(0, 5).map((l) => ({ url: l.url, id: l.id })),
        actualInfluencerLinks: influencerLinks
          .slice(0, 5)
          .map((l) => ({ url: l.url, platform: l.platform, id: l.id })),
        actualOtherLinks: otherSourceLinks
          .slice(0, 5)
          .map((l) => ({ url: l.url, source_category: l.source_category, id: l.id })),
      };
    } else if (
      taxonomyNode.type === "subcategory" &&
      taxonomyNode.category &&
      taxonomyNode.subcategory
    ) {
      // Use category + subcategory for subcategory level
      [influencerLinks, redditLinks, otherSourceLinks] = await Promise.all([
        getInfluencerLinksForSubcategory(taxonomyNode.category, taxonomyNode.subcategory),
        getRedditLinksForSubcategory(taxonomyNode.category, taxonomyNode.subcategory),
        getOtherSourceLinksForSubcategory(taxonomyNode.category, taxonomyNode.subcategory),
      ]);
    } else if (taxonomyNode.type === "category" && taxonomyNode.category) {
      // Use category for category level
      [influencerLinks, redditLinks, otherSourceLinks] = await Promise.all([
        getInfluencerLinksForCategory(taxonomyNode.category),
        getRedditLinksForCategory(taxonomyNode.category),
        getOtherSourceLinksForCategory(taxonomyNode.category),
      ]);
    }

    // Group by platform
    const grouped: Record<
      string,
      Array<{
        id: string;
        url: string;
        name?: string | null;
        platform?: string;
        sourceCategory?: string;
        linkType: string;
      }>
    > = {};

    // Group influencer links by platform
    influencerLinks.forEach((link) => {
      const platform = link.platform;
      if (!grouped[platform]) {
        grouped[platform] = [];
      }
      grouped[platform].push({
        id: link.id,
        url: link.url,
        name: link.channel_name,
        platform: link.platform,
        linkType: "INFLUENCER",
      });
    });

    // Add Reddit links
    if (redditLinks.length > 0) {
      grouped["REDDIT"] = redditLinks.map((link) => ({
        id: link.id,
        url: link.url,
        name: null,
        linkType: "REDDIT",
      }));
    }

    // Group other source links by category
    otherSourceLinks.forEach((link) => {
      const category = link.source_category;
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push({
        id: link.id,
        url: link.url,
        name: link.channel_name,
        sourceCategory: link.source_category,
        linkType: "OTHER_SOURCE",
      });
    });

    console.log(`[taxonomy-sources/get] Grouped sources:`, {
      keys: Object.keys(grouped),
      counts: Object.entries(grouped).map(([key, arr]) => [key, (arr as any[]).length]),
      redditLinksCount: redditLinks.length,
      influencerLinksCount: influencerLinks.length,
      otherSourceLinksCount: otherSourceLinks.length,
    });

    const response: any = {
      sources: grouped,
      debug: {
        taxonomyNode,
        counts: {
          influencer: influencerLinks.length,
          reddit: redditLinks.length,
          other: otherSourceLinks.length,
        },
        groupedKeys: Object.keys(grouped),
        detailed: debugInfo, // Shows what was retrieved from database
      },
    };
    console.log(
      `[taxonomy-sources/get] Returning response with ${Object.keys(grouped).length} platform/category groups`
    );
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching taxonomy sources:", error);
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
