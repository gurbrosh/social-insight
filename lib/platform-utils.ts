/**
 * Platform Detection and UI Utilities
 *
 * Provides helper functions for detecting the runtime environment
 * and generating appropriate UI messages and behaviors.
 */

import { isPlatformEnvironment } from "crunchycone-lib/environment";
import { getEnvironmentServiceInfo } from "./environment-service";
import { getCrunchyConeAuthInstructions } from "./crunchycone-auth-service";

/**
 * Platform information
 */
export interface PlatformInfo {
  name: string;
  isPlatform: boolean;
  envProvider: "local" | "remote";
  supportsSecrets: boolean;
  description: string;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const isPlatform = isPlatformEnvironment();
  const envInfo = getEnvironmentServiceInfo();

  if (isPlatform) {
    return {
      name: "CrunchyCone Platform",
      isPlatform: true,
      envProvider: "remote",
      supportsSecrets: envInfo.supportsSecrets,
      description: "Deployed on CrunchyCone platform with API-based environment management",
    };
  }

  return {
    name: "Local Development",
    isPlatform: false,
    envProvider: "local",
    supportsSecrets: envInfo.supportsSecrets,
    description: "Running locally with .env file-based environment management",
  };
}

/**
 * Get platform-specific UI messages
 */
export function getPlatformMessages() {
  const platform = getPlatformInfo();

  if (platform.isPlatform) {
    return {
      environment: {
        title: "Platform Environment Management",
        description:
          "Environment variables are managed through the CrunchyCone platform API. Changes are applied immediately.",
        warning: "Changes made here will affect the live application environment.",
      },
      crunchycone: {
        title: "CrunchyCone Services",
        description: "CrunchyCone services are automatically configured with platform credentials.",
        status: "Platform API key is used for all CrunchyCone services.",
      },
      cli: {
        title: "CLI Commands",
        description: "CLI commands are not available in platform deployments.",
        warning: "Direct CLI access is disabled for security reasons.",
      },
    };
  }

  return {
    environment: {
      title: "Local Environment Management",
      description:
        "Environment variables are stored in your local .env file. Restart your development server after making changes.",
      warning: "These changes only affect your local development environment.",
    },
    crunchycone: {
      title: "CrunchyCone Services",
      description:
        "To use CrunchyCone services locally, you need to authenticate with the CLI or provide an API key.",
      status: "Authentication required for CrunchyCone email and storage services.",
    },
    cli: {
      title: "CLI Commands",
      description: "CLI commands are available for testing and authentication.",
      warning: "Make sure you have the CrunchyCone CLI installed and authenticated.",
    },
  };
}

/**
 * Get feature availability based on platform
 */
export function getFeatureAvailability() {
  const platform = getPlatformInfo();

  return {
    environmentVariables: {
      available: true,
      method: platform.isPlatform ? "API-based" : "File-based (.env)",
    },
    secrets: {
      available: platform.supportsSecrets,
      method: platform.isPlatform ? "Platform secrets API" : "Not supported locally",
      note: platform.isPlatform
        ? "Secrets are encrypted and managed securely"
        : "Use environment variables for local development",
    },
    cliCommands: {
      available: !platform.isPlatform,
      method: platform.isPlatform ? "Not available" : "Direct CLI execution",
      note: platform.isPlatform
        ? "CLI access is disabled on platform"
        : "Requires CrunchyCone CLI installation",
    },
    crunchyconeServices: {
      available: true,
      method: platform.isPlatform ? "Platform API key" : "CLI credentials or manual API key",
      requiresAuth: !platform.isPlatform,
    },
  };
}

/**
 * Get setup instructions for the current environment
 */
export function getSetupInstructions() {
  const platform = getPlatformInfo();
  const authInstructions = getCrunchyConeAuthInstructions();

  if (platform.isPlatform) {
    return {
      environment: "platform",
      title: "Platform Setup Complete",
      steps: [
        "Your application is running on the CrunchyCone platform",
        "Environment variables are managed through the platform dashboard",
        "CrunchyCone services are automatically configured",
        "No additional setup required",
      ],
      notes: [
        "Changes to environment variables are applied immediately",
        "Use the admin settings to configure third-party services",
        "Secrets are managed securely through the platform",
      ],
    };
  }

  return {
    environment: "local",
    title: "Local Development Setup",
    steps: [
      "Environment variables are stored in your .env file",
      "Restart your development server after environment changes",
      "For CrunchyCone services, authenticate with CLI or set API key",
      "Use admin settings to test and configure services",
    ],
    notes: [
      "Install CrunchyCone CLI for full functionality: npm install -g @crunchycone/cli",
      "Authenticate with: crunchycone auth login",
      "Or set CRUNCHYCONE_API_KEY environment variable",
      "Local .env changes do not affect production",
    ],
    commands: authInstructions.commands,
  };
}

/**
 * Get warning messages for potentially destructive actions
 */
export function getWarningMessages() {
  const platform = getPlatformInfo();

  return {
    environmentChange: {
      title: platform.isPlatform ? "Platform Environment Change" : "Local Environment Change",
      message: platform.isPlatform
        ? "This will immediately update the live application environment. Make sure this change is safe for production."
        : "This will update your local .env file. Restart your development server to apply changes.",
      severity: platform.isPlatform ? "high" : "low",
    },
    serviceTest: {
      title: "Service Connection Test",
      message: platform.isPlatform
        ? "This will test the connection using platform credentials."
        : "This will test the connection using your local CLI credentials or API key.",
      severity: "low",
    },
    bulkUpdate: {
      title: "Bulk Environment Update",
      message: platform.isPlatform
        ? "This will update multiple environment variables simultaneously in the live environment."
        : "This will update multiple variables in your local .env file.",
      severity: platform.isPlatform ? "medium" : "low",
    },
  };
}

/**
 * Get UI theme/styling suggestions based on platform
 */
export function getPlatformTheme() {
  const platform = getPlatformInfo();

  if (platform.isPlatform) {
    return {
      variant: "production" as const,
      badgeColor: "bg-blue-100 text-blue-800",
      iconColor: "text-blue-600",
      borderColor: "border-blue-200",
      alertColor: "border-yellow-200 bg-yellow-50",
    };
  }

  return {
    variant: "development" as const,
    badgeColor: "bg-green-100 text-green-800",
    iconColor: "text-green-600",
    borderColor: "border-green-200",
    alertColor: "border-blue-200 bg-blue-50",
  };
}

/**
 * Check if a feature should be shown/enabled based on platform
 */
export function shouldShowFeature(feature: string): boolean {
  const platform = getPlatformInfo();

  switch (feature) {
    case "cli-commands":
      return !platform.isPlatform;

    case "secrets-management":
      return platform.supportsSecrets;

    case "environment-file-info":
      return !platform.isPlatform;

    case "platform-api-info":
      return platform.isPlatform;

    case "crunchycone-auth-setup":
      return !platform.isPlatform;

    case "restart-server-warning":
      return !platform.isPlatform;

    default:
      return true;
  }
}

// Re-export platform detection for convenience
export { isPlatformEnvironment } from "crunchycone-lib/environment";
