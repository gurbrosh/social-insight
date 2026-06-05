"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolderTree, Sparkles, List } from "lucide-react";
import { ReactNode } from "react";

interface BrandDirectoryTabsProps {
  taxonomyContent: ReactNode;
  discoverContent: ReactNode;
  brandsContent: ReactNode;
}

export function BrandDirectoryTabs({
  taxonomyContent,
  discoverContent,
  brandsContent,
}: BrandDirectoryTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("tab") || "taxonomy";

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "taxonomy") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    // Preserve other search params (for brands tab)
    const newUrl = params.toString() ? `?${params.toString()}` : "";
    router.push(`/admin/brand-directory${newUrl}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="taxonomy" className="flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          Taxonomy
        </TabsTrigger>
        <TabsTrigger value="discover" className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Discover Brands
        </TabsTrigger>
        <TabsTrigger value="brands" className="flex items-center gap-2">
          <List className="h-4 w-4" />
          Browse Brands
        </TabsTrigger>
      </TabsList>

      <TabsContent value="taxonomy" className="mt-6">
        {taxonomyContent}
      </TabsContent>

      <TabsContent value="discover" className="mt-6">
        {discoverContent}
      </TabsContent>

      <TabsContent value="brands" className="mt-6">
        {brandsContent}
      </TabsContent>
    </Tabs>
  );
}
