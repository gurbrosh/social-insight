import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { generateId } from "@/lib/utils/ulid";

export const dynamic = "force-dynamic";

// GET /api/admin/orchestrations - Get all orchestrations
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

    const orchestrations = await prisma.orchestration.findMany({
      where: { deleted_at: null },
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
          take: 1, // Get the latest execution
        },
      },
      orderBy: { created_at: "desc" },
    });

    // Transform the data to match the expected format
    const transformedOrchestrations = orchestrations.map((orch) => {
      let projectIds: string[] = [];
      let threads: any[] = [];

      try {
        projectIds = JSON.parse(orch.project_ids || "[]");
        if (!Array.isArray(projectIds)) projectIds = [];
      } catch (error) {
        console.error(`Error parsing project_ids for orchestration ${orch.id}:`, error);
        projectIds = [];
      }

      try {
        threads = JSON.parse(orch.threads || "[]");
        if (!Array.isArray(threads)) threads = [];
      } catch (error) {
        console.error(`Error parsing threads for orchestration ${orch.id}:`, error);
        threads = [];
      }

      return {
        id: orch.id,
        name: orch.name,
        description: orch.description,
        projectIds,
        threads,
        isRunning: orch.is_running,
        createdAt: orch.created_at.toISOString(),
        lastExecution: orch.executions[0]
          ? {
              id: orch.executions[0].id,
              status: orch.executions[0].status,
              startedAt: orch.executions[0].started_at?.toISOString(),
              completedAt: orch.executions[0].completed_at?.toISOString(),
            }
          : null,
      };
    });

    return NextResponse.json(transformedOrchestrations);
  } catch (error) {
    console.error("Error fetching orchestrations:", error);
    return NextResponse.json({ error: "Failed to fetch orchestrations" }, { status: 500 });
  }
}

// POST /api/admin/orchestrations - Create new orchestration
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
    const { name, description, projectIds, threads } = body;

    if (!name || !projectIds || !threads) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const orchestration = await prisma.orchestration.create({
      data: {
        id: generateId(),
        name,
        description: description || null,
        project_ids: JSON.stringify(projectIds),
        threads: JSON.stringify(threads),
        user_id: session.user.id,
      },
    });

    // Parse the values from database for response (reuse variables from body since they're the same)
    let parsedProjectIds: string[] = [];
    let parsedThreads: any[] = [];

    try {
      parsedProjectIds = JSON.parse(orchestration.project_ids || "[]");
      if (!Array.isArray(parsedProjectIds)) parsedProjectIds = [];
    } catch (error) {
      console.error(`Error parsing project_ids for new orchestration ${orchestration.id}:`, error);
      parsedProjectIds = [];
    }

    try {
      parsedThreads = JSON.parse(orchestration.threads || "[]");
      if (!Array.isArray(parsedThreads)) parsedThreads = [];
    } catch (error) {
      console.error(`Error parsing threads for new orchestration ${orchestration.id}:`, error);
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
    console.error("Error creating orchestration:", error);
    return NextResponse.json({ error: "Failed to create orchestration" }, { status: 500 });
  }
}
