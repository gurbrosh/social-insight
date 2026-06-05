import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getPendingTimerTasks } from "@/lib/orchestration-recipe-service";
import { processPendingTimerTasks } from "@/lib/orchestration-timer-task-processor";

export const dynamic = "force-dynamic";
let lastRun = 0;
const MIN_INTERVAL_MS = 15_000;

/**
 * Endpoint to check and execute pending timer tasks
 * This should be called periodically (e.g., via cron job or scheduled task)
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = Date.now();
    if (now - lastRun < MIN_INTERVAL_MS) {
      return NextResponse.json({
        success: true,
        executed: 0,
        message: "Already processed recently",
      });
    }

    lastRun = now;

    const pending = await getPendingTimerTasks(50);
    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending tasks to execute",
        executed: 0,
      });
    }

    const result = await processPendingTimerTasks(50);

    return NextResponse.json({
      success: true,
      executed: result.executed,
      skipped: result.skipped,
      failed: result.failed.length,
      failedTasks: result.failed.length > 0 ? result.failed : undefined,
    });
  } catch (error) {
    console.error("Error executing timer tasks:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Get pending timer tasks (for monitoring/debugging)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pendingTasks = await getPendingTimerTasks(100);

    const tasks = await prisma.orchestrationTimerTask.findMany({
      where: {
        id: { in: pendingTasks.map((t) => t.id) },
        deleted_at: null,
      },
      include: {
        recipeStep: {
          include: {
            recipe: {
              select: {
                name: true,
                is_active: true,
              },
            },
            orchestration: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { scheduled_at: "asc" },
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Error fetching timer tasks:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
