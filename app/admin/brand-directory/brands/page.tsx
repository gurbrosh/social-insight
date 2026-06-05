import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { BrandDirectoryPanel } from "@/components/admin/brand-directory/BrandDirectoryPanel";

export const dynamic = "force-dynamic";

async function BrandsPageContent({
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
  const taxonomies = await prisma.businessTaxonomy.findMany({
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Brand Directory</h1>
        <p className="text-muted-foreground">Browse and manage the brand directory</p>
      </div>

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
    </div>
  );
}

export default function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    taxonomyId?: string;
    brandStage?: string;
    search?: string;
  }>;
}) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BrandsPageContent searchParams={searchParams} />
    </Suspense>
  );
}
