import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { auth } from "@/lib/auth";
import { z } from "zod";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

const deletePostsSchema = z.object({
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
    const { deleteType } = deletePostsSchema.parse(body);

    // Build where clause based on delete type
    const whereClause: any = {};

    if (deleteType === "test") {
      whereClause.isTest = true;
    } else if (deleteType === "production") {
      whereClause.isTest = false;
    }
    // For "all", we don't add any additional filters

    // Get count before deletion for response
    const countBefore = await prisma.post.count({ where: whereClause });

    if (countBefore === 0) {
      return NextResponse.json({
        success: true,
        message: `No ${deleteType === "all" ? "" : deleteType + " "}posts found to delete`,
        deletedCount: 0,
      });
    }

    // Perform hard delete
    const result = await prisma.post.deleteMany({
      where: whereClause,
    });

    // Do NOT reset analysis progress (lastChatterPostId, lastThemesPostId, etc.) when deleting posts.
    // Resetting would force a full re-analysis of the entire project. Partial deletes (e.g. clearing
    // only YouTube posts) should not re-run theme/chatter/sentiment for Reddit/X/LinkedIn. If the
    // user wants a full re-analysis they can use the explicit "Reset analysis" action.

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${result.count} ${deleteType === "all" ? "" : deleteType + " "}posts`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Error deleting posts:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
