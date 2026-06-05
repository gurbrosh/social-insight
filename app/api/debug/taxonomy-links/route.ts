import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taxonomyId = searchParams.get("taxonomyId");

  if (!taxonomyId) {
    return NextResponse.json({ error: "taxonomyId required" }, { status: 400 });
  }

  // Get taxonomy info
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId, deleted_at: null },
  });

  if (!taxonomy) {
    return NextResponse.json({ error: "Taxonomy not found" }, { status: 404 });
  }

  // Query links using the SAME logic as getRedditLinksForTaxonomy
  const whereClause = {
    deleted_at: null,
    OR: [
      {
        category: taxonomy.category,
        subcategory: null,
        sub_subcategory: null,
      },
      {
        category: taxonomy.category,
        subcategory: taxonomy.subcategory,
        sub_subcategory: null,
      },
      {
        category: taxonomy.category,
        subcategory: taxonomy.subcategory,
        sub_subcategory: taxonomy.sub_subcategory,
      },
      {
        taxonomy_id: taxonomyId,
      },
    ],
  };

  const [redditLinks, influencerLinks, otherLinks, directReddit, directInfluencer, directOther] =
    await Promise.all([
      // Query using OR clause (same as getRedditLinksForTaxonomy)
      prisma.taxonomyRedditLink.findMany({
        where: whereClause,
        take: 10,
      }),
      prisma.taxonomyInfluencerLink.findMany({
        where: whereClause,
        take: 10,
      }),
      prisma.taxonomyOtherSourceLink.findMany({
        where: whereClause,
        take: 10,
      }),
      // Direct query by taxonomy_id only
      prisma.taxonomyRedditLink.findMany({
        where: {
          taxonomy_id: taxonomyId,
          deleted_at: null,
        },
        take: 10,
      }),
      prisma.taxonomyInfluencerLink.findMany({
        where: {
          taxonomy_id: taxonomyId,
          deleted_at: null,
        },
        take: 10,
      }),
      prisma.taxonomyOtherSourceLink.findMany({
        where: {
          taxonomy_id: taxonomyId,
          deleted_at: null,
        },
        take: 10,
      }),
    ]);

  return NextResponse.json({
    taxonomy: {
      id: taxonomy.id,
      category: taxonomy.category,
      subcategory: taxonomy.subcategory,
      sub_subcategory: taxonomy.sub_subcategory,
    },
    query: {
      whereClause,
    },
    results: {
      reddit: {
        orQuery: redditLinks.length,
        directQuery: directReddit.length,
        sample: redditLinks.slice(0, 5).map((l) => ({
          url: l.url,
          taxonomy_id: l.taxonomy_id,
          category: l.category,
          subcategory: l.subcategory,
          sub_subcategory: l.sub_subcategory,
        })),
      },
      influencer: {
        orQuery: influencerLinks.length,
        directQuery: directInfluencer.length,
        sample: influencerLinks.slice(0, 5).map((l) => ({
          url: l.url,
          platform: l.platform,
          taxonomy_id: l.taxonomy_id,
        })),
      },
      other: {
        orQuery: otherLinks.length,
        directQuery: directOther.length,
        sample: otherLinks.slice(0, 5).map((l) => ({
          url: l.url,
          source_category: l.source_category,
          taxonomy_id: l.taxonomy_id,
        })),
      },
    },
  });
}
