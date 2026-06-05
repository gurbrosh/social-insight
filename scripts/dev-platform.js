#!/usr/bin/env node

import { spawn } from "child_process";
import { config } from "dotenv";

// Load .env file
config();

// Display platform information
console.log("🚀 Starting CrunchyCone Development Server");
console.log("=====================================");

const platform = process.env.CRUNCHYCONE_PLATFORM;
const hasApiKey = !!process.env.CRUNCHYCONE_API_KEY;

if (platform === "1") {
  console.log("🏗️  Platform Mode: ENABLED");
  console.log("📡 Environment Source: CrunchyCone API");
  console.log("🔑 API Key:", hasApiKey ? "CONFIGURED" : "MISSING");
} else {
  console.log("💻 Platform Mode: DISABLED");
  console.log("📁 Environment Source: Local .env file");
  console.log("🔑 API Key:", hasApiKey ? "Available (unused in local mode)" : "Not configured");
}

console.log("=====================================\n");

// Start the actual dev server
// Use platform-specific npm command without shell to avoid security warning
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";

const child = spawn(npmCommand, ["run", "dev"], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

child.on("error", (error) => {
  console.error("Failed to start dev server:", error);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code);
});
