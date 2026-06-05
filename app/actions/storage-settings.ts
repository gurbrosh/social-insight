"use server";

import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import {
  updateEnvironmentVariables,
  getEnvironmentVariables,
  isPlatformEnvironment,
} from "@/lib/environment-service";
import { getCrunchyConeAuthService } from "@/lib/crunchycone-auth-service";

interface StorageSettings {
  provider: string;
  // LocalStorage settings
  localStoragePath?: string;
  localStorageBaseUrl?: string;

  // AWS S3 settings
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  awsBucket?: string;
  awsCloudFrontDomain?: string;

  // Digital Ocean Spaces settings
  doAccessKeyId?: string;
  doSecretAccessKey?: string;
  doRegion?: string;
  doBucket?: string;
  doCdnEndpoint?: string;

  // Azure Storage settings
  azureAccountName?: string;
  azureAccountKey?: string;
  azureSasToken?: string;
  azureConnectionString?: string;
  azureContainerName?: string;
  azureCdnUrl?: string;

  // Google Cloud Storage settings
  gcpProjectId?: string;
  gcpKeyFile?: string;
  gcsBucket?: string;
  gcpCdnUrl?: string;

  // CrunchyCone settings
  crunchyconeApiKey?: string;
  crunchyconeApiUrl?: string;
  crunchyconeProjectId?: string;
  // Flags to indicate if values are set via environment (and should not be editable)
  isEnvCrunchyconeApiKey?: boolean;
  isEnvCrunchyconeApiUrl?: boolean;
  isEnvCrunchyconeProjectId?: boolean;
}

