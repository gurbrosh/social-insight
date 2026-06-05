import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/twitter/disconnect
 * Disconnects user's Twitter account
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete Twitter API account (Account model doesn't have soft delete)
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: "twitter-api",
      },
    });

    // Also soft delete UserPlatformIdentity for Twitter/X
    await prisma.userPlatformIdentity.updateMany({
      where: {
        user_id: session.user.id,
        platform: "x",
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({ success: true, message: "Twitter account disconnected" });
  } catch (error) {
    console.error("Error disconnecting Twitter:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect Twitter" },
      { status: 500 }
    );
  }
}
