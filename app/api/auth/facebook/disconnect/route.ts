import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/facebook/disconnect
 * Disconnects user's Facebook account
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete Facebook API account
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: "facebook-api",
      },
    });

    // Also soft delete UserPlatformIdentity for Facebook
    await prisma.userPlatformIdentity.updateMany({
      where: {
        user_id: session.user.id,
        platform: "facebook",
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({ success: true, message: "Facebook account disconnected" });
  } catch (error) {
    console.error("Error disconnecting Facebook:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect Facebook" },
      { status: 500 }
    );
  }
}
