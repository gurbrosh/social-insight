import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TaxonomyTree } from "@/components/admin/brand-directory/TaxonomyTree";
import { BrandDiscoveryPanel } from "@/components/admin/brand-directory/BrandDiscoveryPanel";
import { BrandDirectoryPanel } from "@/components/admin/brand-directory/BrandDirectoryPanel";
import { BrandDirectoryTabs } from "@/components/admin/brand-directory/BrandDirectoryTabs";

export const dynamic = "force-dynamic";

async function TaxonomyTabContent() {
  const taxonomies = await (prisma as any).businessTaxonomy.findMany({
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
    (
      acc: Record<
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
      >,
      tax: any
    ) => {
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
        brandNames: tax.brands.map((b: { brand_name: string }) => b.brand_name),
      });
      return acc;
    },
    {}
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taxonomy Tree</CardTitle>
        <CardDescription>
          Total categories: {taxonomies.length} | Total brands:{" "}
          {taxonomies.reduce(
            (sum: number, tax: { _count: { brands: number } }) => sum + tax._count.brands,
            0
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div>Loading taxonomy...</div>}>
          <TaxonomyTree groupedTaxonomy={grouped} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

async function DiscoverTabContent() {
  const taxonomies = await (prisma as any).businessTaxonomy.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BrandDiscoveryPanel taxonomies={taxonomies} />
    </Suspense>
  );
}

async function BrandsTabContent({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    taxonomyId?: string;
    brandStage?: string;
    search?: string;
  }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const limit = 20;

  // Fetch taxonomies for filter dropdown
  const taxonomies = await (prisma as any).businessTaxonomy.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sub_subcategory: "asc" }],
  });

  return (
    <Suspense fallback={<div>Loading brands...</div>}>
      <BrandDirectoryPanel
        initialPage={page}
        initialTaxonomyId={
          params.taxonomyId && params.taxonomyId !== "" ? params.taxonomyId : undefined
        }
        initialBrandStage={params.brandStage as any}
        initialSearch={params.search}
        taxonomies={taxonomies}
        itemsPerPage={limit}
      />
    </Suspense>
  );
}

export default async function BrandDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    taxonomyId?: string;
    brandStage?: string;
    search?: string;
  }>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Brand Directory</h1>
        <p className="text-muted-foreground">
          Manage the brand directory, discover new brands, and browse existing brands
        </p>
      </div>

      <BrandDirectoryTabs
        taxonomyContent={
          <Suspense fallback={<div>Loading...</div>}>
            <TaxonomyTabContent />
          </Suspense>
        }
        discoverContent={
          <Suspense fallback={<div>Loading...</div>}>
            <DiscoverTabContent />
          </Suspense>
        }
        brandsContent={
          <Suspense fallback={<div>Loading...</div>}>
            <BrandsTabContent searchParams={searchParams} />
          </Suspense>
        }
      />
    </div>
  );
}
