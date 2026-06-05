import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    // Verify the token
    let decoded;
    try {
      const secret = process.env.AUTH_SECRET;
      if (!secret) {
        throw new Error("AUTH_SECRET not configured");
      }
      decoded = jwt.verify(token, secret) as { userId: string; type: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
    }

    if (!decoded || decoded.type !== "reset") {
      return NextResponse.json({ error: "Invalid token type" }, { status: 400 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: {
        id: decoded.userId,
        deleted_at: null,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update the user's password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ message: "Password reset successfully" }, { status: 200 });
  } catch {
    console.error("Password reset error:");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
