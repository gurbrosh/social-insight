import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/permissions";
import { getCrunchyConeAuthService } from "@/lib/crunchycone-auth-service";
import { isPlatformEnvironment } from "@/lib/platform-utils";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  try {
    // Require admin role
    await requireRole("admin");

    // Use the unified CrunchyCone auth service
    const authService = getCrunchyConeAuthService();
    const authResult = await authService.checkAuthentication();

    return NextResponse.json({
      authenticated: authResult.success,
      output: {
        success: authResult.success,
        source: authResult.source,
        user: authResult.user,
        project: authResult.project,
        message: authResult.message,
        error: authResult.error,
        platform: {
          isPlatform: isPlatformEnvironment(),
          environment: isPlatformEnvironment() ? "platform" : "local",
        },
      },
    });
  } catch (error) {
    console.error("Error checking CrunchyCone authentication:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        authenticated: false,
        error: "Failed to check authentication status",
        output: {
          success: false,
          error: errorMessage,
          platform: {
            isPlatform: isPlatformEnvironment(),
            environment: isPlatformEnvironment() ? "platform" : "local",
          },
        },
      },
      { status: 500 }
    );
  }
}