export async function getStorageSettings(): Promise<{
  success: boolean;
  settings?: StorageSettings;
  isPlatformMode?: boolean;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return { success: false, error: "Unauthorized" };
    }

    // Get environment variables using the unified service
    const envVars = await getEnvironmentVariables([
      "CRUNCHYCONE_STORAGE_PROVIDER",
      "CRUNCHYCONE_LOCALSTORAGE_PATH",
      "CRUNCHYCONE_LOCALSTORAGE_BASE_URL",
      "CRUNCHYCONE_AWS_ACCESS_KEY_ID",
      "CRUNCHYCONE_AWS_SECRET_ACCESS_KEY",
      "CRUNCHYCONE_AWS_REGION",
      "CRUNCHYCONE_AWS_BUCKET",
      "CRUNCHYCONE_AWS_CLOUDFRONT_DOMAIN",
      "CRUNCHYCONE_DO_ACCESS_KEY_ID",
      "CRUNCHYCONE_DO_SECRET_ACCESS_KEY",
      "CRUNCHYCONE_DO_REGION",
      "CRUNCHYCONE_DO_BUCKET",
      "CRUNCHYCONE_DO_CDN_ENDPOINT",
      "CRUNCHYCONE_AZURE_ACCOUNT_NAME",
      "CRUNCHYCONE_AZURE_ACCOUNT_KEY",
      "CRUNCHYCONE_AZURE_SAS_TOKEN",
      "CRUNCHYCONE_AZURE_CONNECTION_STRING",
      "CRUNCHYCONE_AZURE_CONTAINER_NAME",
      "CRUNCHYCONE_AZURE_CDN_URL",
      "CRUNCHYCONE_GCP_PROJECT_ID",
      "CRUNCHYCONE_GCP_KEY_FILE",
      "CRUNCHYCONE_GCS_BUCKET",
      "CRUNCHYCONE_GCP_CDN_URL",
      "CRUNCHYCONE_API_KEY",
      "CRUNCHYCONE_API_URL",
      "CRUNCHYCONE_PROJECT_ID",
    ]);

    // Check if CrunchyCone settings are set via process environment (not managed)
    // This helps distinguish between managed variables and system-provided ones
    const isEnvCrunchyconeApiKey =
      !envVars.CRUNCHYCONE_API_KEY && !!process.env.CRUNCHYCONE_API_KEY;
    const isEnvCrunchyconeApiUrl =
      !envVars.CRUNCHYCONE_API_URL && !!process.env.CRUNCHYCONE_API_URL;
    const isEnvCrunchyconeProjectId =
      !envVars.CRUNCHYCONE_PROJECT_ID && !!process.env.CRUNCHYCONE_PROJECT_ID;

    const settings: StorageSettings = {
      provider: envVars.CRUNCHYCONE_STORAGE_PROVIDER || "localstorage",
      localStoragePath: envVars.CRUNCHYCONE_LOCALSTORAGE_PATH,
      localStorageBaseUrl: envVars.CRUNCHYCONE_LOCALSTORAGE_BASE_URL,
      awsAccessKeyId: envVars.CRUNCHYCONE_AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: envVars.CRUNCHYCONE_AWS_SECRET_ACCESS_KEY,
      awsRegion: envVars.CRUNCHYCONE_AWS_REGION,
      awsBucket: envVars.CRUNCHYCONE_AWS_BUCKET,
      awsCloudFrontDomain: envVars.CRUNCHYCONE_AWS_CLOUDFRONT_DOMAIN,
      doAccessKeyId: envVars.CRUNCHYCONE_DO_ACCESS_KEY_ID,
      doSecretAccessKey: envVars.CRUNCHYCONE_DO_SECRET_ACCESS_KEY,
      doRegion: envVars.CRUNCHYCONE_DO_REGION,
      doBucket: envVars.CRUNCHYCONE_DO_BUCKET,
      doCdnEndpoint: envVars.CRUNCHYCONE_DO_CDN_ENDPOINT,
      azureAccountName: envVars.CRUNCHYCONE_AZURE_ACCOUNT_NAME,
      azureAccountKey: envVars.CRUNCHYCONE_AZURE_ACCOUNT_KEY,
      azureSasToken: envVars.CRUNCHYCONE_AZURE_SAS_TOKEN,
      azureConnectionString: envVars.CRUNCHYCONE_AZURE_CONNECTION_STRING,
      azureContainerName: envVars.CRUNCHYCONE_AZURE_CONTAINER_NAME,
      azureCdnUrl: envVars.CRUNCHYCONE_AZURE_CDN_URL,
      gcpProjectId: envVars.CRUNCHYCONE_GCP_PROJECT_ID,
      gcpKeyFile: envVars.CRUNCHYCONE_GCP_KEY_FILE,
      gcsBucket: envVars.CRUNCHYCONE_GCS_BUCKET,
      gcpCdnUrl: envVars.CRUNCHYCONE_GCP_CDN_URL,
      // For CrunchyCone settings, prefer managed variables, fallback to process env
      crunchyconeApiKey: envVars.CRUNCHYCONE_API_KEY || process.env.CRUNCHYCONE_API_KEY,
      crunchyconeApiUrl: envVars.CRUNCHYCONE_API_URL || process.env.CRUNCHYCONE_API_URL,
      crunchyconeProjectId: envVars.CRUNCHYCONE_PROJECT_ID || process.env.CRUNCHYCONE_PROJECT_ID,
      // Environment flags
      isEnvCrunchyconeApiKey,
      isEnvCrunchyconeApiUrl,
      isEnvCrunchyconeProjectId,
    };

    return { success: true, settings, isPlatformMode: isPlatformEnvironment() };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: `Failed to load storage settings: ${errorMessage}` };
  }
}

