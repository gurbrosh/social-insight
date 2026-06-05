import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;
    const { email, name, image, password, roles } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (password && password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: {
        id: userId,
        deleted_at: null,
      },
    });

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if email is already taken by another user
    if (email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email },
      });

      if (emailExists && emailExists.id !== userId) {
        return NextResponse.json({ error: "Email is already taken" }, { status: 400 });
      }
    }

    // Update user in transaction
    const updatedUser = await prisma.$transaction(async (tx) => {
      // Prepare user update data
      const userUpdateData: {
        email: string;
        name: string | null;
        image: string | null;
        password?: string;
      } = {
        email,
        name: name || null,
        image: image || null,
      };

      // Hash password if provided
      if (password) {
        userUpdateData.password = await bcrypt.hash(password, 12);
      }

      // Update user
      const user = await tx.user.update({
        where: { id: userId },
        data: userUpdateData,
      });

      // Update roles if provided
      if (roles !== undefined) {
        // Remove existing roles
        await tx.userRole.updateMany({
          where: { user_id: userId },
          data: { deleted_at: new Date() },
        });

        // Add new roles
        if (roles.length > 0) {
          const roleRecords = await tx.role.findMany({
            where: {
              name: { in: roles },
              deleted_at: null,
            },
          });

          await tx.userRole.createMany({
            data: roleRecords.map((role) => ({
              user_id: userId,
              role_id: role.id,
            })),
          });
        }
      }

      return user;
    });

    return NextResponse.json({
      success: true,
      message: "User updated successfully",
      user: { id: updatedUser.id, email: updatedUser.email },
    });
  } catch (error) {
    console.error("User update error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
