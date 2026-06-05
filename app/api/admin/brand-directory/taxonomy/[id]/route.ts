import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateTaxonomySchema = z.object({
  category: z.string().min(1).optional(),
  subcategory: z.string().min(1).optional(),
  sub_subcategory: z.string().min(1).optional(),
});

/**
 * GET /api/admin/brand-directory/taxonomy/[id]
 * Get taxonomy details
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const taxonomy = await prisma.businessTaxonomy.findUnique({
      where: {
        id: resolvedParams.id,
        deleted_at: null,
      },
      include: {
        _count: {
          select: {
            brands: {
              where: { deleted_at: null },
            },
          },
        },
      },
    });

    if (!taxonomy) {
      return NextResponse.json({ error: "Taxonomy not found" }, { status: 404 });
    }

    return NextResponse.json({ taxonomy });
  } catch (error) {
    console.error("Error fetching taxonomy:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/brand-directory/taxonomy/[id]
 * Update taxonomy entry
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = updateTaxonomySchema.parse(body);

    // Check if taxonomy exists
    const existing = await prisma.businessTaxonomy.findUnique({
      where: { id: resolvedParams.id, deleted_at: null },
    });

    if (!existing) {
      return NextResponse.json({ error: "Taxonomy not found" }, { status: 404 });
    }

    // Check if updated values would create a duplicate
    const category = validatedData.category ?? existing.category;
    const subcategory = validatedData.subcategory ?? existing.subcategory;
    const sub_subcategory = validatedData.sub_subcategory ?? existing.sub_subcategory;

    if (
      category !== existing.category ||
      subcategory !== existing.subcategory ||
      sub_subcategory !== existing.sub_subcategory
    ) {
      const duplicate = await prisma.businessTaxonomy.findFirst({
        where: {
          category,
          subcategory,
          sub_subcategory,
          deleted_at: null,
          id: { not: resolvedParams.id },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: "Taxonomy entry with these values already exists" },
          { status: 400 }
        );
      }
    }

    const taxonomy = await prisma.businessTaxonomy.update({
      where: { id: resolvedParams.id },
      data: {
        category: validatedData.category,
        subcategory: validatedData.subcategory,
        sub_subcategory: validatedData.sub_subcategory,
      },
    });

    return NextResponse.json({ taxonomy });
  } catch (error) {
    console.error("Error updating taxonomy:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/brand-directory/taxonomy/[id]
 * Soft delete taxonomy entry
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permission
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if taxonomy exists
    const existing = await prisma.businessTaxonomy.findUnique({
      where: { id: resolvedParams.id, deleted_at: null },
      include: {
        _count: {
          select: {
            brands: {
              where: { deleted_at: null },
            },
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Taxonomy not found" }, { status: 404 });
    }

    // Check if there are brands using this taxonomy
    if (existing._count.brands > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete taxonomy: ${existing._count.brands} brand(s) are using this category`,
        },
        { status: 400 }
      );
    }

    // Soft delete
    await prisma.businessTaxonomy.update({
      where: { id: resolvedParams.id },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ message: "Taxonomy deleted successfully" });
  } catch (error) {
    console.error("Error deleting taxonomy:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
