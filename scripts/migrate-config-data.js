#!/usr/bin/env node

/**
 * Migrate configuration data (Scrapers, Orchestrations, Recipes, AppConfig) from local to remote database
 *
 * Usage:
 *   LOCAL_DATABASE_URL="file:./db/prod.db" REMOTE_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/migrate-config-data.js
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

async function exportScrapers(localPrisma) {
  console.log("📦 Exporting scrapers...");
  const scrapers = await localPrisma.scraper.findMany({
    where: { deleted_at: null },
  });
  console.log(`   Found ${scrapers.length} scraper(s)`);
  return scrapers;
}

async function exportOrchestrations(localPrisma) {
  console.log("📦 Exporting orchestrations...");
  const orchestrations = await localPrisma.orchestration.findMany({
    where: { deleted_at: null },
  });
  console.log(`   Found ${orchestrations.length} orchestration(s)`);
  return orchestrations;
}

async function exportRecipes(localPrisma) {
  console.log("📦 Exporting recipes...");
  const recipes = await localPrisma.orchestrationRecipe.findMany({
    where: { deleted_at: null },
    include: {
      steps: {
        where: { deleted_at: null },
        include: {
          skipConfigurations: {
            include: {
              skipStep: true,
            },
          },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
  console.log(
    `   Found ${recipes.length} recipe(s) with ${recipes.reduce((sum, r) => sum + r.steps.length, 0)} total step(s)`
  );
  return recipes;
}

async function exportAppConfigs(localPrisma) {
  console.log("📦 Exporting app configurations...");
  const appConfigs = await localPrisma.appConfig.findMany({
    where: { deleted_at: null },
  });
  console.log(`   Found ${appConfigs.length} configuration item(s)`);
  return appConfigs;
}

async function importScrapers(remoteClient, scrapers, userIdMapping = {}) {
  console.log(`\n📥 Importing ${scrapers.length} scraper(s)...`);
  let imported = 0;
  let skipped = 0;

  for (const scraper of scrapers) {
    try {
      // Check if scraper already exists (by name, which is unique)
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "Scraper" WHERE name = ? AND deleted_at IS NULL`,
        args: [scraper.name],
      });

      if (existing.rows.length > 0) {
        console.log(`   ⏭️  Skipping scraper "${scraper.name}" (already exists)`);
        skipped++;
        continue;
      }

      // Insert scraper
      await remoteClient.execute({
        sql: `INSERT INTO "Scraper" (
          id, created_at, updated_at, deleted_at,
          name, descriptive_name, actor_id, readme_url, platform,
          config_json, is_active, save_to_db,
          input_type, run_iteratively,
          url_input_field_name, url_input_source_scraper
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          scraper.id,
          scraper.created_at,
          scraper.updated_at,
          scraper.deleted_at,
          scraper.name,
          scraper.descriptive_name || "",
          scraper.actor_id,
          scraper.readme_url,
          scraper.platform,
          scraper.config_json,
          scraper.is_active,
          scraper.save_to_db,
          scraper.input_type || "array",
          scraper.run_iteratively ?? true,
          scraper.url_input_field_name,
          scraper.url_input_source_scraper,
        ],
      });

      console.log(`   ✓ Imported scraper "${scraper.name}"`);
      imported++;
    } catch (error) {
      console.error(`   ❌ Failed to import scraper "${scraper.name}": ${error.message}`);
    }
  }

  console.log(`   ✅ Imported ${imported}, skipped ${skipped}`);
  return { imported, skipped };
}

async function importOrchestrations(remoteClient, orchestrations, userIdMapping = {}) {
  console.log(`\n📥 Importing ${orchestrations.length} orchestration(s)...`);
  let imported = 0;
  let skipped = 0;

  // Build user ID mapping if not provided
  if (Object.keys(userIdMapping).length === 0) {
    console.log(
      "   ⚠️  No user ID mapping provided. Using first admin user from remote database..."
    );
    const adminUsers = await remoteClient.execute({
      sql: `SELECT u.id FROM "User" u 
            INNER JOIN "UserRole" ur ON u.id = ur.user_id 
            INNER JOIN "Role" r ON ur.role_id = r.id 
            WHERE r.name = 'admin' AND u.deleted_at IS NULL AND ur.deleted_at IS NULL AND r.deleted_at IS NULL 
            LIMIT 1`,
    });

    if (adminUsers.rows.length === 0) {
      throw new Error(
        "No admin user found in remote database. Please create an admin user first or provide user_id mapping."
      );
    }

    const defaultAdminId = adminUsers.rows[0].id;
    // Map all local user IDs to the default admin
    const localUserIds = [...new Set(orchestrations.map((o) => o.user_id))];
    for (const localUserId of localUserIds) {
      userIdMapping[localUserId] = defaultAdminId;
    }
    console.log(`   ℹ️  Mapping all local users to remote admin user: ${defaultAdminId}`);
  }

  for (const orchestration of orchestrations) {
    try {
      // Map user ID
      const remoteUserId = userIdMapping[orchestration.user_id] || orchestration.user_id;

      // Check if orchestration already exists (by name and user, though name isn't unique)
      // We'll import anyway and let duplicates exist if names match

      // Insert orchestration
      await remoteClient.execute({
        sql: `INSERT INTO "Orchestration" (
          id, created_at, updated_at, deleted_at,
          name, description, user_id,
          project_ids, threads,
          is_running, last_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          orchestration.id,
          orchestration.created_at,
          orchestration.updated_at,
          orchestration.deleted_at,
          orchestration.name,
          orchestration.description,
          remoteUserId,
          orchestration.project_ids,
          orchestration.threads,
          false, // Always set is_running to false on import
          orchestration.last_run_at,
        ],
      });

      console.log(`   ✓ Imported orchestration "${orchestration.name}"`);
      imported++;
    } catch (error) {
      if (error.message.includes("UNIQUE constraint") || error.message.includes("already exists")) {
        console.log(`   ⏭️  Skipping orchestration "${orchestration.name}" (already exists)`);
        skipped++;
      } else {
        console.error(
          `   ❌ Failed to import orchestration "${orchestration.name}": ${error.message}`
        );
      }
    }
  }

  console.log(`   ✅ Imported ${imported}, skipped ${skipped}`);
  return { imported, skipped };
}

async function importRecipes(
  remoteClient,
  recipes,
  userIdMapping = {},
  orchestrationIdMapping = {}
) {
  console.log(`\n📥 Importing ${recipes.length} recipe(s)...`);
  let imported = 0;
  let skipped = 0;
  let stepsImported = 0;
  let stepsSkipped = 0;

  // Build user ID mapping if not provided
  if (Object.keys(userIdMapping).length === 0) {
    console.log(
      "   ⚠️  No user ID mapping provided. Using first admin user from remote database..."
    );
    const adminUsers = await remoteClient.execute({
      sql: `SELECT u.id FROM "User" u 
            INNER JOIN "UserRole" ur ON u.id = ur.user_id 
            INNER JOIN "Role" r ON ur.role_id = r.id 
            WHERE r.name = 'admin' AND u.deleted_at IS NULL AND ur.deleted_at IS NULL AND r.deleted_at IS NULL 
            LIMIT 1`,
    });

    if (adminUsers.rows.length === 0) {
      throw new Error(
        "No admin user found in remote database. Please create an admin user first or provide user_id mapping."
      );
    }

    const defaultAdminId = adminUsers.rows[0].id;
    const localUserIds = [...new Set(recipes.map((r) => r.user_id))];
    for (const localUserId of localUserIds) {
      userIdMapping[localUserId] = defaultAdminId;
    }
    console.log(`   ℹ️  Mapping all local users to remote admin user: ${defaultAdminId}`);
  }

  for (const recipe of recipes) {
    try {
      // Map user ID
      const remoteUserId = userIdMapping[recipe.user_id] || recipe.user_id;

      // Check if recipe already exists
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "OrchestrationRecipe" WHERE id = ? AND deleted_at IS NULL`,
        args: [recipe.id],
      });

      if (existing.rows.length > 0) {
        console.log(`   ⏭️  Skipping recipe "${recipe.name}" (already exists)`);
        skipped++;
        continue;
      }

      // Insert recipe
      await remoteClient.execute({
        sql: `INSERT INTO "OrchestrationRecipe" (
          id, created_at, updated_at, deleted_at,
          name, description, user_id,
          timezone, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          recipe.id,
          recipe.created_at,
          recipe.updated_at,
          recipe.deleted_at,
          recipe.name,
          recipe.description,
          remoteUserId,
          recipe.timezone || "UTC",
          recipe.is_active ?? true,
        ],
      });

      console.log(`   ✓ Imported recipe "${recipe.name}"`);
      imported++;

      // Import recipe steps
      for (const step of recipe.steps) {
        try {
          // Map orchestration ID if mapping provided
          const remoteOrchestrationId =
            orchestrationIdMapping[step.orchestration_id] || step.orchestration_id;

          // Insert step
          await remoteClient.execute({
            sql: `INSERT INTO "OrchestrationRecipeStep" (
              id, created_at, updated_at, deleted_at,
              recipe_id, orchestration_id, sequence,
              initial_enabled, initial_run_type, initial_schedule_time,
              hourly_interval, daily_interval, daily_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              step.id,
              step.created_at,
              step.updated_at,
              step.deleted_at,
              step.recipe_id,
              remoteOrchestrationId,
              step.sequence,
              step.initial_enabled ?? false,
              step.initial_run_type || "NOW",
              step.initial_schedule_time,
              step.hourly_interval,
              step.daily_interval,
              step.daily_time,
            ],
          });

          stepsImported++;

          // Import skip configurations if any
          if (step.skipConfigurations && step.skipConfigurations.length > 0) {
            for (const skip of step.skipConfigurations) {
              try {
                await remoteClient.execute({
                  sql: `INSERT OR IGNORE INTO "OrchestrationRecipeStepSkip" (
                    id, created_at, step_id, skip_step_id
                  ) VALUES (?, ?, ?, ?)`,
                  args: [skip.id, skip.created_at, skip.step_id, skip.skip_step_id],
                });
              } catch (skipError) {
                // Skip if already exists
                if (!skipError.message.includes("UNIQUE constraint")) {
                  console.warn(`     ⚠️  Failed to import skip config: ${skipError.message}`);
                }
              }
            }
          }
        } catch (stepError) {
          if (
            stepError.message.includes("UNIQUE constraint") ||
            stepError.message.includes("already exists")
          ) {
            stepsSkipped++;
          } else {
            console.error(`     ❌ Failed to import step ${step.sequence}: ${stepError.message}`);
          }
        }
      }

      if (recipe.steps.length > 0) {
        console.log(`     → Imported ${stepsImported} step(s), skipped ${stepsSkipped}`);
      }
    } catch (error) {
      if (error.message.includes("UNIQUE constraint") || error.message.includes("already exists")) {
        console.log(`   ⏭️  Skipping recipe "${recipe.name}" (already exists)`);
        skipped++;
      } else {
        console.error(`   ❌ Failed to import recipe "${recipe.name}": ${error.message}`);
      }
    }
  }

  console.log(`   ✅ Imported ${imported} recipe(s), skipped ${skipped}`);
  return { imported, skipped, stepsImported, stepsSkipped };
}

async function importAppConfigs(remoteClient, appConfigs) {
  console.log(`\n📥 Importing ${appConfigs.length} configuration item(s)...`);
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const config of appConfigs) {
    try {
      // Check if config already exists (by category + key, which is unique)
      const existing = await remoteClient.execute({
        sql: `SELECT id FROM "AppConfig" WHERE category = ? AND key = ? AND deleted_at IS NULL`,
        args: [config.category, config.key],
      });

      if (existing.rows.length > 0) {
        // Update existing config instead of skipping
        await remoteClient.execute({
          sql: `UPDATE "AppConfig" SET
            updated_at = ?,
            value = ?,
            data_type = ?,
            description = ?,
            min_value = ?,
            max_value = ?,
            options = ?,
            display_name = ?,
            section = ?,
            "order" = ?
            WHERE category = ? AND key = ? AND deleted_at IS NULL`,
          args: [
            config.updated_at || new Date(),
            config.value,
            config.data_type,
            config.description,
            config.min_value,
            config.max_value,
            config.options,
            config.display_name,
            config.section,
            config.order,
            config.category,
            config.key,
          ],
        });
        console.log(`   ↻ Updated config "${config.category}.${config.key}"`);
        updated++;
      } else {
        // Insert new config
        await remoteClient.execute({
          sql: `INSERT INTO "AppConfig" (
            id, created_at, updated_at, deleted_at,
            category, key, value, data_type, description,
            min_value, max_value, options,
            display_name, section, "order"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            config.id,
            config.created_at,
            config.updated_at,
            config.deleted_at,
            config.category,
            config.key,
            config.value,
            config.data_type,
            config.description,
            config.min_value,
            config.max_value,
            config.options,
            config.display_name,
            config.section,
            config.order,
          ],
        });
        console.log(`   ✓ Imported config "${config.category}.${config.key}"`);
        imported++;
      }
    } catch (error) {
      if (error.message.includes("UNIQUE constraint") || error.message.includes("already exists")) {
        console.log(`   ⏭️  Skipping config "${config.category}.${config.key}" (already exists)`);
        skipped++;
      } else {
        console.error(
          `   ❌ Failed to import config "${config.category}.${config.key}": ${error.message}`
        );
      }
    }
  }

  console.log(`   ✅ Imported ${imported}, updated ${updated}, skipped ${skipped}`);
  return { imported, updated, skipped };
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

  console.log("🚀 Starting configuration data migration...");
  console.log(`   Local DB: ${localDatabaseUrl}`);
  console.log(`   Remote DB: ${remoteDatabaseUrl.substring(0, 50)}...`);

  const localPrisma = createLocalPrisma(localDatabaseUrl);
  const remoteClient = await getRemoteLibSQLClient(remoteDatabaseUrl, tursoAuthToken);

  try {
    // Export data
    console.log("\n📤 Exporting data from local database...");
    const scrapers = await exportScrapers(localPrisma);
    const orchestrations = await exportOrchestrations(localPrisma);
    const recipes = await exportRecipes(localPrisma);
    const appConfigs = await exportAppConfigs(localPrisma);

    // Import data
    console.log("\n📥 Importing data to remote database...");
    const scraperResults = await importScrapers(remoteClient, scrapers);
    const orchestrationResults = await importOrchestrations(remoteClient, orchestrations);
    const recipeResults = await importRecipes(remoteClient, recipes);
    const appConfigResults = await importAppConfigs(remoteClient, appConfigs);

    // Summary
    console.log("\n✅ Migration complete!");
    console.log("\n📊 Summary:");
    console.log(
      `   Scrapers: ${scraperResults.imported} imported, ${scraperResults.skipped} skipped`
    );
    console.log(
      `   Orchestrations: ${orchestrationResults.imported} imported, ${orchestrationResults.skipped} skipped`
    );
    console.log(`   Recipes: ${recipeResults.imported} imported, ${recipeResults.skipped} skipped`);
    console.log(
      `   Recipe Steps: ${recipeResults.stepsImported} imported, ${recipeResults.stepsSkipped} skipped`
    );
    console.log(
      `   App Config: ${appConfigResults.imported} imported, ${appConfigResults.updated} updated, ${appConfigResults.skipped} skipped`
    );
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await localPrisma.$disconnect();
  }
}

main();
