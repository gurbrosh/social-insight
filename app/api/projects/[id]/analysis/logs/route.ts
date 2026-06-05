import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { executionLogger } from "@/lib/execution-logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") || "5", 10), 20));

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        deleted_at: null,
      },
      select: { user_id: true },
    });

    if (!project) {
      // Return empty logs instead of 404 for newly created projects or non-existent projects
      // This prevents UI errors when projects are just created
      return NextResponse.json({
        logs: [],
      });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (project.user_id !== session.user.id && !userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let logs: any[] = [];
    try {
      logs = await executionLogger.getSentimentAnalysisLogsForProject(projectId, limit);
    } catch (logError) {
      // If there's an error reading logs (e.g., log file doesn't exist yet), return empty array
      // This is expected for new projects that haven't run any analysis yet
      console.warn("Error reading analysis logs (this is normal for new projects):", logError);
      logs = [];
    }

    return NextResponse.json({
      logs: logs.map((log) => ({
        ...log,
        timestamp: log.timestamp.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching analysis logs:", error);
    // Return empty logs instead of error for better UX
    return NextResponse.json({
      logs: [],
    });
  }
}
