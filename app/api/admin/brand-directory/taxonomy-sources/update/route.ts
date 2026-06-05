import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  linkId: z.string(),
  linkType: z.enum(["INFLUENCER", "REDDIT", "OTHER_SOURCE"]),
  url: z.string().url(),
  name: z.string().optional().nullable(),
});

/**
 * PUT /api/admin/brand-directory/taxonomy-sources/update
 * Update a taxonomy source link
 */
export async function PUT(request: NextRequest) {
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
    const validated = updateSchema.parse(body);
    const { linkId, linkType, url, name } = validated;

    let updated;
    if (linkType === "INFLUENCER") {
      updated = await prisma.taxonomyInfluencerLink.update({
        where: { id: linkId },
        data: {
          url: url.trim(),
          channel_name: name?.trim() || null,
        },
      });
    } else if (linkType === "REDDIT") {
      updated = await prisma.taxonomyRedditLink.update({
        where: { id: linkId },
        data: {
          url: url.trim(),
        },
      });
    } else if (linkType === "OTHER_SOURCE") {
      updated = await prisma.taxonomyOtherSourceLink.update({
        where: { id: linkId },
        data: {
          url: url.trim(),
          channel_name: name?.trim() || null,
        },
      });
    } else {
      return NextResponse.json({ error: "Invalid link type" }, { status: 400 });
    }

    return NextResponse.json({ success: true, link: updated });
  } catch (error) {
    console.error("Error updating taxonomy source:", error);
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