export async function updateStorageSettings(
  settings: StorageSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return { success: false, error: "Unauthorized" };
    }

    // Prepare environment variable updates
    const updates: Record<string, string | undefined> = {
      CRUNCHYCONE_STORAGE_PROVIDER: settings.provider,
      CRUNCHYCONE_LOCALSTORAGE_PATH: settings.localStoragePath,
      CRUNCHYCONE_LOCALSTORAGE_BASE_URL: settings.localStorageBaseUrl,
      CRUNCHYCONE_AWS_ACCESS_KEY_ID: settings.awsAccessKeyId,
      CRUNCHYCONE_AWS_SECRET_ACCESS_KEY: settings.awsSecretAccessKey,
      CRUNCHYCONE_AWS_REGION: settings.awsRegion,
      CRUNCHYCONE_AWS_BUCKET: settings.awsBucket,
      CRUNCHYCONE_AWS_CLOUDFRONT_DOMAIN: settings.awsCloudFrontDomain,
      CRUNCHYCONE_DO_ACCESS_KEY_ID: settings.doAccessKeyId,
      CRUNCHYCONE_DO_SECRET_ACCESS_KEY: settings.doSecretAccessKey,
      CRUNCHYCONE_DO_REGION: settings.doRegion,
      CRUNCHYCONE_DO_BUCKET: settings.doBucket,
      CRUNCHYCONE_DO_CDN_ENDPOINT: settings.doCdnEndpoint,
      CRUNCHYCONE_AZURE_ACCOUNT_NAME: settings.azureAccountName,
      CRUNCHYCONE_AZURE_ACCOUNT_KEY: settings.azureAccountKey,
      CRUNCHYCONE_AZURE_SAS_TOKEN: settings.azureSasToken,
      CRUNCHYCONE_AZURE_CONNECTION_STRING: settings.azureConnectionString,
      CRUNCHYCONE_AZURE_CONTAINER_NAME: settings.azureContainerName,
      CRUNCHYCONE_AZURE_CDN_URL: settings.azureCdnUrl,
      CRUNCHYCONE_GCP_PROJECT_ID: settings.gcpProjectId,
      CRUNCHYCONE_GCP_KEY_FILE: settings.gcpKeyFile,
      CRUNCHYCONE_GCS_BUCKET: settings.gcsBucket,
      CRUNCHYCONE_GCP_CDN_URL: settings.gcpCdnUrl,
    };

    // Only set CrunchyCone settings if not already set via environment
    if (settings.crunchyconeApiKey && !settings.isEnvCrunchyconeApiKey) {
      updates.CRUNCHYCONE_API_KEY = settings.crunchyconeApiKey;
    }
    if (settings.crunchyconeApiUrl && !settings.isEnvCrunchyconeApiUrl) {
      updates.CRUNCHYCONE_API_URL = settings.crunchyconeApiUrl;
    }
    if (settings.crunchyconeProjectId && !settings.isEnvCrunchyconeProjectId) {
      updates.CRUNCHYCONE_PROJECT_ID = settings.crunchyconeProjectId;
    }

    // Use the unified environment service to update variables
    const result = await updateEnvironmentVariables(updates, {
      removeEmpty: true, // Remove variables with empty values
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating storage settings:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: `Failed to update storage settings: ${errorMessage}` };
  }
}

