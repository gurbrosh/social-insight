import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { deleteInfluencerLink } from "@/lib/brand-directory/taxonomy-influencer-links-service";
import { deleteRedditLink } from "@/lib/brand-directory/reddit-links-service";
import { deleteOtherSourceLink } from "@/lib/brand-directory/taxonomy-other-source-links-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  linkId: z.string(),
  linkType: z.enum(["INFLUENCER", "REDDIT", "OTHER_SOURCE"]),
});

/**
 * DELETE /api/admin/brand-directory/taxonomy-sources/delete
 * Delete a taxonomy source link
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validated = deleteSchema.parse(body);
    const { linkId, linkType } = validated;

    if (linkType === "INFLUENCER") {
      await deleteInfluencerLink(linkId);
    } else if (linkType === "REDDIT") {
      await deleteRedditLink(linkId);
    } else if (linkType === "OTHER_SOURCE") {
      await deleteOtherSourceLink(linkId);
    } else {
      return NextResponse.json({ error: "Invalid link type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting taxonomy source:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
