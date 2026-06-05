/**
 * LinkedIn OAuth 2.0 Integration for API Access
 *
 * This module handles LinkedIn OAuth 2.0 Authorization Code Flow
 * for allowing users to connect their LinkedIn accounts for API access.
 *
 * Note: This is separate from login OAuth - this is for LinkedIn API access only.
 *
 * LinkedIn API Limitations:
 * - Does NOT support fetching public conversation threads/comments
 * - Mainly useful for identity verification and profile data
 * - Engagement tracking relies on scraped data from database
 */

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface LinkedInOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Generate a random state for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Build LinkedIn OAuth authorization URL
 */
export function buildLinkedInAuthUrl(config: LinkedInOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    // Try minimal scope - just basic profile without email
    // Note: LinkedIn has deprecated many scopes and now requires product approval for most
    // If this doesn't work, LinkedIn OAuth may not be available without product approval
    scope: "r_liteprofile", // Basic profile only - no email to avoid approval requirement
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  config: LinkedInOAuthConfig,
  code: string
): Promise<{
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn OAuth token exchange failed: ${error}`);
  }

  return await response.json();
}

/**
 * Refresh LinkedIn OAuth access token
 * Note: LinkedIn tokens typically last 60 days and may not have refresh tokens
 */
export async function refreshLinkedInToken(
  config: LinkedInOAuthConfig,
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn OAuth token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Get LinkedIn user info using access token
 * Uses LinkedIn API v2 /me endpoint with basic profile scopes
 */
export async function getLinkedInUserInfo(accessToken: string): Promise<{
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}> {
  // Get basic profile info using /v2/me endpoint
  const profileResponse = await fetch("https://api.linkedin.com/v2/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!profileResponse.ok) {
    const error = await profileResponse.text();
    throw new Error(`Failed to fetch LinkedIn profile: ${error}`);
  }

  const profileData = await profileResponse.json();

  // Try to get email (if r_emailaddress scope is available)
  let email: string | undefined;
  try {
    const emailResponse = await fetch(
      "https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (emailResponse.ok) {
      const emailData = await emailResponse.json();
      // Handle different possible response structures
      email =
        emailData.elements?.[0]?.["handle~"]?.emailAddress ||
        emailData.elements?.[0]?.emailAddress ||
        emailData.emailAddress;
    }
  } catch {
    // Email is optional - not all LinkedIn apps have email permission
  }

  return {
    id: profileData.id || "",
    firstName: profileData.localizedFirstName || profileData.firstName || "",
    lastName: profileData.localizedLastName || profileData.lastName || "",
    email,
  };
}

/**
 * Store LinkedIn OAuth tokens in Account model
 */
export async function storeLinkedInOAuthTokens(
  userId: string,
  linkedInUserId: string,
  accessToken: string,
  expiresIn: number,
  scope: string
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "linkedin-api",
        providerAccountId: linkedInUserId,
      },
    },
    create: {
      userId,
      type: "oauth",
      provider: "linkedin-api",
      providerAccountId: linkedInUserId,
      access_token: accessToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope,
    },
    update: {
      access_token: accessToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope,
    },
  });
}

/**
 * Get valid LinkedIn access token for user
 */
export async function getLinkedInAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "linkedin-api",
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
    // Note: LinkedIn tokens typically last 60 days and may not have refresh tokens
    // For now, we'll just return null if expired
    console.warn(`[LinkedIn OAuth] Token expired for user ${userId}`);
    return null;
  }

  return account.access_token;
}

/**
 * Get LinkedIn OAuth configuration from environment
 */
export function getLinkedInOAuthConfig(): LinkedInOAuthConfig | null {
  const clientId = process.env.LINKEDIN_CLIENT_ID || process.env.LINKEDIN_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.LINKEDIN_CLIENT_SECRET || process.env.LINKEDIN_OAUTH_CLIENT_SECRET;

  // Determine redirect URI - prioritize explicit setting, then NEXT_PUBLIC_APP_URL, then detect from request
  let redirectUri = process.env.LINKEDIN_OAUTH_REDIRECT_URI;

  if (!redirectUri) {
    // Use NEXT_PUBLIC_APP_URL if set, otherwise default to localhost:3000
    // Note: In development, you may need to set this to match your actual port (e.g., 3007)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    redirectUri = `${baseUrl}/api/auth/linkedin/callback`;
  }

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Check if LinkedIn OAuth is configured
 */
export function isLinkedInOAuthConfigured(): boolean {
  return getLinkedInOAuthConfig() !== null;
}
