#!/usr/bin/env node

/**
 * Automated Turso Database Migration System
 *
 * This script automatically:
 * 1. Creates a migration tracking table
 * 2. Reads all migration files from prisma/migrations
 * 3. Applies only migrations that haven't been run yet
 * 4. Tracks migration history
 */

import { createClient } from "@libsql/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { parsePrismaSchema } from "./parse-prisma-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

async function tableExists(client, tableName) {
  // sqlite_master access can vary across libsql adapters; the most reliable existence check
  // is to attempt a trivial SELECT from the table.
  // NOTE: tableName is controlled internally (not user input).
  try {
    await client.execute(`SELECT 1 FROM "${tableName}" LIMIT 1`);
    return true;
  } catch (error) {
    if (String(error?.message || "").includes("no such table")) {
      return false;
    }
    // Unknown error - bubble up so callers can decide how to handle
    throw error;
  }
}

async function columnExists(client, tableName, columnName) {
  try {
    // Use PRAGMA table_info to check for column existence
    const result = await client.execute(`PRAGMA table_info("${tableName}")`);
    const columns = result.rows.map((row) => row.name);
    return columns.includes(columnName);
  } catch (error) {
    // If table doesn't exist, column doesn't exist either
    if (String(error?.message || "").includes("no such table")) {
      return false;
    }
    throw error;
  }
}

function isSkippableMigrationStatementError(statement, errorMessage) {
  const stmt = statement.trim().replace(/\s+/g, " ").toUpperCase();
  const msg = String(errorMessage || "");

  const isAlterTable = stmt.startsWith("ALTER TABLE");
  const isCreateIndex =
    stmt.startsWith("CREATE INDEX") ||
    stmt.startsWith("CREATE UNIQUE INDEX") ||
    (stmt.startsWith("CREATE") && stmt.includes(" INDEX "));

  // Generic "already exists" (SQLite/libSQL phrasing)
  if (msg.includes("already exists")) return true;

  // Column already added (common when a migration applied but wasn't recorded)
  if (msg.includes("duplicate column name")) return isAlterTable;

  // Index already created
  if (msg.includes("duplicate") && msg.includes("index")) return isCreateIndex;

  return false;
}

function generateSchemaSQL(schemaPath) {
  // Avoid relying on `npx` in production images (PATH / package resolution can differ).
  // Prefer invoking the local Prisma CLI entry directly.
  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");

  if (!fs.existsSync(prismaCli)) {
    throw new Error(
      `Prisma CLI not found at ${prismaCli}. This environment must include devDependency 'prisma' to run schema repair.`
    );
  }

  return execSync(
    `node ${prismaCli} migrate diff --from-empty --to-schema-datamodel ${schemaPath} --script`,
    { encoding: "utf8" }
  );
}

async function applySQLStatements({ client, sql, label }) {
  // Better SQL splitting that handles multi-line statements
  // Split by semicolon, but preserve multi-line CREATE TABLE statements
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.trim().startsWith("--") && s.length > 0);

  let successCount = 0;
  let skippedCount = 0;
  let failedStatements = [];

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    try {
      await client.execute(statement);
      successCount++;
    } catch (error) {
      if (isSkippableMigrationStatementError(statement, error.message)) {
        skippedCount++;
        continue;
      }
      // For schema repair, don't fail on all errors - some tables might already exist
      // or dependencies might not be met yet
      failedStatements.push({ statement: statement.substring(0, 100), error: error.message });
      console.warn(
        `  ⚠️  ${label} statement ${i + 1}/${statements.length} failed: ${error.message.substring(0, 100)}`
      );

      // If this is a "no such table" error for a foreign key constraint,
      // continue - we'll try again after creating dependencies
      if (error.message.includes("no such table")) {
        continue;
      }

      // For other errors in schema repair, continue to try other statements
      // Only throw if this is a migration (not schema repair)
      if (!label.includes("repair")) {
        throw error;
      }
    }
  }

  if (failedStatements.length > 0 && !label.includes("repair")) {
    console.error(`❌ ${failedStatements.length} statement(s) failed`);
    throw new Error(`${failedStatements.length} statement(s) failed`);
  }

  console.log(
    `✓ ${label}: applied ${successCount} statement(s)` +
      (skippedCount ? `, skipped ${skippedCount}` : "") +
      (failedStatements.length > 0 && label.includes("repair")
        ? `, ${failedStatements.length} failed (non-critical)`
        : "")
  );
  return { statements, successCount, skippedCount, failedCount: failedStatements.length };
}

