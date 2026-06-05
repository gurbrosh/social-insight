import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: { id: true, name: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const rows = await prisma.analysisTask.groupBy({
    by: ["step"],
    where: {
      project_id: projectId,
      deleted_at: null,
      state: "RUNNING",
    },
    _count: { _all: true },
  });

  const byStep: Record<"THEMES" | "CHATTER" | "NEWS" | "NETWORK" | "BLOG_NEWS_ANALYSIS", number> = {
    THEMES: 0,
    CHATTER: 0,
    NEWS: 0,
    NETWORK: 0,
    BLOG_NEWS_ANALYSIS: 0,
  };

  let totalRunning = 0;
  let otherStepsRunning = 0;

  for (const row of rows) {
    const n = row._count._all;
    totalRunning += n;
    if (row.step in byStep) {
      byStep[row.step as keyof typeof byStep] = n;
    } else {
      otherStepsRunning += n;
    }
  }

  return NextResponse.json({
    projectId: project.id,
    projectName: project.name,
    byStep,
    otherStepsRunning,
    totalRunning,
  });
}
