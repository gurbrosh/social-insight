import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getEnvironmentService } from "@/lib/environment-service";
import { getFacebookOAuthConfig, isFacebookOAuthConfigured } from "@/lib/facebook-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/test-facebook-oauth
 * Tests Facebook OAuth configuration and token validity
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Try to get config from environment service (supports CrunchyCone remote vars)
    let appId: string | null = null;
    let appSecret: string | null = null;
    let tokenSource = "unknown";

    try {
      const envService = getEnvironmentService();
      const envVars = await envService.listEnvVars();
      appId = envVars.FACEBOOK_APP_ID || envVars.FACEBOOK_CLIENT_ID || null;
      appSecret = envVars.FACEBOOK_APP_SECRET || envVars.FACEBOOK_CLIENT_SECRET || null;
      if (appId && appSecret) {
        tokenSource = "crunchycone-remote";
      }
    } catch (error) {
      console.warn("[Test Facebook OAuth] Failed to get from environment service:", error);
    }

    // If not found, try remote service directly
    if (!appId || !appSecret) {
      try {
        const { getDualEnvironmentServices } = await import("@/lib/environment-service");
        const { remote } = getDualEnvironmentServices();
        const remoteVars = await remote.listEnvVars();
        appId = appId || remoteVars.FACEBOOK_APP_ID || remoteVars.FACEBOOK_CLIENT_ID || null;
        appSecret =
          appSecret || remoteVars.FACEBOOK_APP_SECRET || remoteVars.FACEBOOK_CLIENT_SECRET || null;
        if (appId && appSecret) {
          tokenSource = "crunchycone-remote-local";
        }
      } catch (error) {
        console.warn("[Test Facebook OAuth] Failed to get from remote service:", error);
      }
    }

    // Fallback to process.env
    if (!appId || !appSecret) {
      appId = process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID || null;
      appSecret = process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET || null;
      if (appId && appSecret) {
        tokenSource = "local-env";
      }
    }

    // Check if OAuth is configured
    const configured = isFacebookOAuthConfigured();
    const config = await getFacebookOAuthConfig();

    if (!configured || !config) {
      return NextResponse.json({
        success: false,
        error: "Facebook OAuth not configured",
        message:
          "Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to your .env file or CrunchyCone settings",
        tokenPresent: false,
        appIdFound: !!appId,
        appSecretFound: !!appSecret,
        tokenSource,
        envVars: {
          FACEBOOK_APP_ID: !!process.env.FACEBOOK_APP_ID || !!process.env.FACEBOOK_CLIENT_ID,
          FACEBOOK_APP_SECRET:
            !!process.env.FACEBOOK_APP_SECRET || !!process.env.FACEBOOK_CLIENT_SECRET,
        },
      });
    }

    // Test if we can make a basic API call (test with App Access Token)
    // Note: We can't test user token without actual OAuth flow, but we can verify config
    let testResult = null;
    try {
      // Try to get app info using app access token (app_id|app_secret format)
      const appAccessToken = `${config.appId}|${config.appSecret}`;
      const testResponse = await fetch(
        `https://graph.facebook.com/v21.0/${config.appId}?access_token=${appAccessToken}`
      );

      if (testResponse.ok) {
        const appInfo = await testResponse.json();
        testResult = {
          appId: appInfo.id,
          appName: appInfo.name,
          apiStatus: "connected",
        };
      } else {
        const errorText = await testResponse.text();
        testResult = {
          apiStatus: "error",
          error: errorText,
        };
      }
    } catch (error) {
      testResult = {
        apiStatus: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    return NextResponse.json({
      success: true,
      message: "Facebook OAuth configuration is valid!",
      tokenPresent: true,
      appId: config.appId,
      appIdLength: config.appId.length,
      appIdPrefix: config.appId.substring(0, 10) + "...",
      appSecretLength: config.appSecret.length,
      redirectUri: config.redirectUri,
      tokenSource,
      testResult,
      apiStatus: testResult?.apiStatus || "unknown",
    });
  } catch (error) {
    console.error("Error testing Facebook OAuth:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to test Facebook OAuth",
      },
      { status: 500 }
    );
  }
}
