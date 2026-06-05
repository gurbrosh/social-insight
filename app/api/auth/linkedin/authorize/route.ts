import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateState,
  buildLinkedInAuthUrl,
  getLinkedInOAuthConfig,
  isLinkedInOAuthConfigured,
} from "@/lib/linkedin-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/linkedin/authorize
 * Initiates LinkedIn OAuth 2.0 flow
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isLinkedInOAuthConfigured()) {
      return NextResponse.json(
        {
          error: "LinkedIn OAuth not configured",
          message:
            "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set in environment variables",
        },
        { status: 500 }
      );
    }

    const config = getLinkedInOAuthConfig();
    if (!config) {
      return NextResponse.json({ error: "LinkedIn OAuth config missing" }, { status: 500 });
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
    const authUrl = buildLinkedInAuthUrl(config, encodedState);

    return NextResponse.json({ authUrl, state: encodedState });
  } catch (error) {
    console.error("Error initiating LinkedIn OAuth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 }
    );
  }
}
