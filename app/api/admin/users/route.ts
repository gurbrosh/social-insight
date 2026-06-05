import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { email, name, image, password, roles } = await request.json();
    console.log("Create user request:", { email, name, image, hasPassword: !!password, roles });

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with profile in transaction
    const user = await prisma.$transaction(async (tx) => {
      // Create user
      const newUser = await tx.user.create({
        data: {
          email,
          name: name || null,
          image: image || null,
          password: hashedPassword,
        },
      });

      // Assign roles if provided
      if (roles && roles.length > 0) {
        const roleRecords = await tx.role.findMany({
          where: {
            name: { in: roles },
            deleted_at: null,
          },
        });

        await tx.userRole.createMany({
          data: roleRecords.map((role) => ({
            user_id: newUser.id,
            role_id: role.id,
          })),
        });
      }

      return newUser;
    });

    return NextResponse.json({
      success: true,
      message: "User created successfully",
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    console.error("User creation error:", error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
