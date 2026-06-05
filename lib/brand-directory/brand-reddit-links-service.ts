/**
 * Service for managing Reddit links for brands
 */

import { prisma } from "@/lib/prisma";

export interface BrandRedditLink {
  id: string;
  url: string;
  brand_id: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get all Reddit links for a brand
 */
export async function getRedditLinksForBrand(brandId: string): Promise<BrandRedditLink[]> {
  const links = await prisma.brandRedditLink.findMany({
    where: {
      brand_id: brandId,
      deleted_at: null,
    },
    orderBy: { created_at: "asc" },
  });

  return links.map((link) => ({
    id: link.id,
    url: link.url,
    brand_id: link.brand_id,
    created_at: link.created_at,
    updated_at: link.updated_at,
  }));
}

/**
 * Add Reddit links to a brand
 */
export async function addBrandRedditLinks(
  brandId: string,
  urls: string[]
): Promise<BrandRedditLink[]> {
  // Filter out empty URLs
  const validUrls = urls.filter((url) => url.trim().length > 0);

  if (validUrls.length === 0) {
    return [];
  }

  // Create all links (Prisma will handle unique constraint violations)
  const createdLinks = await Promise.all(
    validUrls.map(async (url) => {
      try {
        const created = await prisma.brandRedditLink.create({
          data: {
            brand_id: brandId,
            url: url.trim(),
          },
        });

        return {
          id: created.id,
          url: created.url,
          brand_id: created.brand_id,
          created_at: created.created_at,
          updated_at: created.updated_at,
        };
      } catch (error) {
        // If duplicate, skip it
        if (
          error instanceof Error &&
          (error.message.includes("Unique constraint") || error.message.includes("duplicate"))
        ) {
          console.log(`Skipping duplicate Reddit link: ${url}`);
          return null;
        }
        throw error;
      }
    })
  );

  return createdLinks.filter((link): link is BrandRedditLink => link !== null);
}

/**
 * Update Reddit links for a brand (replaces all existing links)
 */
export async function updateBrandRedditLinks(
  brandId: string,
  urls: string[]
): Promise<BrandRedditLink[]> {
  return await prisma.$transaction(async (tx) => {
    // Soft delete existing links
    await tx.brandRedditLink.updateMany({
      where: {
        brand_id: brandId,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    // Filter out empty URLs
    const validUrls = urls.filter((url) => url.trim().length > 0);

    if (validUrls.length === 0) {
      return [];
    }

    // Create new links
    const createdLinks = await Promise.all(
      validUrls.map(async (url) => {
        const created = await tx.brandRedditLink.create({
          data: {
            brand_id: brandId,
            url: url.trim(),
          },
        });

        return {
          id: created.id,
          url: created.url,
          brand_id: created.brand_id,
          created_at: created.created_at,
          updated_at: created.updated_at,
        };
      })
    );

    return createdLinks;
  });
}

/**
 * Delete a Reddit link by ID
 */
export async function deleteBrandRedditLink(linkId: string): Promise<void> {
  await prisma.brandRedditLink.update({
    where: { id: linkId },
    data: { deleted_at: new Date() },
  });
}
