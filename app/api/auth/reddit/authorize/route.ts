import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateState,
  buildRedditAuthUrl,
  getRedditOAuthConfig,
  isRedditOAuthConfigured,
} from "@/lib/reddit-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/reddit/authorize
 * Initiates Reddit OAuth 2.0 flow
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isRedditOAuthConfigured()) {
      return NextResponse.json(
        {
          error: "Reddit OAuth not configured",
          message: "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in environment variables",
        },
        { status: 500 }
      );
    }

    const config = getRedditOAuthConfig();
    if (!config) {
      return NextResponse.json({ error: "Reddit OAuth config missing" }, { status: 500 });
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
    const authUrl = buildRedditAuthUrl(config, encodedState);

    return NextResponse.json({ authUrl, state: encodedState });
  } catch (error) {
    console.error("Error initiating Reddit OAuth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 }
    );
  }
}
