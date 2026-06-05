#!/usr/bin/env node

/**
 * Migrate Brand Directory data (BusinessTaxonomy, Brand, BrandKeyword, TaxonomyRedditLink, BrandRedditLink)
 * from local to remote database
 *
 * Usage:
 *   LOCAL_DATABASE_URL="file:./db/prod.db" REMOTE_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/migrate-brand-directory.js
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Prisma client for local database
function createLocalPrisma(databaseUrl) {
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

// Get remote libSQL client (for Turso or other libSQL databases)
async function getRemoteLibSQLClient(databaseUrl, authToken) {
  return createClient({
    url: databaseUrl,
    authToken: authToken,
  });
}

async function exportTaxonomy(localPrisma) {
  console.log("📦 Exporting business taxonomy...");
  const taxonomies = await localPrisma.businessTaxonomy.findMany({
    where: { deleted_at: null },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
  });
  console.log(`   Found ${taxonomies.length} taxonomy entries`);
  return taxonomies;
}

async function exportBrands(localPrisma) {
  console.log("📦 Exporting brands...");
  const brands = await localPrisma.brand.findMany({
    where: { deleted_at: null },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
      redditLinks: {
        where: { deleted_at: null },
      },
    },
    orderBy: { created_at: "asc" },
  });
  console.log(
    `   Found ${brands.length} brand(s) with ${brands.reduce((sum, b) => sum + b.keywords.length, 0)} total keywords`
  );
  return brands;
}

async function exportTaxonomyRedditLinks(localPrisma) {
  console.log("📦 Exporting taxonomy Reddit links...");
  const links = await localPrisma.taxonomyRedditLink.findMany({
    where: { deleted_at: null },
  });
  console.log(`   Found ${links.length} taxonomy Reddit link(s)`);
  return links;
}

async function importTaxonomy(remoteClient, taxonomies) {
  console.log(`\n📥 Importing ${taxonomies.length} taxonomy entries...`);
  let imported = 0;
  let skipped = 0;

  for (const taxonomy of taxonomies) {
    try {
      // Check if taxonomy already exists (by unique combination of category, subcategory, sub_subcategory)
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "BusinessTaxonomy" 
              WHERE category = ? AND subcategory = ? AND sub_subcategory = ? AND deleted_at IS NULL`,
        args: [taxonomy.category, taxonomy.subcategory, taxonomy.sub_subcategory],
      });

      if (existing.rows.length > 0) {
        console.log(
          `   ⏭️  Skipping taxonomy "${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}" (already exists)`
        );
        skipped++;
        continue;
      }

      // Insert taxonomy
      await remoteClient.execute({
        sql: `INSERT INTO "BusinessTaxonomy" (
          id, created_at, updated_at, deleted_at,
          category, subcategory, sub_subcategory
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          taxonomy.id,
          taxonomy.created_at,
          taxonomy.updated_at,
          taxonomy.deleted_at,
          taxonomy.category,
          taxonomy.subcategory,
          taxonomy.sub_subcategory,
        ],
      });

      imported++;
      if (imported % 50 === 0) {
        console.log(`   ✓ Imported ${imported} taxonomy entries...`);
      }
    } catch (error) {
      if (error.message.includes("UNIQUE constraint") || error.message.includes("already exists")) {
        console.log(
          `   ⏭️  Skipping taxonomy "${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}" (duplicate)`
        );
        skipped++;
      } else {
        console.error(
          `   ❌ Failed to import taxonomy "${taxonomy.category} > ${taxonomy.subcategory} > ${taxonomy.sub_subcategory}": ${error.message}`
        );
        throw error;
      }
    }
  }

  console.log(`   ✅ Imported ${imported}, skipped ${skipped}`);
  return { imported, skipped };
}

async function importBrands(remoteClient, brands) {
  console.log(`\n📥 Importing ${brands.length} brand(s)...`);
  let imported = 0;
  let skipped = 0;
  let keywordsImported = 0;
  let keywordsSkipped = 0;
  let redditLinksImported = 0;
  let redditLinksSkipped = 0;

  for (const brand of brands) {
    try {
      // Check if brand already exists (by company_name or brand_name)
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "Brand" 
              WHERE (company_name = ? OR brand_name = ?) AND deleted_at IS NULL
              LIMIT 1`,
        args: [brand.company_name, brand.brand_name],
      });

      if (existing.rows.length > 0) {
        console.log(`   ⏭️  Skipping brand "${brand.brand_name}" (already exists)`);
        skipped++;
        continue;
      }

      // Verify taxonomy exists
      const taxonomyExists = await remoteClient.execute({
        sql: `SELECT id FROM "BusinessTaxonomy" WHERE id = ? AND deleted_at IS NULL`,
        args: [brand.business_taxonomy_id],
      });

      if (taxonomyExists.rows.length === 0) {
        console.log(
          `   ⚠️  Skipping brand "${brand.brand_name}" (taxonomy ${brand.business_taxonomy_id} not found)`
        );
        skipped++;
        continue;
      }

      // Insert brand
      await remoteClient.execute({
        sql: `INSERT INTO "Brand" (
          id, created_at, updated_at, deleted_at,
          business_taxonomy_id, company_name, brand_name, brand_stage, approved,
          website_url, careers_url, linkedin_url, facebook_url, x_url,
          instagram_url, tiktok_url, youtube_url, discord_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          brand.id,
          brand.created_at,
          brand.updated_at,
          brand.deleted_at,
          brand.business_taxonomy_id,
          brand.company_name,
          brand.brand_name,
          brand.brand_stage,
          brand.approved ? 1 : 0, // SQLite boolean
          brand.website_url,
          brand.careers_url,
          brand.linkedin_url,
          brand.facebook_url,
          brand.x_url,
          brand.instagram_url,
          brand.tiktok_url,
          brand.youtube_url,
          brand.discord_url,
        ],
      });

      // Import keywords
      for (const keyword of brand.keywords) {
        try {
          await remoteClient.execute({
            sql: `INSERT INTO "BrandKeyword" (
              id, created_at, updated_at, deleted_at,
              brand_id, keyword
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
              keyword.id,
              keyword.created_at,
              keyword.updated_at,
              keyword.deleted_at,
              brand.id,
              keyword.keyword,
            ],
          });
          keywordsImported++;
        } catch (error) {
          if (error.message.includes("UNIQUE constraint")) {
            keywordsSkipped++;
          } else {
            console.error(
              `   ❌ Failed to import keyword "${keyword.keyword}" for brand "${brand.brand_name}": ${error.message}`
            );
          }
        }
      }

      // Import Reddit links
      for (const link of brand.redditLinks) {
        try {
          await remoteClient.execute({
            sql: `INSERT INTO "BrandRedditLink" (
              id, created_at, updated_at, deleted_at,
              brand_id, url
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [link.id, link.created_at, link.updated_at, link.deleted_at, brand.id, link.url],
          });
          redditLinksImported++;
        } catch (error) {
          if (error.message.includes("UNIQUE constraint")) {
            redditLinksSkipped++;
          } else {
            console.error(
              `   ❌ Failed to import Reddit link for brand "${brand.brand_name}": ${error.message}`
            );
          }
        }
      }

      imported++;
      if (imported % 10 === 0) {
        console.log(`   ✓ Imported ${imported} brands...`);
      }
    } catch (error) {
      if (error.message.includes("UNIQUE constraint") || error.message.includes("already exists")) {
        console.log(`   ⏭️  Skipping brand "${brand.brand_name}" (duplicate)`);
        skipped++;
      } else {
        console.error(`   ❌ Failed to import brand "${brand.brand_name}": ${error.message}`);
        throw error;
      }
    }
  }

  console.log(`   ✅ Imported ${imported} brands, skipped ${skipped}`);
  console.log(`   ✅ Imported ${keywordsImported} keywords, skipped ${keywordsSkipped}`);
  console.log(`   ✅ Imported ${redditLinksImported} Reddit links, skipped ${redditLinksSkipped}`);
  return {
    imported,
    skipped,
    keywordsImported,
    keywordsSkipped,
    redditLinksImported,
    redditLinksSkipped,
  };
}

async function importTaxonomyRedditLinks(remoteClient, links) {
  console.log(`\n📥 Importing ${links.length} taxonomy Reddit links...`);
  let imported = 0;
  let skipped = 0;

  for (const link of links) {
    try {
      // Check if link already exists
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "TaxonomyRedditLink" 
              WHERE taxonomy_id = ? AND url = ? AND deleted_at IS NULL`,
        args: [link.taxonomy_id, link.url],
      });

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Verify taxonomy exists
      const taxonomyExists = await remoteClient.execute({
        sql: `SELECT id FROM "BusinessTaxonomy" WHERE id = ? AND deleted_at IS NULL`,
        args: [link.taxonomy_id],
      });

      if (taxonomyExists.rows.length === 0) {
        console.log(`   ⚠️  Skipping Reddit link (taxonomy ${link.taxonomy_id} not found)`);
        skipped++;
        continue;
      }

      // Insert link
      await remoteClient.execute({
        sql: `INSERT INTO "TaxonomyRedditLink" (
          id, created_at, updated_at, deleted_at,
          taxonomy_id, url
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          link.id,
          link.created_at,
          link.updated_at,
          link.deleted_at,
          link.taxonomy_id,
          link.url,
        ],
      });

      imported++;
    } catch (error) {
      if (error.message.includes("UNIQUE constraint")) {
        skipped++;
      } else {
        console.error(`   ❌ Failed to import taxonomy Reddit link: ${error.message}`);
      }
    }
  }

  console.log(`   ✅ Imported ${imported}, skipped ${skipped}`);
  return { imported, skipped };
}

async function main() {
  const localDatabaseUrl = process.env.LOCAL_DATABASE_URL || "file:./db/prod.db";
  const remoteDatabaseUrl = process.env.REMOTE_DATABASE_URL || process.env.DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

  if (!remoteDatabaseUrl) {
    console.error("❌ REMOTE_DATABASE_URL or DATABASE_URL environment variable is required");
    process.exit(1);
  }

  if (remoteDatabaseUrl.startsWith("libsql://") && !tursoAuthToken) {
    console.error("❌ TURSO_AUTH_TOKEN environment variable is required for Turso databases");
    process.exit(1);
  }

  console.log("🚀 Starting brand directory data migration...");
  console.log(`   Local DB: ${localDatabaseUrl}`);
  console.log(`   Remote DB: ${remoteDatabaseUrl.substring(0, 30)}...`);

  const localPrisma = createLocalPrisma(localDatabaseUrl);
  const remoteClient = await getRemoteLibSQLClient(remoteDatabaseUrl, tursoAuthToken);

  try {
    // Export data
    console.log("\n📤 Exporting data from local database...");
    const taxonomies = await exportTaxonomy(localPrisma);
    const brands = await exportBrands(localPrisma);
    const taxonomyRedditLinks = await exportTaxonomyRedditLinks(localPrisma);

    // Import data (order matters: taxonomy first, then brands, then links)
    console.log("\n📥 Importing data to remote database...");
    const taxonomyResults = await importTaxonomy(remoteClient, taxonomies);
    const brandResults = await importBrands(remoteClient, brands);
    const redditLinksResults = await importTaxonomyRedditLinks(remoteClient, taxonomyRedditLinks);

    // Summary
    console.log("\n✅ Migration complete!");
    console.log("\n📊 Summary:");
    console.log(
      `   Taxonomy: ${taxonomyResults.imported} imported, ${taxonomyResults.skipped} skipped`
    );
    console.log(`   Brands: ${brandResults.imported} imported, ${brandResults.skipped} skipped`);
    console.log(
      `   Brand Keywords: ${brandResults.keywordsImported} imported, ${brandResults.keywordsSkipped} skipped`
    );
    console.log(
      `   Brand Reddit Links: ${brandResults.redditLinksImported} imported, ${brandResults.redditLinksSkipped} skipped`
    );
    console.log(
      `   Taxonomy Reddit Links: ${redditLinksResults.imported} imported, ${redditLinksResults.skipped} skipped`
    );
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await localPrisma.$disconnect();
  }
}

main();
