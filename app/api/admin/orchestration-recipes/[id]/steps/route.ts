import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { createStepSchema } from "@/lib/validation/orchestration-recipe-step";
import { createRecipeStepForUser } from "@/lib/orchestration-recipes/step-service";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function applySkipConfiguration(
  recipeId: string,
  stepId: string,
  skipStepIds?: string[] | null
) {
  const ids = (skipStepIds ?? []).filter((id) => id !== stepId);

  await prisma.orchestrationRecipeStepSkip.deleteMany({
    where: { step_id: stepId },
  });

  if (ids.length === 0) {
    return;
  }

  const validSteps = await prisma.orchestrationRecipeStep.findMany({
    where: {
      id: { in: ids },
      recipe_id: recipeId,
      deleted_at: null,
    },
    select: { id: true },
  });

  if (validSteps.length === 0) {
    return;
  }

  const { ulid: generateUlid } = await import("ulid");

  await prisma.orchestrationRecipeStepSkip.createMany({
    data: validSteps.map((step) => ({
      id: generateUlid(),
      step_id: stepId,
      skip_step_id: step.id,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieHeader = request.headers.get("cookie");
    console.log("[POST /steps] cookie header:", cookieHeader);
    console.log("[POST /steps] request cookies:", request.cookies.getAll());
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: recipeId } = await params;
    const body = await request.json();
    const validatedData = createStepSchema.parse(body);
    console.log("Creating recipe step payload:", validatedData);

    try {
      const step = await createRecipeStepForUser(session.user.id, recipeId, validatedData);
      return NextResponse.json({ step }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to create orchestration recipe step",
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error creating recipe step:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
