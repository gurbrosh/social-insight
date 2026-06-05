/**
 * Migration script to normalize all existing YouTube URLs from /c/ format to @ format
 *
 * Run with: npx tsx scripts/migrate-youtube-urls.ts
 */

import { prisma } from "../lib/prisma";
import { normalizeYouTubeUrl } from "../lib/utils/youtube-url-normalization";

async function migrateYouTubeUrls() {
  console.log("Starting YouTube URL migration...\n");

  let totalUpdated = 0;

  // 1. Update BrandAdditionalLink table
  console.log("1. Updating BrandAdditionalLink table...");
  const brandAdditionalLinks = await prisma.brandAdditionalLink.findMany({
    where: {
      platform: "YOUTUBE",
      deleted_at: null,
    },
  });

  console.log(`   Found ${brandAdditionalLinks.length} YouTube links in BrandAdditionalLink`);
  let updatedCount = 0;
  for (const link of brandAdditionalLinks) {
    const normalizedUrl = normalizeYouTubeUrl(link.url);
    if (normalizedUrl !== link.url) {
      try {
        await prisma.brandAdditionalLink.update({
          where: { id: link.id },
          data: { url: normalizedUrl },
        });
        updatedCount++;
        console.log(`   Updated: ${link.url} -> ${normalizedUrl}`);
      } catch (error: any) {
        console.error(`   Error updating link ${link.id}:`, error.message);
      }
    }
  }
  console.log(`   Updated ${updatedCount} links in BrandAdditionalLink\n`);
  totalUpdated += updatedCount;

  // 2. Update TaxonomyInfluencerLink table
  console.log("2. Updating TaxonomyInfluencerLink table...");
  const taxonomyInfluencerLinks = await prisma.taxonomyInfluencerLink.findMany({
    where: {
      platform: "YOUTUBE",
      deleted_at: null,
    },
  });

  console.log(`   Found ${taxonomyInfluencerLinks.length} YouTube links in TaxonomyInfluencerLink`);
  updatedCount = 0;
  for (const link of taxonomyInfluencerLinks) {
    const normalizedUrl = normalizeYouTubeUrl(link.url);
    if (normalizedUrl !== link.url) {
      try {
        await prisma.taxonomyInfluencerLink.update({
          where: { id: link.id },
          data: { url: normalizedUrl },
        });
        updatedCount++;
        console.log(`   Updated: ${link.url} -> ${normalizedUrl}`);
      } catch (error: any) {
        console.error(`   Error updating link ${link.id}:`, error.message);
      }
    }
  }
  console.log(`   Updated ${updatedCount} links in TaxonomyInfluencerLink\n`);
  totalUpdated += updatedCount;

  // 3. Update Brand.youtube_url field
  console.log("3. Updating Brand.youtube_url field...");
  const brands = await prisma.brand.findMany({
    where: {
      youtube_url: { not: null },
      deleted_at: null,
    },
    select: {
      id: true,
      brand_name: true,
      youtube_url: true,
    },
  });

  console.log(`   Found ${brands.length} brands with YouTube URLs`);
  updatedCount = 0;
  for (const brand of brands) {
    if (!brand.youtube_url) continue;
    const normalizedUrl = normalizeYouTubeUrl(brand.youtube_url);
    if (normalizedUrl !== brand.youtube_url) {
      try {
        await prisma.brand.update({
          where: { id: brand.id },
          data: { youtube_url: normalizedUrl },
        });
        updatedCount++;
        console.log(`   Updated ${brand.brand_name}: ${brand.youtube_url} -> ${normalizedUrl}`);
      } catch (error: any) {
        console.error(`   Error updating brand ${brand.id}:`, error.message);
      }
    }
  }
  console.log(`   Updated ${updatedCount} brands\n`);
  totalUpdated += updatedCount;

  console.log(`\n✅ Migration complete! Total URLs updated: ${totalUpdated}`);
}

// Run the migration
migrateYouTubeUrls()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
