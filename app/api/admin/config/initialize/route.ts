import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

// POST /api/admin/config/initialize - Initialize default configuration values
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

    await configService.initializeDefaults();

    return NextResponse.json({
      success: true,
      message: "Default configuration values initialized successfully",
    });
  } catch (error) {
    console.error("Error initializing configuration:", error);
    return NextResponse.json({ error: "Failed to initialize configuration" }, { status: 500 });
  }
}
