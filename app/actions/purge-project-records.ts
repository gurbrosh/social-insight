"use server";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { purgeProjectRecords } from "@/lib/projects/purge-service";

export async function purgeProjectRecordsAction(projectId: string) {
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

    const deleted = await purgeProjectRecords(projectId);

    return {
      success: true,
      projectId,
      projectName: project.name,
      deleted,
    } as const;
  } catch (error) {
    console.error("[purgeProjectRecordsAction] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove project records",
    } as const;
  }
}
