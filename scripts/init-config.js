#!/usr/bin/env node

import { configService } from "../lib/config-service.js";

async function main() {
  try {
    console.log("Initializing default configuration values...");
    await configService.initializeDefaults();
    console.log("✅ Default configuration values initialized successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error initializing configuration:", error);
    process.exit(1);
  }
}

main();
