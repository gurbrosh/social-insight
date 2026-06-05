import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  addRedditLinks,
  updateRedditLinks,
  RedditLinkInput,
} from "@/lib/brand-directory/reddit-links-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const redditLinkSchema = z.object({
  url: z.string().url("Invalid URL format"),
});

const addLinksSchema = z.object({
  links: z.array(redditLinkSchema).min(1, "At least one link is required"),
  category: z.string().min(1, "Category is required"),
  subcategory: z.string().nullable().optional(),
  sub_subcategory: z.string().nullable().optional(),
  taxonomy_id: z.string().optional(),
});

/**
 * POST /api/admin/brand-directory/reddit-links
 * Add Reddit links to a taxonomy node
 */
export async function POST(request: NextRequest) {
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
    const validated = addLinksSchema.parse(body);

    // Convert to RedditLinkInput format
    const linkInputs: RedditLinkInput[] = validated.links.map((link) => ({
      url: link.url,
      category: validated.category,
      subcategory: validated.subcategory ?? null,
      sub_subcategory: validated.sub_subcategory ?? null,
    }));

    const createdLinks = await addRedditLinks(linkInputs, validated.taxonomy_id);

    return NextResponse.json({ links: createdLinks });
  } catch (error) {
    console.error("Error adding Reddit links:", error);
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

/**
 * PUT /api/admin/brand-directory/reddit-links
 * Update Reddit links for a taxonomy node (replaces existing links)
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
    const validated = addLinksSchema.parse(body);

    // Convert to RedditLinkInput format
    const linkInputs: RedditLinkInput[] = validated.links.map((link) => ({
      url: link.url,
      category: validated.category,
      subcategory: validated.subcategory ?? null,
      sub_subcategory: validated.sub_subcategory ?? null,
    }));

    const updatedLinks = await updateRedditLinks(linkInputs, validated.taxonomy_id);

    return NextResponse.json({ links: updatedLinks });
  } catch (error) {
    console.error("Error updating Reddit links:", error);
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
