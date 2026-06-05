import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import fs from "fs";
import path from "path";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin status
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Only allow in non-production environments for security
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      return NextResponse.json(
        { error: "Environment variable syncing is not available in production mode" },
        { status: 403 }
      );
    }

    // Check for crunchycone.toml
    const crunchyConeConfigPath = path.join(process.cwd(), "crunchycone.toml");
    const hasCrunchyConeConfig = fs.existsSync(crunchyConeConfigPath);

    if (!hasCrunchyConeConfig) {
      return NextResponse.json({ error: "CrunchyCone configuration not found" }, { status: 400 });
    }

    // Check authentication
    const isAuthenticated = await checkCrunchyConeAuth();
    if (!isAuthenticated) {
      return NextResponse.json({ error: "CrunchyCone authentication required" }, { status: 401 });
    }

    const { key, direction, isSecret } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "Variable key is required" }, { status: 400 });
    }

    if (!direction || !["pull", "push"].includes(direction)) {
      return NextResponse.json({ error: "Direction must be 'pull' or 'push'" }, { status: 400 });
    }

    // Get current values
    const envData = await getEnvironmentData();
    const envVar = envData.variables.find((v) => v.key === key);

    if (!envVar) {
      return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    }

    // Perform directional sync
    const syncResult = await syncVariable(
      key,
      envVar.localValue,
      envVar.crunchyconeValue,
      direction,
      isSecret
    );

    return NextResponse.json({
      success: true,
      message: syncResult.message,
      action: syncResult.action,
    });
  } catch (error) {
    console.error("Error syncing environment variable:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function checkCrunchyConeAuth(): Promise<boolean> {
  try {
    const { execSync } = await import("child_process");
    const result = execSync("npx --yes crunchycone-cli auth check --json", {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 10000,
    });

    const response = JSON.parse(result);
    return response.data?.authenticated === true;
  } catch (error) {
    console.error("Failed to check CrunchyCone authentication:", error);
    return false;
  }
}

async function getEnvironmentData() {
  // Read .env file
  const envFilePath = path.join(process.cwd(), ".env");
  let envFileVars: Record<string, string> = {};

  try {
    if (fs.existsSync(envFilePath)) {
      const envFileContent = fs.readFileSync(envFilePath, "utf8");
      envFileVars = parseEnvFile(envFileContent);
    }
  } catch (error) {
    console.error("Error reading .env file:", error);
  }

  // Get CrunchyCone values
  let crunchyConeData: { envVars: Record<string, string>; secrets: Record<string, string> } = {
    envVars: {},
    secrets: {},
  };

  try {
    crunchyConeData = await fetchCrunchyConeVariables();
  } catch (error) {
    console.error("Error fetching CrunchyCone data:", error);
  }

  const allCrunchyConeVars = { ...crunchyConeData.envVars, ...crunchyConeData.secrets };

  // Process variables
  const variables = [];
  const allKeys = new Set([...Object.keys(envFileVars), ...Object.keys(allCrunchyConeVars)]);

  for (const key of allKeys) {
    const localValue = envFileVars[key];
    const remoteValue = allCrunchyConeVars[key];
    const isRemoteSecret = key in crunchyConeData.secrets;

    variables.push({
      key,
      localValue: localValue || "",
      crunchyconeValue: remoteValue,
      isSecret: isSensitiveKey(key),
      isRemoteSecret,
    });
  }

  return { variables };
}

async function fetchCrunchyConeVariables(): Promise<{
  envVars: Record<string, string>;
  secrets: Record<string, string>;
}> {
  try {
    const { execSync } = await import("child_process");

    // Fetch environment variables
    const envVars: Record<string, string> = {};
    try {
      const envResult = execSync("npx --yes crunchycone-cli env ls --json", {
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });

      const envResponse = JSON.parse(envResult);
      if (envResponse.success && envResponse.data && envResponse.data.variables) {
        for (const variable of envResponse.data.variables) {
          envVars[variable.key] = String(variable.value);
        }
      }
    } catch (error) {
      console.error("Failed to fetch CrunchyCone env vars:", error);
    }

    // Fetch secrets
    const secrets: Record<string, string> = {};
    try {
      const secretsResult = execSync("npx --yes crunchycone-cli secrets ls --json", {
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });

      const secretsResponse = JSON.parse(secretsResult);
      if (secretsResponse.success && secretsResponse.data && secretsResponse.data.secrets) {
        for (const [key] of Object.entries(secretsResponse.data.secrets)) {
          secrets[key] = "••••••••";
        }
      }
    } catch (error) {
      console.error("Failed to fetch CrunchyCone secrets:", error);
    }

    return { envVars, secrets };
  } catch (error) {
    console.error("Failed to fetch CrunchyCone data:", error);
    return { envVars: {}, secrets: {} };
  }
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Find the first = character
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

function isSensitiveKey(key: string): boolean {
  const sensitiveKeywords = [
    "secret",
    "password",
    "token",
    "auth",
    "private",
    "credential",
    "pass",
    "jwt",
    "oauth",
    "github",
    "google",
    "aws",
    "azure",
    "gcp",
    "stripe",
    "paypal",
    "database",
    "db",
    "redis",
    "session",
    "cookie",
    "smtp",
    "twilio",
    "sendgrid",
    "access",
    "client",
  ];

  const crunchyconeSecretPatterns = [
    "crunchycone_api_key",
    "crunchycone_token",
    "crunchycone_secret",
    "crunchycone_auth",
    "crunchycone_password",
    "crunchycone_credential",
  ];

  const lowerKey = key.toLowerCase();

  if (sensitiveKeywords.some((keyword) => lowerKey.includes(keyword))) {
    return true;
  }

  return crunchyconeSecretPatterns.some((pattern) => lowerKey.includes(pattern));
}

async function syncVariable(
  key: string,
  localValue: string,
  remoteValue?: string,
  direction: string = "auto",
  isSecret: boolean = false
): Promise<{ message: string; action: string }> {
  const hasLocal = localValue && localValue.trim() !== "";
  const hasRemote = remoteValue && remoteValue !== "••••••••" && remoteValue.trim() !== "";

  try {
    if (direction === "pull") {
      // Pull from remote to local
      if (hasRemote) {
        await updateLocalVariable(key, remoteValue!);
        return { message: "Pulled value from CrunchyCone to local", action: "remote_to_local" };
      } else {
        return { message: "No remote value to pull", action: "none" };
      }
    } else if (direction === "push") {
      // Push from local to remote
      if (hasLocal) {
        await updateCrunchyConeVariable(key, localValue, isSecret);
        return {
          message: `Pushed local value to CrunchyCone as ${isSecret ? "secret" : "env var"}`,
          action: "local_to_remote",
        };
      } else {
        return { message: "No local value to push", action: "none" };
      }
    } else {
      // Auto sync (legacy behavior)
      if (hasLocal && hasRemote) {
        // Both exist - check if they're different
        if (localValue === remoteValue) {
          return { message: "Values are already synchronized", action: "none" };
        } else {
          // For now, prefer local value (update CrunchyCone with local)
          await updateCrunchyConeVariable(key, localValue, isSecret);
          return { message: "Updated CrunchyCone with local value", action: "local_to_remote" };
        }
      } else if (hasLocal && !hasRemote) {
        // Local exists, remote doesn't - push to CrunchyCone
        await updateCrunchyConeVariable(key, localValue, isSecret);
        return { message: "Pushed local value to CrunchyCone", action: "local_to_remote" };
      } else if (!hasLocal && hasRemote) {
        // Remote exists, local doesn't - pull from CrunchyCone
        await updateLocalVariable(key, remoteValue!);
        return { message: "Pulled value from CrunchyCone to local", action: "remote_to_local" };
      } else {
        return { message: "Both values are empty - nothing to sync", action: "none" };
      }
    }
  } catch (error) {
    console.error(`Error syncing variable ${key}:`, error);
    throw new Error(
      `Failed to sync variable: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function updateCrunchyConeVariable(
  key: string,
  value: string,
  isSecret: boolean = false
): Promise<void> {
  const { execSync } = await import("child_process");

  try {
    if (isSecret) {
      // If setting as secret, first try to delete any existing env var with same name
      try {
        execSync(`npx --yes crunchycone-cli env rm "${key}"`, {
          stdio: "pipe",
          encoding: "utf8",
          timeout: 10000,
        });
      } catch {
        // Ignore errors - env var might not exist
        console.log(`Env var ${key} not found or already deleted`);
      }

      // Create as secret
      execSync(`npx --yes crunchycone-cli secrets set "${key}" "${value}"`, {
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });
    } else {
      // If setting as env var, first try to delete any existing secret with same name
      try {
        execSync(`npx --yes crunchycone-cli secrets rm "${key}"`, {
          stdio: "pipe",
          encoding: "utf8",
          timeout: 10000,
        });
      } catch {
        // Ignore errors - secret might not exist
        console.log(`Secret ${key} not found or already deleted`);
      }

      // Create as env var
      execSync(`npx --yes crunchycone-cli env set "${key}" "${value}"`, {
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });
    }
  } catch (error) {
    throw new Error(`Failed to update CrunchyCone variable: ${error}`);
  }
}

async function updateLocalVariable(key: string, value: string): Promise<void> {
  const envFilePath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envFilePath)) {
    // Create .env file if it doesn't exist
    fs.writeFileSync(envFilePath, `${key}="${value}"\n`);
    return;
  }

  const envContent = fs.readFileSync(envFilePath, "utf8");
  const lines = envContent.split("\n");
  let found = false;

  // Update existing variable or add new one
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex > 0) {
        const lineKey = trimmed.slice(0, equalIndex).trim();
        if (lineKey === key) {
          found = true;
          return `${key}="${value}"`;
        }
      }
    }
    return line;
  });

  // If not found, add to the end
  if (!found) {
    updatedLines.push(`${key}="${value}"`);
  }

  fs.writeFileSync(envFilePath, updatedLines.join("\n"));
}
