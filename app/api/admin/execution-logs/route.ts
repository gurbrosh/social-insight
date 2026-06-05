import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { executionLogger } from "@/lib/execution-logger";

export const dynamic = "force-dynamic";

// GET /api/admin/execution-logs - Get all execution logs
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";

    if (format === "csv") {
      // Export all logs as CSV
      const csvData = await executionLogger.exportToCSV();

      return new NextResponse(csvData, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="all-execution-logs.csv"',
        },
      });
    } else {
      // Return as JSON
      const logs = await executionLogger.getAllLogs();

      return NextResponse.json({
        logs,
        totalCount: logs.length,
      });
    }
  } catch (error) {
    console.error("Error getting execution logs:", error);
    return NextResponse.json({ error: "Failed to get execution logs" }, { status: 500 });
  }
}

// DELETE /api/admin/execution-logs - Clear all execution logs
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await executionLogger.clearLogs();

    return NextResponse.json({
      message: "All execution logs cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing execution logs:", error);
    return NextResponse.json({ error: "Failed to clear execution logs" }, { status: 500 });
  }
}
