import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const dynamic = "force-dynamic";

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = signUpSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { email, password } = validationResult.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with default user role
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          emailVerified: new Date(), // Mark as verified since we'll auto-login
        },
      });

      // Create user profile
      await tx.userProfile.create({
        data: {
          user_id: newUser.id,
        },
      });

      // Assign default user role
      const userRole = await tx.role.findUnique({
        where: { name: "user" },
      });

      if (userRole) {
        await tx.userRole.create({
          data: {
            user_id: newUser.id,
            role_id: userRole.id,
          },
        });
      }

      return newUser;
    });

    return NextResponse.json({
      success: true,
      message: "Account created successfully.",
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch {
    console.error("Sign up error:");
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
