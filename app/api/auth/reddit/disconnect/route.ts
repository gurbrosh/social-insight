import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reddit/disconnect
 * Disconnects user's Reddit account
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete Reddit API account
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: "reddit-api",
      },
    });

    // Also soft delete UserPlatformIdentity for Reddit
    await prisma.userPlatformIdentity.updateMany({
      where: {
        user_id: session.user.id,
        platform: "reddit",
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({ success: true, message: "Reddit account disconnected" });
  } catch (error) {
    console.error("Error disconnecting Reddit:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect Reddit" },
      { status: 500 }
    );
  }
}
