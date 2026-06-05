import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createRecipeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  timezone: z.string().default("UTC"),
  is_active: z.boolean().default(false),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Try to fetch recipes with steps, but handle missing table gracefully
    try {
      if (!prisma.orchestrationRecipe) {
        console.log("OrchestrationRecipe model not found on Prisma client");
        return NextResponse.json({ recipes: [] });
      }

      const recipes = await prisma.orchestrationRecipe.findMany({
        where: { deleted_at: null },
        include: {
          steps: {
            where: { deleted_at: null },
            include: {
              orchestration: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
              skipConfigurations: {
                include: {
                  skipStep: {
                    select: {
                      id: true,
                      sequence: true,
                      orchestration: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
              _count: {
                select: {
                  timerTasks: {
                    where: {
                      deleted_at: null,
                      status: "PENDING",
                    },
                  },
                },
              },
            },
            orderBy: { sequence: "asc" },
          },
        },
        orderBy: { created_at: "desc" },
      });

      return NextResponse.json({ recipes });
    } catch (error) {
      // Catch ALL errors and return empty array - table might not exist yet
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("Error fetching recipes (returning empty array):", {
        error: errorMessage.substring(0, 200),
      });
      console.error("Full error fetching recipes:", error);
      return NextResponse.json({ recipes: [] });
    }
  } catch (error) {
    // Catch any other errors (auth, etc.) and return error response
    console.error("Error fetching recipes:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = createRecipeSchema.parse(body);

    const { ulid: generateUlid } = await import("ulid");

    // Create recipe (without steps - they'll be added separately)
    const recipe = await prisma.orchestrationRecipe.create({
      data: {
        id: generateUlid(),
        name: validatedData.name,
        description: validatedData.description || null,
        user_id: session.user.id,
        timezone: validatedData.timezone,
        is_active: validatedData.is_active,
      },
      include: {
        steps: {
          orderBy: { sequence: "asc" },
        },
      },
    });

    return NextResponse.json({ recipe }, { status: 201 });
  } catch (error) {
    console.error("Error creating recipe:", error);

    // Check if it's a missing table error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = String(error);

    const isTableNotFoundError =
      errorMessage.includes("no such table") ||
      errorMessage.includes("does not exist") ||
      errorMessage.includes("Unknown table") ||
      (errorMessage.includes("Table") && errorMessage.includes("doesn't exist")) ||
      errorMessage.includes("Cannot find model") ||
      errorMessage.includes("Unknown model") ||
      (errorMessage.includes("Property") && errorMessage.includes("does not exist")) ||
      errorString.includes("no such table") ||
      errorString.includes("does not exist") ||
      errorString.includes("Unknown table") ||
      (errorString.includes("Table") && errorString.includes("doesn't exist")) ||
      errorString.includes("Cannot find model") ||
      errorString.includes("Unknown model") ||
      (errorString.includes("Property") && errorString.includes("does not exist"));

    if (isTableNotFoundError) {
      console.log("OrchestrationRecipe table not found - please run migrations");
      return NextResponse.json(
        { error: "Database table not found. Please run: npx prisma migrate dev" },
        { status: 503 }
      );
    }

    if (error instanceof z.ZodError) {
      console.error("Validation error:", error.issues);
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
