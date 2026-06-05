#!/usr/bin/env node

/**
 * Pre-deployment script to sync configuration data to remote database
 *
 * This script runs the config migration before deploying to ensure
 * orchestrations and recipes are synced to the remote database.
 *
 * Usage:
 *   npm run deploy:sync
 *   OR
 *   node scripts/pre-deploy-sync.js
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🚀 Pre-deployment configuration sync");
console.log("=====================================\n");

// Check if required environment variables are set
const remoteDatabaseUrl = process.env.REMOTE_DATABASE_URL || process.env.DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteDatabaseUrl) {
  console.error("❌ REMOTE_DATABASE_URL or DATABASE_URL environment variable is required");
  console.error("   Set it to your remote database URL (e.g., libsql://...)");
  process.exit(1);
}

if (remoteDatabaseUrl.startsWith("libsql://") && !tursoAuthToken) {
  console.error("❌ TURSO_AUTH_TOKEN environment variable is required for Turso databases");
  process.exit(1);
}

console.log("✅ Environment variables configured");
console.log(`   Remote DB: ${remoteDatabaseUrl.substring(0, 50)}...\n`);

// Run the migration script
console.log("📤 Running configuration data migration...\n");

const migrationScript = join(__dirname, "migrate-config-data.js");
const child = spawn("node", [migrationScript], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOCAL_DATABASE_URL: process.env.LOCAL_DATABASE_URL || "file:./db/prod.db",
    REMOTE_DATABASE_URL: remoteDatabaseUrl,
    TURSO_AUTH_TOKEN: tursoAuthToken,
  },
});

child.on("close", (code) => {
  if (code === 0) {
    console.log("\n✅ Pre-deployment sync complete!");
    console.log("   You can now deploy your changes to CrunchyCone.");
    process.exit(0);
  } else {
    console.error("\n❌ Pre-deployment sync failed!");
    console.error("   Please fix the errors above before deploying.");
    process.exit(code || 1);
  }
});

child.on("error", (error) => {
  console.error("❌ Failed to run migration script:", error.message);
  process.exit(1);
});
