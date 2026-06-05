import { prisma } from "@/lib/prisma";

/**
 * Active project keywords and brand display names (for HN / listening-style tasks).
 */
export async function loadProjectListeningTerms(projectId: string): Promise<string[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    include: {
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });
  if (!project) return [];
  const kw = project.keywords.map((k) => k.keyword.trim()).filter(Boolean);
  const br = project.brands.map((b) => b.brand_name.trim()).filter(Boolean);
  return [...new Set([...kw, ...br])];
}
