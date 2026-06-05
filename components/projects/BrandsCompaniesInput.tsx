"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Brand {
  name: string;
  selected: boolean;
}

interface Source {
  name: string;
  selected: boolean;
}

interface BrandsCompaniesInputProps {
  keywords: string[];
  brands: Brand[];
  onBrandsChange: (brands: Brand[]) => void;
  sources: Source[];
  onSourcesChange: (sources: Source[]) => void;
}

export function BrandsCompaniesInput({
  keywords,
  brands,
  onBrandsChange,
  sources,
  onSourcesChange,
}: BrandsCompaniesInputProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [manualBrandsInput, setManualBrandsInput] = useState("");

  const handleFindBrands = async () => {
    if (keywords.length === 0) {
      toast({
        title: "Keywords required",
        description: "Please add keywords first to find related brands and companies.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/projects/extract-brands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keywords }),
      });

      if (!response.ok) {
        throw new Error("Failed to extract brands");
      }

      const data = await response.json();
      const extractedBrands: Brand[] = data.brands.map((brand: string) => ({
        name: brand,
        selected: true, // Default to selected
      }));

      // Merge with existing brands, avoiding duplicates
      const existingBrandNames = new Set(brands.map((brand) => brand.name.toLowerCase()));
      const uniqueNewBrands = extractedBrands.filter(
        (brand) => !existingBrandNames.has(brand.name.toLowerCase())
      );

      const mergedBrands = [...brands, ...uniqueNewBrands];
      onBrandsChange(mergedBrands);

      toast({
        title: "Brands found",
        description: `Found ${extractedBrands.length} brands. Added ${uniqueNewBrands.length} new brand${uniqueNewBrands.length === 1 ? "" : "s"} to your list.`,
      });
    } catch (error) {
      console.error("Error extracting brands:", error);
      toast({
        title: "Error",
        description: "Failed to extract brands. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBrandToggle = (index: number, selected: boolean) => {
    const updatedBrands = [...brands];
    updatedBrands[index].selected = selected;
    onBrandsChange(updatedBrands);
  };

  const handleSelectAll = () => {
    const updatedBrands = brands.map((brand) => ({ ...brand, selected: true }));
    onBrandsChange(updatedBrands);
  };

  const handleUnselectAll = () => {
    const updatedBrands = brands.map((brand) => ({ ...brand, selected: false }));
    onBrandsChange(updatedBrands);
  };

  const handleAddManualBrands = () => {
    if (!manualBrandsInput.trim()) {
      toast({
        title: "No brands entered",
        description: "Please enter brand names separated by commas.",
        variant: "destructive",
      });
      return;
    }

    // Parse comma-separated brands
    const newBrands = manualBrandsInput
      .split(",")
      .map((brand) => brand.trim())
      .filter((brand) => brand.length > 0)
      .map((brand) => ({ name: brand, selected: true }));

    if (newBrands.length === 0) {
      toast({
        title: "No valid brands",
        description: "Please enter valid brand names separated by commas.",
        variant: "destructive",
      });
      return;
    }

    // Add new brands to existing list, avoiding duplicates
    const existingBrandNames = new Set(brands.map((brand) => brand.name.toLowerCase()));
    const uniqueNewBrands = newBrands.filter(
      (brand) => !existingBrandNames.has(brand.name.toLowerCase())
    );

    if (uniqueNewBrands.length === 0) {
      toast({
        title: "No new brands",
        description: "All entered brands already exist in the list.",
        variant: "destructive",
      });
      return;
    }

    const updatedBrands = [...brands, ...uniqueNewBrands];
    onBrandsChange(updatedBrands);
    setManualBrandsInput("");

    toast({
      title: "Brands added",
      description: `Added ${uniqueNewBrands.length} new brand${uniqueNewBrands.length === 1 ? "" : "s"} to the list.`,
    });
  };

  const selectedCount = brands.filter((brand) => brand.selected).length;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSourceToggle = (index: number, selected: boolean) => {
    const updatedSources = [...sources];
    updatedSources[index].selected = selected;
    onSourcesChange(updatedSources);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSelectAllSources = () => {
    const updatedSources = sources.map((source) => ({ ...source, selected: true }));
    onSourcesChange(updatedSources);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleUnselectAllSources = () => {
    const updatedSources = sources.map((source) => ({ ...source, selected: false }));
    onSourcesChange(updatedSources);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const selectedSourcesCount = sources.filter((source) => source.selected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Related Brands & Companies</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          Use this section to find brands and companies that relevant to the keywords you chose.
          This could be related/ competing/ partnering products, platforms or companies that we
          should listen on, For example: ChatGPT, Google, Facebook. Use &apos;AI Find&apos; to find
          initial relevant results.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFindBrands}
            disabled={isLoading || keywords.length === 0}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            AI Find
          </Button>
          {brands.length > 0 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="flex items-center gap-2"
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnselectAll}
                className="flex items-center gap-2"
              >
                Unselect All
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {brands.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>
              Click &quot;AI Find&quot; to discover brands and companies related to your keywords,
              or add them manually below.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {selectedCount} of {brands.length} brands selected
              </span>
              <span>Uncheck brands you don&apos;t want to monitor</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
              {brands.map((brand, index) => (
                <div key={index} className="flex items-center space-x-2 p-2 border rounded-lg">
                  <Checkbox
                    id={`brand-${index}`}
                    checked={brand.selected}
                    onCheckedChange={(checked) => handleBrandToggle(index, checked === true)}
                  />
                  <Label
                    htmlFor={`brand-${index}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                  >
                    {brand.name}
                  </Label>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Manual brand input - moved below the table */}
        <div className="space-y-2">
          <Label htmlFor="manual-brands">Add Brands Manually</Label>
          <div className="flex gap-2">
            <Input
              id="manual-brands"
              placeholder="Enter brand names separated by commas (e.g., Apple, Google, Microsoft)"
              value={manualBrandsInput}
              onChange={(e) => setManualBrandsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddManualBrands();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddManualBrands}
              disabled={!manualBrandsInput.trim()}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Sources component
interface SourcesInputProps {
  sources: Source[];
  onSourcesChange: (sources: Source[]) => void;
}

export function SourcesInput({ sources, onSourcesChange }: SourcesInputProps) {
  const handleSourceToggle = (index: number, selected: boolean) => {
    const updatedSources = [...sources];
    updatedSources[index].selected = selected;
    onSourcesChange(updatedSources);
  };

  const handleSelectAllSources = () => {
    const updatedSources = sources.map((source) => ({ ...source, selected: true }));
    onSourcesChange(updatedSources);
  };

  const handleUnselectAllSources = () => {
    const updatedSources = sources.map((source) => ({ ...source, selected: false }));
    onSourcesChange(updatedSources);
  };

  const selectedSourcesCount = sources.filter((source) => source.selected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Sources</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectAllSources}
            className="flex items-center gap-2"
          >
            Select All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUnselectAllSources}
            className="flex items-center gap-2"
          >
            Unselect All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {selectedSourcesCount} of {sources.length} sources selected
          </span>
          <span>Uncheck sources you don&apos;t want to monitor</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sources.map((source, index) => (
            <div key={index} className="flex items-center space-x-2 p-2 border rounded-lg">
              <Checkbox
                id={`source-${index}`}
                checked={source.selected}
                onCheckedChange={(checked) => handleSourceToggle(index, checked === true)}
              />
              <Label
                htmlFor={`source-${index}`}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
              >
                {source.name}
              </Label>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
