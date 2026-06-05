import { prisma } from "@/lib/prisma";

export async function assertProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, user_id: userId, deleted_at: null },
    select: { id: true },
  });
  return p != null;
}
