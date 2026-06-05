import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

const protectedRoles = ["user", "admin"];

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

    const { id: roleId } = await params;

    // Find the role
    const role = await prisma.role.findUnique({
      where: {
        id: roleId,
        deleted_at: null,
      },
    });

    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Prevent deletion of protected roles
    if (protectedRoles.includes(role.name)) {
      return NextResponse.json({ error: `Cannot delete the "${role.name}" role` }, { status: 400 });
    }

    // Check if role has any users
    const userCount = await prisma.userRole.count({
      where: {
        role_id: roleId,
        deleted_at: null,
        user: {
          deleted_at: null,
        },
      },
    });

    if (userCount > 0) {
      return NextResponse.json(
        { error: "Cannot delete role with assigned users" },
        { status: 400 }
      );
    }

    // Soft delete the role
    await prisma.role.update({
      where: { id: roleId },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch {
    console.error("Delete role error:");
    return NextResponse.json({ error: "Failed to delete role" }, { status: 500 });
  }
}
