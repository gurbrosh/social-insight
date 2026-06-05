import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { pullFromRemote, isPlatformEnvironment } from "@/lib/environment-service";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Check authentication and admin status
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Push/pull only available in local mode
    if (isPlatformEnvironment()) {
      return NextResponse.json(
        { error: "Pull functionality is not available in platform mode" },
        { status: 403 }
      );
    }

    // On production local, restrict access for security
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      return NextResponse.json(
        { error: "Pull functionality is not available in local production mode" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { keys } = body; // Optional array of specific keys to pull

    const result = await pullFromRemote(keys);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Successfully pulled ${result.pulledCount} variables from remote`,
        pulledCount: result.pulledCount,
      });
    } else {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  } catch (error) {
    console.error("Error pulling environment variables:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
