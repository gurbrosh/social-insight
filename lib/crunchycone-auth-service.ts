/**
 * CrunchyCone Authentication Service for Admin Settings
 *
 * Handles authentication for CrunchyCone services (email, storage) in different environments:
 * - Local Development: Uses keytar keychain (from CLI login) or env vars
 * - Platform Deployment: Uses provided CRUNCHYCONE_API_KEY
 *
 * This service replaces direct CLI command execution for auth checking.
 */

import {
  CrunchyConeAuthService,
  type CrunchyConeAuthResult,
  type CrunchyConeAuthServiceConfig,
} from "crunchycone-lib";
import { isPlatformEnvironment } from "crunchycone-lib/environment";

// Global auth service instance
let globalAuthService: CrunchyConeAuthService | null = null;

/**
 * Get the global CrunchyCone auth service instance
 */
export function getCrunchyConeAuthService(
  config?: CrunchyConeAuthServiceConfig
): CrunchyConeAuthService {
  // Force recreation to apply new config (remove for production)
  globalAuthService = null;

  if (!globalAuthService) {
    const isPlatform = isPlatformEnvironment();

    // Default config optimized for admin settings usage
    const defaultConfig: CrunchyConeAuthServiceConfig = {
      timeout: 10000, // 10 seconds
      preferApi: isPlatform, // On platform, always prefer API; locally, allow CLI fallback
      cliTimeout: isPlatform ? 5000 : 15000, // Shorter timeout on platform where CLI shouldn't be used
      ...config,
    };

    console.log("Creating CrunchyCone auth service with config:", {
      isPlatform,
      preferApi: defaultConfig.preferApi,
      timeout: defaultConfig.timeout,
      cliTimeout: defaultConfig.cliTimeout,
    });

    globalAuthService = new CrunchyConeAuthService(defaultConfig);
  }
  return globalAuthService;
}

/**
 * Check if user is authenticated with CrunchyCone services
 * Returns detailed authentication information
 */
