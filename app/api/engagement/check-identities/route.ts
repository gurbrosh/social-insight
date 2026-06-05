import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/engagement/check-identities?platform=reddit
 * Returns user's identities for a platform. Used to determine if identity selection is needed.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform");

    if (!platform) {
      return NextResponse.json({ error: "platform parameter is required" }, { status: 400 });
    }

    const identities = await prisma.userPlatformIdentity.findMany({
      where: {
        user_id: session.user.id,
        platform: platform.toLowerCase(),
        deleted_at: null,
      },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({
      success: true,
      identities: identities.map((id) => ({
        id: id.id,
        platform: id.platform,
        identity: id.identity,
        verified: id.verified,
      })),
      needsSelection: identities.length > 1,
    });
  } catch (error) {
    console.error("Error checking identities:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check identities" },
      { status: 500 }
    );
  }
}
