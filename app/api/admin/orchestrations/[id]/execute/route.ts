import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { normalizeOrchestrationThreads } from "@/lib/orchestration-config-normalize";
import { prisma } from "@/lib/prisma";
import {
  orchestrationExecutor,
  type OrchestrationConfig,
} from "@/lib/orchestration-executor";

export const dynamic = "force-dynamic";

function sortedIds(ids: string[]): string {
  return [...ids].filter(Boolean).sort().join(",");
}

// POST /api/admin/orchestrations/[id]/execute - Execute orchestration
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    console.log("=== ORCHESTRATION EXECUTE API CALLED ===");
    console.log("Orchestration ID:", id);

    console.log("=== REQUEST BODY DEBUG ===");
    console.log("Request method:", request.method);
    console.log("Request headers:", Object.fromEntries(request.headers.entries()));

    const bodyText = await request.text();
    console.log("Raw request body:", bodyText);

    if (!bodyText) {
      return NextResponse.json(
        { error: "Orchestration configuration must be provided from UI" },
        { status: 400 }
      );
    }

    let body: { orchestration?: Record<string, unknown> };
    try {
      body = JSON.parse(bodyText);
      console.log("Parsed body:", JSON.stringify(body, null, 2));
    } catch (error) {
      console.error("JSON parse error:", error);
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    let orchestrationConfig = body.orchestration;

    if (!orchestrationConfig) {
      return NextResponse.json({ error: "Orchestration configuration required" }, { status: 400 });
    }

    if ((orchestrationConfig.id as string) !== id) {
      return NextResponse.json(
        { error: "Orchestration id in body must match URL" },
        { status: 400 }
      );
    }

    const saved = await prisma.orchestration.findUnique({
      where: { id, deleted_at: null },
      select: {
        project_ids: true,
        threads: true,
        name: true,
        description: true,
        is_running: true,
        created_at: true,
      },
    });

    if (!saved) {
      return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
    }

    let dbProjectIds: string[] = [];
    try {
      dbProjectIds = JSON.parse(saved.project_ids || "[]");
      if (!Array.isArray(dbProjectIds)) dbProjectIds = [];
    } catch {
      dbProjectIds = [];
    }

    const clientProjectIds = Array.isArray(orchestrationConfig.projectIds)
      ? (orchestrationConfig.projectIds as string[])
      : [];
    if (sortedIds(clientProjectIds) !== sortedIds(dbProjectIds)) {
      console.warn(
        `[Execute] Using saved project_ids from DB (not client payload). DB: [${dbProjectIds.join(", ")}]. Client had: [${clientProjectIds.join(", ")}]`
      );
    }

    const threadsForCount = Array.isArray(orchestrationConfig.threads)
      ? orchestrationConfig.threads
      : [];
    const requestStepCount = threadsForCount.reduce(
      (sum: number, t: { steps?: unknown[] }) => sum + (t.steps?.length ?? 0),
      0
    );

    if (requestStepCount === 0) {
      let threads: unknown[] = [];
      try {
        threads = JSON.parse(saved.threads || "[]");
        if (!Array.isArray(threads)) threads = [];
      } catch {
        threads = [];
      }
      type ThreadWithSteps = { steps?: unknown[] };
      const savedStepCount = (threads as ThreadWithSteps[]).reduce(
        (sum: number, t: ThreadWithSteps) => sum + (t.steps?.length ?? 0),
        0
      );
      if (savedStepCount > 0) {
        console.log(
          `[Execute] Request had 0 steps; using saved threads from DB (${savedStepCount} step(s))`
        );
        orchestrationConfig = {
          ...orchestrationConfig,
          id,
          name: saved.name,
          description: saved.description ?? undefined,
          projectIds: dbProjectIds,
          threads,
          isRunning: !!saved.is_running,
          createdAt: saved.created_at.toISOString(),
        };
      } else {
        orchestrationConfig = {
          ...orchestrationConfig,
          projectIds: dbProjectIds,
        };
      }
    } else {
      orchestrationConfig = {
        ...orchestrationConfig,
        projectIds: dbProjectIds,
      };
    }

    orchestrationConfig = {
      ...orchestrationConfig,
      threads: normalizeOrchestrationThreads(orchestrationConfig.threads as unknown),
    };

    console.log("=== USING CONFIG ===");
    console.log("Config:", JSON.stringify(orchestrationConfig, null, 2));

    const orchId = orchestrationConfig.id as string;

    // Always check the in-process lock first. DB is_running can lag behind the real run (race) or be
    // stale after a restart; without this, a second POST hits executeOrchestration and throws "already running".
    if (orchestrationExecutor.isOrchestrationRunningInMemory(orchId)) {
      return NextResponse.json(
        {
          error: `Orchestration "${saved.name ?? orchestrationConfig.name}" is already running. Wait for it to finish or stop it first.`,
          code: "ALREADY_RUNNING",
        },
        { status: 409 }
      );
    }

    if (saved.is_running) {
      await prisma.orchestration.update({
        where: { id: orchId },
        data: { is_running: false },
      });
      console.warn(
        `[Execute] Cleared stale is_running for orchestration ${orchId} (no in-memory run)`
      );
    }

    orchestrationExecutor
      .executeOrchestration(orchestrationConfig as unknown as OrchestrationConfig)
      .then((executionId) => {
        console.log(
          `Orchestration ${orchestrationConfig.id} completed with execution ID: ${executionId}`
        );
      })
      .catch((error) => {
        console.error(`Orchestration ${orchestrationConfig.id} failed:`, error);
      });

    return NextResponse.json({
      message: "Orchestration execution started",
      orchestrationId: orchestrationConfig.id,
    });
  } catch (error) {
    console.error("Error executing orchestration:", error);
    return NextResponse.json({ error: "Failed to execute orchestration" }, { status: 500 });
  }
}

// DELETE /api/admin/orchestrations/[id]/execute - Stop orchestration execution
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
    const orchestration = await prisma.orchestration.findUnique({
      where: {
        id: id,
        deleted_at: null,
      },
    });

    if (!orchestration) {
      return NextResponse.json({ error: "Orchestration not found" }, { status: 404 });
    }

    if (!orchestration.is_running) {
      return NextResponse.json({ error: "Orchestration is not running" }, { status: 400 });
    }

    await orchestrationExecutor.stopOrchestration(id);

    return NextResponse.json({
      message: "Orchestration execution stopped",
      orchestrationId: orchestration.id,
    });
  } catch (error) {
    console.error("Error stopping orchestration:", error);
    return NextResponse.json({ error: "Failed to stop orchestration" }, { status: 500 });
  }
}
