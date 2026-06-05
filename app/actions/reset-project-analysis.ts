"use server";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { purgeProjectAnalysis } from "@/lib/projects/purge-service";

export async function resetProjectAnalysisAction(projectId: string) {
  console.log("[resetProjectAnalysisAction] invoked", { projectId });

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" } as const;
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    return { success: false, error: "Forbidden" } as const;
  }

  if (!projectId) {
    return { success: false, error: "Project ID is required" } as const;
  }

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" } as const;
    }

    const deleted = await purgeProjectAnalysis(projectId);

    return {
      success: true,
      projectId,
      projectName: project.name,
      deleted,
      message: "Analysis progress reset successfully",
    } as const;
  } catch (error) {
    console.error("[resetProjectAnalysisAction] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset analysis progress",
    } as const;
  }
}
