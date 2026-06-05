import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { BrandDiscoveryPanel } from "@/components/admin/brand-directory/BrandDiscoveryPanel";

export const dynamic = "force-dynamic";

async function DiscoverPageContent() {
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
        <h1 className="text-3xl font-bold">Brand Discovery</h1>
        <p className="text-muted-foreground">
          Use OpenAI to discover brands for taxonomy categories
        </p>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <BrandDiscoveryPanel taxonomies={taxonomies} />
      </Suspense>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DiscoverPageContent />
    </Suspense>
  );
}
