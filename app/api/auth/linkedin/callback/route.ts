import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  exchangeCodeForToken,
  getLinkedInUserInfo,
  storeLinkedInOAuthTokens,
  getLinkedInOAuthConfig,
} from "@/lib/linkedin-oauth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/linkedin/callback
 * Handles LinkedIn OAuth callback
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
      console.error("LinkedIn OAuth error:", error);
      return NextResponse.redirect(
        new URL(
          `/profile?error=${encodeURIComponent("LinkedIn authorization failed")}`,
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

    const config = getLinkedInOAuthConfig();
    if (!config) {
      return NextResponse.redirect(
        new URL(
          `/profile?error=${encodeURIComponent("LinkedIn OAuth not configured")}`,
          request.url
        )
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(config, code);

    // Get LinkedIn user info
    const linkedInUser = await getLinkedInUserInfo(tokens.access_token);

    // Store tokens
    await storeLinkedInOAuthTokens(
      session.user.id,
      linkedInUser.id,
      tokens.access_token,
      tokens.expires_in,
      tokens.scope
    );

    // Update or create UserPlatformIdentity
    // LinkedIn profile URL format: https://www.linkedin.com/in/username
    const profileUrl = `https://www.linkedin.com/in/${linkedInUser.id}`;
    await prisma.userPlatformIdentity.upsert({
      where: {
        user_id_platform_identity: {
          user_id: session.user.id,
          platform: "linkedin",
          identity: profileUrl,
        },
      },
      create: {
        user_id: session.user.id,
        platform: "linkedin",
        identity: profileUrl,
        verified: true,
      },
      update: {
        verified: true,
      },
    });

    return NextResponse.redirect(
      new URL(
        `/profile?success=${encodeURIComponent("LinkedIn connected successfully")}`,
        request.url
      )
    );
  } catch (error) {
    console.error("Error in LinkedIn OAuth callback:", error);
    return NextResponse.redirect(
      new URL(
        `/profile?error=${encodeURIComponent(
          error instanceof Error ? error.message : "Failed to connect LinkedIn"
        )}`,
        request.url
      )
    );
  }
}
