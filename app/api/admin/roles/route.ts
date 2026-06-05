import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name must be less than 50 characters")
    .regex(
      /^[a-z0-9_-]+$/,
      "Role name must contain only lowercase letters, numbers, hyphens, and underscores"
    ),
});

export async function GET(_request: NextRequest) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const roles = await prisma.role.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        id: "asc",
      },
      include: {
        _count: {
          select: {
            users: {
              where: {
                deleted_at: null,
                user: {
                  deleted_at: null,
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ roles });
  } catch {
    console.error("Get roles error:");
    return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = createRoleSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { name } = validationResult.data;

    // Check if role already exists
    const existingRole = await prisma.role.findUnique({
      where: { name },
    });

    if (existingRole) {
      return NextResponse.json({ error: "Role already exists" }, { status: 400 });
    }

    // Create new role
    const role = await prisma.role.create({
      data: { name },
    });

    return NextResponse.json({
      success: true,
      role,
    });
  } catch {
    console.error("Create role error:");
    return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
  }
}
