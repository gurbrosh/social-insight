import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { stopAllOrchestrations } from "@/lib/orchestration-executor";

export const dynamic = "force-dynamic";

// POST /api/admin/orchestrations/stop-all - Emergency stop all running orchestrations
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Stop all orchestrations
    await stopAllOrchestrations();

    return NextResponse.json({
      message: "All orchestrations stopped successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error stopping all orchestrations:", error);
    return NextResponse.json(
      {
        error: "Failed to stop orchestrations",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
