import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ulid as generateUlid } from "ulid";

export const dynamic = "force-dynamic";

/**
 * POST /api/engagement/mark-replied
 * Manually mark an engagement session as having a user reply.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { engagementId, message } = body as { engagementId?: string; message?: string };

    if (!engagementId) {
      return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
    }

    // Verify ownership of the engagement session
    const engagement = await prisma.engagementSession.findFirst({
      where: {
        id: engagementId,
        started_by_user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement session not found or unauthorized" },
        { status: 404 }
      );
    }

    // Check if already marked
    const existingMark = await prisma.engagementEvent.findFirst({
      where: {
        engagement_id: engagementId,
        type: "manual_marked",
        deleted_at: null,
      },
    });

    if (existingMark) {
      return NextResponse.json({ error: "Already marked as replied" }, { status: 409 });
    }

    // Create manual_marked event
    await prisma.engagementEvent.create({
      data: {
        id: generateUlid(),
        engagement_id: engagementId,
        type: "manual_marked",
        payload: message ? JSON.stringify({ message, marked_at: new Date().toISOString() }) : null,
        occurred_at: new Date(),
      },
    });

    return NextResponse.json({ success: true, message: "Engagement marked as replied" });
  } catch (error) {
    console.error("Error marking engagement as replied:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to mark engagement" },
      { status: 500 }
    );
  }
}
