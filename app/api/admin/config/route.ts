import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";

// GET /api/admin/config - Get all configuration values
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const config = await configService.getAllConfig();
    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Error fetching configuration:", error);
    return NextResponse.json({ error: "Failed to fetch configuration" }, { status: 500 });
  }
}

// POST /api/admin/config - Update configuration values
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { category, key, value, dataType, options } = body;

    if (!category || !key || value === undefined || !dataType) {
      return NextResponse.json(
        { error: "Missing required fields: category, key, value, dataType" },
        { status: 400 }
      );
    }

    const success = await configService.setConfig(category, key, value, dataType, options);

    if (!success) {
      return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
    }

    if (category === "performance" && key === "use_task_based_analysis") {
      const { clearTaskBasedAnalysisCache } = await import("@/lib/use-task-based-analysis");
      clearTaskBasedAnalysisCache();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating configuration:", error);
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
}
