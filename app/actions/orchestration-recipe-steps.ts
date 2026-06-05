"use server";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createStepSchema } from "@/lib/validation/orchestration-recipe-step";
import { createRecipeStepForUser } from "@/lib/orchestration-recipes/step-service";

export async function createRecipeStepAction(recipeId: string, rawInput: unknown) {
  console.log("[createRecipeStepAction] invoked", { recipeId, rawInput });
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" } as const;
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    return { success: false, error: "Forbidden" } as const;
  }

  try {
    const validated = createStepSchema.parse(rawInput);
    await createRecipeStepForUser(session.user.id, recipeId, validated);
    return { success: true } as const;
  } catch (error) {
    console.error("[createRecipeStepAction] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create recipe step",
    } as const;
  }
}
