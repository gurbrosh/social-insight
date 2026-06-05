import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/admin/orchestrations/[id]/status - Get orchestration execution status
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    // Get the orchestration with its latest execution
    const orchestration = await prisma.orchestration.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
      include: {
        executions: {
          where: { deleted_at: null },
          orderBy: { created_at: "desc" },
          take: 1,
          include: {
            thread_executions: {
              where: { deleted_at: null },
              orderBy: { created_at: "asc" },
              include: {
                step_executions: {
                  where: { deleted_at: null },
                  orderBy: { created_at: "asc" },
                  include: {
                    scrape_job: {
                      select: {
                        id: true,
                        status: true,
                        started_at: true,
                        completed_at: true,
                        error_message: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!orchestration) {
      return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
    }

    const latestExecution = orchestration.executions[0];

    if (!latestExecution) {
      return NextResponse.json({
        orchestrationId: orchestration.id,
        orchestrationName: orchestration.name,
        isRunning: orchestration.is_running,
        status: "NOT_STARTED",
        message: "No executions found",
        threads: [],
        summary: {
          totalThreads: 0,
          completedThreads: 0,
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
        },
      });
    }

    // Calculate summary statistics
    const totalThreads = latestExecution.thread_executions.length;
    const completedThreads = latestExecution.thread_executions.filter(
      (t) => t.status === "COMPLETED"
    ).length;

    const totalSteps = latestExecution.thread_executions.reduce(
      (sum, thread) => sum + thread.step_executions.length,
      0
    );
    const completedSteps = latestExecution.thread_executions.reduce(
      (sum, thread) =>
        sum + thread.step_executions.filter((step) => step.status === "COMPLETED").length,
      0
    );
    const failedSteps = latestExecution.thread_executions.reduce(
      (sum, thread) =>
        sum + thread.step_executions.filter((step) => step.status === "FAILED").length,
      0
    );

    // Format thread data
    const threads = latestExecution.thread_executions.map((thread) => ({
      id: thread.id,
      name: thread.thread_name,
      status: thread.status,
      startedAt: thread.started_at?.toISOString(),
      completedAt: thread.completed_at?.toISOString(),
      errorMessage: thread.error_message,
      steps: thread.step_executions.map((step) => ({
        id: step.id,
        scraperId: step.scraper_id,
        scraperName: step.scraper_name,
        platform: step.platform,
        status: step.status,
        startedAt: step.started_at?.toISOString(),
        completedAt: step.completed_at?.toISOString(),
        errorMessage: step.error_message,
        scrapeJob: step.scrape_job
          ? {
              id: step.scrape_job.id,
              status: step.scrape_job.status,
              startedAt: step.scrape_job.started_at?.toISOString(),
              completedAt: step.scrape_job.completed_at?.toISOString(),
              errorMessage: step.scrape_job.error_message,
            }
          : null,
      })),
    }));

    return NextResponse.json({
      orchestrationId: orchestration.id,
      orchestrationName: orchestration.name,
      isRunning: orchestration.is_running,
      executionId: latestExecution.id,
      status: latestExecution.status,
      startedAt: latestExecution.started_at?.toISOString(),
      completedAt: latestExecution.completed_at?.toISOString(),
      errorMessage: latestExecution.error_message,
      threads,
      summary: {
        totalThreads,
        completedThreads,
        totalSteps,
        completedSteps,
        failedSteps,
        progress: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      },
    });
  } catch (error) {
    console.error("Error getting orchestration status:", error);
    return NextResponse.json({ error: "Failed to get orchestration status" }, { status: 500 });
  }
}
