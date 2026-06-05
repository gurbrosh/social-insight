/**
 * Reddit OAuth 2.0 Integration for API Access
 *
 * This module handles Reddit OAuth 2.0 Authorization Code Flow
 * for allowing users to connect their Reddit accounts for API access.
 *
 * Reddit API Benefits:
 * - Better rate limits (60 requests/minute authenticated vs public)
 * - More reliable access to comments and threads
 * - Can fetch user's own comments and posts
 * - Can use authenticated endpoints for engagement tracking
 */

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface RedditOAuthConfig {
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
 * Build Reddit OAuth authorization URL
 */
export function buildRedditAuthUrl(config: RedditOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    state,
    redirect_uri: config.redirectUri,
    duration: "permanent", // Get refresh token
    scope: "read identity", // Read posts/comments and identity
  });

  return `https://www.reddit.com/api/v1/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 * Reddit uses Basic Auth with client_id:client_secret
 */
export async function exchangeCodeForToken(
  config: RedditOAuthConfig,
  code: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "SocialInsight:RedditOAuth:1.0.0 (by /u/socialinsight)",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Reddit OAuth token exchange failed: ${error}`);
  }

  return await response.json();
}

/**
 * Refresh Reddit OAuth access token
 * Reddit tokens expire after 1 hour
 */
export async function refreshRedditToken(
  config: RedditOAuthConfig,
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "SocialInsight:RedditOAuth:1.0.0 (by /u/socialinsight)",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Reddit OAuth token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Get Reddit user info using access token
 */
export async function getRedditUserInfo(accessToken: string): Promise<{
  id: string;
  name: string; // Reddit username (e.g., "socialinsight")
}> {
  const response = await fetch("https://oauth.reddit.com/api/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "SocialInsight:RedditOAuth:1.0.0 (by /u/socialinsight)",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Reddit profile: ${error}`);
  }

  const data = await response.json();

  return {
    id: data.id, // Reddit user ID (numeric)
    name: data.name, // Reddit username
  };
}

/**
 * Store Reddit OAuth tokens in Account model
 */
export async function storeRedditOAuthTokens(
  userId: string,
  redditUserId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  scope: string
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "reddit-api",
        providerAccountId: redditUserId,
      },
    },
    create: {
      userId,
      type: "oauth",
      provider: "reddit-api",
      providerAccountId: redditUserId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope,
    },
    update: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: "bearer",
      scope,
    },
  });
}

/**
 * Get valid Reddit access token for user (with auto-refresh)
 */
export async function getRedditAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "reddit-api",
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
    // Token expired or expiring soon - try to refresh
    if (account.refresh_token) {
      try {
        const config = getRedditOAuthConfig();
        if (!config) {
          console.warn(`[Reddit OAuth] Cannot refresh token - config missing`);
          return null;
        }

        const newTokens = await refreshRedditToken(config, account.refresh_token);

        // Update stored tokens
        await storeRedditOAuthTokens(
          userId,
          account.providerAccountId,
          newTokens.access_token,
          account.refresh_token, // Refresh token doesn't change
          newTokens.expires_in,
          newTokens.scope
        );

        return newTokens.access_token;
      } catch (error) {
        console.error(`[Reddit OAuth] Failed to refresh token for user ${userId}:`, error);
        return null;
      }
    } else {
      console.warn(`[Reddit OAuth] Token expired and no refresh token for user ${userId}`);
      return null;
    }
  }

  return account.access_token;
}

/**
 * Get Reddit OAuth configuration from environment
 */
export function getRedditOAuthConfig(): RedditOAuthConfig | null {
  const clientId = process.env.REDDIT_CLIENT_ID || process.env.REDDIT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET || process.env.REDDIT_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.REDDIT_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/reddit/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Check if Reddit OAuth is configured
 */
export function isRedditOAuthConfigured(): boolean {
  return getRedditOAuthConfig() !== null;
}
