import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    // Get basic stats
    const userCount = await prisma.user.count({
      where: { deleted_at: null },
    });

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      stats: {
        users: userCount,
      },
    });
  } catch {
    console.error("Health check failed:");

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: "Database connection failed",
      },
      { status: 503 }
    );
  }
}
