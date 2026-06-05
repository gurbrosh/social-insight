"use server";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { previewRecipeSchedule } from "@/lib/orchestration-recipe-service";

export async function previewRecipeScheduleAction(recipeId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" } as const;
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    return { success: false, error: "Forbidden" } as const;
  }

  try {
    const data = await previewRecipeSchedule(recipeId, { limit: 100 });
    return { success: true, data } as const;
  } catch (error) {
    console.error("[previewRecipeScheduleAction] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to preview schedule",
    } as const;
  }
}
