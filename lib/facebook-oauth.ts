/**
 * Facebook OAuth 2.0 Integration for API Access
 *
 * This module handles Facebook OAuth 2.0 Authorization Code Flow
 * for allowing users to connect their Facebook accounts for API access.
 *
 * Facebook API Benefits:
 * - Identity verification (matching user's Facebook profile to replies)
 * - Access to user's own posts and comments via Graph API
 * - Better identity matching in engagement tracking
 *
 * Note: Facebook's Graph API has limitations on fetching public conversations
 * Engagement tracking primarily relies on scraped data from database
 */

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface FacebookOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/**
 * Generate a random state for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Build Facebook OAuth authorization URL
 */
export function buildFacebookAuthUrl(config: FacebookOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    scope: "public_profile,email", // Basic profile and email permissions
    response_type: "code",
  });

  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  config: FacebookOAuthConfig,
  code: string
): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
}> {
  const response = await fetch("https://graph.facebook.com/v21.0/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Facebook OAuth token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    access_token: data.access_token,
    token_type: data.token_type || "bearer",
    expires_in: data.expires_in || 5184000, // Default 60 days
  };
}

/**
 * Get Facebook user info using access token
 */
export async function getFacebookUserInfo(accessToken: string): Promise<{
  id: string;
  name: string;
  email?: string;
}> {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${accessToken}`
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Facebook profile: ${error}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    name: data.name || "",
    email: data.email,
  };
}

/**
 * Store Facebook OAuth tokens in Account model
 */
export async function storeFacebookOAuthTokens(
  userId: string,
  facebookUserId: string,
  accessToken: string,
  expiresIn: number
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "facebook-api",
        providerAccountId: facebookUserId,
      },
    },
    create: {
      userId,
      type: "oauth",
      provider: "facebook-api",
      providerAccountId: facebookUserId,
      access_token: accessToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope: "public_profile,email",
    },
    update: {
      access_token: accessToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope: "public_profile,email",
    },
  });
}

/**
 * Get valid Facebook access token for user
 */
export async function getFacebookAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "facebook-api",
    },
  });

  if (!account || !account.access_token) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = account.expires_at || 0;
  const buffer = 300; // 5 minutes

  if (expiresAt && now >= expiresAt - buffer) {
    // Token expired or expiring soon
    // Note: Facebook tokens typically last 60 days and may not have refresh tokens
    // For now, we'll just return null if expired
    console.warn(`[Facebook OAuth] Token expired for user ${userId}`);
    return null;
  }

  return account.access_token;
}

/**
 * Get Facebook OAuth configuration from environment
 * Supports both local .env and CrunchyCone remote settings
 */
export async function getFacebookOAuthConfig(): Promise<FacebookOAuthConfig | null> {
  let appId: string | undefined;
  let appSecret: string | undefined;

  // Try to get from environment service (supports CrunchyCone remote vars)
  try {
    const { getEnvironmentService } = await import("@/lib/environment-service");
    const envService = getEnvironmentService();
    const envVars = await envService.listEnvVars();
    if (envVars.FACEBOOK_APP_ID || envVars.FACEBOOK_CLIENT_ID) {
      appId = envVars.FACEBOOK_APP_ID || envVars.FACEBOOK_CLIENT_ID;
    }
    if (envVars.FACEBOOK_APP_SECRET || envVars.FACEBOOK_CLIENT_SECRET) {
      appSecret = envVars.FACEBOOK_APP_SECRET || envVars.FACEBOOK_CLIENT_SECRET;
    }
  } catch (error) {
    // Fall back to process.env if environment service fails
    console.warn(
      "[Facebook OAuth] Failed to get from environment service, using process.env:",
      error
    );
  }

  // Fallback to process.env if not found from environment service
  if (!appId) {
    appId = process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID;
  }
  if (!appSecret) {
    appSecret = process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET;
  }

  const redirectUri =
    process.env.FACEBOOK_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/facebook/callback`;

  if (!appId || !appSecret) {
    return null;
  }

  return { appId, appSecret, redirectUri };
}

/**
 * Check if Facebook OAuth is configured
 * Note: This is synchronous for UI checks, but actual config retrieval is async
 */
export function isFacebookOAuthConfigured(): boolean {
  // Quick synchronous check using process.env
  // Full async check is done in getFacebookOAuthConfig()
  return !!(
    process.env.FACEBOOK_APP_ID ||
    process.env.FACEBOOK_CLIENT_ID ||
    process.env.FACEBOOK_APP_SECRET ||
    process.env.FACEBOOK_CLIENT_SECRET
  );
}
