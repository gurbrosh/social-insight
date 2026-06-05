import { prisma } from "@/lib/prisma";

/**
 * Resolve an active project id from its display name (first match if duplicates exist).
 */
export async function findProjectIdByName(projectName: string): Promise<string | null> {
  const trimmed = projectName.trim();
  if (!trimmed) return null;

  const project = await prisma.project.findFirst({
    where: {
      name: trimmed,
      deleted_at: null,
    },
    select: { id: true },
  });
  return project?.id ?? null;
}
