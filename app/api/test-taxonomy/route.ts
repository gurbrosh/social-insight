import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taxonomyId = searchParams.get("id");

  if (!taxonomyId) {
    return NextResponse.json({ error: "id parameter required" }, { status: 400 });
  }

  // Get taxonomy
  const taxonomy = await prisma.businessTaxonomy.findUnique({
    where: { id: taxonomyId },
  });

  if (!taxonomy) {
    return NextResponse.json({ error: "Taxonomy not found" }, { status: 404 });
  }

  // Get links directly
  const [reddit, influencer, other] = await Promise.all([
    prisma.taxonomyRedditLink.findMany({
      where: { taxonomy_id: taxonomyId, deleted_at: null },
      take: 10,
    }),
    prisma.taxonomyInfluencerLink.findMany({
      where: { taxonomy_id: taxonomyId, deleted_at: null },
      take: 10,
    }),
    prisma.taxonomyOtherSourceLink.findMany({
      where: { taxonomy_id: taxonomyId, deleted_at: null },
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
    links: {
      reddit: {
        count: reddit.length,
        items: reddit.map((l) => ({ url: l.url, taxonomy_id: l.taxonomy_id })),
      },
      influencer: {
        count: influencer.length,
        items: influencer.map((l) => ({
          url: l.url,
          platform: l.platform,
          taxonomy_id: l.taxonomy_id,
        })),
      },
      other: {
        count: other.length,
        items: other.map((l) => ({
          url: l.url,
          source_category: l.source_category,
          taxonomy_id: l.taxonomy_id,
        })),
      },
    },
  });
}
