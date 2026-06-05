import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  exchangeCodeForToken,
  getFacebookUserInfo,
  storeFacebookOAuthTokens,
  getFacebookOAuthConfig,
} from "@/lib/facebook-oauth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/facebook/callback
 * Handles Facebook OAuth callback
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
    const errorReason = searchParams.get("error_reason");

    if (error) {
      console.error("Facebook OAuth error:", error, errorReason);
      return NextResponse.redirect(
        new URL(
          `/profile?error=${encodeURIComponent(`Facebook authorization failed: ${errorReason || error}`)}`,
          request.url
        )
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL(`/profile?error=${encodeURIComponent("Missing authorization code")}`, request.url)
      );
    }

    // Decode state to get user ID
    let stateData: { state: string; userId: string; timestamp: number };
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

    const config = await getFacebookOAuthConfig();
    if (!config) {
      return NextResponse.redirect(
        new URL(
          `/profile?error=${encodeURIComponent("Facebook OAuth not configured")}`,
          request.url
        )
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(config, code);

    // Get Facebook user info
    const facebookUser = await getFacebookUserInfo(tokens.access_token);

    // Store tokens
    await storeFacebookOAuthTokens(
      session.user.id,
      facebookUser.id,
      tokens.access_token,
      tokens.expires_in
    );

    // Update or create UserPlatformIdentity
    // Facebook profile URL format: https://www.facebook.com/profile.php?id=USER_ID or https://www.facebook.com/username
    // For now, we'll use the profile ID format
    const profileUrl = `https://www.facebook.com/profile.php?id=${facebookUser.id}`;

    await prisma.userPlatformIdentity.upsert({
      where: {
        user_id_platform_identity: {
          user_id: session.user.id,
          platform: "facebook",
          identity: profileUrl,
        },
      },
      create: {
        user_id: session.user.id,
        platform: "facebook",
        identity: profileUrl,
        verified: true,
      },
      update: {
        verified: true,
      },
    });

    return NextResponse.redirect(
      new URL(
        `/profile?success=${encodeURIComponent("Facebook connected successfully")}`,
        request.url
      )
    );
  } catch (error) {
    console.error("Error in Facebook OAuth callback:", error);
    return NextResponse.redirect(
      new URL(
        `/profile?error=${encodeURIComponent(
          error instanceof Error ? error.message : "Failed to connect Facebook"
        )}`,
        request.url
      )
    );
  }
}
