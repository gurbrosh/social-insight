import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { deleteBrandRedditLink } from "@/lib/brand-directory/brand-reddit-links-service";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/brand-directory/brands/[id]/reddit-links/[linkId]
 * Delete a Reddit link
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await deleteBrandRedditLink(resolvedParams.linkId);

    return NextResponse.json({ message: "Reddit link deleted successfully" });
  } catch (error) {
    console.error("Error deleting brand Reddit link:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
