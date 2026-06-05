"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Plus, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface BrandSuggestion {
  id: string;
  company_name: string;
  brand_name: string;
  brand_stage: string;
  website_url: string | null;
  linkedin_url: string | null;
  businessTaxonomy: {
    category: string;
    subcategory: string;
    sub_subcategory: string;
  };
  keywords: Array<{ keyword: string }>;
  relevanceScore: number;
}

interface BrandSuggestionsProps {
  projectId: string;
}

export function BrandSuggestions({ projectId }: BrandSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<BrandSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedBrand, setSelectedBrand] = useState<BrandSuggestion | null>(null);

  useEffect(() => {
    fetchSuggestions();
  }, [projectId]);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/suggest-brands`, {
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch brand suggestions");
      }

      setSuggestions(data.suggestions || []);
    } catch (error) {
      console.error("Error fetching brand suggestions:", error);
      // Don't show error toast - suggestions are optional
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBrand = async (brandId: string, brandName: string) => {
    try {
      // Get current project data
      const projectResponse = await fetch("/api/projects", {
        method: "GET",
        credentials: "include",
      });
      const projectData = await projectResponse.json();
      const project = projectData.projects?.find((p: any) => p.id === projectId);

      if (!project) {
        throw new Error("Project not found");
      }

      // Add brand to project
      const currentBrands = project.brands?.map((b: any) => b.brand_name) || [];
      if (currentBrands.includes(brandName)) {
        toast({
          title: "Already Added",
          description: "This brand is already in your project",
        });
        return;
      }

      const updateResponse = await fetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          brands: [...currentBrands, brandName],
        }),
      });

      const updateData = await updateResponse.json();

      if (!updateResponse.ok) {
        throw new Error(updateData.error || "Failed to add brand");
      }

      toast({
        title: "Brand Added",
        description: `${brandName} has been added to your project`,
      });

      // Refresh suggestions to update UI
      fetchSuggestions();
    } catch (error) {
      console.error("Error adding brand:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add brand",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Brand Suggestions</CardTitle>
          <CardDescription>Finding relevant brands based on your project keywords</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Brand Suggestions</CardTitle>
          <CardDescription>
            No brand suggestions available. Add keywords to your project to get suggestions.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand Suggestions</CardTitle>
        <CardDescription>
          Based on your project keywords, here are relevant brands from the directory
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {suggestions.slice(0, 5).map((brand) => (
            <div
              key={brand.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{brand.company_name}</span>
                  <Badge variant="outline" className="text-xs">
                    {brand.relevanceScore}% match
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Brand: {brand.brand_name} | {brand.businessTaxonomy.sub_subcategory}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {brand.keywords.slice(0, 3).map((k, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {k.keyword}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {brand.website_url && (
                  <a
                    href={brand.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => setSelectedBrand(brand)}>
                      View
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{selectedBrand?.company_name}</DialogTitle>
                      <DialogDescription>
                        Brand: {selectedBrand?.brand_name} | Relevance:{" "}
                        {selectedBrand?.relevanceScore}%
                      </DialogDescription>
                    </DialogHeader>
                    {selectedBrand && (
                      <div className="space-y-4">
                        <div>
                          <div className="text-sm font-medium mb-2">Category</div>
                          <p className="text-sm text-muted-foreground">
                            {selectedBrand.businessTaxonomy.category} &gt;{" "}
                            {selectedBrand.businessTaxonomy.subcategory} &gt;{" "}
                            {selectedBrand.businessTaxonomy.sub_subcategory}
                          </p>
                        </div>
                        <div>
                          <div className="text-sm font-medium mb-2">Keywords</div>
                          <div className="flex flex-wrap gap-2">
                            {selectedBrand.keywords.map((k, i) => (
                              <Badge key={i} variant="secondary">
                                {k.keyword}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() =>
                              handleAddBrand(selectedBrand.id, selectedBrand.brand_name)
                            }
                            className="flex-1"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add to Project
                          </Button>
                        </div>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
                <Button size="sm" onClick={() => handleAddBrand(brand.id, brand.brand_name)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          ))}
        </div>
        {suggestions.length > 5 && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Showing top 5 of {suggestions.length} suggestions
          </div>
        )}
      </CardContent>
    </Card>
  );
}
