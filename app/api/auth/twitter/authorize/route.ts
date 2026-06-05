import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generatePKCE,
  generateState,
  buildTwitterAuthUrl,
  getTwitterOAuthConfig,
  isTwitterOAuthConfigured,
} from "@/lib/twitter-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/twitter/authorize
 * Initiates Twitter OAuth 2.0 flow
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isTwitterOAuthConfigured()) {
      return NextResponse.json(
        {
          error: "Twitter OAuth not configured",
          message:
            "TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET must be set in environment variables",
        },
        { status: 500 }
      );
    }

    const config = getTwitterOAuthConfig();
    if (!config) {
      return NextResponse.json({ error: "Twitter OAuth config missing" }, { status: 500 });
    }

    // Generate PKCE and state
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();

    // Store state and code verifier in session (or use a temporary storage)
    // For simplicity, we'll encode them in the state parameter
    // In production, you might want to use Redis or a database
    const stateData = {
      codeVerifier,
      state,
      userId: session.user.id,
      timestamp: Date.now(),
    };

    // Store in a temporary session (you might want to use a proper session store)
    // For now, we'll encode it in the state (not ideal but works for MVP)
    // In production, use Redis or a database table
    const encodedState = Buffer.from(JSON.stringify(stateData)).toString("base64url");

    // Build authorization URL
    const authUrl = buildTwitterAuthUrl(config, codeChallenge, encodedState);

    return NextResponse.json({ authUrl, state: encodedState });
  } catch (error) {
    console.error("Error initiating Twitter OAuth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 }
    );
  }
}