function getMissingTableNameFromError(errorMessage) {
  const msg = String(errorMessage || "");
  const match = msg.match(/no such table:\s*([A-Za-z0-9_]+)/i);
  return match?.[1] || null;
}

async function generateManualCreateTable({ client, schemaPath, tableName }) {
  // Read the schema file and extract the model definition
  try {
    const schemaContent = fs.readFileSync(schemaPath, "utf8");

    // Find the model definition
    const modelRegex = new RegExp(`model\\s+${tableName}\\s*{([^}]+(?:{[^}]*}[^}]*)*)}`, "s");
    const match = schemaContent.match(modelRegex);

    if (!match) {
      console.warn(`  ⚠️  Could not find model ${tableName} in schema.prisma`);
      return null;
    }

    // For now, return null and let Prisma handle it
    // This is a complex operation that requires full Prisma schema parsing
    // The better approach is to fix prisma migrate diff to work correctly
    return null;
  } catch (error) {
    console.warn(`  ⚠️  Error reading schema: ${error.message}`);
    return null;
  }
}

function extractCreateTableStatements(sql, tableNames) {
  // Extract CREATE TABLE statements for specific tables from full schema SQL
  // Returns SQL containing only the CREATE TABLE statements for the requested tables
  const results = [];
  const lines = sql.split("\n");
  let inCreateTable = false;
  let currentTable = null;
  let startIdx = -1;
  let parenCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim().toUpperCase();

    // Check if this line starts a CREATE TABLE for one of our needed tables
    if (trimmed.startsWith("CREATE TABLE")) {
      const tableMatch = line.match(/CREATE TABLE\s+"?([^"\s(]+)"?/i);
      if (tableMatch) {
        const tableName = tableMatch[1];
        if (tableNames.includes(tableName)) {
          inCreateTable = true;
          currentTable = tableName;
          startIdx = i;
          const openParens = (line.match(/\(/g) || []).length;
          const closeParens = (line.match(/\)/g) || []).length;
          parenCount = openParens - closeParens;

          if (parenCount === 0 && line.trim().endsWith(";")) {
            // Single-line CREATE TABLE
            results.push(line.trim());
            inCreateTable = false;
            currentTable = null;
          }
          continue;
        }
      }
    }

    if (inCreateTable && currentTable) {
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;
      parenCount += openParens - closeParens;

      if (parenCount === 0 && (line.trim().endsWith(";") || line.includes(");"))) {
        // End of CREATE TABLE found
        results.push(
          lines
            .slice(startIdx, i + 1)
            .join("\n")
            .trim()
        );
        inCreateTable = false;
        currentTable = null;
      }
    }
  }

  // Also extract CREATE INDEX statements for these tables
  for (const tableName of tableNames) {
    const indexRegex = new RegExp(`CREATE(?: UNIQUE)? INDEX[^"]*"${tableName}[^"]*".*?;`, "gis");
    const indexMatches = sql.match(indexRegex);
    if (indexMatches) {
      results.push(...indexMatches.map((m) => m.trim()));
    }
  }

  return results.length > 0 ? results.join("\n\n") : null;
}

function extractCreateTableStatement(migrationSQL, tableName) {
  // Find the CREATE TABLE statement for the specific table
  const lines = migrationSQL.split("\n");
  let inCreateTable = false;
  let startIdx = -1;
  let parenCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim().toUpperCase();

    // Check if this line starts a CREATE TABLE for our table
    if (
      (trimmedLine.includes(`CREATE TABLE "${tableName.toUpperCase()}"`) ||
        trimmedLine.includes(`CREATE TABLE ${tableName.toUpperCase()}`)) &&
      !trimmedLine.includes("NEW_")
    ) {
      inCreateTable = true;
      startIdx = i;
      // Count parentheses on this line
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;
      parenCount = openParens - closeParens;

      // If balanced and ends with semicolon, it's a single-line statement
      if (parenCount === 0 && line.trim().endsWith(";")) {
        return line.trim();
      }
      continue;
    }

    if (inCreateTable) {
      // Count parentheses on this line
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;
      parenCount += openParens - closeParens;

      // End of CREATE TABLE found when parentheses are balanced
      if (parenCount === 0 && (line.trim().endsWith(";") || line.trim().includes(");"))) {
        // Include this line and return
        const result = lines.slice(startIdx, i + 1).join("\n");
        return result.trim();
      }
    }
  }

  return null;
}

