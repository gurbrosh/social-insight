import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/linkedin/disconnect
 * Disconnects user's LinkedIn account
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete LinkedIn API account
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: "linkedin-api",
      },
    });

    // Also soft delete UserPlatformIdentity for LinkedIn
    await prisma.userPlatformIdentity.updateMany({
      where: {
        user_id: session.user.id,
        platform: "linkedin",
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({ success: true, message: "LinkedIn account disconnected" });
  } catch (error) {
    console.error("Error disconnecting LinkedIn:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to disconnect LinkedIn" },
      { status: 500 }
    );
  }
}
