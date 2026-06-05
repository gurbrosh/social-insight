#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline";
import crypto from "crypto";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function log(message, color = "\x1b[0m") {
  console.log(`${color}${message}\x1b[0m`);
}

function logSuccess(message) {
  log(`✅ ${message}`, "\x1b[32m"); // Green
}

function logWarning(message) {
  log(`⚠️  ${message}`, "\x1b[33m"); // Yellow
}

function logError(message) {
  log(`❌ ${message}`, "\x1b[31m"); // Red
}

function logInfo(message) {
  log(`ℹ️  ${message}`, "\x1b[36m"); // Cyan
}

async function askForConfirmation() {
  return new Promise((resolve) => {
    rl.question("\nDo you want to continue? (y/N): ", (answer) => {
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function hasYesFlag() {
  return process.argv.includes("--yes") || process.argv.includes("-y");
}

function hasJwtOnlyFlag() {
  return process.argv.includes("--jwt-only") || process.argv.includes("--jwt");
}

async function readCrunchyConeToml() {
  try {
    const tomlPath = path.join(process.cwd(), "crunchycone.toml");

    if (!fs.existsSync(tomlPath)) {
      return null;
    }

    const tomlContent = fs.readFileSync(tomlPath, "utf8");

    // Simple TOML parsing for environment value
    // Look for [environment] section or environment = "value"
    const envMatch = tomlContent.match(/environment\s*=\s*"([^"]+)"/);

    if (envMatch) {
      const environment = envMatch[1];
      logInfo(`Found crunchycone.toml with environment: ${environment}`);
      return { environment };
    }

    logInfo("Found crunchycone.toml but no environment setting");
    return {};
  } catch (error) {
    logWarning(`Failed to read crunchycone.toml: ${error.message}`);
    return null;
  }
}

async function checkCrunchyConeAuth() {
  try {
    logInfo("Checking CrunchyCone authentication...");

    const result = execSync("npx --yes crunchycone-cli auth check -j", {
      stdio: "pipe",
      encoding: "utf8",
      cwd: process.cwd(),
    });

    const response = JSON.parse(result.trim());

    if (response.success && response.data && response.data.authenticated) {
      const user = response.data.user;
      const email = user ? user.email : "authenticated";
      logSuccess(`CrunchyCone authenticated: ${email}`);
      return response.data;
    } else {
      logWarning("CrunchyCone not authenticated");
      return null;
    }
  } catch {
    logWarning("CrunchyCone CLI not available or authentication failed");
    return null;
  }
}

async function generateJwtOnly() {
  try {
    log("\n🔐 Auth Secret Generation", "\x1b[1m\x1b[34m"); // Bold Blue
    log("=========================\n");

    const envPath = path.join(process.cwd(), ".env");
    const envExamplePath = path.join(process.cwd(), ".env.example");

    // Step 1: Create .env if it doesn't exist
    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      logSuccess("Created .env file from .env.example");
    } else if (!fs.existsSync(envPath)) {
      logError(".env file not found and no .env.example to copy from");
      process.exit(1);
    }

    // Step 2: Generate AUTH_SECRET and NEXTAUTH_SECRET
    let envContent = fs.readFileSync(envPath, "utf8");
    const hasDefaultAuthSecret =
      envContent.includes('AUTH_SECRET="your-secret-key-change-in-production"') ||
      envContent.includes('NEXTAUTH_SECRET="your-secret-key-change-in-production"');

    if (
      hasDefaultAuthSecret ||
      envContent.match(/AUTH_SECRET=""/) ||
      envContent.match(/NEXTAUTH_SECRET=""/)
    ) {
      const authSecret = crypto.randomBytes(32).toString("hex");

      // Update or add AUTH_SECRET
      if (envContent.includes("AUTH_SECRET=")) {
        envContent = envContent.replace(/AUTH_SECRET="[^"]*"/, `AUTH_SECRET="${authSecret}"`);
      } else {
        envContent += `\nAUTH_SECRET="${authSecret}"\n`;
      }

      // Update or add NEXTAUTH_SECRET
      if (envContent.includes("NEXTAUTH_SECRET=")) {
        envContent = envContent.replace(
          /NEXTAUTH_SECRET="[^"]*"/,
          `NEXTAUTH_SECRET="${authSecret}"`
        );
      } else {
        envContent += `NEXTAUTH_SECRET="${authSecret}"\n`;
      }

      fs.writeFileSync(envPath, envContent);
      logSuccess("Generated secure AUTH_SECRET and NEXTAUTH_SECRET");
    } else {
      logInfo("AUTH_SECRET and NEXTAUTH_SECRET already configured");
    }

    // Check CrunchyCone authentication and configure email provider if authenticated
    const authData = await checkCrunchyConeAuth();
    if (authData && authData.authenticated) {
      await setupCrunchyConeEmailProvider(envPath);
    }

    log("\n✅ Auth secret generation completed!", "\x1b[1m\x1b[32m");
    return true;
  } catch (error) {
    logError(`Auth secret generation failed: ${error.message}`);
    return false;
  }
}

async function setupCrunchyConeEmailProvider(envPath) {
  try {
    let envContent = fs.readFileSync(envPath, "utf8");

    // Read crunchycone.toml to check environment
    const tomlConfig = await readCrunchyConeToml();

    // Check if settings are already configured
    const isProviderAlreadyConfigured = envContent.includes(
      'CRUNCHYCONE_EMAIL_PROVIDER="crunchycone"'
    );
    const isEmailFromAlreadySet = envContent.includes(
      'CRUNCHYCONE_EMAIL_FROM="noreply@crunchycone.dev"'
    );
    const isApiUrlCorrect =
      tomlConfig && tomlConfig.environment === "dev"
        ? envContent.includes('CRUNCHYCONE_API_URL="https://api.crunchycone.dev"')
        : true; // Don't require API URL if not dev environment

    if (isProviderAlreadyConfigured && isEmailFromAlreadySet && isApiUrlCorrect) {
      logInfo("CrunchyCone email provider already configured");
      return;
    }

    // Update or add CRUNCHYCONE_EMAIL_PROVIDER
    if (envContent.includes("CRUNCHYCONE_EMAIL_PROVIDER=")) {
      envContent = envContent.replace(
        /CRUNCHYCONE_EMAIL_PROVIDER="[^"]*"/,
        'CRUNCHYCONE_EMAIL_PROVIDER="crunchycone"'
      );
    } else {
      // Add the variable at the end
      envContent += '\n# CrunchyCone Email Provider\nCRUNCHYCONE_EMAIL_PROVIDER="crunchycone"\n';
    }

    // Update or add CRUNCHYCONE_EMAIL_FROM
    if (envContent.includes("CRUNCHYCONE_EMAIL_FROM=")) {
      envContent = envContent.replace(
        /CRUNCHYCONE_EMAIL_FROM="[^"]*"/,
        'CRUNCHYCONE_EMAIL_FROM="noreply@crunchycone.dev"'
      );
    } else {
      // Add the variable right after CRUNCHYCONE_EMAIL_PROVIDER line
      envContent = envContent.replace(
        /CRUNCHYCONE_EMAIL_PROVIDER="crunchycone"/,
        'CRUNCHYCONE_EMAIL_PROVIDER="crunchycone"\nCRUNCHYCONE_EMAIL_FROM="noreply@crunchycone.dev"'
      );
    }

    // Update or add CRUNCHYCONE_API_URL if environment is "dev"
    if (tomlConfig && tomlConfig.environment === "dev") {
      if (envContent.includes("CRUNCHYCONE_API_URL=")) {
        envContent = envContent.replace(
          /CRUNCHYCONE_API_URL="[^"]*"/,
          'CRUNCHYCONE_API_URL="https://api.crunchycone.dev"'
        );
        if (!isApiUrlCorrect) {
          logSuccess("Set CRUNCHYCONE_API_URL to 'https://api.crunchycone.dev' (dev environment)");
        }
      } else {
        // Add the API URL after CRUNCHYCONE_EMAIL_FROM
        envContent = envContent.replace(
          /CRUNCHYCONE_EMAIL_FROM="noreply@crunchycone\.dev"/,
          'CRUNCHYCONE_EMAIL_FROM="noreply@crunchycone.dev"\nCRUNCHYCONE_API_URL="https://api.crunchycone.dev"'
        );
        logSuccess("Set CRUNCHYCONE_API_URL to 'https://api.crunchycone.dev' (dev environment)");
      }
    }

    fs.writeFileSync(envPath, envContent);

    if (!isProviderAlreadyConfigured) {
      logSuccess("Set CRUNCHYCONE_EMAIL_PROVIDER to 'crunchycone'");
    }
    if (!isEmailFromAlreadySet) {
      logSuccess("Set CRUNCHYCONE_EMAIL_FROM to 'noreply@crunchycone.dev'");
    }
  } catch (error) {
    logWarning(`Failed to set CrunchyCone email provider: ${error.message}`);
  }
}

