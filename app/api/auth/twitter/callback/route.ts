import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  exchangeCodeForToken,
  getTwitterUserInfo,
  storeTwitterOAuthTokens,
  getTwitterOAuthConfig,
} from "@/lib/twitter-oauth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/twitter/callback
 * Handles Twitter OAuth callback
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(new URL("/auth/signin", request.url));
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      console.error("Twitter OAuth error:", error);
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("Twitter authorization failed")}`, request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("Missing authorization code")}`, request.url)
      );
    }

    // Decode state to get code verifier and user ID
    let stateData: { codeVerifier: string; state: string; userId: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    } catch {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("Invalid state parameter")}`, request.url)
      );
    }

    // Verify user matches
    if (stateData.userId !== session.user.id) {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("User mismatch")}`, request.url)
      );
    }

    // Verify state is not too old (5 minutes)
    const now = Date.now();
    if (now - stateData.timestamp > 5 * 60 * 1000) {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("State expired")}`, request.url)
      );
    }

    const config = getTwitterOAuthConfig();
    if (!config) {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("Twitter OAuth not configured")}`, request.url)
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(config, code, stateData.codeVerifier);

    // Get Twitter user info
    const twitterUser = await getTwitterUserInfo(tokens.access_token);

    // Store tokens
    await storeTwitterOAuthTokens(
      session.user.id,
      twitterUser.id,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      tokens.scope
    );

    // Update or create UserPlatformIdentity
    await prisma.userPlatformIdentity.upsert({
      where: {
        user_id_platform_identity: {
          user_id: session.user.id,
          platform: "x",
          identity: `@${twitterUser.username}`,
        },
      },
      create: {
        user_id: session.user.id,
        platform: "x",
        identity: `@${twitterUser.username}`,
        verified: true,
      },
      update: {
        verified: true,
      },
    });

    return NextResponse.redirect(
      new URL(
        `/profile?success=${encodeURIComponent("Twitter connected successfully")}`,
        request.url
      )
    );
  } catch (error) {
    console.error("Error in Twitter OAuth callback:", error);
    return NextResponse.redirect(
      new URL(
        `/profile?error=${encodeURIComponent(
          error instanceof Error ? error.message : "Failed to connect Twitter"
        )}`,
        request.url
      )
    );
  }
}
