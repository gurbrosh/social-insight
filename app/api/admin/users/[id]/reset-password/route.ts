import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import jwt from "jsonwebtoken";
import { sendEmail, getPasswordResetEmailTemplate } from "@/lib/email/email";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Check admin authentication
    const session = await auth();
    if (!session?.user || !(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId } = await params;

    // Find user
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        deleted_at: null,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Generate reset token (1 hour expiry)
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET not configured");
    }

    const resetToken = jwt.sign({ userId: user.id, type: "reset" }, secret, { expiresIn: "1h" });

    // Send password reset email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const emailTemplate = getPasswordResetEmailTemplate(resetToken, appUrl);
    await sendEmail({
      ...emailTemplate,
      to: user.email,
    });

    return NextResponse.json({
      success: true,
      message: "Password reset link sent",
    });
  } catch {
    console.error("Password reset error:");
    return NextResponse.json({ error: "Failed to send password reset" }, { status: 500 });
  }
}
