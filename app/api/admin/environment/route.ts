import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/permissions";
import {
  getEnvironmentService,
  getMergedEnvironmentVariables,
  getDualEnvironmentServices,
  isPlatformEnvironment,
} from "@/lib/environment-service";
import { existsSync } from "fs";
import { join } from "path";

// Force dynamic rendering
export const dynamic = "force-dynamic";

// Helper function to determine if a key is sensitive
function isSensitiveKey(key: string): boolean {
  const sensitiveKeywords = [
    "secret",
    "key",
    "password",
    "token",
    "auth",
    "api",
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
    "email",
    "twilio",
    "sendgrid",
    "crunchycone",
    "do",
    "spaces",
    "bucket",
    "access",
    "client",
  ];
  const lowerKey = key.toLowerCase();
  return sensitiveKeywords.some((keyword) => lowerKey.includes(keyword));
}

export async function GET(_request: NextRequest) {
  try {
    // Require admin role (handles both auth and admin check)
    await requireRole("admin");

    console.log("=== Environment API GET Request ===");
    console.log("Authentication passed using requireRole");

    // Debug environment variables being used by the service
    console.log("Environment debug:", {
      isInPlatformMode: isPlatformEnvironment(),
      hasCrunchyConeApiKey: !!process.env.CRUNCHYCONE_API_KEY,
      crunchyConeApiKeyLength: process.env.CRUNCHYCONE_API_KEY?.length,
      crunchyConePlatform: process.env.CRUNCHYCONE_PLATFORM,
      crunchyConeProjectId: process.env.CRUNCHYCONE_PROJECT_ID,
    });

    // Determine if we're in platform mode using the improved detection
    const isInPlatformMode = isPlatformEnvironment();

    // On production local (not platform), restrict access for security
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !isInPlatformMode) {
      return NextResponse.json(
        { error: "Environment variables are not available in local production mode" },
        { status: 403 }
      );
    }

    // Note: We don't pre-check CrunchyCone authentication here
    // Instead, we let the environment service handle auth and return appropriate errors

    let variables: Array<{
      key: string;
      localValue?: string;
      remoteValue?: string;
      isSecret: boolean;
      isRemoteSecret?: boolean;
      hasConflict?: boolean;
    }> = [];

    let supportsRemoteSecrets = false;

    try {
      if (isInPlatformMode) {
        // PLATFORM MODE: Only use CrunchyCone provider
        const envService = getEnvironmentService();
        const providerInfo = envService.getProviderInfo();

        console.log("Platform mode - about to fetch environment variables from CrunchyCone API");
        console.log("Environment service provider info:", providerInfo);

        // Get environment variables from platform
        console.log("Calling envService.listEnvVars()...");
        const envVars = await envService.listEnvVars();
        console.log("Successfully fetched envVars:", Object.keys(envVars).length, "variables");

        // Get secrets if supported
        let secretNames: string[] = [];
        if (providerInfo.supportsSecrets) {
          supportsRemoteSecrets = true;
          secretNames = await envService.listSecretNames();
        }

        // Convert environment variables to array format
        const envEntries = Object.entries(envVars).map(([key, value]) => ({
          key,
          remoteValue: value || "",
          isSecret: false,
          isRemoteSecret: false,
        }));

        // Convert secrets to array format (values are hidden)
        const secretEntries = secretNames.map((key) => ({
          key,
          remoteValue: "••••••••", // Masked value for secrets
          isSecret: true,
          isRemoteSecret: true,
        }));

        // Combine environment variables and secrets
        variables = [...envEntries, ...secretEntries];
      } else {
        // LOCAL MODE: Check if CrunchyCone project is available
        const crunchyConeTomlPath = join(process.cwd(), "crunchycone.toml");
        const hasCrunchyConeConfig = existsSync(crunchyConeTomlPath);

        if (hasCrunchyConeConfig) {
          // Project has CrunchyCone config: Merge local (.env) + CrunchyCone providers
          const mergedResult = await getMergedEnvironmentVariables();
          variables = mergedResult.variables.map((variable) => ({
            key: variable.key,
            localValue: variable.localValue,
            remoteValue: variable.remoteValue,
            isSecret: variable.isSecret,
            isRemoteSecret: variable.isRemoteSecret,
            hasConflict: variable.hasConflict,
          }));
          supportsRemoteSecrets = mergedResult.supportsRemoteSecrets;
        } else {
          // No CrunchyCone config: Only show local variables
          console.log("No crunchycone.toml found - loading only local environment variables");
          const { local } = getDualEnvironmentServices();
          const localVars = await local.listEnvVars();

          variables = Object.entries(localVars).map(([key, localValue]) => ({
            key,
            localValue: localValue || "",
            isSecret: isSensitiveKey(key),
          }));
        }
      }

      // Sort alphabetically by key
      variables.sort((a, b) => a.key.localeCompare(b.key));
    } catch (error) {
      console.error("Failed to fetch environment variables:", error);
      console.error("Error details:", error instanceof Error ? error.message : error);
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      console.error("Error name:", error instanceof Error ? error.name : "Unknown");
      console.error("Error constructor:", error?.constructor?.name);

      // Check if this is a Next.js redirect error (not an actual error)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === "NEXT_REDIRECT") {
        console.error(
          "NEXT_REDIRECT error detected - this should not happen after requireRole passes"
        );
        throw error; // Re-throw redirect errors
      }

      // Check if this is a CrunchyCone API error
      if (
        errorMessage.includes("api.crunchycone.dev") ||
        errorMessage.includes("401") ||
        errorMessage.includes("403")
      ) {
        return NextResponse.json(
          {
            error:
              "CrunchyCone API authentication failed. Please check your API key and permissions.",
          },
          { status: 502 }
        );
      }

      return NextResponse.json({ error: "Failed to fetch environment variables" }, { status: 500 });
    }

    // Check if CrunchyCone is authenticated by testing if we can access remote vars
    let crunchyConeAuth = { isAuthenticated: false, source: "unknown" };
    if (!isInPlatformMode) {
      // Check if crunchycone.toml exists in the project root
      const crunchyConeTomlPath = join(process.cwd(), "crunchycone.toml");
      const hasCrunchyConeConfig = existsSync(crunchyConeTomlPath);

      if (!hasCrunchyConeConfig) {
        console.log("No crunchycone.toml found - project not available in CrunchyCone");
        crunchyConeAuth = {
          isAuthenticated: false,
          source: "project_not_available",
        };
      } else {
        try {
          // In local mode, check if we successfully fetched remote variables
          const hasRemoteVars = variables.some((v) => v.remoteValue !== undefined);
          crunchyConeAuth = {
            isAuthenticated: hasRemoteVars,
            source: hasRemoteVars ? "keychain" : "not_authenticated",
          };
        } catch (error) {
          console.warn("Failed to determine CrunchyCone auth status:", error);
        }
      }
    }

    return NextResponse.json({
      variables,
      platform: {
        isPlatformEnvironment: isInPlatformMode,
        supportsSecrets: supportsRemoteSecrets,
        supportsLocalRemoteSync: !isInPlatformMode, // Push/pull only available in local mode
      },
      crunchyConeAuth,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching environment variables:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require admin role (handles both auth and admin check)
    await requireRole("admin");

    // Get the unified environment service
    const envService = getEnvironmentService();
    const providerInfo = envService.getProviderInfo();

    // On production local (not platform), restrict access for security
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !providerInfo.isPlatformEnvironment) {
      return NextResponse.json(
        { error: "Environment variable editing is not available in local production mode" },
        { status: 403 }
      );
    }

    // Note: We let the environment service handle CrunchyCone authentication

    const { key, value, isSecret } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "Variable key is required" }, { status: 400 });
    }

    if (isSecret) {
      await envService.setSecret(key, value);
    } else {
      // Use regular environment variable API
      await envService.setEnvVar(key, value);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating environment variable:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require admin role (handles both auth and admin check)
    await requireRole("admin");

    // Get the unified environment service
    const envService = getEnvironmentService();
    const providerInfo = envService.getProviderInfo();

    // On production local (not platform), restrict access for security
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && !providerInfo.isPlatformEnvironment) {
      return NextResponse.json(
        { error: "Environment variable deletion is not available in local production mode" },
        { status: 403 }
      );
    }

    // Note: We let the environment service handle CrunchyCone authentication

    const { key, isSecret } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "Variable key is required" }, { status: 400 });
    }

    // Use appropriate deletion method based on whether it's a secret
    if (isSecret) {
      await envService.deleteSecret(key);
    } else {
      await envService.deleteEnvVar(key);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting environment variable:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
