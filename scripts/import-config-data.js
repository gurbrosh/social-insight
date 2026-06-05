#!/usr/bin/env node

/**
 * Import configuration data from JSON file to remote database
 *
 * This script runs during deployment to import configuration data
 * from the exported JSON file into the remote database.
 *
 * Usage:
 *   DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/import-config-data.js
 */

import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DATA_FILE = path.join(__dirname, "../prisma/config-data.json");

async function getRemoteLibSQLClient(databaseUrl, authToken) {
  return createClient({
    url: databaseUrl,
    authToken: authToken,
  });
}

async function importConfigData() {
  const databaseUrl = process.env.DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is required");
    process.exit(1);
  }

  if (databaseUrl.startsWith("libsql://") && !tursoAuthToken) {
    console.error("❌ TURSO_AUTH_TOKEN environment variable is required for Turso databases");
    process.exit(1);
  }

  // Check if config data file exists
  if (!fs.existsSync(CONFIG_DATA_FILE)) {
    console.log("ℹ️  No config data file found, skipping import");
    return;
  }

  console.log("📥 Importing configuration data from file...");

  const configData = JSON.parse(fs.readFileSync(CONFIG_DATA_FILE, "utf8"));
  const remoteClient = await getRemoteLibSQLClient(databaseUrl, tursoAuthToken);

  // Get admin user ID for mapping
  const adminUsers = await remoteClient.execute({
    sql: `SELECT u.id FROM "User" u 
          INNER JOIN "UserRole" ur ON u.id = ur.user_id 
          INNER JOIN "Role" r ON ur.role_id = r.id 
          WHERE r.name = 'admin' AND u.deleted_at IS NULL AND ur.deleted_at IS NULL AND r.deleted_at IS NULL 
          LIMIT 1`,
  });

  if (adminUsers.rows.length === 0) {
    console.log(
      "⚠️  No admin user found, skipping import (will need to run manually after admin setup)"
    );
    return;
  }

  const adminUserId = adminUsers.rows[0].id;
  console.log(`   Using admin user: ${adminUserId}`);

  let imported = { scrapers: 0, orchestrations: 0, recipes: 0, appConfigs: 0 };
  let skipped = { scrapers: 0, orchestrations: 0, recipes: 0, appConfigs: 0 };
  let updated = { appConfigs: 0 };

  // Import scrapers
  if (configData.scrapers && configData.scrapers.length > 0) {
    console.log(`\n📥 Importing ${configData.scrapers.length} scraper(s)...`);
    for (const scraper of configData.scrapers) {
      try {
        const existing = await remoteClient.execute({
          sql: `SELECT id FROM "Scraper" WHERE name = ? AND deleted_at IS NULL`,
          args: [scraper.name],
        });

        if (existing.rows.length > 0) {
          skipped.scrapers++;
          continue;
        }

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
        imported.scrapers++;
      } catch (error) {
        if (!error.message.includes("UNIQUE constraint")) {
          console.error(`   ❌ Failed to import scraper "${scraper.name}": ${error.message}`);
        } else {
          skipped.scrapers++;
        }
      }
    }
    console.log(`   ✅ Imported ${imported.scrapers}, skipped ${skipped.scrapers}`);
  }

  // Import orchestrations
  if (configData.orchestrations && configData.orchestrations.length > 0) {
    console.log(`\n📥 Importing ${configData.orchestrations.length} orchestration(s)...`);
    for (const orchestration of configData.orchestrations) {
      try {
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
            adminUserId,
            orchestration.project_ids,
            orchestration.threads,
            false,
            orchestration.last_run_at,
          ],
        });
        imported.orchestrations++;
      } catch (error) {
        if (error.message.includes("UNIQUE constraint")) {
          skipped.orchestrations++;
        } else {
          console.error(
            `   ❌ Failed to import orchestration "${orchestration.name}": ${error.message}`
          );
        }
      }
    }
    console.log(`   ✅ Imported ${imported.orchestrations}, skipped ${skipped.orchestrations}`);
  }

  // Import recipes
  if (configData.recipes && configData.recipes.length > 0) {
    console.log(`\n📥 Importing ${configData.recipes.length} recipe(s)...`);
    for (const recipe of configData.recipes) {
      try {
        const existing = await remoteClient.execute({
          sql: `SELECT id FROM "OrchestrationRecipe" WHERE id = ? AND deleted_at IS NULL`,
          args: [recipe.id],
        });

        if (existing.rows.length > 0) {
          skipped.recipes++;
          continue;
        }

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
            adminUserId,
            recipe.timezone || "UTC",
            recipe.is_active ?? true,
          ],
        });
        imported.recipes++;

        // Import recipe steps
        if (recipe.steps && recipe.steps.length > 0) {
          for (const step of recipe.steps) {
            try {
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
                  step.orchestration_id,
                  step.sequence,
                  step.initial_enabled ?? false,
                  step.initial_run_type || "NOW",
                  step.initial_schedule_time,
                  step.hourly_interval,
                  step.daily_interval,
                  step.daily_time,
                ],
              });
            } catch (stepError) {
              if (!stepError.message.includes("UNIQUE constraint")) {
                console.error(
                  `     ❌ Failed to import step ${step.sequence}: ${stepError.message}`
                );
              }
            }
          }
        }
      } catch (error) {
        if (error.message.includes("UNIQUE constraint")) {
          skipped.recipes++;
        } else {
          console.error(`   ❌ Failed to import recipe "${recipe.name}": ${error.message}`);
        }
      }
    }
    console.log(`   ✅ Imported ${imported.recipes}, skipped ${skipped.recipes}`);
  }

  // Import app configs
  if (configData.appConfigs && configData.appConfigs.length > 0) {
    console.log(`\n📥 Importing ${configData.appConfigs.length} configuration item(s)...`);
    for (const config of configData.appConfigs) {
      try {
        const existing = await remoteClient.execute({
          sql: `SELECT id FROM "AppConfig" WHERE category = ? AND key = ? AND deleted_at IS NULL`,
          args: [config.category, config.key],
        });

        if (existing.rows.length > 0) {
          // Update existing
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
          updated.appConfigs++;
        } else {
          // Insert new
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
          imported.appConfigs++;
        }
      } catch (error) {
        if (!error.message.includes("UNIQUE constraint")) {
          console.error(
            `   ❌ Failed to import config "${config.category}.${config.key}": ${error.message}`
          );
        } else {
          skipped.appConfigs++;
        }
      }
    }
    console.log(
      `   ✅ Imported ${imported.appConfigs}, updated ${updated.appConfigs}, skipped ${skipped.appConfigs}`
    );
  }

  console.log("\n✅ Configuration data import complete!");
  console.log("\n📊 Summary:");
  console.log(`   Scrapers: ${imported.scrapers} imported, ${skipped.scrapers} skipped`);
  console.log(
    `   Orchestrations: ${imported.orchestrations} imported, ${skipped.orchestrations} skipped`
  );
  console.log(`   Recipes: ${imported.recipes} imported, ${skipped.recipes} skipped`);
  console.log(
    `   App Config: ${imported.appConfigs} imported, ${updated.appConfigs} updated, ${skipped.appConfigs} skipped`
  );
}

importConfigData().catch((error) => {
  console.error("❌ Import failed:", error);
  process.exit(1);
});
