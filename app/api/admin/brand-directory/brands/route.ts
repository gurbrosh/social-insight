import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  findBrandsByTaxonomy,
  createBrandWithKeywords,
  BrandFilters,
} from "@/lib/brand-directory/brand-service";
import { ensureValidBlogNewsUrl } from "@/lib/brand-directory/blog-news-url";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createBrandSchema = z.object({
  business_taxonomy_id: z.string().min(1),
  company_name: z.string().min(1),
  brand_name: z.string().min(1),
  brand_stage: z.enum(["ESTABLISHED", "EMERGING", "SMALL"]),
  website_url: z.string().url().optional().nullable(),
  careers_url: z.string().url().optional().nullable(),
  blog_news_url: z.string().url().optional().nullable(),
  linkedin_url: z.string().url().optional().nullable(),
  facebook_url: z.string().url().optional().nullable(),
  x_url: z.string().url().optional().nullable(),
  instagram_url: z.string().url().optional().nullable(),
  tiktok_url: z.string().url().optional().nullable(),
  youtube_url: z.string().url().optional().nullable(),
  discord_url: z.string().url().optional().nullable(),
  keywords: z.array(z.string().min(1)).min(1),
});

/**
 * GET /api/admin/brand-directory/brands
 * List brands with filters
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const sortBy = searchParams.get("sortBy");
    const sortOrder = searchParams.get("sortOrder");
    const filters: BrandFilters = {
      taxonomyId: searchParams.get("taxonomyId") || undefined,
      brandStage: (searchParams.get("brandStage") as any) || undefined,
      search: searchParams.get("search") || undefined,
      limit: parseInt(searchParams.get("limit") || "50", 10),
      offset: parseInt(searchParams.get("offset") || "0", 10),
      sortBy:
        sortBy && ["company_name", "brand_name", "category", "brand_stage"].includes(sortBy)
          ? (sortBy as "company_name" | "brand_name" | "category" | "brand_stage")
          : undefined,
      sortOrder:
        sortOrder && ["asc", "desc"].includes(sortOrder)
          ? (sortOrder as "asc" | "desc")
          : undefined,
    };

    const result = await findBrandsByTaxonomy(filters);

    return NextResponse.json({
      brands: result.brands,
      total: result.total,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/brand-directory/brands
 * Create a brand manually
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = createBrandSchema.parse(body);

    const blogNewsUrl =
      validatedData.blog_news_url != null
        ? await ensureValidBlogNewsUrl(
            validatedData.blog_news_url,
            validatedData.brand_name,
            validatedData.website_url ?? undefined
          )
        : undefined;

    const brand = await createBrandWithKeywords(
      {
        business_taxonomy_id: validatedData.business_taxonomy_id,
        company_name: validatedData.company_name,
        brand_name: validatedData.brand_name,
        brand_stage: validatedData.brand_stage,
        website_url: validatedData.website_url || undefined,
        careers_url: validatedData.careers_url || undefined,
        blog_news_url: blogNewsUrl ?? undefined,
        linkedin_url: validatedData.linkedin_url || undefined,
        facebook_url: validatedData.facebook_url || undefined,
        x_url: validatedData.x_url || undefined,
        instagram_url: validatedData.instagram_url || undefined,
        tiktok_url: validatedData.tiktok_url || undefined,
        youtube_url: validatedData.youtube_url || undefined,
        discord_url: validatedData.discord_url || undefined,
      },
      validatedData.keywords
    );

    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    console.error("Error creating brand:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