/**
 * Comprehensive schema validation: checks ALL tables and columns against Prisma schema
 */
async function validateAllTablesAndColumns({ client, schemaPath }) {
  const needsColumnAdd = [];

  try {
    // Parse the Prisma schema to get all models and fields
    const models = parsePrismaSchema(schemaPath);

    console.log(`🔍 Validating schema: checking ${Object.keys(models).length} models...`);

    for (const [modelName, model] of Object.entries(models)) {
      const tableExists = await tableExists(client, modelName);

      if (!tableExists) {
        // Table doesn't exist - skip column validation (table repair will handle it)
        continue;
      }

      // Get existing columns from database
      const tableInfo = await client.execute(`PRAGMA table_info("${modelName}")`);
      const existingColumns = new Set(tableInfo.rows.map((row) => row.name));

      // Check each field from schema
      for (const field of model.fields) {
        if (!existingColumns.has(field.name)) {
          needsColumnAdd.push({
            table: modelName,
            column: field.name,
            type: field.sqliteType,
            prismaType: field.prismaType,
          });
        }
      }
    }

    if (needsColumnAdd.length > 0) {
      console.log(
        `⚠️  Found ${needsColumnAdd.length} missing column(s) across ${new Set(needsColumnAdd.map((c) => c.table)).size} table(s)`
      );
    }

    return needsColumnAdd;
  } catch (error) {
    console.warn(`⚠️  Schema validation failed: ${error.message}`);
    return [];
  }
}

