import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

const roleSchema = z.object({
  roleName: z.string(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;
    const body = await request.json();
    const validationResult = roleSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { roleName } = validationResult.data;

    // Find role
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Check if user already has this role
    const existingUserRole = await prisma.userRole.findFirst({
      where: {
        user_id: userId,
        role_id: role.id,
        deleted_at: null,
      },
    });

    if (existingUserRole) {
      return NextResponse.json({ error: "User already has this role" }, { status: 400 });
    }

    // Add role to user
    await prisma.userRole.create({
      data: {
        user_id: userId,
        role_id: role.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Role added successfully",
    });
  } catch {
    console.error("Add role error:");
    return NextResponse.json({ error: "Failed to add role" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;
    const body = await request.json();
    const validationResult = roleSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { roleName } = validationResult.data;

    // Prevent users from removing their own admin role
    if (userId === session.user.id && roleName === "admin") {
      return NextResponse.json({ error: "Cannot remove your own admin role" }, { status: 400 });
    }

    // Prevent removing last admin
    if (roleName === "admin") {
      const adminRole = await prisma.role.findUnique({
        where: { name: "admin" },
      });

      if (adminRole) {
        const adminCount = await prisma.userRole.count({
          where: {
            role_id: adminRole.id,
            deleted_at: null,
            user: {
              deleted_at: null,
            },
          },
        });

        if (adminCount <= 1) {
          return NextResponse.json({ error: "Cannot remove the last admin" }, { status: 400 });
        }
      }
    }

    // Find role
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Soft delete the user role
    await prisma.userRole.updateMany({
      where: {
        user_id: userId,
        role_id: role.id,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Role removed successfully",
    });
  } catch {
    console.error("Remove role error:");
    return NextResponse.json({ error: "Failed to remove role" }, { status: 500 });
  }
}
