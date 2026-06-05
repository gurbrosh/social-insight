"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronRight,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Download,
  Link2,
  X,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";

interface TaxonomyTreeProps {
  groupedTaxonomy: Record<
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
  >;
}

type SelectionType = "category" | "subcategory" | "sub_subcategory" | null;
interface Selection {
  type: SelectionType;
  category?: string;
  subcategory?: string;
  sub_subcategory?: string;
  id?: string;
}

export function TaxonomyTree({ groupedTaxonomy }: TaxonomyTreeProps) {
  const router = useRouter();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSubcategories, setExpandedSubcategories] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRedditLinksDialogOpen, setIsRedditLinksDialogOpen] = useState(false);
  const [isSearchSourcesDialogOpen, setIsSearchSourcesDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [redditLinks, setRedditLinks] = useState<Array<{ id: string; url: string; level: string }>>(
    []
  );
  const [newRedditLinks, setNewRedditLinks] = useState<string[]>([""]);

  // Search Sources state
  const [selectedPlatforms, setSelectedPlatforms] = useState<
    Record<string, { enabled: boolean; count: number; linkType: string; sourceCategory?: string }>
  >({
    TWITTER: { enabled: false, count: 10, linkType: "INFLUENCER" },
    LINKEDIN: { enabled: false, count: 10, linkType: "INFLUENCER" },
    FACEBOOK: { enabled: false, count: 10, linkType: "INFLUENCER" },
    YOUTUBE: { enabled: false, count: 10, linkType: "INFLUENCER" },
    INSTAGRAM: { enabled: false, count: 10, linkType: "INFLUENCER" },
    TIKTOK: { enabled: false, count: 10, linkType: "INFLUENCER" },
    BLUESKY: { enabled: false, count: 10, linkType: "INFLUENCER" },
    REDDIT: { enabled: false, count: 10, linkType: "REDDIT" },
    PODCAST: { enabled: false, count: 10, linkType: "OTHER_SOURCE", sourceCategory: "PODCAST" },
    BLOG: { enabled: false, count: 10, linkType: "OTHER_SOURCE", sourceCategory: "BLOG" },
    NEWS_OUTLET: {
      enabled: false,
      count: 10,
      linkType: "OTHER_SOURCE",
      sourceCategory: "NEWS_OUTLET",
    },
  });
  const [searchId, setSearchId] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<{
    progress: number;
    currentPlatform?: string;
    status: string;
  }>({ progress: 0, status: "idle" });
  const [searchResults, setSearchResults] = useState<
    Record<
      string,
      Array<{ name?: string | null; url: string | null; selected: boolean; isDuplicate?: boolean }>
    >
  >({});
  const [isSearching, setIsSearching] = useState(false);
  const [sourcesTab, setSourcesTab] = useState<"search" | "sources">("sources");
  const [existingSources, setExistingSources] = useState<
    Record<
      string,
      Array<{
        id: string;
        url: string;
        name?: string | null;
        platform?: string;
        sourceCategory?: string;
        linkType: string;
      }>
    >
  >({});
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [editingSource, setEditingSource] = useState<{ platform: string; index: number } | null>(
    null
  );
  const [editingSourceData, setEditingSourceData] = useState<{ name: string; url: string }>({
    name: "",
    url: "",
  });
  const [newSourceData, setNewSourceData] = useState<Record<string, { name: string; url: string }>>(
    {}
  );

  const [formData, setFormData] = useState({
    category: "",
    subcategory: "",
    sub_subcategory: "",
  });

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleSubcategory = (key: string) => {
    const newExpanded = new Set(expandedSubcategories);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSubcategories(newExpanded);
  };

  const handleSelect = (
    e: React.MouseEvent,
    type: SelectionType,
    category?: string,
    subcategory?: string,
    sub_subcategory?: string,
    id?: string
  ) => {
    e.stopPropagation();
    setSelected({
      type,
      category,
      subcategory,
      sub_subcategory,
      id,
    });
  };

  const handleAdd = () => {
    if (!selected) {
      // Add at root level (new category)
      setFormData({ category: "", subcategory: "", sub_subcategory: "" });
      setIsAddDialogOpen(true);
      return;
    }

    // Pre-fill based on selection
    if (selected.type === "category") {
      setFormData({
        category: selected.category || "",
        subcategory: "",
        sub_subcategory: "",
      });
    } else if (selected.type === "subcategory") {
      setFormData({
        category: selected.category || "",
        subcategory: selected.subcategory || "",
        sub_subcategory: "",
      });
    }
    setIsAddDialogOpen(true);
  };

  const handleEdit = () => {
    if (!selected || !selected.id || selected.type !== "sub_subcategory") {
      toast({
        title: "Error",
        description: "Only sub-subcategories can be edited. Please select a sub-subcategory.",
        variant: "destructive",
      });
      return;
    }

    // Find the taxonomy entry
    for (const [cat, subcats] of Object.entries(groupedTaxonomy)) {
      for (const [subcat, items] of Object.entries(subcats)) {
        const item = items.find((i) => i.id === selected.id);
        if (item) {
          setFormData({
            category: item.category,
            subcategory: item.subcategory,
            sub_subcategory: item.sub_subcategory,
          });
          setIsEditDialogOpen(true);
          return;
        }
      }
    }
  };

  const handleDelete = () => {
    if (!selected || !selected.id || selected.type !== "sub_subcategory") {
      toast({
        title: "Error",
        description: "Only sub-subcategories can be deleted. Please select a sub-subcategory.",
        variant: "destructive",
      });
      return;
    }
    setIsDeleteDialogOpen(true);
  };

  const handleRedditLinks = async () => {
    if (!selected) {
      toast({
        title: "Error",
        description: "Please select a taxonomy node",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      let links: Array<{ id: string; url: string; level: string }> = [];

      if (selected.type === "sub_subcategory" && selected.id) {
        // Fetch links for specific taxonomy entry (includes inherited links)
        const response = await fetch(`/api/admin/brand-directory/reddit-links/${selected.id}`, {
          credentials: "include",
        });
        const data = await response.json();
        if (response.ok) {
          links = data.links || [];
        }
      } else if (selected.type === "subcategory" && selected.category && selected.subcategory) {
        // Fetch links for subcategory level
        const response = await fetch(
          `/api/admin/brand-directory/reddit-links/subcategory?category=${encodeURIComponent(selected.category)}&subcategory=${encodeURIComponent(selected.subcategory)}`,
          { credentials: "include" }
        );
        const data = await response.json();
        if (response.ok) {
          links = data.links || [];
        }
      } else if (selected.type === "category" && selected.category) {
        // Fetch links for category level
        const response = await fetch(
          `/api/admin/brand-directory/reddit-links/category?category=${encodeURIComponent(selected.category)}`,
          { credentials: "include" }
        );
        const data = await response.json();
        if (response.ok) {
          links = data.links || [];
        }
      }

      setRedditLinks(links);
      setNewRedditLinks([""]); // Reset to single empty field when opening dialog
      setIsRedditLinksDialogOpen(true);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load Reddit links",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddRedditLinkField = () => {
    setNewRedditLinks([...newRedditLinks, ""]);
  };

  const handleRemoveRedditLinkField = (index: number) => {
    if (newRedditLinks.length > 1) {
      setNewRedditLinks(newRedditLinks.filter((_, i) => i !== index));
    }
  };

  const handleUpdateRedditLinkField = (index: number, value: string) => {
    const updated = [...newRedditLinks];
    updated[index] = value;
    setNewRedditLinks(updated);
  };

  const handleSaveRedditLinks = async () => {
    if (!selected) return;

    // Filter out empty links and validate URLs
    const validLinks = newRedditLinks.map((link) => link.trim()).filter((link) => link.length > 0);

    if (validLinks.length === 0) {
      toast({
        title: "Error",
        description: "Please enter at least one link",
        variant: "destructive",
      });
      return;
    }

    // Validate all URLs
    const invalidLinks: number[] = [];
    validLinks.forEach((link, index) => {
      try {
        new URL(link);
      } catch {
        invalidLinks.push(index + 1);
      }
    });

    if (invalidLinks.length > 0) {
      toast({
        title: "Error",
        description: `Invalid URL(s) at position(s): ${invalidLinks.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const linkData = {
        links: validLinks.map((url) => ({ url })),
        category: selected.category!,
        subcategory: selected.subcategory ?? null,
        sub_subcategory: selected.sub_subcategory ?? null,
        taxonomy_id: selected.id ?? undefined,
      };

      const response = await fetch("/api/admin/brand-directory/reddit-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(linkData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add Reddit links");
      }

      toast({
        title: "Success",
        description: `Successfully added ${validLinks.length} Reddit link(s)`,
      });

      setNewRedditLinks([""]);
      // Reload links
      await handleRedditLinks();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add Reddit links",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRedditLink = async (linkId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/brand-directory/reddit-links/link/${linkId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete Reddit link");
      }

      toast({
        title: "Success",
        description: "Reddit link deleted successfully",
      });

      // Reload links
      await handleRedditLinks();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete Reddit link",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/brand-directory/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create taxonomy");
      }

      toast({
        title: "Success",
        description: "Taxonomy entry created successfully",
      });

      setIsAddDialogOpen(false);
      setFormData({ category: "", subcategory: "", sub_subcategory: "" });
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create taxonomy",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.id) return;

    setIsLoading(true);

    try {
      const response = await fetch(`/api/admin/brand-directory/taxonomy/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update taxonomy");
      }

      toast({
        title: "Success",
        description: "Taxonomy entry updated successfully",
      });

      setIsEditDialogOpen(false);
      setSelected(null);
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update taxonomy",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selected?.id) return;

    setIsLoading(true);

    try {
      const response = await fetch(`/api/admin/brand-directory/taxonomy/${selected.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete taxonomy");
      }

      toast({
        title: "Success",
        description: "Taxonomy entry deleted successfully",
      });

      setIsDeleteDialogOpen(false);
      setSelected(null);
      router.refresh();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete taxonomy",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchExistingSources = async () => {
    console.log("[TaxonomyTree] fetchExistingSources called, selected:", selected);
    if (!selected) {
      console.log("[TaxonomyTree] No selection, returning early");
      return;
    }

    console.log("[TaxonomyTree] Fetching sources for taxonomy:", selected.id);
    setIsLoadingSources(true);
    try {
      const response = await fetch("/api/admin/brand-directory/taxonomy-sources/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          taxonomyNode: {
            type: selected.type,
            category: selected.category,
            subcategory: selected.subcategory,
            sub_subcategory: selected.sub_subcategory,
            id: selected.id,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch sources");
      }

      const data = await response.json();
      console.log("[TaxonomyTree] Received from API:", {
        hasSources: !!data.sources,
        sourcesKeys: Object.keys(data.sources || {}),
        totalSources: Object.values(data.sources || {}).reduce(
          (sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0),
          0
        ),
        debug: data.debug,
      });
      setExistingSources(data.sources || {});
    } catch (error) {
      console.error("Error fetching existing sources:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch sources",
        variant: "destructive",
      });
      setExistingSources({});
    } finally {
      setIsLoadingSources(false);
    }
  };

  const getSelectedLabel = () => {
    if (!selected) return "Nothing selected";
    if (selected.type === "category") return `Category: ${selected.category}`;
    if (selected.type === "subcategory")
      return `Subcategory: ${selected.category} > ${selected.subcategory}`;
    if (selected.type === "sub_subcategory")
      return `Sub-subcategory: ${selected.category} > ${selected.subcategory} > ${selected.sub_subcategory}`;
    return "Nothing selected";
  };

  const handleExportJSON = () => {
    // Build JSON structure
    const jsonStructure: Record<string, Record<string, Record<string, string[]>>> = {};

    Object.entries(groupedTaxonomy).forEach(([category, subcategories]) => {
      jsonStructure[category] = {};
      Object.entries(subcategories).forEach(([subcategory, items]) => {
        jsonStructure[category][subcategory] = {};
        items.forEach((item) => {
          jsonStructure[category][subcategory][item.sub_subcategory] = item.brandNames || [];
        });
      });
    });

    // Convert to JSON string with pretty formatting
    const jsonString = JSON.stringify(jsonStructure, null, 2);

    // Create a blob and download
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `taxonomy-tree-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Success",
      description: "Taxonomy tree exported as JSON",
    });
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
        <div className="flex-1">
          <div className="text-sm font-medium">Selected:</div>
          <div className="text-sm text-muted-foreground">{getSelectedLabel()}</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJSON}
            disabled={isLoading}
            title="Export taxonomy tree as JSON"
          >
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <Button variant="default" size="sm" onClick={handleAdd} disabled={isLoading}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEdit}
            disabled={!selected || !selected.id || selected.type !== "sub_subcategory" || isLoading}
            title={
              selected?.type !== "sub_subcategory"
                ? "Only sub-subcategories can be edited"
                : "Edit selected taxonomy entry"
            }
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={!selected || !selected.id || selected.type !== "sub_subcategory" || isLoading}
            title={
              selected?.type !== "sub_subcategory"
                ? "Only sub-subcategories can be deleted"
                : "Delete selected taxonomy entry"
            }
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              console.log("[TaxonomyTree] Additional Links clicked, selected:", selected);
              if (!selected) {
                console.log("[TaxonomyTree] No selection, showing error");
                toast({
                  title: "Error",
                  description: "Please select a taxonomy node",
                  variant: "destructive",
                });
                return;
              }
              console.log("[TaxonomyTree] Opening dialog for taxonomy:", selected.id);
              setIsSearchSourcesDialogOpen(true);
              // Also fetch sources immediately (don't wait for dialog onOpenChange)
              setTimeout(() => {
                console.log("[TaxonomyTree] Calling fetchExistingSources after dialog open");
                fetchExistingSources();
              }, 100);
            }}
            disabled={!selected || isLoading}
            title="Search for influencers and sources using AI"
          >
            <Search className="h-4 w-4 mr-2" />
            Additional Links
          </Button>
        </div>
      </div>

      {/* Taxonomy Tree */}
      <div className="space-y-2">
        {Object.entries(groupedTaxonomy).map(([category, subcategories]) => {
          const categoryExpanded = expandedCategories.has(category);
          const totalBrands = Object.values(subcategories).reduce(
            (sum, subs) => sum + subs.reduce((s, item) => s + item.brandCount, 0),
            0
          );
          const isCategorySelected =
            selected?.type === "category" && selected.category === category;

          return (
            <Card
              key={category}
              className={`overflow-hidden ${isCategorySelected ? "ring-2 ring-primary" : ""}`}
            >
              <CardHeader
                className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                  isCategorySelected ? "bg-muted" : ""
                }`}
                onClick={() => toggleCategory(category)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    {categoryExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <CardTitle
                      className="text-lg"
                      onClick={(e) =>
                        handleSelect(e, "category", category, undefined, undefined, undefined)
                      }
                    >
                      {category}
                    </CardTitle>
                  </div>
                  <Badge variant={totalBrands > 0 ? "default" : "secondary"}>
                    {totalBrands} {totalBrands === 1 ? "brand" : "brands"}
                  </Badge>
                </div>
              </CardHeader>
              {categoryExpanded && (
                <CardContent className="pt-0">
                  <div className="space-y-2 pl-6">
                    {Object.entries(subcategories).map(([subcategory, items]) => {
                      const subKey = `${category}|${subcategory}`;
                      const subExpanded = expandedSubcategories.has(subKey);
                      const subBrands = items.reduce((sum, item) => sum + item.brandCount, 0);
                      const isSubcategorySelected =
                        selected?.type === "subcategory" &&
                        selected.category === category &&
                        selected.subcategory === subcategory;

                      return (
                        <div
                          key={subcategory}
                          className={`border-l-2 pl-4 ${isSubcategorySelected ? "ring-2 ring-primary rounded" : ""}`}
                        >
                          <div
                            className={`flex items-center justify-between cursor-pointer hover:bg-muted/30 p-2 rounded transition-colors ${
                              isSubcategorySelected ? "bg-muted" : ""
                            }`}
                            onClick={() => toggleSubcategory(subKey)}
                          >
                            <div className="flex items-center gap-2 flex-1">
                              {subExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <span
                                className="font-medium"
                                onClick={(e) =>
                                  handleSelect(
                                    e,
                                    "subcategory",
                                    category,
                                    subcategory,
                                    undefined,
                                    undefined
                                  )
                                }
                              >
                                {subcategory}
                              </span>
                            </div>
                            <Badge variant={subBrands > 0 ? "default" : "outline"}>
                              {subBrands} {subBrands === 1 ? "brand" : "brands"}
                            </Badge>
                          </div>
                          {subExpanded && (
                            <div className="space-y-1 pl-6 mt-2">
                              {items.map((item) => {
                                const isItemSelected =
                                  selected?.type === "sub_subcategory" && selected.id === item.id;

                                return (
                                  <div
                                    key={item.id}
                                    className={`flex items-center justify-between p-2 hover:bg-muted/20 rounded text-sm ${
                                      isItemSelected ? "bg-muted ring-2 ring-primary" : ""
                                    }`}
                                    onClick={(e) =>
                                      handleSelect(
                                        e,
                                        "sub_subcategory",
                                        category,
                                        subcategory,
                                        item.sub_subcategory,
                                        item.id
                                      )
                                    }
                                  >
                                    <div className="flex items-center gap-2">
                                      <Building2 className="h-3 w-3 text-muted-foreground" />
                                      <span>{item.sub_subcategory}</span>
                                    </div>
                                    <Badge
                                      variant={item.brandCount > 0 ? "default" : "outline"}
                                      className="text-xs"
                                    >
                                      {item.brandCount} {item.brandCount === 1 ? "brand" : "brands"}
                                    </Badge>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Taxonomy Entry</DialogTitle>
            <DialogDescription>
              {selected?.type === "category"
                ? `Add a new subcategory under "${selected.category}"`
                : selected?.type === "subcategory"
                  ? `Add a new sub-subcategory under "${selected.category} > ${selected.subcategory}"`
                  : "Add a new taxonomy entry"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subcategory">Subcategory *</Label>
              <Input
                id="subcategory"
                value={formData.subcategory}
                onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub_subcategory">Sub-subcategory *</Label>
              <Input
                id="sub_subcategory"
                value={formData.sub_subcategory}
                onChange={(e) => setFormData({ ...formData, sub_subcategory: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Taxonomy Entry</DialogTitle>
            <DialogDescription>Update the taxonomy entry details</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category *</Label>
              <Input
                id="edit-category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subcategory">Subcategory *</Label>
              <Input
                id="edit-subcategory"
                value={formData.subcategory}
                onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sub_subcategory">Sub-subcategory *</Label>
              <Input
                id="edit-sub_subcategory"
                value={formData.sub_subcategory}
                onChange={(e) => setFormData({ ...formData, sub_subcategory: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Updating..." : "Update"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the taxonomy entry:{" "}
              {selected?.category && selected.subcategory && selected.sub_subcategory
                ? `${selected.category} > ${selected.subcategory} > ${selected.sub_subcategory}`
                : "selected item"}
              . This action cannot be undone. If there are brands using this taxonomy, the deletion
              will fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reddit Links Dialog */}
      <Dialog
        open={isRedditLinksDialogOpen}
        onOpenChange={(open) => {
          setIsRedditLinksDialogOpen(open);
          if (!open) {
            // Reset when closing
            setNewRedditLinks([""]);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Reddit Links</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  Reddit links for: {getSelectedLabel()}
                  <br />
                  <span className="text-xs text-muted-foreground mt-1 block">
                    Links added at parent levels (category/subcategory) are inherited by all child
                    nodes.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Add new links */}
            <div className="space-y-2">
              <Label>Add Reddit Links</Label>
              {newRedditLinks.map((link, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="https://reddit.com/r/..."
                    value={link}
                    onChange={(e) => handleUpdateRedditLinkField(index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.ctrlKey) {
                        e.preventDefault();
                        handleSaveRedditLinks();
                      }
                    }}
                    disabled={isLoading}
                  />
                  {newRedditLinks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveRedditLinkField(index)}
                      disabled={isLoading}
                      title="Remove this field"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  {index === newRedditLinks.length - 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleAddRedditLinkField}
                      disabled={isLoading}
                      title="Add another link field"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                onClick={handleSaveRedditLinks}
                disabled={isLoading || newRedditLinks.every((link) => !link.trim())}
                className="w-full"
              >
                {isLoading
                  ? "Saving..."
                  : `Save ${newRedditLinks.filter((l) => l.trim()).length} Link(s)`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Tip: Press Ctrl+Enter in any field to save all links
              </p>
            </div>

            {/* List of links */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {redditLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No Reddit links added yet. Add links that will apply to this taxonomy node and all
                  its children.
                </p>
              ) : (
                redditLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline break-all"
                      >
                        {link.url}
                      </a>
                      <div className="text-xs text-muted-foreground mt-1">Level: {link.level}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteRedditLink(link.id)}
                      disabled={isLoading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search Sources Dialog */}
      <Dialog
        open={isSearchSourcesDialogOpen}
        onOpenChange={(open) => {
          setIsSearchSourcesDialogOpen(open);
          if (open && selected) {
            // Reset to Sources tab when opening dialog
            setSourcesTab("sources");
            // Fetch existing sources when opening dialog
            fetchExistingSources();
          }
          if (!open) {
            // Reset when closing
            setSelectedPlatforms({
              TWITTER: { enabled: false, count: 10, linkType: "INFLUENCER" },
              LINKEDIN: { enabled: false, count: 10, linkType: "INFLUENCER" },
              FACEBOOK: { enabled: false, count: 10, linkType: "INFLUENCER" },
              YOUTUBE: { enabled: false, count: 10, linkType: "INFLUENCER" },
              INSTAGRAM: { enabled: false, count: 10, linkType: "INFLUENCER" },
              TIKTOK: { enabled: false, count: 10, linkType: "INFLUENCER" },
              BLUESKY: { enabled: false, count: 10, linkType: "INFLUENCER" },
              REDDIT: { enabled: false, count: 10, linkType: "REDDIT" },
              PODCAST: {
                enabled: false,
                count: 10,
                linkType: "OTHER_SOURCE",
                sourceCategory: "PODCAST",
              },
              BLOG: { enabled: false, count: 10, linkType: "OTHER_SOURCE", sourceCategory: "BLOG" },
              NEWS_OUTLET: {
                enabled: false,
                count: 10,
                linkType: "OTHER_SOURCE",
                sourceCategory: "NEWS_OUTLET",
              },
            });
            setSearchId(null);
            setSearchProgress({ progress: 0, status: "idle" });
            setSearchResults({});
            setIsSearching(false);
            setSourcesTab("sources");
            setExistingSources({});
            setEditingSource(null);
            setNewSourceData({});
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sources</DialogTitle>
            <DialogDescription>
              {selected && <>Manage sources for: {getSelectedLabel()}</>}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={sourcesTab}
            onValueChange={(v) => {
              setSourcesTab(v as "search" | "sources");
              if (v === "sources" && selected) {
                // Fetch existing sources when switching to Sources tab
                fetchExistingSources();
              }
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sources">Sources</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="space-y-4 mt-4">
              {!isSearching && Object.values(searchResults).length === 0 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Select Platforms and Quantities</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const allEnabled = Object.values(selectedPlatforms).every(
                              (p) => p.enabled
                            );
                            const updated = { ...selectedPlatforms };
                            for (const platform in updated) {
                              updated[platform] = { ...updated[platform], enabled: !allEnabled };
                            }
                            setSelectedPlatforms(updated);
                          }}
                        >
                          {Object.values(selectedPlatforms).every((p) => p.enabled)
                            ? "Deselect All"
                            : "Select All"}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(selectedPlatforms).map(([platform, config]) => {
                        const displayName =
                          platform === "TWITTER"
                            ? "X (Twitter)"
                            : platform === "NEWS_OUTLET"
                              ? "Publications"
                              : platform === "PODCAST"
                                ? "Podcasts"
                                : platform === "BLOG"
                                  ? "Blogs"
                                  : platform.charAt(0) + platform.slice(1).toLowerCase();
                        const searchTerm =
                          config.linkType === "INFLUENCER"
                            ? "influencers"
                            : config.linkType === "REDDIT"
                              ? "channels"
                              : platform === "PODCAST"
                                ? "podcasts"
                                : platform === "BLOG"
                                  ? "blogs"
                                  : platform === "NEWS_OUTLET"
                                    ? "publications"
                                    : platform.toLowerCase();

                        return (
                          <div
                            key={platform}
                            className="flex items-center gap-3 p-3 border rounded-lg"
                          >
                            <Checkbox
                              checked={config.enabled}
                              onCheckedChange={(checked) => {
                                setSelectedPlatforms({
                                  ...selectedPlatforms,
                                  [platform]: { ...config, enabled: !!checked },
                                });
                              }}
                            />
                            <div className="flex-1">
                              <Label className="text-sm font-medium">
                                {platform === "PODCAST" ||
                                platform === "BLOG" ||
                                platform === "NEWS_OUTLET"
                                  ? displayName
                                  : `${displayName} ${searchTerm}`}
                              </Label>
                            </div>
                            <Input
                              type="number"
                              min="1"
                              max="50"
                              value={config.count}
                              onChange={(e) => {
                                const count = parseInt(e.target.value) || 1;
                                setSelectedPlatforms({
                                  ...selectedPlatforms,
                                  [platform]: { ...config, count },
                                });
                              }}
                              className="w-20"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsSearchSourcesDialogOpen(false)}
                      disabled={isLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={async () => {
                        const enabledPlatforms = Object.entries(selectedPlatforms).filter(
                          ([_, config]) => config.enabled
                        );
                        if (enabledPlatforms.length === 0) {
                          toast({
                            title: "Error",
                            description: "Please select at least one platform",
                            variant: "destructive",
                          });
                          return;
                        }

                        if (!selected) return;

                        setIsSearching(true);
                        setIsLoading(true);

                        try {
                          const platforms = enabledPlatforms.map(([platform, config]) => ({
                            platform,
                            count: config.count,
                            linkType: config.linkType as "INFLUENCER" | "REDDIT" | "OTHER_SOURCE",
                            sourceCategory: config.sourceCategory as
                              | "NEWS_OUTLET"
                              | "BLOG"
                              | "PODCAST"
                              | undefined,
                          }));

                          const response = await fetch(
                            "/api/admin/brand-directory/taxonomy-sources/search",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                taxonomyNode: {
                                  type: selected.type,
                                  category: selected.category,
                                  subcategory: selected.subcategory,
                                  sub_subcategory: selected.sub_subcategory,
                                  id: selected.id,
                                },
                                platforms,
                              }),
                            }
                          );

                          const data = await response.json();
                          if (!response.ok) {
                            throw new Error(data.error || "Failed to start search");
                          }

                          setSearchId(data.searchId);
                          setSearchProgress({ progress: 0, status: "in_progress" });

                          // Poll for progress
                          const pollInterval = setInterval(async () => {
                            if (
                              typeof document !== "undefined" &&
                              document.visibilityState === "hidden"
                            ) {
                              return;
                            }
                            try {
                              const progressResponse = await fetch(
                                `/api/admin/brand-directory/taxonomy-sources/search/${data.searchId}`,
                                { credentials: "include" }
                              );
                              const progressData = await progressResponse.json();

                              if (progressData.status === "completed") {
                                clearInterval(pollInterval);
                                setSearchProgress({ progress: 100, status: "completed" });
                                setSearchResults(progressData.results || {});
                                setIsSearching(false);
                                setIsLoading(false);
                              } else if (progressData.status === "error") {
                                clearInterval(pollInterval);
                                setSearchProgress({ progress: 0, status: "error" });
                                toast({
                                  title: "Error",
                                  description: progressData.error || "Search failed",
                                  variant: "destructive",
                                });
                                setIsSearching(false);
                                setIsLoading(false);
                              } else {
                                setSearchProgress({
                                  progress: progressData.progress || 0,
                                  currentPlatform: progressData.currentPlatform,
                                  status: progressData.status,
                                });
                                setSearchResults(progressData.results || {});
                              }
                            } catch (error) {
                              console.error("Error polling search progress:", error);
                            }
                          }, 1000); // Poll every second
                        } catch (error) {
                          console.error("Error starting search:", error);
                          toast({
                            title: "Error",
                            description:
                              error instanceof Error ? error.message : "Failed to start search",
                            variant: "destructive",
                          });
                          setIsSearching(false);
                          setIsLoading(false);
                        }
                      }}
                      disabled={
                        isLoading || Object.values(selectedPlatforms).every((p) => !p.enabled)
                      }
                    >
                      Start Search
                    </Button>
                  </div>
                </div>
              )}

              {isSearching && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>
                        {searchProgress.currentPlatform
                          ? `Searching ${searchProgress.currentPlatform}...`
                          : "Searching..."}
                      </Label>
                      <span className="text-sm text-muted-foreground">
                        {searchProgress.progress}%
                      </span>
                    </div>
                    <Progress value={searchProgress.progress} />
                  </div>

                  {Object.keys(searchResults).length > 0 && (
                    <div className="space-y-2">
                      <Label>Results (as they arrive):</Label>
                      <div className="max-h-60 overflow-y-auto space-y-2">
                        {Object.entries(searchResults).map(([platform, results]) => (
                          <div key={platform} className="border rounded p-2">
                            <div className="text-sm font-medium mb-1">{platform}</div>
                            <div className="text-xs text-muted-foreground">
                              {results.length} result{results.length !== 1 ? "s" : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isSearching && Object.values(searchResults).length > 0 && (
                <div className="space-y-4">
                  {(() => {
                    // Sort platforms: BLUESKY always last, others maintain insertion order
                    const platforms = Object.keys(searchResults);
                    const sortedPlatforms = [
                      ...platforms.filter((p) => p !== "BLUESKY"),
                      ...platforms.filter((p) => p === "BLUESKY"),
                    ];
                    return (
                      <Tabs defaultValue={sortedPlatforms[0]} className="w-full">
                        <TabsList className="flex w-full overflow-x-auto overflow-y-hidden max-h-12 justify-start">
                          {sortedPlatforms.map((platform) => {
                            const displayName =
                              platform === "TWITTER"
                                ? "X"
                                : platform === "NEWS_OUTLET"
                                  ? "Publications"
                                  : platform.charAt(0) + platform.slice(1).toLowerCase();
                            return (
                              <TabsTrigger
                                key={platform}
                                value={platform}
                                className="flex-shrink-0 whitespace-nowrap"
                              >
                                {displayName}
                              </TabsTrigger>
                            );
                          })}
                        </TabsList>

                        {sortedPlatforms.map((platform) => {
                          const results = searchResults[platform];
                          return (
                            <TabsContent
                              key={platform}
                              value={platform}
                              className="space-y-2 max-h-96 overflow-y-auto"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <Label>
                                  {results.length} result{results.length !== 1 ? "s" : ""}
                                </Label>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSearchResults({
                                        ...searchResults,
                                        [platform]: results.map((r) => ({ ...r, selected: true })),
                                      });
                                    }}
                                  >
                                    Select All
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSearchResults({
                                        ...searchResults,
                                        [platform]: results.map((r) => ({ ...r, selected: false })),
                                      });
                                    }}
                                  >
                                    Deselect All
                                  </Button>
                                </div>
                              </div>

                              {results.map((result, index) => (
                                <div
                                  key={index}
                                  className={`flex items-start gap-2 p-2 border rounded ${result.isDuplicate ? "bg-muted/50 opacity-75" : ""}`}
                                >
                                  <Checkbox
                                    checked={result.selected}
                                    onCheckedChange={(checked) => {
                                      const updated = [...results];
                                      updated[index] = { ...updated[index], selected: !!checked };
                                      setSearchResults({
                                        ...searchResults,
                                        [platform]: updated,
                                      });
                                    }}
                                    disabled={result.isDuplicate}
                                  />
                                  <div className="flex-1 min-w-0">
                                    {result.name && (
                                      <div className="text-sm font-medium mb-1">{result.name}</div>
                                    )}
                                    {result.url && result.url.trim() ? (
                                      <a
                                        href={result.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-600 hover:underline break-all block"
                                      >
                                        {result.url}
                                      </a>
                                    ) : (
                                      <Input
                                        type="text"
                                        placeholder="Add LinkedIn URL (optional)"
                                        value={result.url || ""}
                                        onChange={(e) => {
                                          const updated = [...results];
                                          updated[index] = {
                                            ...updated[index],
                                            url: e.target.value || null,
                                          };
                                          setSearchResults({
                                            ...searchResults,
                                            [platform]: updated,
                                          });
                                        }}
                                        className="text-sm h-8"
                                      />
                                    )}
                                    {result.isDuplicate && (
                                      <div className="text-xs text-muted-foreground mt-1">
                                        Already exists
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </TabsContent>
                          );
                        })}
                      </Tabs>
                    );
                  })()}

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsSearchSourcesDialogOpen(false);
                        setSearchResults({});
                        setIsSearching(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={async () => {
                        if (!selected) return;

                        setIsLoading(true);
                        try {
                          // Collect all selected links
                          const linksToSave: Array<{
                            platform: string;
                            linkType: string;
                            sourceCategory?: string;
                            url: string;
                            channel_name?: string | null;
                          }> = [];

                          for (const [platform, results] of Object.entries(searchResults)) {
                            const config = selectedPlatforms[platform];
                            if (!config) continue;

                            for (const result of results) {
                              // Skip duplicates even if selected
                              // Skip if URL is empty or null
                              if (
                                result.selected &&
                                !result.isDuplicate &&
                                result.url &&
                                result.url.trim()
                              ) {
                                linksToSave.push({
                                  platform,
                                  linkType: config.linkType,
                                  sourceCategory: config.sourceCategory,
                                  url: result.url.trim(),
                                  channel_name: result.name || null,
                                });
                              }
                            }
                          }

                          if (linksToSave.length === 0) {
                            toast({
                              title: "Error",
                              description: "Please select at least one result to save",
                              variant: "destructive",
                            });
                            setIsLoading(false);
                            return;
                          }

                          const response = await fetch(
                            "/api/admin/brand-directory/taxonomy-sources/save",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                taxonomyNode: {
                                  type: selected.type,
                                  category: selected.category,
                                  subcategory: selected.subcategory,
                                  sub_subcategory: selected.sub_subcategory,
                                  id: selected.id,
                                },
                                links: linksToSave,
                              }),
                            }
                          );

                          const data = await response.json();
                          if (!response.ok) {
                            throw new Error(data.error || "Failed to save links");
                          }

                          toast({
                            title: "Success",
                            description: `Successfully saved ${data.savedCount} link(s)`,
                          });

                          setIsSearchSourcesDialogOpen(false);
                          setSearchResults({});
                          setIsSearching(false);
                          router.refresh();
                        } catch (error) {
                          console.error("Error saving links:", error);
                          toast({
                            title: "Error",
                            description:
                              error instanceof Error ? error.message : "Failed to save links",
                            variant: "destructive",
                          });
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      disabled={
                        isLoading ||
                        Object.values(searchResults)
                          .flat()
                          .every((r) => !r.selected || r.isDuplicate)
                      }
                    >
                      Save Selected (
                      {
                        Object.values(searchResults)
                          .flat()
                          .filter((r) => r.selected && !r.isDuplicate).length
                      }
                      )
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="sources" className="space-y-4 mt-4">
              {isLoadingSources ? (
                <div className="flex items-center justify-center py-8">
                  <Label>Loading sources...</Label>
                </div>
              ) : Object.keys(existingSources).length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Label className="text-muted-foreground">None</Label>
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    // Sort platforms: BLUESKY always last, others maintain insertion order
                    const platforms = Object.keys(existingSources);
                    const sortedPlatforms = [
                      ...platforms.filter((p) => p !== "BLUESKY"),
                      ...platforms.filter((p) => p === "BLUESKY"),
                    ];
                    return (
                      <Tabs defaultValue={sortedPlatforms[0]} className="w-full">
                        <TabsList className="flex w-full overflow-x-auto overflow-y-hidden max-h-12 justify-start">
                          {sortedPlatforms.map((platform) => {
                            const displayName =
                              platform === "TWITTER"
                                ? "X"
                                : platform === "NEWS_OUTLET"
                                  ? "Publications"
                                  : platform.charAt(0) + platform.slice(1).toLowerCase();
                            return (
                              <TabsTrigger
                                key={platform}
                                value={platform}
                                className="flex-shrink-0 whitespace-nowrap"
                              >
                                {displayName} ({existingSources[platform].length})
                              </TabsTrigger>
                            );
                          })}
                        </TabsList>

                        {sortedPlatforms.map((platform) => {
                          const sources = existingSources[platform];
                          const firstSource = sources[0];
                          const linkType = firstSource?.linkType || "INFLUENCER";
                          return (
                            <TabsContent
                              key={platform}
                              value={platform}
                              className="space-y-3 max-h-96 overflow-y-auto mt-4"
                            >
                              {sources.map((source, index) => (
                                <div
                                  key={source.id}
                                  className="flex items-start border rounded-lg overflow-hidden"
                                >
                                  {editingSource?.platform === platform &&
                                  editingSource?.index === index ? (
                                    <div className="w-1/2 p-3 space-y-2 border-r">
                                      <Input
                                        placeholder="Name (optional)"
                                        value={editingSourceData.name || ""}
                                        onChange={(e) =>
                                          setEditingSourceData({
                                            ...editingSourceData,
                                            name: e.target.value,
                                          })
                                        }
                                        className="max-w-[80%]"
                                      />
                                      <Input
                                        placeholder="URL"
                                        value={editingSourceData.url}
                                        onChange={(e) =>
                                          setEditingSourceData({
                                            ...editingSourceData,
                                            url: e.target.value,
                                          })
                                        }
                                        className="max-w-[80%]"
                                      />
                                      <div className="flex gap-2">
                                        <Button
                                          size="sm"
                                          onClick={async () => {
                                            try {
                                              const response = await fetch(
                                                "/api/admin/brand-directory/taxonomy-sources/update",
                                                {
                                                  method: "PUT",
                                                  headers: { "Content-Type": "application/json" },
                                                  credentials: "include",
                                                  body: JSON.stringify({
                                                    linkId: source.id,
                                                    linkType,
                                                    url: editingSourceData.url,
                                                    name: editingSourceData.name || null,
                                                  }),
                                                }
                                              );
                                              if (!response.ok) {
                                                throw new Error("Failed to update");
                                              }
                                              toast({
                                                title: "Success",
                                                description: "Source updated",
                                              });
                                              setEditingSource(null);
                                              fetchExistingSources();
                                            } catch (error) {
                                              toast({
                                                title: "Error",
                                                description:
                                                  error instanceof Error
                                                    ? error.message
                                                    : "Failed to update",
                                                variant: "destructive",
                                              });
                                            }
                                          }}
                                        >
                                          Save
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setEditingSource(null)}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="w-1/2 p-3 min-w-0 border-r">
                                        {source.name && (
                                          <div className="text-sm font-medium mb-1 truncate">
                                            {source.name}
                                          </div>
                                        )}
                                        <a
                                          href={source.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm text-blue-600 hover:underline break-all"
                                        >
                                          {source.url}
                                        </a>
                                      </div>
                                      <div className="flex gap-2 p-3 items-center border-l bg-muted/30 flex-shrink-0">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setEditingSource({ platform, index });
                                            setEditingSourceData({
                                              name: source.name || "",
                                              url: source.url,
                                            });
                                          }}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={async () => {
                                            if (
                                              !confirm(
                                                "Are you sure you want to delete this source?"
                                              )
                                            )
                                              return;
                                            try {
                                              const response = await fetch(
                                                "/api/admin/brand-directory/taxonomy-sources/delete",
                                                {
                                                  method: "DELETE",
                                                  headers: { "Content-Type": "application/json" },
                                                  credentials: "include",
                                                  body: JSON.stringify({
                                                    linkId: source.id,
                                                    linkType,
                                                  }),
                                                }
                                              );
                                              if (!response.ok) {
                                                throw new Error("Failed to delete");
                                              }
                                              toast({
                                                title: "Success",
                                                description: "Source deleted",
                                              });
                                              fetchExistingSources();
                                            } catch (error) {
                                              toast({
                                                title: "Error",
                                                description:
                                                  error instanceof Error
                                                    ? error.message
                                                    : "Failed to delete",
                                                variant: "destructive",
                                              });
                                            }
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                              <div className="border-t pt-3 mt-3">
                                <div className="space-y-2">
                                  <Label>Add New Source</Label>
                                  <Input
                                    placeholder="Name (optional)"
                                    value={newSourceData[platform]?.name || ""}
                                    onChange={(e) =>
                                      setNewSourceData({
                                        ...newSourceData,
                                        [platform]: {
                                          ...newSourceData[platform],
                                          name: e.target.value,
                                          url: newSourceData[platform]?.url || "",
                                        },
                                      })
                                    }
                                    className="max-w-[60%]"
                                  />
                                  <Input
                                    placeholder="URL"
                                    value={newSourceData[platform]?.url || ""}
                                    onChange={(e) =>
                                      setNewSourceData({
                                        ...newSourceData,
                                        [platform]: {
                                          ...newSourceData[platform],
                                          name: newSourceData[platform]?.name || "",
                                          url: e.target.value,
                                        },
                                      })
                                    }
                                    className="max-w-[60%]"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      const newSource = newSourceData[platform];
                                      if (!newSource?.url) {
                                        toast({
                                          title: "Error",
                                          description: "URL is required",
                                          variant: "destructive",
                                        });
                                        return;
                                      }
                                      try {
                                        const response = await fetch(
                                          "/api/admin/brand-directory/taxonomy-sources/save",
                                          {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            credentials: "include",
                                            body: JSON.stringify({
                                              taxonomyNode: {
                                                type: selected?.type,
                                                category: selected?.category,
                                                subcategory: selected?.subcategory,
                                                sub_subcategory: selected?.sub_subcategory,
                                                id: selected?.id,
                                              },
                                              links: [
                                                {
                                                  platform,
                                                  linkType,
                                                  sourceCategory: firstSource?.sourceCategory,
                                                  url: newSource.url,
                                                  channel_name: newSource.name || null,
                                                },
                                              ],
                                            }),
                                          }
                                        );
                                        if (!response.ok) {
                                          throw new Error("Failed to add");
                                        }
                                        toast({ title: "Success", description: "Source added" });
                                        setNewSourceData({
                                          ...newSourceData,
                                          [platform]: { name: "", url: "" },
                                        });
                                        fetchExistingSources();
                                      } catch (error) {
                                        toast({
                                          title: "Error",
                                          description:
                                            error instanceof Error
                                              ? error.message
                                              : "Failed to add",
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                  >
                                    Add Source
                                  </Button>
                                </div>
                              </div>
                            </TabsContent>
                          );
                        })}
                      </Tabs>
                    );
                  })()}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