export async function checkCrunchyConeAuth(): Promise<CrunchyConeAuthResult> {
  try {
    const authService = getCrunchyConeAuthService();
    const isPlatform = isPlatformEnvironment();

    // Debug logging for platform environment
    if (isPlatform) {
      console.log("Platform environment detected:");
      console.log("- CRUNCHYCONE_PLATFORM:", process.env.CRUNCHYCONE_PLATFORM);
      console.log("- CRUNCHYCONE_API_KEY exists:", !!process.env.CRUNCHYCONE_API_KEY);
      console.log("- CRUNCHYCONE_API_KEY length:", process.env.CRUNCHYCONE_API_KEY?.length);

      // Additional validation for platform environment
      if (!process.env.CRUNCHYCONE_API_KEY) {
        console.error("Platform environment missing CRUNCHYCONE_API_KEY");
        return {
          success: false,
          source: "api",
          error: "CRUNCHYCONE_API_KEY not set in platform environment",
          message: "Platform environment requires CRUNCHYCONE_API_KEY to be set",
        };
      }

      if (process.env.CRUNCHYCONE_API_KEY.length < 10) {
        console.warn("Platform CRUNCHYCONE_API_KEY seems too short (less than 10 chars)");
      }
    }

    console.log("About to call authService.checkAuthentication()");

    const result = await authService.checkAuthentication();

    // Log the result for debugging
    console.log("Auth check result:", {
      success: result.success,
      source: result.source,
      error: result.error,
      hasUser: !!result.user,
      hasProject: !!result.project,
      expectedSource: isPlatform ? "api" : "cli",
    });

    // On platform, warn if we're getting CLI authentication instead of API
    if (isPlatform && result.success && result.source === "cli") {
      console.warn(
        "Warning: Platform environment got CLI authentication instead of API. CLI may not be available in production."
      );
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown authentication error";

    console.error("Auth check failed with exception:", error);

    // Provide more helpful error messages for platform environments
    const isPlatform = isPlatformEnvironment();
    let enhancedMessage = `Authentication check failed: ${errorMessage}`;

    if (isPlatform) {
      if (errorMessage.includes("CRUNCHYCONE_API_KEY")) {
        enhancedMessage =
          "Platform authentication failed: CRUNCHYCONE_API_KEY is invalid or not accessible";
      } else if (errorMessage.includes("timeout") || errorMessage.includes("network")) {
        enhancedMessage = "Platform authentication failed: Network timeout or connectivity issue";
      } else if (errorMessage.includes("unauthorized") || errorMessage.includes("401")) {
        enhancedMessage = "Platform authentication failed: API key is invalid or expired";
      }
    }

    return {
      success: false,
      source: isPlatform ? "api" : "cli",
      error: errorMessage,
      message: enhancedMessage,
    };
  }
}

/**
 * Simple boolean check for CrunchyCone authentication
 * Useful for quick availability checks
 */
export async function isCrunchyConeAuthenticated(): Promise<boolean> {
  try {
    const result = await checkCrunchyConeAuth();
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Get authentication status with user-friendly messages
 */
export async function getCrunchyConeAuthStatus(): Promise<{
  isAuthenticated: boolean;
  source: "api" | "cli" | "unknown";
  message: string;
  userEmail?: string;
  projectId?: string;
  error?: string;
}> {
  const result = await checkCrunchyConeAuth();

  if (result.success) {
    return {
      isAuthenticated: true,
      source: result.source,
      message: `Authenticated via ${result.source === "api" ? "API key" : "CLI credentials"}`,
      userEmail: result.user?.email,
      projectId: result.project?.project_id,
    };
  }

  // Generate helpful error messages based on environment
  let message = "Not authenticated with CrunchyCone services";

  if (isPlatformEnvironment()) {
    message = "CRUNCHYCONE_API_KEY not available. This should be provided by the platform.";
  } else {
    // Local development - provide setup instructions
    if (result.error?.includes("keytar is not available")) {
      message =
        "CrunchyCone CLI credentials not found. Please set CRUNCHYCONE_API_KEY environment variable or install the CLI and run: crunchycone auth login";
    } else if (result.error?.includes("not found")) {
      message = "CrunchyCone CLI credentials not found. Please run: crunchycone auth login";
    } else {
      message = `Authentication failed: ${result.error || "Unknown error"}`;
    }
  }

  return {
    isAuthenticated: false,
    source: result.source || "unknown",
    message,
    error: result.error,
  };
}

/**
 * Get CrunchyCone API key for direct usage
 * This is useful for services that need the raw API key
 */
export async function getCrunchyConeAPIKey(): Promise<string | null> {
  try {
    // Import the auth functions from crunchycone-lib
    const { getCrunchyConeAPIKeyWithFallback } = await import("crunchycone-lib/auth");
    return await getCrunchyConeAPIKeyWithFallback();
  } catch (error) {
    console.error("Failed to get CrunchyCone API key:", error);
    return null;
  }
}

/**
 * Check if CrunchyCone services are available for testing
 * This includes checking both authentication and basic connectivity
 */
export async function areCrunchyConeServicesAvailable(): Promise<{
  available: boolean;
  reason?: string;
  canUseEmail: boolean;
  canUseStorage: boolean;
}> {
  const authStatus = await getCrunchyConeAuthStatus();

  if (!authStatus.isAuthenticated) {
    return {
      available: false,
      reason: authStatus.message,
      canUseEmail: false,
      canUseStorage: false,
    };
  }

  // If authenticated, services are available
  // Individual service availability is checked by the respective providers
  return {
    available: true,
    canUseEmail: true,
    canUseStorage: true,
  };
}

/**
 * Get authentication instructions for the current environment
 */
export function getCrunchyConeAuthInstructions(): {
  environment: "platform" | "local";
  instructions: string;
  commands?: string[];
} {
  if (isPlatformEnvironment()) {
    return {
      environment: "platform",
      instructions: "Running on CrunchyCone platform. API key should be provided automatically.",
    };
  }

  return {
    environment: "local",
    instructions:
      "To use CrunchyCone services locally, you need to authenticate with the CLI or set an API key.",
    commands: [
      "Option 1: Install CLI and login",
      "npm install -g @crunchycone/cli",
      "crunchycone auth login",
      "",
      "Option 2: Set environment variable",
      "export CRUNCHYCONE_API_KEY=your-api-key",
    ],
  };
}

// Re-export types for convenience
export type { CrunchyConeAuthResult, CrunchyConeAuthServiceConfig };
