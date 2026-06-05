import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/admin/orchestrations/[id] - Get specific orchestration
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
    const orchestration = await prisma.orchestration.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        executions: {
          where: { deleted_at: null },
          orderBy: { created_at: "desc" },
        },
      },
    });

    if (!orchestration) {
      return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
    }

    let projectIds: string[] = [];
    let threads: any[] = [];

    try {
      projectIds = JSON.parse(orchestration.project_ids || "[]");
      if (!Array.isArray(projectIds)) projectIds = [];
    } catch (error) {
      console.error(`Error parsing project_ids for orchestration ${orchestration.id}:`, error);
      projectIds = [];
    }

    try {
      threads = JSON.parse(orchestration.threads || "[]");
      if (!Array.isArray(threads)) threads = [];
    } catch (error) {
      console.error(`Error parsing threads for orchestration ${orchestration.id}:`, error);
      threads = [];
    }

    return NextResponse.json({
      id: orchestration.id,
      name: orchestration.name,
      description: orchestration.description,
      projectIds,
      threads,
      isRunning: orchestration.is_running,
      createdAt: orchestration.created_at.toISOString(),
      executions: orchestration.executions.map((exec) => ({
        id: exec.id,
        status: exec.status,
        startedAt: exec.started_at?.toISOString(),
        completedAt: exec.completed_at?.toISOString(),
        totalThreads: exec.total_threads,
        completedThreads: exec.completed_threads,
        totalJobs: exec.total_jobs,
        completedJobs: exec.completed_jobs,
      })),
    });
  } catch (error) {
    console.error("Error fetching orchestration:", error);
    return NextResponse.json({ error: "Failed to fetch orchestration" }, { status: 500 });
  }
}

// PUT /api/admin/orchestrations/[id] - Update orchestration
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    console.log("=== PUT ORCHESTRATION API CALLED ===");
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, projectIds, threads } = body;

    if (!name || !projectIds || !threads) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const incomingStepCount = (threads ?? []).reduce(
      (sum: number, t: { steps?: unknown[] }) => sum + (t.steps?.length ?? 0),
      0
    );
    console.log(
      `[PUT Orchestration] Incoming threads: ${(threads ?? []).length}, total steps: ${incomingStepCount}`
    );

    const { id } = await params;

    // Check if orchestration exists first
    console.log("=== CHECKING IF ORCHESTRATION EXISTS ===");
    console.log("Looking for ID:", id);

    const existingOrchestration = await prisma.orchestration.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
    });

    console.log("Existing orchestration found:", existingOrchestration ? "YES" : "NO");
    if (existingOrchestration) {
      console.log("Existing orchestration name:", existingOrchestration.name);
    }

    if (!existingOrchestration) {
      console.log("=== ORCHESTRATION NOT FOUND - RETURNING 404 ===");
      return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
    }

    const orchestration = await prisma.orchestration.update({
      where: {
        id: id,
        deleted_at: null,
      },
      data: {
        name,
        description: description || null,
        project_ids: JSON.stringify(projectIds),
        threads: JSON.stringify(threads),
      },
    });

    // Return the parsed values from database (already have projectIds and threads from body)
    let parsedProjectIds: string[] = [];
    let parsedThreads: any[] = [];

    try {
      parsedProjectIds = JSON.parse(orchestration.project_ids || "[]");
      if (!Array.isArray(parsedProjectIds)) parsedProjectIds = [];
    } catch (error) {
      console.error(
        `Error parsing project_ids for updated orchestration ${orchestration.id}:`,
        error
      );
      parsedProjectIds = [];
    }

    try {
      parsedThreads = JSON.parse(orchestration.threads || "[]");
      if (!Array.isArray(parsedThreads)) parsedThreads = [];
    } catch (error) {
      console.error(`Error parsing threads for updated orchestration ${orchestration.id}:`, error);
      parsedThreads = [];
    }

    return NextResponse.json({
      id: orchestration.id,
      name: orchestration.name,
      description: orchestration.description,
      projectIds: parsedProjectIds,
      threads: parsedThreads,
      isRunning: orchestration.is_running,
      createdAt: orchestration.created_at.toISOString(),
    });
  } catch (error) {
    console.error("Error updating orchestration:", error);
    return NextResponse.json({ error: "Failed to update orchestration" }, { status: 500 });
  }
}

// DELETE /api/admin/orchestrations/[id] - Delete orchestration (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    await prisma.orchestration.update({
      where: {
        id: id,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting orchestration:", error);
    return NextResponse.json({ error: "Failed to delete orchestration" }, { status: 500 });
  }
}
