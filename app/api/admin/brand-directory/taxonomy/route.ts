import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createTaxonomySchema = z.object({
  category: z.string().min(1, "Category is required"),
  subcategory: z.string().min(1, "Subcategory is required"),
  sub_subcategory: z.string().min(1, "Sub-subcategory is required"),
});

const updateTaxonomySchema = z.object({
  category: z.string().min(1).optional(),
  subcategory: z.string().min(1).optional(),
  sub_subcategory: z.string().min(1).optional(),
});

/**
 * GET /api/admin/brand-directory/taxonomy
 * List all taxonomy categories
 */
export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const subcategory = searchParams.get("subcategory");

    const where: any = {
      deleted_at: null,
    };

    if (category) {
      where.category = category;
    }

    if (subcategory) {
      where.subcategory = subcategory;
    }

    const taxonomies = await prisma.businessTaxonomy.findMany({
      where,
      include: {
        _count: {
          select: {
            brands: {
              where: { deleted_at: null },
            },
          },
        },
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
    });

    return NextResponse.json({ taxonomies });
  } catch (error) {
    console.error("Error fetching taxonomy:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/brand-directory/taxonomy
 * Create a new taxonomy entry
 */
export async function POST(request: NextRequest) {
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
    const validatedData = createTaxonomySchema.parse(body);

    // Check if taxonomy already exists
    const existing = await prisma.businessTaxonomy.findFirst({
      where: {
        category: validatedData.category,
        subcategory: validatedData.subcategory,
        sub_subcategory: validatedData.sub_subcategory,
        deleted_at: null,
      },
    });

    if (existing) {
      return NextResponse.json({ error: "Taxonomy entry already exists" }, { status: 400 });
    }

    const taxonomy = await prisma.businessTaxonomy.create({
      data: {
        category: validatedData.category,
        subcategory: validatedData.subcategory,
        sub_subcategory: validatedData.sub_subcategory,
      },
    });

    return NextResponse.json({ taxonomy }, { status: 201 });
  } catch (error) {
    console.error("Error creating taxonomy:", error);
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
