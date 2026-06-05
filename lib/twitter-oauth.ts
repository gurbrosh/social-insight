/**
 * Twitter OAuth 2.0 Integration for API Access
 *
 * This module handles Twitter OAuth 2.0 Authorization Code Flow with PKCE
 * for allowing users to connect their Twitter accounts for API access.
 *
 * Note: This is separate from login OAuth - this is for Twitter API access only.
 */

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface TwitterOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TwitterOAuthState {
  codeVerifier: string;
  state: string;
  userId: string;
}

/**
 * Generate PKCE code verifier and challenge
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Generate a random state for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Build Twitter OAuth authorization URL
 */
export function buildTwitterAuthUrl(
  config: TwitterOAuthConfig,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  config: TwitterOAuthConfig,
  code: string,
  codeVerifier: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twitter OAuth token exchange failed: ${error}`);
  }

  return await response.json();
}

/**
 * Refresh Twitter OAuth access token
 */
export async function refreshTwitterToken(
  config: TwitterOAuthConfig,
  refreshToken: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: config.clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twitter OAuth token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Get Twitter user info using access token
 */
export async function getTwitterUserInfo(accessToken: string): Promise<{
  id: string;
  username: string;
  name: string;
}> {
  const response = await fetch("https://api.twitter.com/2/users/me?user.fields=username,name", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Twitter user info: ${error}`);
  }

  const data = await response.json();
  return {
    id: data.data.id,
    username: data.data.username,
    name: data.data.name,
  };
}

/**
 * Store Twitter OAuth tokens in Account model
 */
export async function storeTwitterOAuthTokens(
  userId: string,
  twitterUserId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  scope: string
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "twitter-api",
        providerAccountId: twitterUserId,
      },
    },
    create: {
      userId,
      type: "oauth",
      provider: "twitter-api",
      providerAccountId: twitterUserId,
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
 * Get valid Twitter access token for user (with auto-refresh if needed)
 */
export async function getTwitterAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "twitter-api",
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
    // Token expired or expiring soon, try to refresh
    if (!account.refresh_token) {
      console.warn(`[Twitter OAuth] No refresh token for user ${userId}`);
      return null;
    }

    try {
      const config = getTwitterOAuthConfig();
      if (!config) {
        console.error("[Twitter OAuth] Missing OAuth config");
        return null;
      }

      const refreshed = await refreshTwitterToken(config, account.refresh_token);

      // Update stored tokens
      await prisma.account.update({
        where: { id: account.id },
        data: {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token || account.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          scope: refreshed.scope,
        },
      });

      return refreshed.access_token;
    } catch (error) {
      console.error(`[Twitter OAuth] Failed to refresh token for user ${userId}:`, error);
      return null;
    }
  }

  return account.access_token;
}

/**
 * Get Twitter OAuth configuration from environment
 */
export function getTwitterOAuthConfig(): TwitterOAuthConfig | null {
  const clientId = process.env.TWITTER_CLIENT_ID || process.env.TWITTER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.TWITTER_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.TWITTER_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/twitter/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Check if Twitter OAuth is configured
 */
export function isTwitterOAuthConfigured(): boolean {
  return getTwitterOAuthConfig() !== null;
}