export async function testStorageConnection(
  settings: StorageSettings
): Promise<{ success: boolean; error?: string; details?: string }> {
  try {
    const session = await auth();
    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return { success: false, error: "Unauthorized" };
    }

    // In platform mode, LocalStorage is not available
    if (settings.provider === "localstorage" && process.env.CRUNCHYCONE_PLATFORM === "1") {
      return {
        success: false,
        error: "LocalStorage is not available when running in CrunchyCone platform mode",
        details:
          "LocalStorage requires file system access which is not available in managed platform deployments",
      };
    }

    // For CrunchyCone provider, check authentication based on environment
    if (settings.provider === "crunchycone") {
      // First, check if crunchycone.toml exists
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path");
      const crunchyConeTomlPath = path.join(process.cwd(), "crunchycone.toml");
      const hasCrunchyConeConfig = fs.existsSync(crunchyConeTomlPath);

      if (!hasCrunchyConeConfig) {
        return {
          success: false,
          error: "CrunchyCone configuration not found",
          details:
            "This template project is not connected to CrunchyCone. To use CrunchyCone storage, initialize a project with 'crunchycone init' or use a different storage provider.",
        };
      }

      if (process.env.CRUNCHYCONE_PLATFORM === "1") {
        // Check if API key is available for platform environments (settings or environment)
        if (!settings.crunchyconeApiKey && !process.env.CRUNCHYCONE_API_KEY) {
          return {
            success: false,
            error: "CrunchyCone API key is required for platform environment",
            details: "CRUNCHYCONE_API_KEY environment variable is not set",
          };
        }
      } else {
        // For local environments, check CLI authentication
        const authService = getCrunchyConeAuthService();
        const authResult = await authService.checkAuthentication();

        if (!authResult.success) {
          return {
            success: false,
            error: "CrunchyCone authentication failed",
            details:
              authResult.error ||
              "Not authenticated with CrunchyCone services. Please check your CLI authentication.",
          };
        }
      }
    }

    // Import crunchycone-lib storage classes
    const { initializeStorageProvider, getStorageProvider } = await import(
      "crunchycone-lib/storage"
    );

    // Temporarily set environment variables for testing
    const originalEnvVars = new Map<string, string | undefined>();
    const testEnvVars: Record<string, string> = {
      CRUNCHYCONE_STORAGE_PROVIDER: settings.provider,
    };

    // Add provider-specific environment variables
    switch (settings.provider) {
      case "localstorage":
        if (settings.localStoragePath)
          testEnvVars.CRUNCHYCONE_LOCALSTORAGE_PATH = settings.localStoragePath;
        if (settings.localStorageBaseUrl)
          testEnvVars.CRUNCHYCONE_LOCALSTORAGE_BASE_URL = settings.localStorageBaseUrl;
        break;
      case "aws":
        if (settings.awsAccessKeyId)
          testEnvVars.CRUNCHYCONE_AWS_ACCESS_KEY_ID = settings.awsAccessKeyId;
        if (settings.awsSecretAccessKey)
          testEnvVars.CRUNCHYCONE_AWS_SECRET_ACCESS_KEY = settings.awsSecretAccessKey;
        if (settings.awsRegion) testEnvVars.CRUNCHYCONE_AWS_REGION = settings.awsRegion;
        if (settings.awsBucket) testEnvVars.CRUNCHYCONE_AWS_BUCKET = settings.awsBucket;
        if (settings.awsCloudFrontDomain)
          testEnvVars.CRUNCHYCONE_AWS_CLOUDFRONT_DOMAIN = settings.awsCloudFrontDomain;
        break;
      case "digitalocean":
        if (settings.doAccessKeyId)
          testEnvVars.CRUNCHYCONE_DO_ACCESS_KEY_ID = settings.doAccessKeyId;
        if (settings.doSecretAccessKey)
          testEnvVars.CRUNCHYCONE_DO_SECRET_ACCESS_KEY = settings.doSecretAccessKey;
        if (settings.doRegion) testEnvVars.CRUNCHYCONE_DO_REGION = settings.doRegion;
        if (settings.doBucket) testEnvVars.CRUNCHYCONE_DO_BUCKET = settings.doBucket;
        if (settings.doCdnEndpoint)
          testEnvVars.CRUNCHYCONE_DO_CDN_ENDPOINT = settings.doCdnEndpoint;
        break;
      case "azure":
        if (settings.azureAccountName)
          testEnvVars.CRUNCHYCONE_AZURE_ACCOUNT_NAME = settings.azureAccountName;
        if (settings.azureAccountKey)
          testEnvVars.CRUNCHYCONE_AZURE_ACCOUNT_KEY = settings.azureAccountKey;
        if (settings.azureSasToken)
          testEnvVars.CRUNCHYCONE_AZURE_SAS_TOKEN = settings.azureSasToken;
        if (settings.azureConnectionString)
          testEnvVars.CRUNCHYCONE_AZURE_CONNECTION_STRING = settings.azureConnectionString;
        if (settings.azureContainerName)
          testEnvVars.CRUNCHYCONE_AZURE_CONTAINER_NAME = settings.azureContainerName;
        if (settings.azureCdnUrl) testEnvVars.CRUNCHYCONE_AZURE_CDN_URL = settings.azureCdnUrl;
        break;
      case "gcp":
        if (settings.gcpProjectId) testEnvVars.CRUNCHYCONE_GCP_PROJECT_ID = settings.gcpProjectId;
        if (settings.gcpKeyFile) testEnvVars.CRUNCHYCONE_GCP_KEY_FILE = settings.gcpKeyFile;
        if (settings.gcsBucket) testEnvVars.CRUNCHYCONE_GCS_BUCKET = settings.gcsBucket;
        if (settings.gcpCdnUrl) testEnvVars.CRUNCHYCONE_GCP_CDN_URL = settings.gcpCdnUrl;
        break;
      case "crunchycone":
        // CrunchyCone provider will use the auth service for credentials
        // No additional environment variables needed for testing
        break;
    }

    // Backup and set test environment variables
    for (const [key, value] of Object.entries(testEnvVars)) {
      originalEnvVars.set(key, process.env[key]);
      process.env[key] = value;
    }

    try {
      // Initialize and test the storage provider
      initializeStorageProvider();
      const provider = getStorageProvider();

      // Test if provider is available
      const isAvailable = await provider.isAvailable();

      if (isAvailable) {
        // Try to list files to ensure connection works
        const listResult = await provider.listFiles({ limit: 1 });
        return {
          success: true,
          details: `Successfully connected to ${settings.provider} storage. Found ${listResult.totalCount || 0} files.`,
        };
      } else {
        return {
          success: false,
          error: `${settings.provider} storage provider is not available`,
          details: "Provider failed availability check",
        };
      }
    } finally {
      // Restore original environment variables
      for (const [key, originalValue] of originalEnvVars) {
        if (originalValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalValue;
        }
      }
    }
  } catch (error) {
    return {
      success: false,
      error: "Storage connection test failed",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
