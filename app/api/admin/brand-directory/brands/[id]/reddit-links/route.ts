import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import {
  getRedditLinksForBrand,
  addBrandRedditLinks,
  updateBrandRedditLinks,
} from "@/lib/brand-directory/brand-reddit-links-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const redditLinkSchema = z.object({
  url: z.string().url("Invalid URL format"),
});

const addLinksSchema = z.object({
  links: z.array(redditLinkSchema).min(1, "At least one link is required"),
});

const updateLinksSchema = z.object({
  links: z.array(z.string().url("Invalid URL format")),
});

/**
 * GET /api/admin/brand-directory/brands/[id]/reddit-links
 * Get all Reddit links for a brand
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const links = await getRedditLinksForBrand(resolvedParams.id);

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error fetching brand Reddit links:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/brand-directory/brands/[id]/reddit-links
 * Add Reddit links to a brand
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();
    const validated = addLinksSchema.parse(body);

    const urls = validated.links.map((link) => link.url);
    const createdLinks = await addBrandRedditLinks(resolvedParams.id, urls);

    return NextResponse.json({ links: createdLinks });
  } catch (error) {
    console.error("Error adding brand Reddit links:", error);
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
 * PUT /api/admin/brand-directory/brands/[id]/reddit-links
 * Update Reddit links for a brand (replaces existing links)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();
    const validated = updateLinksSchema.parse(body);

    const links = await updateBrandRedditLinks(resolvedParams.id, validated.links);

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Error updating brand Reddit links:", error);
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