async function main() {
  try {
    // Handle JWT-only mode
    if (hasJwtOnlyFlag()) {
      const success = await generateJwtOnly();
      process.exit(success ? 0 : 1);
    }

    log("\n🔄 CrunchyCone Vanilla Starter Project Reset", "\x1b[1m\x1b[34m"); // Bold Blue
    log("=====================================\n");

    // Check if database exists for first-run detection
    const dbPath = path.join(process.cwd(), "prisma", "db", "prod.db");
    const isFirstRun = !fs.existsSync(dbPath);

    logWarning("This will reset the project to its initial state:");
    console.log("  • Remove existing database");
    console.log("  • Create fresh database with default schema");
    console.log("  • Copy .env.example to .env (if needed)");
    console.log("  • Clean Next.js build cache");
    console.log("  • Reset to first-time user experience");

    if (isFirstRun) {
      logInfo("First-time setup detected, skipping confirmation.");
    } else if (hasYesFlag()) {
      logInfo("--yes flag detected, skipping confirmation.");
    } else {
      const confirmed = await askForConfirmation();

      if (!confirmed) {
        logInfo("Reset cancelled.");
        process.exit(0);
      }
    }

    log("\n🚀 Starting reset process...\n");

    // Step 1: Remove existing database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      logSuccess("Removed existing database");
    } else {
      logInfo("No existing database found");
    }

    // Step 2: Copy .env.example to .env if .env doesn't exist
    const envPath = path.join(process.cwd(), ".env");
    const envExamplePath = path.join(process.cwd(), ".env.example");

    let envFileCreated = false;

    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      logSuccess("Created .env file from .env.example");
      envFileCreated = true;
    } else if (fs.existsSync(envPath)) {
      logInfo(".env file already exists (not overwritten)");
    } else {
      logWarning(".env.example not found - you may need to create .env manually");
    }

    // Generate AUTH_SECRET and NEXTAUTH_SECRET if needed
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, "utf8");
      const hasDefaultAuthSecret =
        envContent.includes('AUTH_SECRET="your-secret-key-change-in-production"') ||
        envContent.includes('NEXTAUTH_SECRET="your-secret-key-change-in-production"');
      const forceNewSecret =
        process.argv.includes("--new-secret") || process.argv.includes("--new-jwt");

      if (hasDefaultAuthSecret || forceNewSecret) {
        const authSecret = crypto.randomBytes(32).toString("hex");

        // Update or add AUTH_SECRET
        if (envContent.includes("AUTH_SECRET=")) {
          envContent = envContent.replace(/AUTH_SECRET="[^"]*"/, `AUTH_SECRET="${authSecret}"`);
        } else {
          envContent += `\nAUTH_SECRET="${authSecret}"\n`;
        }

        // Update or add NEXTAUTH_SECRET
        if (envContent.includes("NEXTAUTH_SECRET=")) {
          envContent = envContent.replace(
            /NEXTAUTH_SECRET="[^"]*"/,
            `NEXTAUTH_SECRET="${authSecret}"`
          );
        } else {
          envContent += `NEXTAUTH_SECRET="${authSecret}"\n`;
        }

        fs.writeFileSync(envPath, envContent);

        if (forceNewSecret && !hasDefaultAuthSecret) {
          logSuccess("Generated new AUTH_SECRET and NEXTAUTH_SECRET (forced)");
        } else {
          logSuccess("Generated secure AUTH_SECRET and NEXTAUTH_SECRET (replaced default)");
        }
      } else if (!envFileCreated) {
        logInfo(
          "AUTH_SECRET and NEXTAUTH_SECRET already configured (use --new-secret to regenerate)"
        );
      }

      // Check CrunchyCone authentication and configure email provider if authenticated
      const authData = await checkCrunchyConeAuth();
      if (authData && authData.authenticated) {
        await setupCrunchyConeEmailProvider(envPath);
      }
    }

    // Step 3: Clean Next.js cache
    const nextCachePath = path.join(process.cwd(), ".next");
    if (fs.existsSync(nextCachePath)) {
      fs.rmSync(nextCachePath, { recursive: true, force: true });
      logSuccess("Cleaned Next.js build cache");
    }

    // Step 3.5: Install Git hooks
    try {
      logInfo("Installing Git pre-commit hooks...");
      execSync("npm run hooks:install", {
        stdio: "pipe",
        cwd: process.cwd(),
      });
      logSuccess("Git pre-commit hooks installed (lint + build protection)");
    } catch (error) {
      logWarning(`Failed to install Git hooks (not critical for setup): ${error.message}`);
    }

    // Step 4: Check for migrations and reset database
    const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
    const hasMigrations =
      fs.existsSync(migrationsPath) && fs.readdirSync(migrationsPath).some((f) => f.match(/^\d+_/));

    if (!hasMigrations) {
      logInfo("No migrations found, creating initial migration...");
      try {
        execSync("npx prisma migrate dev --name init --skip-seed", {
          stdio: "inherit",
          cwd: process.cwd(),
        });
        logSuccess("Initial migration created");
      } catch (error) {
        logError("Failed to create initial migration");
        console.error(error.message);
        process.exit(1);
      }
    }

    // Step 5: Reset database with Prisma
    logInfo("Resetting database with Prisma...");
    try {
      execSync("npx prisma migrate reset --force", {
        stdio: "pipe",
        cwd: process.cwd(),
      });
      logSuccess("Database reset and seeded successfully");
    } catch (error) {
      logError("Failed to reset database with Prisma");
      console.error(error.message);
      process.exit(1);
    }

    // Success message
    log("\n🎉 Reset completed successfully!", "\x1b[1m\x1b[32m"); // Bold Green
    log("================================\n");

    logInfo("Next steps:");
    console.log("  1. Run: npm run dev");
    console.log("  2. Open: http://localhost:3000");
    console.log("  3. Complete first-time admin setup");
    console.log("  4. Start building your application!\n");

    logInfo("The application is now in its initial state, ready for first-time setup.");
  } catch (error) {
    logError(`Reset failed: ${error.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
