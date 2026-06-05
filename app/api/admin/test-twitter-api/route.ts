import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getEnvironmentService } from "@/lib/environment-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/test-twitter-api
 * Tests Twitter API v2 connectivity and token validity
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden - Admin only" }, { status: 403 });
    }

    // Try to get token from environment service (supports CrunchyCone remote vars)
    let bearerToken: string | null = null;
    let tokenSource = "unknown";
    let errorDetails: any = null;

    try {
      // First, try the main environment service (works in platform mode)
      const envService = getEnvironmentService();
      const envVars = await envService.listEnvVars();
      bearerToken = envVars.TWITTER_BEARER_TOKEN || envVars.X_BEARER_TOKEN || null;
      if (bearerToken) {
        tokenSource = "crunchycone-remote";
      }
    } catch (error) {
      errorDetails = error;
      console.warn("[Test Twitter API] Failed to get token from environment service:", error);
    }

    // If not found and we're in local mode, try to get remote vars directly
    if (!bearerToken) {
      try {
        const { getDualEnvironmentServices } = await import("@/lib/environment-service");
        const { remote } = getDualEnvironmentServices();
        const remoteVars = await remote.listEnvVars();
        bearerToken = remoteVars.TWITTER_BEARER_TOKEN || remoteVars.X_BEARER_TOKEN || null;
        if (bearerToken) {
          tokenSource = "crunchycone-remote-local";
        }
      } catch (error) {
        console.warn("[Test Twitter API] Failed to get token from remote service:", error);
      }
    }

    // If still not found, check if it's stored as a secret and try to get it via CLI
    if (!bearerToken) {
      try {
        const { execSync } = await import("child_process");
        // Check if secret exists
        const secretsResult = execSync("npx --yes crunchycone-cli secrets ls --json", {
          stdio: "pipe",
          encoding: "utf8",
          timeout: 10000,
        });
        const secretsResponse = JSON.parse(secretsResult);
        if (secretsResponse.success && secretsResponse.data?.secrets) {
          const secretNames = Object.keys(secretsResponse.data.secrets);
          if (
            secretNames.includes("TWITTER_BEARER_TOKEN") ||
            secretNames.includes("X_BEARER_TOKEN")
          ) {
            // Secret exists but can't read value - inform user
            tokenSource = "crunchycone-secret-unreadable";
            console.warn(
              "[Test Twitter API] Token is stored as a CrunchyCone secret (write-only). On platform deployment, secrets are automatically available as env vars."
            );
          }
        }
      } catch {
        // Ignore CLI errors - user might not have CLI setup
      }
    }

    // Fallback to process.env if environment service didn't provide it
    if (!bearerToken) {
      bearerToken = process.env.TWITTER_BEARER_TOKEN || process.env.X_BEARER_TOKEN || null;
      if (bearerToken) {
        tokenSource = "process.env";
      }
    }

    // Check if token exists (without exposing it)
    const tokenLength = bearerToken ? bearerToken.length : 0;
    const tokenPrefix = bearerToken ? bearerToken.substring(0, 10) + "..." : "N/A";

    if (!bearerToken) {
      const message =
        tokenSource === "crunchycone-secret-unreadable"
          ? "Token is stored as a CrunchyCone secret. Secrets are write-only for security and cannot be read programmatically. On CrunchyCone platform deployment, secrets are automatically available as environment variables. For local development, you need to add TWITTER_BEARER_TOKEN to your local .env file. You can manually copy the value from CrunchyCone settings."
          : "Add TWITTER_BEARER_TOKEN or X_BEARER_TOKEN to your .env file or CrunchyCone settings";

      return NextResponse.json({
        success: false,
        error: "Twitter Bearer Token not configured",
        message,
        tokenPresent: false,
        tokenSource: tokenSource === "crunchycone-secret-unreadable" ? tokenSource : "none",
        hint:
          tokenSource === "crunchycone-secret-unreadable"
            ? "To use locally: Copy the token value from CrunchyCone settings (https://app.crunchycone.dev/projects/0199655c-41ab-77ce-b0bd-534c99a3f598#settings) and add it to your .env file as TWITTER_BEARER_TOKEN=your_token_here"
            : undefined,
        envVars: {
          TWITTER_BEARER_TOKEN: !!process.env.TWITTER_BEARER_TOKEN,
          X_BEARER_TOKEN: !!process.env.X_BEARER_TOKEN,
        },
        errorDetails: errorDetails
          ? errorDetails instanceof Error
            ? errorDetails.message
            : String(errorDetails)
          : undefined,
      });
    }

    // Test with a simple API call - get a well-known tweet (Twitter's first tweet)
    // Using a public endpoint that doesn't require authentication to test connectivity
    // Actually, let's test with a real API call to verify token works
    const testUrl = "https://api.twitter.com/2/tweets/20?tweet.fields=created_at,text";

    try {
      const response = await fetch(testUrl, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "User-Agent": "SocialInsight/test",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: "Twitter API error",
          status: response.status,
          statusText: response.statusText,
          details: data,
          tokenPresent: true,
          tokenLength: bearerToken.length,
        });
      }

      return NextResponse.json({
        success: true,
        message: "Twitter API token is valid and working!",
        tokenPresent: true,
        tokenLength: tokenLength,
        tokenPrefix: tokenPrefix,
        tokenSource: tokenSource,
        testTweet: {
          id: data.data?.id,
          text: data.data?.text?.substring(0, 100),
          createdAt: data.data?.created_at,
        },
        apiStatus: "connected",
      });
    } catch (fetchError) {
      return NextResponse.json({
        success: false,
        error: "Failed to connect to Twitter API",
        details: fetchError instanceof Error ? fetchError.message : String(fetchError),
        tokenPresent: true,
        tokenLength: tokenLength,
        tokenPrefix: tokenPrefix,
      });
    }
  } catch (error) {
    console.error("Error testing Twitter API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to test Twitter API" },
      { status: 500 }
    );
  }
}
