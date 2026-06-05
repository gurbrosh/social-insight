import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateState,
  buildFacebookAuthUrl,
  getFacebookOAuthConfig,
  isFacebookOAuthConfigured,
} from "@/lib/facebook-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/facebook/authorize
 * Initiates Facebook OAuth 2.0 flow
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isFacebookOAuthConfigured()) {
      return NextResponse.json(
        {
          error: "Facebook OAuth not configured",
          message: "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set in environment variables",
        },
        { status: 500 }
      );
    }

    const config = await getFacebookOAuthConfig();
    if (!config) {
      return NextResponse.json({ error: "Facebook OAuth config missing" }, { status: 500 });
    }

    // Generate state for CSRF protection
    const state = generateState();

    // Store state data (encode in state parameter for simplicity)
    const stateData = {
      state,
      userId: session.user.id,
      timestamp: Date.now(),
    };

    const encodedState = Buffer.from(JSON.stringify(stateData)).toString("base64url");

    // Build authorization URL
    const authUrl = buildFacebookAuthUrl(config, encodedState);

    return NextResponse.json({ authUrl, state: encodedState });
  } catch (error) {
    console.error("Error initiating Facebook OAuth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 }
    );
  }
}