async function schemaRepairIfNeeded({ client, schemaPath, reason }) {
  try {
    // Table name -> migration folder that creates it
    // Note: Order matters for dependencies (e.g., OrchestrationRecipeStep needs OrchestrationRecipe)
    const criticalTables = {
      Orchestration: "20250928231049_add_orchestration_models",
      OrchestrationRecipe: null, // Not in migrations, will use Prisma diff
      ScrapeJob: "20250920060301_add_social_listening_models",
      OrchestrationRecipeStep: null, // Not in migrations, will use Prisma diff (depends on OrchestrationRecipe)
      OrchestrationTimerTask: null, // Not in migrations, will use Prisma diff (depends on OrchestrationRecipeStep)
      OrchestrationRecipeStepSkip: "20251106200000_add_initial_run_type", // Created in migration
    };

    const missing = [];
    const needsRepair = [];

    // Check tables in dependency order
    for (const [tableName, migrationName] of Object.entries(criticalTables)) {
      const exists = await tableExists(client, tableName);
      if (!exists) {
        missing.push({ table: tableName, migration: migrationName });
      } else {
        // Check for critical columns that might be missing
        // For OrchestrationTimerTask, ensure recipe_step_id exists
        if (tableName === "OrchestrationTimerTask") {
          const hasRecipeStepId = await columnExists(client, tableName, "recipe_step_id");
          if (!hasRecipeStepId) {
            needsRepair.push({ table: tableName, issue: "missing column recipe_step_id" });
          }
        }
      }
    }

    // Comprehensive validation: check ALL tables and columns against schema
    const needsColumnAdd = await validateAllTablesAndColumns({ client, schemaPath });

    // If tables need column repairs, we'll need to recreate them or add columns
    // For now, treat missing columns as missing tables to trigger full recreation
    if (needsRepair.length > 0) {
      console.warn(
        `⚠️  Detected tables with missing columns: ${needsRepair.map((r) => `${r.table} (${r.issue})`).join(", ")}`
      );
      // Add to missing list to trigger recreation
      for (const { table } of needsRepair) {
        const tableConfig = Object.entries(criticalTables).find(([name]) => name === table);
        if (tableConfig && !missing.find((m) => m.table === table)) {
          missing.push({ table, migration: tableConfig[1] });
        }
      }
    }

    // Handle non-destructive column additions (ALTER TABLE ADD COLUMN)
    if (needsColumnAdd.length > 0) {
      console.log(`ℹ️  Adding ${needsColumnAdd.length} missing column(s) to existing tables...`);

      // Group by table for better logging
      const byTable = {};
      for (const col of needsColumnAdd) {
        if (!byTable[col.table]) {
          byTable[col.table] = [];
        }
        byTable[col.table].push(col);
      }

      for (const [table, columns] of Object.entries(byTable)) {
        console.log(`  📋 Table ${table}: adding ${columns.length} column(s)`);
        for (const { column, type, prismaType } of columns) {
          try {
            await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
            console.log(`    ✓ Added column ${column} (${prismaType} -> ${type})`);
          } catch (error) {
            // Column might have been added concurrently, or there's a constraint issue
            if (
              String(error?.message || "").includes("duplicate column") ||
              String(error?.message || "").includes("already exists")
            ) {
              console.log(`    ℹ️  Column ${column} already exists, skipping`);
            } else {
              console.warn(`    ⚠️  Failed to add column ${column}: ${error.message}`);
            }
          }
        }
      }
    }

    // If we only have column additions (non-destructive), handle them separately
    if (missing.length === 0 && needsColumnAdd.length > 0) {
      // Column additions already handled above
      const repairedItems = needsColumnAdd.map((c) => `${c.table}.${c.column}`);
      return { repaired: true, missing: repairedItems };
    }

    if (missing.length === 0) return { repaired: false };

    console.log(
      `⚠️  Detected missing table(s): ${missing.map((m) => m.table).join(", ")}. Running schema repair (${reason})...`
    );

    const migrationsDir = path.join(__dirname, "../prisma/migrations");
    const repairStatements = [];

    // First, try to extract CREATE TABLE statements from known migrations
    for (const { table, migration } of missing) {
      // Check if table exists but is missing columns (needs to be dropped and recreated)
      const tableExistsButIncomplete = await tableExists(client, table);

      if (tableExistsButIncomplete) {
        // Table exists but is missing critical columns - drop it so we can recreate properly
        console.log(
          `  ⚠️  Table ${table} exists but is missing critical columns, dropping for recreation...`
        );
        try {
          await client.execute(`DROP TABLE IF EXISTS "${table}"`);
          console.log(`  ✓ Dropped incomplete table ${table}`);
        } catch (dropError) {
          console.warn(`  ⚠️  Failed to drop table ${table}: ${dropError.message}`);
          // Continue anyway - the CREATE TABLE might work if we skip existing errors
        }
      }

      if (migration) {
        const migrationPath = path.join(migrationsDir, migration, "migration.sql");
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf8");
          const createTableSQL = extractCreateTableStatement(migrationSQL, table);
          if (createTableSQL) {
            console.log(`  ✓ Extracted CREATE TABLE for ${table} from migration ${migration}`);
            repairStatements.push(createTableSQL);
          } else {
            console.warn(`  ⚠️  Could not extract CREATE TABLE for ${table} from ${migration}`);
          }
        } else {
          console.warn(`  ⚠️  Migration file not found: ${migrationPath}`);
        }
      }
    }

    // For tables not in migrations, use Prisma schema diff as fallback
    const tablesNeedingPrismaDiff = missing.filter((m) => !m.migration);
    if (tablesNeedingPrismaDiff.length > 0) {
      console.log(
        `  ℹ️  Using Prisma schema diff for: ${tablesNeedingPrismaDiff.map((m) => m.table).join(", ")}`
      );
      try {
        const sql = generateSchemaSQL(schemaPath);
        if (sql && sql.trim()) {
          // Debug: show first 1000 chars and count of CREATE TABLE statements
          const preview = sql.substring(0, 1000).replace(/\n/g, "\\n ");
          const createTableCount = (sql.match(/CREATE TABLE/gi) || []).length;
          console.log(
            `  ℹ️  Generated SQL: ${createTableCount} CREATE TABLE statement(s), preview: ${preview}...`
          );

          // Extract only the CREATE TABLE statements for tables we need
          // This avoids applying statements for tables that already exist (which would fail)
          const neededTables = tablesNeedingPrismaDiff.map((m) => m.table);
          const filteredSQL = extractCreateTableStatements(sql, neededTables);

          if (filteredSQL) {
            const extractedCount = (filteredSQL.match(/CREATE TABLE/gi) || []).length;
            console.log(
              `  ✓ Extracted ${extractedCount} CREATE TABLE statement(s) for needed tables`
            );
            repairStatements.push(filteredSQL);
          } else {
            console.warn(
              `  ⚠️  Could not extract CREATE TABLE statements for needed tables, using full SQL`
            );
            repairStatements.push(sql);
          }
        } else {
          console.warn(`  ⚠️  Prisma schema diff returned empty SQL`);
        }
      } catch (error) {
        console.warn(`  ⚠️  Could not generate schema SQL: ${error.message}`);
      }
    }

    if (repairStatements.length === 0) {
      console.warn("⚠️  No repair SQL generated");
      return { repaired: false, error: "No repair SQL generated" };
    }

    // Apply all repair statements (only if we have any)
    if (repairStatements.length > 0) {
      const repairSQL = repairStatements.join("\n\n");
      await applySQLStatements({ client, sql: repairSQL, label: "Schema repair" });
    }

    console.log("✅ Schema repair complete");
    const repairedItems = [
      ...missing.map((m) => m.table),
      ...needsColumnAdd.map((c) => `${c.table}.${c.column}`),
    ];
    return { repaired: true, missing: repairedItems };
  } catch (error) {
    console.error("⚠️  Schema repair failed:", error.message);
    return { repaired: false, error };
  }
}

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!databaseUrl || !databaseUrl.startsWith("libsql://")) {
    console.log("ℹ️  Not a Turso database, skipping migrations");
    process.exit(0);
  }

  if (!authToken) {
    console.error("❌ TURSO_AUTH_TOKEN is required for Turso databases");
    process.exit(1);
  }

  console.log("🚀 Starting Turso migration system...");

  let client;
  try {
    client = createClient({
      url: databaseUrl,
      authToken: authToken,
    });
  } catch (error) {
    console.error("❌ Failed to connect to Turso:", error.message);
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, "../prisma/migrations");
  const schemaPath = path.join(__dirname, "../prisma/schema.prisma");

  // Step 1: Create migration tracking table
  console.log("📊 Setting up migration tracking...");
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                    TEXT PRIMARY KEY NOT NULL,
        "checksum"              TEXT NOT NULL,
        "finished_at"           DATETIME,
        "migration_name"        TEXT NOT NULL,
        "logs"                  TEXT,
        "rolled_back_at"        DATETIME,
        "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
        "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      )
    `);
  } catch (error) {
    console.error("❌ Failed to create migration table:", error.message);
    process.exit(1);
  }

  // If an older version of this script created a legacy _prisma_migrations table
  // (missing Prisma-required columns like checksum), upgrade it safely.
  try {
    const tableInfo = await client.execute(`PRAGMA table_info("_prisma_migrations")`);
    const columns = new Set(tableInfo.rows.map((row) => row.name));

    if (
      !columns.has("checksum") ||
      !columns.has("started_at") ||
      !columns.has("applied_steps_count")
    ) {
      const legacyTable = `_prisma_migrations_legacy_${Date.now()}`;
      console.log(`⚠️  Detected legacy _prisma_migrations schema; upgrading → ${legacyTable}`);

      await client.execute(`ALTER TABLE "_prisma_migrations" RENAME TO "${legacyTable}"`);

      // Create the correct Prisma migrations table
      await client.execute(`
        CREATE TABLE "_prisma_migrations" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
        )
      `);

      // Migrate rows over (best-effort checksum from migration.sql if available)
      const legacyInfo = await client.execute(`PRAGMA table_info("${legacyTable}")`);
      const legacyCols = new Set(legacyInfo.rows.map((row) => row.name));

      const selectCols = [
        legacyCols.has("id") ? "id" : "NULL as id",
        legacyCols.has("migration_name") ? "migration_name" : "NULL as migration_name",
        legacyCols.has("logs") ? "logs" : "NULL as logs",
        legacyCols.has("applied_at") ? "applied_at" : "NULL as applied_at",
      ].join(", ");

      const legacyRows = await client.execute(`SELECT ${selectCols} FROM "${legacyTable}"`);

      for (const row of legacyRows.rows) {
        const migrationName = row.migration_name;
        if (!migrationName) continue;

        let checksum = sha256Hex(`legacy:${migrationName}`);
        const migrationPath = path.join(migrationsDir, migrationName, "migration.sql");
        if (fs.existsSync(migrationPath)) {
          checksum = sha256Hex(fs.readFileSync(migrationPath, "utf8"));
        }

        const when = row.applied_at ? String(row.applied_at) : new Date().toISOString();
        const id = row.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        await client.execute({
          sql: `INSERT INTO "_prisma_migrations"
            (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [id, checksum, migrationName, row.logs || null, when, when, 0],
        });
      }

      console.log("✅ Legacy _prisma_migrations upgrade complete");
    }
  } catch (error) {
    console.log("⚠️  Migration table upgrade check skipped:", error.message);
  }

  // Step 1b: Best-effort schema repair for partially-applied migrations.
  // If a previous deploy crashed mid-migration (common with SQLite "redefine table" steps),
  // core tables can be left missing (e.g., ScrapeJob). Repair early before applying migrations.
  await schemaRepairIfNeeded({ client, schemaPath, reason: "startup" });

  // Step 2: Get list of applied migrations
  let appliedMigrations = [];
  try {
    const result = await client.execute(
      `SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL`
    );
    appliedMigrations = result.rows.map((row) => row.migration_name);
    console.log(`✓ Found ${appliedMigrations.length} applied migrations`);
  } catch (error) {
    console.error("⚠️  Could not read migration history:", error.message);
  }

  // Step 3: Read migration files
  let migrationFolders = [];

  try {
    if (fs.existsSync(migrationsDir)) {
      migrationFolders = fs
        .readdirSync(migrationsDir)
        .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory())
        .filter((f) => /^\d{14}_/.test(f)) // Only folders starting with timestamp
        .sort(); // Sort chronologically
    }
  } catch {
    console.log("⚠️  No migrations directory found");
  }

  // Early exit if no pending migrations
  const pendingMigrations = migrationFolders.filter(
    (folder) => !appliedMigrations.includes(folder)
  );

  if (pendingMigrations.length === 0 && migrationFolders.length > 0) {
    console.log("✅ Database is up to date, no migrations needed");
    client.close();
    process.exit(0);
  }

  if (pendingMigrations.length > 0) {
    console.log(`🔄 Found ${pendingMigrations.length} pending migrations to apply`);
  }

  // Step 4: Apply pending migrations
  let migrationsRun = 0;
  let migrationsFailed = 0;

  for (const folder of migrationFolders) {
    if (appliedMigrations.includes(folder)) {
      console.log(`⏭️  Skipping migration: ${folder} (already applied)`);
      continue;
    }

    const migrationPath = path.join(migrationsDir, folder, "migration.sql");

    if (!fs.existsSync(migrationPath)) {
      console.log(`⚠️  No migration.sql found in ${folder}`);
      continue;
    }

    console.log(`📝 Applying migration: ${folder}`);

    try {
      const migrationSQL = fs.readFileSync(migrationPath, "utf8");
      const checksum = sha256Hex(migrationSQL);

      // Split migration into individual statements
      // First remove comment lines, then split by semicolon
      const cleanSQL = migrationSQL
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");

      const statements = cleanSQL
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Execute migration in a transaction-like manner
      let logs = [];
      let statementCount = 0;

      console.log(`  Processing ${statements.length} SQL statements...`);

      const executeStatementsOnce = async () => {
        for (const statement of statements) {
          try {
            await client.execute(statement);
            statementCount++;
            const preview = statement.replace(/\s+/g, " ").substring(0, 50);
            logs.push(`✓ ${preview}...`);
            console.log(`  ✓ Statement ${statementCount}/${statements.length}`);
          } catch (error) {
            // Some errors might be acceptable (e.g., column/index already exists)
            if (isSkippableMigrationStatementError(statement, error.message)) {
              statementCount++;
              logs.push(`ℹ️  Skipped (exists): ${statement.substring(0, 30)}`);
              console.log(
                `  ℹ️  Skipped statement ${statementCount}/${statements.length} (already exists)`
              );
            } else {
              console.error(
                `  ❌ Failed statement ${statementCount + 1}/${statements.length}: ${error.message}`
              );
              logs.push(`❌ Failed: ${error.message}`);
              throw error; // Re-throw to fail the migration
            }
          }
        }
      };

      // First attempt
      try {
        await executeStatementsOnce();
      } catch (error) {
        const missingTable = getMissingTableNameFromError(error.message);
        if (missingTable) {
          console.warn(
            `⚠️  Migration ${folder} failed due to missing table '${missingTable}'. Attempting schema repair and retry...`
          );
          await schemaRepairIfNeeded({
            client,
            schemaPath,
            reason: `missing table ${missingTable}`,
          });

          // Reset counters/logs for a clean retry
          logs = [];
          statementCount = 0;
          await executeStatementsOnce();
        } else {
          throw error;
        }
      }

      // Record successful migration
      const migrationId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      await client.execute({
        sql: `INSERT INTO "_prisma_migrations"
          (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          migrationId,
          checksum,
          folder,
          logs.join("\n"),
          new Date().toISOString(),
          new Date().toISOString(),
          statements.length,
        ],
      });

      console.log(`✅ Migration ${folder} applied successfully`);
      migrationsRun++;
    } catch (error) {
      console.error(`❌ Migration ${folder} failed:`, error.message);
      migrationsFailed++;
      // Migrations are ordered and often dependent; stop here to avoid cascading noise.
      break;
    }
  }

  // Step 5: If no migrations exist, generate initial schema
  if (migrationFolders.length === 0) {
    console.log("📝 No migrations found, generating initial schema...");

    // Generate SQL from Prisma schema

    try {
      const sql = generateSchemaSQL(schemaPath);
      const { successCount } = await applySQLStatements({ client, sql, label: "Initial schema" });

      // Record initial schema as migration
      const migrationId = `m_${Date.now()}_initial`;
      await client.execute({
        sql: `INSERT INTO "_prisma_migrations"
          (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          migrationId,
          sha256Hex(sql),
          "initial_schema",
          `Generated and applied ${successCount} statements`,
          new Date().toISOString(),
          new Date().toISOString(),
          successCount,
        ],
      });
    } catch (error) {
      console.error("❌ Failed to generate initial schema:", error.message);
    }
  }

  // Step 6: Add seed data if needed
  try {
    const roleCheck = await client.execute(`SELECT COUNT(*) as count FROM "Role"`);
    if (roleCheck.rows[0].count === 0) {
      console.log("🌱 Adding seed data...");

      await client.execute(`
        INSERT INTO "Role" (id, name, created_at, updated_at) 
        VALUES ('01JZK5AT1CBD1SBW5T3JQ60VPR', 'user', datetime('now'), datetime('now'))
      `);

      await client.execute(`
        INSERT INTO "Role" (id, name, created_at, updated_at) 
        VALUES ('01JZK5AT1CBD1SBW5T3JQ60VPS', 'admin', datetime('now'), datetime('now'))
      `);

      console.log("✓ Seed data added");
    }
  } catch (error) {
    console.log("ℹ️  Seed data check:", error.message);
  }

  client.close();

  // Summary
  console.log("\n📊 Migration complete!");
  if (migrationsRun > 0) {
    console.log(`   ✅ ${migrationsRun} migrations applied`);
  }
  if (migrationsFailed > 0) {
    console.log(`   ⚠️  ${migrationsFailed} migrations failed`);
  }
  if (migrationsRun === 0 && migrationsFailed === 0) {
    console.log(`   ℹ️  Database is up to date`);
  }

  process.exit(migrationsFailed > 0 ? 1 : 0);
}

// Run migrations
runMigrations().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
