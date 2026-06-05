#!/usr/bin/env node

/**
 * Export configuration data to JSON file for deployment
 *
 * This script exports scrapers, orchestrations, recipes, and app configs
 * to a JSON file that can be included in the Docker image and imported
 * during deployment.
 *
 * Usage:
 *   node scripts/export-config-data.js
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_FILE = path.join(__dirname, "../prisma/config-data.json");

async function exportAllConfigData() {
  const prisma = new PrismaClient();

  try {
    console.log("📦 Exporting configuration data...");

    // Export all configuration data
    const scrapers = await prisma.scraper.findMany({
      where: { deleted_at: null },
    });

    const orchestrations = await prisma.orchestration.findMany({
      where: { deleted_at: null },
    });

    const recipes = await prisma.orchestrationRecipe.findMany({
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

    const appConfigs = await prisma.appConfig.findMany({
      where: { deleted_at: null },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      scrapers,
      orchestrations,
      recipes,
      appConfigs,
    };

    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(exportData, null, 2));

    console.log(`✅ Configuration data exported to ${OUTPUT_FILE}`);
    console.log(`   Scrapers: ${scrapers.length}`);
    console.log(`   Orchestrations: ${orchestrations.length}`);
    console.log(`   Recipes: ${recipes.length}`);
    console.log(`   App Configs: ${appConfigs.length}`);

    return exportData;
  } finally {
    await prisma.$disconnect();
  }
}

exportAllConfigData().catch((error) => {
  console.error("❌ Export failed:", error);
  process.exit(1);
});
