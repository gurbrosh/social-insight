import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TaxonomyTree } from "@/components/admin/brand-directory/TaxonomyTree";

export const dynamic = "force-dynamic";

async function TaxonomyPageContent() {
  if (!prisma || !prisma.businessTaxonomy) {
    throw new Error("Prisma client not properly initialized. Please restart the dev server.");
  }

  const taxonomies = await prisma.businessTaxonomy.findMany({
    where: { deleted_at: null },
    include: {
      _count: {
        select: {
          brands: {
            where: { deleted_at: null },
          },
        },
      },
      brands: {
        where: { deleted_at: null },
        select: {
          brand_name: true,
        },
        orderBy: {
          brand_name: "asc",
        },
      },
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  // Group by category and subcategory, preserving full taxonomy data
  const grouped = taxonomies.reduce(
    (acc, tax) => {
      if (!acc[tax.category]) {
        acc[tax.category] = {};
      }
      if (!acc[tax.category][tax.subcategory]) {
        acc[tax.category][tax.subcategory] = [];
      }
      acc[tax.category][tax.subcategory].push({
        id: tax.id,
        category: tax.category,
        subcategory: tax.subcategory,
        sub_subcategory: tax.sub_subcategory,
        brandCount: tax._count.brands,
        brandNames: tax.brands.map((b) => b.brand_name),
      });
      return acc;
    },
    {} as Record<
      string,
      Record<
        string,
        Array<{
          id: string;
          category: string;
          subcategory: string;
          sub_subcategory: string;
          brandCount: number;
          brandNames: string[];
        }>
      >
    >
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Business Taxonomy</h1>
        <p className="text-muted-foreground">View and manage the business taxonomy categories</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Taxonomy Tree</CardTitle>
          <CardDescription>
            Total categories: {taxonomies.length} | Total brands:{" "}
            {taxonomies.reduce((sum, tax) => sum + tax._count.brands, 0)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div>Loading taxonomy...</div>}>
            <TaxonomyTree groupedTaxonomy={grouped} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TaxonomyPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TaxonomyPageContent />
    </Suspense>
  );
}
