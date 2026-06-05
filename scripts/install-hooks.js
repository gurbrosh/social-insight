#!/usr/bin/env node

/**
 * Install Git hooks for the project
 * Run manually with: npm run hooks:install
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOOKS_SOURCE_DIR = path.join(__dirname, "hooks");
const GIT_HOOKS_DIR = path.join(__dirname, "..", ".git", "hooks");

// Check if .git directory exists
if (!fs.existsSync(path.join(__dirname, "..", ".git"))) {
  console.log("📦 Not a git repository, skipping hooks installation");
  process.exit(0);
}

// Create hooks directory if it doesn't exist
if (!fs.existsSync(GIT_HOOKS_DIR)) {
  fs.mkdirSync(GIT_HOOKS_DIR, { recursive: true });
}

// List of hooks to install
const hooks = ["pre-commit"];

let installedCount = 0;

hooks.forEach((hookName) => {
  const sourcePath = path.join(HOOKS_SOURCE_DIR, hookName);
  const targetPath = path.join(GIT_HOOKS_DIR, hookName);

  if (!fs.existsSync(sourcePath)) {
    console.log(`⚠️  Hook source not found: ${hookName}`);
    return;
  }

  try {
    // Copy the hook file
    fs.copyFileSync(sourcePath, targetPath);

    // Make it executable (Unix-like systems)
    fs.chmodSync(targetPath, "755");

    installedCount++;
    console.log(`✅ Installed git hook: ${hookName}`);
  } catch (error) {
    console.error(`❌ Failed to install ${hookName}:`, error.message);
  }
});

if (installedCount > 0) {
  console.log(`\n🎯 Git hooks installed successfully!`);
  console.log("   These hooks will run lint and build checks before commits.");
} else if (hooks.length > 0) {
  console.log("\n⚠️  No git hooks were installed.");
}
