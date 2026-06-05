import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { deleteRedditLink } from "@/lib/brand-directory/reddit-links-service";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/brand-directory/reddit-links/link/[linkId]
 * Delete a Reddit link by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const resolvedParams = await params;
    await deleteRedditLink(resolvedParams.linkId);

    return NextResponse.json({ message: "Link deleted successfully" });
  } catch (error) {
    console.error("Error deleting Reddit link:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
