import { prisma } from "@/lib/prisma";
import type { CampaignPrerequisiteResult } from "./types";

export async function checkCampaignPostBasedPrerequisites(
  projectId: string
): Promise<CampaignPrerequisiteResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: {
      my_product_name: true,
      my_product_focus_text: true,
    },
  });

  if (!project) {
    return { ok: false, code: "missing_product", message: "Project not found." };
  }

  const hasMyProduct =
    Boolean(project.my_product_name?.trim()) || Boolean(project.my_product_focus_text?.trim());

  if (!hasMyProduct) {
    return {
      ok: false,
      code: "missing_product",
      message:
        'Post-based candidates require "My product" on this project (name or focus text). Add it under project settings, then try again.',
    };
  }

  const defaultObjective = await prisma.responseObjective.findFirst({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { created_at: "asc" },
  });

  if (!defaultObjective) {
    return {
      ok: false,
      code: "missing_objective",
      message:
        "Post-based candidates require at least one response objective on this project. Add one under project settings.",
    };
  }

  return { ok: true };
}
