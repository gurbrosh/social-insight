"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Loader2,
  Sparkles,
  Save,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { AddBrandDialog } from "./AddBrandDialog";

interface Taxonomy {
  id: string;
  category: string;
  subcategory: string;
  sub_subcategory: string;
}

interface BrandDiscoveryPanelProps {
  taxonomies: Taxonomy[];
}

export function BrandDiscoveryPanel({ taxonomies }: BrandDiscoveryPanelProps) {
  const router = useRouter();
  const [taxonomyId, setTaxonomyId] = useState<string | undefined>(undefined);
  const [taxonomySearch, setTaxonomySearch] = useState<string>("");
  const [isTaxonomyDropdownOpen, setIsTaxonomyDropdownOpen] = useState<boolean>(false);
  const taxonomyDropdownRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number>(10);
  const [brandStage, setBrandStage] = useState<"ESTABLISHED" | "EMERGING" | "SMALL" | undefined>();
  const [saveToDatabase, setSaveToDatabase] = useState<boolean>(true);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [discoveredBrands, setDiscoveredBrands] = useState<any[]>([]);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [discoveryResult, setDiscoveryResult] = useState<{
    discovered: number;
    saved: number;
    duplicates: number;
    errors: number;
    stages?: number;
    brandsPerStage?: number;
  } | null>(null);
  const [isAddBrandDialogOpen, setIsAddBrandDialogOpen] = useState<boolean>(false);

  const selectedTaxonomy = taxonomies.find((t) => t.id === taxonomyId);

  // Close taxonomy dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        taxonomyDropdownRef.current &&
        !taxonomyDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTaxonomyDropdownOpen(false);
      }
    };

    if (isTaxonomyDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTaxonomyDropdownOpen]);

  const handleDiscover = async () => {
    if (!taxonomyId || taxonomyId === "") {
      toast({
        title: "Error",
        description: "Please select a taxonomy category",
        variant: "destructive",
      });
      return;
    }

    setIsDiscovering(true);
    setDiscoveredBrands([]);
    setProgressStatus("Initializing discovery...");
    setProgressPercent(5);
    setDiscoveryResult(null);

    try {
      // Step 1: Starting discovery
      setProgressStatus("Preparing discovery request...");
      setProgressPercent(10);

      // Step 2: API call (this is where most time is spent)
      setProgressStatus("Calling OpenAI API to discover brands...");
      setProgressPercent(20);

      const response = await fetch("/api/admin/brand-directory/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          taxonomyId,
          count,
          brandStage: brandStage || undefined,
          saveToDatabase,
        }),
      });

      // Update progress while waiting for response
      setProgressStatus("Waiting for OpenAI response...");
      setProgressPercent(40);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to discover brands");
      }

      // Step 3: Processing results
      setProgressStatus("Processing discovered brands...");
      setProgressPercent(60);

      if (saveToDatabase) {
        setProgressStatus("Generating keywords and saving brands to database...");
        setProgressPercent(80);

        // Set result summary
        setDiscoveryResult({
          discovered: data.discovered || 0,
          saved: data.saved || 0,
          duplicates: data.duplicates || 0,
          errors: data.errors?.length || 0,
          stages: data.stages,
          brandsPerStage: data.brandsPerStage,
        });

        setProgressStatus("Complete!");
        setProgressPercent(100);

        toast({
          title: "Discovery Complete",
          description: `Saved ${data.saved} new brands. ${data.duplicates || 0} duplicates skipped.`,
        });

        // Keep result visible, then refresh and clear
        setTimeout(() => {
          setIsDiscovering(false);
          router.refresh();
        }, 3000);
      } else {
        setDiscoveredBrands(data.brands || []);
        setProgressStatus("Complete!");
        setProgressPercent(100);
        toast({
          title: "Success",
          description: `Discovered ${data.brands?.length || 0} brands (not saved)`,
        });
        setTimeout(() => {
          setIsDiscovering(false);
          setProgressStatus("");
          setProgressPercent(0);
        }, 2000);
      }
    } catch (error) {
      console.error("Error discovering brands:", error);
      setProgressStatus("Error occurred");
      setProgressPercent(0);
      setDiscoveryResult(null);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to discover brands",
        variant: "destructive",
      });
      setIsDiscovering(false);
      setTimeout(() => {
        setProgressStatus("");
        setProgressPercent(0);
      }, 2000);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Discover Brands</CardTitle>
              <CardDescription>
                Use OpenAI to discover companies matching a taxonomy category
              </CardDescription>
            </div>
            <Button
              onClick={() => setIsAddBrandDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Brand
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="taxonomy">Taxonomy Category</Label>
            <div className="relative" ref={taxonomyDropdownRef}>
              <div className="flex items-center">
                <Input
                  id="taxonomy"
                  placeholder="Type to search taxonomy..."
                  value={
                    taxonomyId === undefined
                      ? taxonomySearch
                      : selectedTaxonomy
                        ? `${selectedTaxonomy.category} > ${selectedTaxonomy.subcategory} > ${selectedTaxonomy.sub_subcategory}`
                        : taxonomySearch
                  }
                  onChange={(e) => {
                    setTaxonomySearch(e.target.value);
                    setIsTaxonomyDropdownOpen(true);
                    // Clear selection if user starts typing
                    if (taxonomyId !== undefined) {
                      setTaxonomyId(undefined);
                    }
                  }}
                  onFocus={() => setIsTaxonomyDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setIsTaxonomyDropdownOpen(false);
                    }
                  }}
                  className="pr-8"
                />
                <ChevronDown className="absolute right-2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
              {isTaxonomyDropdownOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                  {taxonomies
                    .filter((tax) => {
                      if (!tax.id || tax.id.trim() === "") return false;
                      if (!taxonomySearch.trim()) return true;

                      // Fuzzy matching: split search into words and check if all words appear
                      const searchLower = taxonomySearch.toLowerCase().trim();
                      const searchWords = searchLower.split(/\s+/).filter((w) => w.length > 0);

                      // Build full taxonomy text for matching
                      const fullTaxonomyText =
                        `${tax.category} > ${tax.subcategory} > ${tax.sub_subcategory}`.toLowerCase();
                      const categoryLower = tax.category.toLowerCase();
                      const subcategoryLower = tax.subcategory.toLowerCase();
                      const subSubcategoryLower = tax.sub_subcategory.toLowerCase();

                      // Check if all search words appear in any part of the taxonomy
                      const allWordsMatch = searchWords.every((word) => {
                        return (
                          categoryLower.includes(word) ||
                          subcategoryLower.includes(word) ||
                          subSubcategoryLower.includes(word) ||
                          fullTaxonomyText.includes(word)
                        );
                      });

                      // Also check exact substring match for backward compatibility
                      const exactMatch =
                        categoryLower.includes(searchLower) ||
                        subcategoryLower.includes(searchLower) ||
                        subSubcategoryLower.includes(searchLower) ||
                        fullTaxonomyText.includes(searchLower);

                      return allWordsMatch || exactMatch;
                    })
                    .slice(0, 50) // Limit to 50 results for performance
                    .map((tax) => (
                      <div
                        key={tax.id}
                        className="p-1 cursor-pointer hover:bg-accent"
                        onClick={() => {
                          setTaxonomyId(tax.id);
                          setTaxonomySearch("");
                          setIsTaxonomyDropdownOpen(false);
                        }}
                      >
                        <div className="px-2 py-1.5 text-sm">
                          {tax.category} &gt; {tax.subcategory} &gt; {tax.sub_subcategory}
                        </div>
                      </div>
                    ))}
                  {taxonomySearch.trim() &&
                    taxonomies.filter((tax) => {
                      if (!tax.id || tax.id.trim() === "") return false;
                      const searchLower = taxonomySearch.toLowerCase();
                      return (
                        tax.category.toLowerCase().includes(searchLower) ||
                        tax.subcategory.toLowerCase().includes(searchLower) ||
                        tax.sub_subcategory.toLowerCase().includes(searchLower) ||
                        `${tax.category} > ${tax.subcategory} > ${tax.sub_subcategory}`
                          .toLowerCase()
                          .includes(searchLower)
                      );
                    }).length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No taxonomies found
                      </div>
                    )}
                </div>
              )}
            </div>
            {selectedTaxonomy && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedTaxonomy.category} &gt; {selectedTaxonomy.subcategory} &gt;{" "}
                {selectedTaxonomy.sub_subcategory}
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="count">Number of Brands</Label>
              <Input
                id="count"
                type="number"
                min="1"
                max="50"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value, 10) || 10)}
                disabled={isDiscovering}
              />
              <p className="text-xs text-muted-foreground">
                {brandStage === undefined
                  ? `Will discover ${Math.floor(count / 3)} brands per stage (${count} total across ESTABLISHED, EMERGING, SMALL)`
                  : `Between 1 and 50`}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brandStage">Brand Stage (Optional)</Label>
              <Select
                value={brandStage || "all"}
                onValueChange={(value) =>
                  setBrandStage(value === "all" ? undefined : (value as any))
                }
              >
                <SelectTrigger id="brandStage">
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  <SelectItem value="ESTABLISHED">Established</SelectItem>
                  <SelectItem value="EMERGING">Emerging</SelectItem>
                  <SelectItem value="SMALL">Small</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="saveToDatabase"
              checked={saveToDatabase}
              onCheckedChange={(checked) => setSaveToDatabase(checked === true)}
              disabled={isDiscovering}
            />
            <Label
              htmlFor="saveToDatabase"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Save to database automatically (with keywords)
            </Label>
          </div>

          <Button
            onClick={handleDiscover}
            disabled={isDiscovering || !taxonomyId}
            className="w-full"
          >
            {isDiscovering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {progressStatus || "Discovering brands..."}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Discover Brands
              </>
            )}
          </Button>

          {isDiscovering && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progressStatus}</span>
                <span className="text-muted-foreground">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          {discoveryResult && !isDiscovering && (
            <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-900 dark:text-green-100">
                <div className="space-y-1">
                  <div className="font-semibold">Discovery Complete!</div>
                  <div className="text-sm space-y-0.5">
                    <div>
                      ✅ <strong>{discoveryResult.saved}</strong> new brand
                      {discoveryResult.saved !== 1 ? "s" : ""} saved
                    </div>
                    {discoveryResult.duplicates > 0 && (
                      <div>
                        ⚠️ <strong>{discoveryResult.duplicates}</strong> duplicate
                        {discoveryResult.duplicates !== 1 ? "s" : ""} skipped
                      </div>
                    )}
                    {discoveryResult.errors > 0 && (
                      <div className="text-red-600 dark:text-red-400">
                        ❌ <strong>{discoveryResult.errors}</strong> error
                        {discoveryResult.errors !== 1 ? "s" : ""} occurred
                      </div>
                    )}
                    {discoveryResult.stages && discoveryResult.stages > 1 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Discovered {discoveryResult.brandsPerStage} brands per stage across{" "}
                        {discoveryResult.stages} stages
                      </div>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {discoveredBrands.length > 0 && !saveToDatabase && (
        <Card>
          <CardHeader>
            <CardTitle>Discovered Brands</CardTitle>
            <CardDescription>Review the discovered brands before saving</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>
                These brands were discovered but not saved. Use the save option above to persist
                them to the database.
              </AlertDescription>
            </Alert>
            <div className="mt-4 space-y-2">
              {discoveredBrands.map((brand, index) => (
                <div key={index} className="p-3 border rounded-lg text-sm">
                  <div className="font-medium">{brand.company_name}</div>
                  <div className="text-muted-foreground">
                    Brand: {brand.brand_name} | Stage: {brand.brand_stage}
                  </div>
                  {brand.website_url && (
                    <div className="text-xs text-muted-foreground mt-1">{brand.website_url}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AddBrandDialog
        open={isAddBrandDialogOpen}
        onOpenChange={setIsAddBrandDialogOpen}
        taxonomies={taxonomies}
        onBrandAdded={() => {
          router.refresh();
        }}
      />
    </div>
  );
}
