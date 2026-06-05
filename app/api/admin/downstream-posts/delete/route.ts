import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { auth } from "@/lib/auth";
import { z } from "zod";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

const deleteDownstreamPostsSchema = z.object({
  deleteType: z.enum(["test", "production", "all"]),
  confirmText: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permissions
    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse and validate request body
    const body = await request.json();
    const { deleteType } = deleteDownstreamPostsSchema.parse(body);

    // Build where clause based on delete type
    const whereClause: any = {};

    if (deleteType === "test") {
      whereClause.isTest = true;
    } else if (deleteType === "production") {
      whereClause.isTest = false;
    }
    // For "all", we don't add any additional filters

    // Get count before deletion for response
    const countBefore = await prisma.downstreamPost.count({ where: whereClause });

    if (countBefore === 0) {
      return NextResponse.json({
        success: true,
        message: `No ${deleteType === "all" ? "" : deleteType + " "}downstream posts found to delete`,
        deletedCount: 0,
      });
    }

    // Perform hard delete
    // NOTE: Downstream posts are intermediate records used for scraper dependencies
    // Deleting them doesn't affect actual posts or theme evaluations, so cache is NOT cleared
    const result = await prisma.downstreamPost.deleteMany({
      where: whereClause,
    });

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${result.count} ${deleteType === "all" ? "" : deleteType + " "}downstream posts`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Error deleting downstream posts:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
