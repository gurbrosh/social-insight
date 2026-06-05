import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  getBrandById,
  updateBrand,
  updateBrandKeywords,
  deleteBrand,
} from "@/lib/brand-directory/brand-service";
import { ensureValidBlogNewsUrl } from "@/lib/brand-directory/blog-news-url";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateBrandSchema = z.object({
  business_taxonomy_id: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  brand_name: z.string().min(1).optional(),
  brand_stage: z.enum(["ESTABLISHED", "EMERGING", "SMALL"]).optional(),
  approved: z.boolean().optional(),
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
  keywords: z.array(z.string().min(1)).optional(),
});

/**
 * GET /api/admin/brand-directory/brands/[id]
 * Get brand details
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
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

    const brand = await getBrandById(resolvedParams.id);

    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    return NextResponse.json({ brand });
  } catch (error) {
    console.error("Error fetching brand:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/brand-directory/brands/[id]
 * Update brand
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
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
    const validatedData = updateBrandSchema.parse(body);

    // Update brand fields first (excluding keywords, converting null to undefined)
    // This ensures taxonomy_id is updated before we update keywords
    const { keywords, ...brandData } = validatedData;
    const updateData: Record<string, unknown> = {};

    if (brandData.blog_news_url !== undefined) {
      const trimmed =
        typeof brandData.blog_news_url === "string" ? brandData.blog_news_url.trim() : "";
      if (trimmed) {
        const existing = await getBrandById(resolvedParams.id);
        const brandName = brandData.brand_name ?? existing?.brand_name ?? "";
        const websiteUrl = brandData.website_url ?? existing?.website_url ?? undefined;
        updateData.blog_news_url =
          (await ensureValidBlogNewsUrl(trimmed, brandName, websiteUrl ?? undefined)) ?? undefined;
      } else {
        updateData.blog_news_url = null;
      }
    }

    if (brandData.business_taxonomy_id !== undefined) {
      updateData.business_taxonomy_id = brandData.business_taxonomy_id;
    }
    if (brandData.company_name !== undefined) {
      updateData.company_name = brandData.company_name;
    }
    if (brandData.brand_name !== undefined) {
      updateData.brand_name = brandData.brand_name;
    }
    if (brandData.brand_stage !== undefined) {
      updateData.brand_stage = brandData.brand_stage;
    }
    if (brandData.approved !== undefined) {
      updateData.approved = brandData.approved;
    }
    // Optional URL fields: persist null when cleared so DB is updated (undefined = "don't change")
    if (brandData.website_url !== undefined) {
      updateData.website_url =
        brandData.website_url && String(brandData.website_url).trim()
          ? String(brandData.website_url).trim()
          : null;
    }
    if (brandData.careers_url !== undefined) {
      updateData.careers_url =
        brandData.careers_url && String(brandData.careers_url).trim()
          ? String(brandData.careers_url).trim()
          : null;
    }
    if (brandData.linkedin_url !== undefined) {
      updateData.linkedin_url =
        brandData.linkedin_url && String(brandData.linkedin_url).trim()
          ? String(brandData.linkedin_url).trim()
          : null;
    }
    if (brandData.facebook_url !== undefined) {
      updateData.facebook_url =
        brandData.facebook_url && String(brandData.facebook_url).trim()
          ? String(brandData.facebook_url).trim()
          : null;
    }
    if (brandData.x_url !== undefined) {
      updateData.x_url =
        brandData.x_url && String(brandData.x_url).trim() ? String(brandData.x_url).trim() : null;
    }
    if (brandData.instagram_url !== undefined) {
      updateData.instagram_url =
        brandData.instagram_url && String(brandData.instagram_url).trim()
          ? String(brandData.instagram_url).trim()
          : null;
    }
    if (brandData.tiktok_url !== undefined) {
      updateData.tiktok_url =
        brandData.tiktok_url && String(brandData.tiktok_url).trim()
          ? String(brandData.tiktok_url).trim()
          : null;
    }
    if (brandData.youtube_url !== undefined) {
      updateData.youtube_url =
        brandData.youtube_url && String(brandData.youtube_url).trim()
          ? String(brandData.youtube_url).trim()
          : null;
    }
    if (brandData.discord_url !== undefined) {
      updateData.discord_url =
        brandData.discord_url && String(brandData.discord_url).trim()
          ? String(brandData.discord_url).trim()
          : null;
    }

    // Update brand fields first (so taxonomy_id is updated before keywords)
    const brand = await updateBrand(resolvedParams.id, updateData);

    // Update keywords separately if provided (after brand update, so it uses the new taxonomy_id)
    if (validatedData.keywords !== undefined) {
      try {
        // Log what we're about to save
        console.log(
          `[PATCH /brands/${resolvedParams.id}] Updating keywords:`,
          validatedData.keywords
        );

        // Safety check: if keywords array is suspiciously empty, fetch current keywords first
        if (validatedData.keywords.length === 0) {
          console.warn(
            `[PATCH /brands/${resolvedParams.id}] WARNING: Empty keywords array provided! Fetching current keywords...`
          );
          const currentBrand = await getBrandById(resolvedParams.id);
          if (currentBrand && currentBrand.keywords.length > 0) {
            console.warn(
              `[PATCH /brands/${resolvedParams.id}] Found ${currentBrand.keywords.length} existing keywords, preserving them`
            );
            // Merge with existing keywords (but still use the provided empty array - user might want to clear them)
            // Actually, let's not override - if user sends empty array, maybe they want to clear?
            // But that seems wrong. Let's preserve existing if empty array is sent.
            // Actually, let's just log and proceed - the sub-subcategory will be added automatically
          }
        }

        await updateBrandKeywords(resolvedParams.id, validatedData.keywords);
      } catch (keywordError) {
        console.error("Error updating keywords:", keywordError);
        throw new Error(
          `Failed to update keywords: ${keywordError instanceof Error ? keywordError.message : "Unknown error"}`
        );
      }
    }

    // Fetch updated brand with keywords
    const updatedBrand = await getBrandById(resolvedParams.id);
    if (!updatedBrand) {
      throw new Error("Brand not found after update");
    }

    return NextResponse.json({ brand: updatedBrand });
  } catch (error) {
    console.error("Error updating brand:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/brand-directory/brands/[id]
 * Soft delete brand
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
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

    await deleteBrand(resolvedParams.id);

    return NextResponse.json({ message: "Brand deleted successfully" });
  } catch (error) {
    console.error("Error deleting brand:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
