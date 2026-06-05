"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/permissions";
import { updateEnvironmentVariables, getEnvironmentVariables } from "@/lib/environment-service";

export interface AuthSettings {
  enableEmailPassword: boolean;
  enableMagicLink: boolean;
  enableGoogleAuth: boolean;
  enableGithubAuth: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
}

async function updateEnvFile(settings: AuthSettings) {
  // Prepare environment variable updates
  const updates: Record<string, string | undefined> = {
    NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD: settings.enableEmailPassword.toString(),
    NEXT_PUBLIC_ENABLE_MAGIC_LINK: settings.enableMagicLink.toString(),
    NEXT_PUBLIC_ENABLE_GOOGLE_AUTH: settings.enableGoogleAuth.toString(),
    NEXT_PUBLIC_ENABLE_GITHUB_AUTH: settings.enableGithubAuth.toString(),
  };

  // Add OAuth provider credentials if provided and not empty
  if (settings.googleClientId && settings.googleClientId.trim() !== "") {
    updates.GOOGLE_CLIENT_ID = settings.googleClientId;
  }
  if (settings.googleClientSecret && settings.googleClientSecret.trim() !== "") {
    updates.GOOGLE_CLIENT_SECRET = settings.googleClientSecret;
  }
  if (settings.githubClientId && settings.githubClientId.trim() !== "") {
    updates.GITHUB_CLIENT_ID = settings.githubClientId;
  }
  if (settings.githubClientSecret && settings.githubClientSecret.trim() !== "") {
    updates.GITHUB_CLIENT_SECRET = settings.githubClientSecret;
  }

  // Use the unified environment service to update variables
  const result = await updateEnvironmentVariables(updates, {
    removeEmpty: false, // Keep OAuth settings even if empty
  });

  if (!result.success) {
    throw new Error(result.error || "Failed to update environment variables");
  }
}

export async function updateAuthSettings(settings: AuthSettings) {
  await requireRole("admin");

  try {
    await updateEnvFile(settings);
    revalidatePath("/admin/settings");

    return {
      success: true,
      message: "Authentication settings updated successfully",
    };
  } catch (error) {
    console.error("Failed to update authentication settings:", error);
    return {
      success: false,
      message: "Failed to update authentication settings",
    };
  }
}

export async function getCurrentAuthSettings(): Promise<AuthSettings> {
  // Get environment variables using the unified service
  const envVars = await getEnvironmentVariables([
    "NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD",
    "NEXT_PUBLIC_ENABLE_MAGIC_LINK",
    "NEXT_PUBLIC_ENABLE_GOOGLE_AUTH",
    "NEXT_PUBLIC_ENABLE_GITHUB_AUTH",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ]);

  return {
    enableEmailPassword: envVars.NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD === "true",
    enableMagicLink: envVars.NEXT_PUBLIC_ENABLE_MAGIC_LINK === "true",
    enableGoogleAuth: envVars.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true",
    enableGithubAuth: envVars.NEXT_PUBLIC_ENABLE_GITHUB_AUTH === "true",
    googleClientId: envVars.GOOGLE_CLIENT_ID,
    googleClientSecret: envVars.GOOGLE_CLIENT_SECRET,
    githubClientId: envVars.GITHUB_CLIENT_ID,
    githubClientSecret: envVars.GITHUB_CLIENT_SECRET,
  };
}
