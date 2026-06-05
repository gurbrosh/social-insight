/**
 * Deduplicate brands: remove duplicate entries based on company_name or brand_name (case-insensitive)
 * Keeps the "best" brand from each duplicate group (approved, most complete data, oldest)
 */

import { prisma } from "../lib/prisma";

interface BrandForDedup {
  id: string;
  company_name: string;
  brand_name: string;
  created_at: Date;
  approved: boolean;
  website_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  discord_url: string | null;
  careers_url: string | null;
}

function countUrls(brand: BrandForDedup): number {
  let count = 0;
  if (brand.website_url) count++;
  if (brand.linkedin_url) count++;
  if (brand.facebook_url) count++;
  if (brand.x_url) count++;
  if (brand.instagram_url) count++;
  if (brand.tiktok_url) count++;
  if (brand.youtube_url) count++;
  if (brand.discord_url) count++;
  if (brand.careers_url) count++;
  return count;
}

function chooseBestBrand(brands: BrandForDedup[]): BrandForDedup {
  // Sort by: approved first, then most URLs, then oldest
  return brands.sort((a, b) => {
    // Approved brands first
    if (a.approved && !b.approved) return -1;
    if (!a.approved && b.approved) return 1;

    // Then by number of URLs (most complete)
    const aUrls = countUrls(a);
    const bUrls = countUrls(b);
    if (aUrls !== bUrls) return bUrls - aUrls;

    // Finally by oldest created_at
    return a.created_at.getTime() - b.created_at.getTime();
  })[0];
}

async function deduplicateBrands() {
  console.log("🔍 Fetching all brands...");
  const allBrands = await prisma.brand.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      company_name: true,
      brand_name: true,
      created_at: true,
      approved: true,
      website_url: true,
      linkedin_url: true,
      facebook_url: true,
      x_url: true,
      instagram_url: true,
      tiktok_url: true,
      youtube_url: true,
      discord_url: true,
      careers_url: true,
    },
  });

  console.log(`📊 Found ${allBrands.length} total brands`);

  // Group by company_name (case-insensitive)
  const companyGroups = new Map<string, BrandForDedup[]>();
  allBrands.forEach((brand) => {
    const key = brand.company_name.toLowerCase().trim();
    if (!companyGroups.has(key)) {
      companyGroups.set(key, []);
    }
    companyGroups.get(key)!.push(brand);
  });

  // Group by brand_name (case-insensitive)
  const brandGroups = new Map<string, BrandForDedup[]>();
  allBrands.forEach((brand) => {
    const key = brand.brand_name.toLowerCase().trim();
    if (!brandGroups.has(key)) {
      brandGroups.set(key, []);
    }
    brandGroups.get(key)!.push(brand);
  });

  // Find duplicates
  const duplicatesToDelete = new Set<string>();
  const brandsToKeep = new Set<string>();

  // Process company_name duplicates
  console.log("\n🔍 Processing company_name duplicates...");
  let companyDupCount = 0;
  companyGroups.forEach((brands, key) => {
    if (brands.length > 1) {
      companyDupCount += brands.length - 1;
      const best = chooseBestBrand(brands);
      brandsToKeep.add(best.id);
      brands.forEach((b) => {
        if (b.id !== best.id) {
          duplicatesToDelete.add(b.id);
        }
      });
    } else {
      brandsToKeep.add(brands[0].id);
    }
  });

  // Process brand_name duplicates (same brand name = duplicate, even if different company names)
  // IMPORTANT: Only keep ONE brand per brand_name, regardless of company_name
  console.log("🔍 Processing brand_name duplicates...");
  let brandDupCount = 0;
  brandGroups.forEach((brands, key) => {
    if (brands.length > 1) {
      // Filter out brands already marked for deletion
      const activeBrands = brands.filter((b) => !duplicatesToDelete.has(b.id));

      if (activeBrands.length > 1) {
        // Always keep only ONE brand per brand_name
        // Choose the best one, mark all others for deletion
        const best = chooseBestBrand(activeBrands);

        // Remove from brandsToKeep if there were multiple kept brands
        activeBrands.forEach((b) => {
          if (b.id !== best.id) {
            // Mark for deletion (even if it was previously kept)
            duplicatesToDelete.add(b.id);
            brandsToKeep.delete(b.id); // Remove from keep set
            brandDupCount++;
          }
        });

        // Ensure the best one is kept
        brandsToKeep.add(best.id);
      } else if (activeBrands.length === 1) {
        // Only one active brand left, make sure it's kept
        brandsToKeep.add(activeBrands[0].id);
      }
    } else {
      // Single brand, make sure it's marked to keep (if not already deleted)
      if (!duplicatesToDelete.has(brands[0].id)) {
        brandsToKeep.add(brands[0].id);
      }
    }
  });

  console.log(`\n📊 Deduplication Summary:`);
  console.log(`  - Brands to keep: ${brandsToKeep.size}`);
  console.log(`  - Duplicates to delete: ${duplicatesToDelete.size}`);
  console.log(`  - Company name duplicates: ${companyDupCount}`);
  console.log(`  - Brand name duplicates: ${brandDupCount}`);

  if (duplicatesToDelete.size === 0) {
    console.log("\n✅ No duplicates found!");
    await prisma.$disconnect();
    return;
  }

  // Soft delete duplicates
  console.log("\n🗑️  Soft-deleting duplicates...");
  const duplicateIds = Array.from(duplicatesToDelete);

  // Process in batches to avoid overwhelming the database
  const batchSize = 50;
  let deleted = 0;
  for (let i = 0; i < duplicateIds.length; i += batchSize) {
    const batch = duplicateIds.slice(i, i + batchSize);
    await prisma.brand.updateMany({
      where: {
        id: { in: batch },
      },
      data: {
        deleted_at: new Date(),
      },
    });
    deleted += batch.length;
    console.log(`  Deleted ${deleted}/${duplicateIds.length} duplicates...`);
  }

  console.log(`\n✅ Successfully deduplicated brands!`);
  console.log(`   Kept: ${brandsToKeep.size} brands`);
  console.log(`   Deleted: ${duplicatesToDelete.size} duplicates`);

  await prisma.$disconnect();
}

deduplicateBrands().catch((error) => {
  console.error("❌ Error deduplicating brands:", error);
  process.exit(1);
});
