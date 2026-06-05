#!/usr/bin/env node

/**
 * Validates that all migrations have required tables before they reference them.
 * Checks migration order and dependency chain.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, "../prisma/migrations");

// Track which tables exist at each migration step
const tableState = new Map(); // migration_name -> Set of table names

function extractTableNames(sql) {
  const tables = new Set();

  // CREATE TABLE "TableName"
  const createMatches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi);
  for (const match of createMatches) {
    tables.add(match[1]);
  }

  // ALTER TABLE "TableName"
  const alterMatches = sql.matchAll(/ALTER\s+TABLE\s+["`]?(\w+)["`]?/gi);
  for (const match of alterMatches) {
    tables.add(match[1]);
  }

  // DROP TABLE "TableName"
  const dropMatches = sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi);
  for (const match of dropMatches) {
    tables.delete(match[1]);
  }

  // INSERT INTO "TableName"
  const insertMatches = sql.matchAll(/INSERT\s+INTO\s+["`]?(\w+)["`]?/gi);
  for (const match of insertMatches) {
    tables.add(match[1]);
  }

  // SELECT ... FROM "TableName"
  const selectMatches = sql.matchAll(/(?:FROM|JOIN)\s+["`]?(\w+)["`]?/gi);
  for (const match of selectMatches) {
    tables.add(match[1]);
  }

  // FOREIGN KEY references
  const fkMatches = sql.matchAll(/REFERENCES\s+["`]?(\w+)["`]?/gi);
  for (const match of fkMatches) {
    tables.add(match[1]);
  }

  // ALTER TABLE ... RENAME TO "NewName" (for redefine patterns)
  const renameMatches = sql.matchAll(
    /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+RENAME\s+TO\s+["`]?(\w+)["`]?/gi
  );
  for (const match of renameMatches) {
    tables.delete(match[1]);
    tables.add(match[2]);
  }

  return tables;
}

function getReferencedTables(sql) {
  const referenced = new Set();

  // ALTER TABLE "TableName" - the table being altered
  const alterMatches = sql.matchAll(/ALTER\s+TABLE\s+["`]?(\w+)["`]?/gi);
  for (const match of alterMatches) {
    referenced.add(match[1]);
  }

  // INSERT INTO "TableName" ... SELECT ... FROM "OtherTable"
  const fromMatches = sql.matchAll(/FROM\s+["`]?(\w+)["`]?/gi);
  for (const match of fromMatches) {
    referenced.add(match[1]);
  }

  // FOREIGN KEY references
  const fkMatches = sql.matchAll(/REFERENCES\s+["`]?(\w+)["`]?/gi);
  for (const match of fkMatches) {
    referenced.add(match[1]);
  }

  // SELECT ... FROM "TableName"
  const selectMatches = sql.matchAll(/SELECT\s+.*?FROM\s+["`]?(\w+)["`]?/gi);
  for (const match of selectMatches) {
    referenced.add(match[1]);
  }

  return referenced;
}

function getDroppedTables(sql) {
  const dropped = new Set();
  const dropMatches = sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi);
  for (const match of dropMatches) {
    dropped.add(match[1]);
  }
  return dropped;
}

function getCreatedTables(sql) {
  const created = new Set();
  const createMatches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi);
  for (const match of createMatches) {
    created.add(match[1]);
  }
  return created;
}

function main() {
  console.log("🔍 Validating migration order and table dependencies...\n");

  // Get all migration folders sorted chronologically
  const migrationFolders = fs
    .readdirSync(migrationsDir)
    .filter((f) => {
      const fullPath = path.join(migrationsDir, f);
      return fs.statSync(fullPath).isDirectory() && /^\d{14}_/.test(f);
    })
    .sort();

  console.log(`Found ${migrationFolders.length} migrations\n`);

  let currentTables = new Set();
  const issues = [];

  for (const folder of migrationFolders) {
    const migrationPath = path.join(migrationsDir, folder, "migration.sql");
    if (!fs.existsSync(migrationPath)) {
      continue;
    }

    const sql = fs.readFileSync(migrationPath, "utf8");
    const referenced = getReferencedTables(sql);
    const created = getCreatedTables(sql);
    const dropped = getDroppedTables(sql);

    // Check for missing tables
    for (const table of referenced) {
      if (!currentTables.has(table) && !created.has(table) && !dropped.has(table)) {
        // Check if it's a "new_" prefixed table (part of redefine pattern)
        if (!table.startsWith("new_")) {
          issues.push({
            migration: folder,
            severity: "ERROR",
            message: `References table "${table}" that doesn't exist yet`,
            referenced,
            current: Array.from(currentTables),
            created: Array.from(created),
            dropped: Array.from(dropped),
          });
        }
      }
    }

    // Update state: apply creates and drops
    for (const table of created) {
      currentTables.add(table);
    }
    for (const table of dropped) {
      currentTables.delete(table);
    }

    // Handle "new_TableName" -> "TableName" rename pattern (common in Prisma redefine)
    const renameMatches = sql.matchAll(
      /ALTER\s+TABLE\s+["`]?new_(\w+)["`]?\s+RENAME\s+TO\s+["`]?(\w+)["`]?/gi
    );
    for (const match of renameMatches) {
      const newTable = `new_${match[1]}`;
      const oldTable = match[2];
      if (currentTables.has(newTable)) {
        currentTables.delete(newTable);
        currentTables.add(oldTable);
      }
    }

    tableState.set(folder, new Set(currentTables));

    console.log(`✓ ${folder}`);
    if (created.size > 0) {
      console.log(`  Creates: ${Array.from(created).join(", ")}`);
    }
    if (dropped.size > 0) {
      console.log(`  Drops: ${Array.from(dropped).join(", ")}`);
    }
    if (referenced.size > 0) {
      const missing = Array.from(referenced).filter(
        (t) => !currentTables.has(t) && !created.has(t) && !t.startsWith("new_")
      );
      if (missing.length > 0 && !dropped.has(missing[0])) {
        // Will be caught in the check above
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("\n📊 Final Table State:");
  console.log(`  ${Array.from(currentTables).sort().join(", ")}`);

  console.log("\n" + "=".repeat(70));

  if (issues.length === 0) {
    console.log("\n✅ All migrations are valid! No missing table references found.\n");
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${issues.length} issue(s):\n`);
    for (const issue of issues) {
      console.log(`  ${issue.severity}: ${issue.migration}`);
      console.log(`    ${issue.message}`);
      console.log(`    Referenced: ${Array.from(issue.referenced).join(", ")}`);
      console.log(`    Current tables: ${issue.current.join(", ") || "(none)"}`);
      if (issue.created.length > 0) {
        console.log(`    Creates in this migration: ${issue.created.join(", ")}`);
      }
      if (issue.dropped.length > 0) {
        console.log(`    Drops in this migration: ${issue.dropped.join(", ")}`);
      }
      console.log("");
    }
    process.exit(1);
  }
}

main();
