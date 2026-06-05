"use client";

import { useState, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Sparkles, Plus, X, Search as SearchIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  AddBrandDialog,
  type AddedBrandSummary,
} from "@/components/admin/brand-directory/AddBrandDialog";
import type { BrandWithTaxonomy } from "@/lib/brand-directory/brand-service";

interface Brand {
  id: string;
  brand_name: string;
  company_name: string;
}

interface BrandsSectionProps {
  brands: Brand[];
  onBrandsChange: (brands: Brand[]) => void;
  keywords?: string[];
  maxTotal?: number;
  currentKeywordCount?: number;
  onKeywordsChange?: (keywords: string[]) => void; // For cross-suggestion
}

interface BrandSuggestion extends BrandWithTaxonomy {
  relevanceScore: number;
}

export function BrandsSection({
  brands,
  onBrandsChange,
  keywords = [],
  maxTotal = 12,
  currentKeywordCount = 0,
  onKeywordsChange,
}: BrandsSectionProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BrandWithTaxonomy[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<BrandSuggestion[]>([]);
  const [hasLoadedSuggestions, setHasLoadedSuggestions] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [taxonomies, setTaxonomies] = useState<
    Array<{ id: string; category: string; subcategory: string; sub_subcategory: string }>
  >([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  const maxBrands = Math.max(0, maxTotal - currentKeywordCount);
  const remainingSlots = maxBrands - brands.length;

  // Fetch taxonomies for AddBrandDialog
  useEffect(() => {
    const fetchTaxonomies = async () => {
      try {
        const response = await fetch("/api/admin/brand-directory/taxonomy", {
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          setTaxonomies(data.taxonomies || []);
        }
      } catch (error) {
        console.error("Error fetching taxonomies:", error);
      }
    };
    fetchTaxonomies();
  }, []);

  // Debounced brand search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      handleSearch();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchResultsRef.current &&
        !searchResultsRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setSearchResults([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({
        search: searchQuery,
        limit: "10",
      });

      const response = await fetch(`/api/projects/brands/search?${params.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to search brands");
      }

      const data = await response.json();
      setSearchResults(data.brands || []);
    } catch (error) {
      console.error("Error searching brands:", error);
      toast({
        title: "Error",
        description: "Failed to search brands. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddBrand = (brand: BrandWithTaxonomy) => {
    if (brands.length >= maxBrands) {
      toast({
        title: "Limit reached",
        description: `You can only add up to ${maxBrands} brands (${maxTotal} total items including keywords).`,
        variant: "destructive",
      });
      return;
    }

    // Check if brand already added
    if (brands.some((b) => b.id === brand.id)) {
      toast({
        title: "Already added",
        description: "This brand is already in your list.",
        variant: "destructive",
      });
      return;
    }

    onBrandsChange([
      ...brands,
      {
        id: brand.id,
        brand_name: brand.brand_name,
        company_name: brand.company_name,
      },
    ]);

    setSearchQuery("");
    setSearchResults([]);
  };

  const handleRemoveBrand = (brandId: string, brandName: string) => {
    // Use both ID and name to uniquely identify brands (handles cases where ID might be empty)
    onBrandsChange(
      brands.filter((b) => {
        // If both have IDs, compare by ID
        if (brandId && b.id) {
          return b.id !== brandId;
        }
        // Otherwise, compare by brand name (case-insensitive)
        return b.brand_name.toLowerCase().trim() !== brandName.toLowerCase().trim();
      })
    );
  };

  const handleSuggest = async (brandsOverride?: Brand[]) => {
    const brandsForRequest = brandsOverride ?? brands;
    // Allow suggestions if we have brands OR keywords
    if (brandsForRequest.length === 0 && keywords.length === 0) {
      toast({
        title: "Brands or keywords required",
        description: "Please add at least one brand or keyword to get suggestions.",
        variant: "destructive",
      });
      return;
    }

    console.log("🔍 Starting brand suggestions with:", {
      brands: brandsForRequest.length,
      keywords: keywords.length,
      keywordList: keywords,
    });

    setIsLoadingSuggestions(true);
    setHasLoadedSuggestions(false);
    try {
      // If there's exactly one brand, increase limit to show all brands in same category
      const limit = brandsForRequest.length === 1 ? 100 : 20;

      const requestBody = {
        selectedBrandIds:
          brandsForRequest.length > 0 ? brandsForRequest.map((b) => b.id).filter((id) => id) : [],
        keywords: keywords.length > 0 ? keywords : [],
        limit,
      };

      console.log("📤 Sending request:", requestBody);

      const response = await fetch("/api/projects/suggest-brands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      console.log("📥 Response status:", response.status, response.ok);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("❌ API Error:", errorData);
        throw new Error(errorData.error || "Failed to fetch suggestions");
      }

      const data = await response.json();
      console.log("✅ Received suggestions:", data.suggestions?.length || 0, "brands");
      setSuggestions(data.suggestions || []);
      setHasLoadedSuggestions(true);
    } catch (error) {
      console.error("❌ Error fetching brand suggestions:", error);
      setSuggestions([]);
      setHasLoadedSuggestions(true);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to fetch brand suggestions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleBrandAdded = (created?: AddedBrandSummary) => {
    setShowAddDialog(false);
    if (!created) {
      if (brands.length > 0 || keywords.length > 0) {
        void handleSuggest();
      }
      return;
    }

    if (brands.length >= maxBrands) {
      toast({
        title: "Limit reached",
        description: `You can only add up to ${maxBrands} brands (${maxTotal} total items including keywords). Remove a brand or keyword to add this one.`,
        variant: "destructive",
      });
      if (brands.length > 0 || keywords.length > 0) {
        void handleSuggest();
      }
      return;
    }

    if (brands.some((b) => b.id === created.id)) {
      if (brands.length > 0 || keywords.length > 0) {
        void handleSuggest();
      }
      return;
    }

    const nextBrands: Brand[] = [
      ...brands,
      {
        id: created.id,
        brand_name: created.brand_name,
        company_name: created.company_name,
      },
    ];
    onBrandsChange(nextBrands);

    if (nextBrands.length > 0 || keywords.length > 0) {
      void handleSuggest(nextBrands);
    }
  };

  // For duplicate checking, use both ID and brand_name (for legacy brands without IDs)
  const adoptedBrandIds = new Set(brands.map((b) => b.id).filter((id) => id));
  const adoptedBrandNames = new Set(brands.map((b) => b.brand_name.toLowerCase().trim()));

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Brands to Monitor</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSuggest()}
              disabled={isLoadingSuggestions || (brands.length === 0 && keywords.length === 0)}
              className="flex items-center gap-2"
            >
              {isLoadingSuggestions ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Suggest
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Brand Search */}
          <div className="space-y-2">
            <Label htmlFor="brand-search">Search Brands From Catalog</Label>
            <div className="relative">
              <Input
                id="brand-search"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Prevent form submission when pressing Enter
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Optionally select first result if available
                    if (searchResults.length > 0) {
                      const firstResult = searchResults.find(
                        (b) =>
                          !adoptedBrandIds.has(b.id) &&
                          !adoptedBrandNames.has(b.brand_name.toLowerCase().trim())
                      );
                      if (firstResult) {
                        handleAddBrand(firstResult);
                      }
                    }
                  }
                }}
                placeholder="Search for brands..."
                className="pr-10"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {!isSearching && searchQuery && (
                <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              )}

              {/* Search Results Dropdown */}
              {searchResults.length > 0 && (
                <div
                  ref={searchResultsRef}
                  className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {searchResults
                    .filter(
                      (b) =>
                        !adoptedBrandIds.has(b.id) &&
                        !adoptedBrandNames.has(b.brand_name.toLowerCase().trim())
                    )
                    .map((brand, index) => (
                      <div
                        key={brand.id || `search-result-${index}-${brand.brand_name}`}
                        className="p-2 hover:bg-accent cursor-pointer"
                        onClick={() => handleAddBrand(brand)}
                      >
                        <div className="font-medium">{brand.brand_name}</div>
                        <div className="text-sm text-muted-foreground">{brand.company_name}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Add Brand Button */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowAddDialog(true)}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Find/ Add New Brand
          </Button>

          {/* Selected Brands Display */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {brands.length}/{maxBrands} brands
                {currentKeywordCount > 0 && (
                  <span className="ml-1">({currentKeywordCount} keywords selected)</span>
                )}
              </span>
            </div>
            {brands.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No brands selected. Search for brands or create a new one.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {brands.map((brand, index) => (
                  <Badge
                    key={brand.id || `brand-${index}-${brand.brand_name}`}
                    variant="secondary"
                    className="text-sm py-1 px-2"
                  >
                    {brand.brand_name}
                    <button
                      type="button"
                      onClick={() => handleRemoveBrand(brand.id, brand.brand_name)}
                      className="ml-2 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {remainingSlots <= 0 && brands.length > 0 && (
              <p className="text-sm text-destructive">
                Maximum brands reached. Remove some brands or keywords to add more.
              </p>
            )}
          </div>

          {/* Brand Suggestions */}
          {(isLoadingSuggestions || hasLoadedSuggestions || suggestions.length > 0) && (
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Suggested Brands</div>
              {isLoadingSuggestions ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Finding brand suggestions...</span>
                </div>
              ) : hasLoadedSuggestions && suggestions.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No brands found matching your keywords. Try searching for brands manually or
                  create a new brand.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggestions
                    .filter(
                      (s) =>
                        !adoptedBrandIds.has(s.id) &&
                        !adoptedBrandNames.has(s.brand_name.toLowerCase().trim())
                    )
                    .slice(0, 10)
                    .map((suggestion, index) => (
                      <Badge
                        key={suggestion.id || `suggestion-${index}-${suggestion.brand_name}`}
                        variant="outline"
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => handleAddBrand(suggestion)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        {suggestion.brand_name}
                        {suggestion.relevanceScore > 0 && (
                          <span className="ml-1 text-xs opacity-70">
                            ({suggestion.relevanceScore}%)
                          </span>
                        )}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Brand Dialog */}
      {taxonomies.length > 0 && (
        <AddBrandDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          taxonomies={taxonomies}
          onBrandAdded={handleBrandAdded}
        />
      )}
    </>
  );
}
