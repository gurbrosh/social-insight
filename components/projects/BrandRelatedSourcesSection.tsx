"use client";

import { useState, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, X, Pencil, Trash2, Search } from "lucide-react";
import type {
  LinkType,
  InfluencerPlatform,
  SourceCategory,
} from "@/lib/brand-directory/brand-additional-links-service";

interface Brand {
  id: string;
  brand_name: string;
  company_name: string;
}

interface Source {
  id?: string;
  link_type: LinkType;
  platform?: InfluencerPlatform;
  source_category?: SourceCategory;
  url: string;
  channel_name?: string;
}

interface BrandRelatedSourcesSectionProps {
  projectId: string | null;
  brands: Brand[];
  /** Project "Keywords to monitor" — primary signal for influencer expertise (ideas/themes). */
  projectKeywords?: string[];
}

export interface BrandRelatedSourcesSectionRef {
  getSourcesForBrand: (brandId: string) => Source[];
  getAllSources: () => Map<string, Source[]>;
  saveSourcesForProject: (projectId: string) => Promise<void>;
}

const INFLUENCER_PLATFORMS: InfluencerPlatform[] = [
  "TWITTER",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TIKTOK",
  "BLUESKY",
  "YOUTUBE",
];

const SOURCE_CATEGORIES: SourceCategory[] = ["NEWS_OUTLET", "BLOG", "PODCAST"];

export const BrandRelatedSourcesSection = forwardRef<
  BrandRelatedSourcesSectionRef,
  BrandRelatedSourcesSectionProps
>(({ projectId, brands, projectKeywords = [] }, ref) => {
  // Filter brands that have brand_id (linked to brand directory) - memoize to prevent infinite loops
  const linkedBrands = useMemo(() => brands.filter((b) => b.id), [brands]);

  // Create stable brand IDs array for dependency comparison
  const linkedBrandIds = useMemo(
    () =>
      linkedBrands
        .map((b) => b.id)
        .sort()
        .join(","),
    [linkedBrands]
  );

  // Default to "all" when there are multiple brands, otherwise use the single brand or null
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(() => {
    return linkedBrands.length > 1 ? "all" : linkedBrands.length > 0 ? linkedBrands[0].id : null;
  });
  const [sources, setSources] = useState<Map<string, Source[]>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"reddit" | "discord" | "influencers" | "other">(
    "influencers"
  );
  const [activePlatform, setActivePlatform] = useState<InfluencerPlatform>("TWITTER");
  const [activeCategory, setActiveCategory] = useState<SourceCategory>("NEWS_OUTLET");
  const [editingSource, setEditingSource] = useState<{ brandId: string; index: number } | null>(
    null
  );
  const [newSourceData, setNewSourceData] = useState<Partial<Source>>({});

  // Search Sources state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
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
  const [editingDialogSource, setEditingDialogSource] = useState<{
    platform: string;
    index: number;
  } | null>(null);
  const [editingDialogSourceData, setEditingDialogSourceData] = useState<{
    name: string;
    url: string;
  }>({ name: "", url: "" });
  const [newDialogSourceData, setNewDialogSourceData] = useState<
    Record<string, { name: string; url: string }>
  >({});

  // Load default sources for all brands on mount
  useEffect(() => {
    if (linkedBrands.length === 0) return;

    const loadDefaultSources = async () => {
      setIsLoading(true);
      try {
        const sourcesMap = new Map<string, Source[]>();

        for (const brand of linkedBrands) {
          if (!projectId) {
            // For new projects, load defaults from brand directory
            const response = await fetch(`/api/brand-directory/brands/${brand.id}/default-sources`);
            if (response.ok) {
              const data = await response.json();
              sourcesMap.set(brand.id, data.sources || []);
            }
          } else {
            // For existing projects, get effective sources (project sources if exist, else defaults)
            const projectResponse = await fetch(
              `/api/projects/${projectId}/brand-sources?brandId=${brand.id}`
            );
            if (projectResponse.ok) {
              const projectData = await projectResponse.json();
              if (projectData.sources && projectData.sources.length > 0) {
                // Project sources exist, use them
                const mappedSources = projectData.sources.map((s: any) => ({
                  id: s.id,
                  link_type: s.link_type,
                  platform: s.platform || undefined,
                  source_category: s.source_category || undefined,
                  url: s.url,
                  channel_name: s.channel_name || undefined,
                }));
                console.log(
                  `[BrandRelatedSources] Loaded ${mappedSources.length} project sources for brand ${brand.id}:`,
                  mappedSources
                );
                sourcesMap.set(brand.id, mappedSources);
              } else {
                // No project sources, load defaults
                const defaultsResponse = await fetch(
                  `/api/projects/${projectId}/brand-sources/defaults?brandId=${brand.id}`
                );
                if (defaultsResponse.ok) {
                  const defaultsData = await defaultsResponse.json();
                  sourcesMap.set(brand.id, defaultsData.sources || []);
                }
              }
            }
          }
        }

        setSources(sourcesMap);
      } catch (error) {
        console.error("Error loading sources:", error);
        toast({
          title: "Error",
          description: "Failed to load brand sources",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadDefaultSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, linkedBrandIds]);

  // Update selectedBrandId when brands change - always default to "all" when there are multiple brands
  useEffect(() => {
    if (linkedBrands.length === 0) {
      setSelectedBrandId(null);
    } else if (linkedBrands.length === 1) {
      // If there's only one brand, use that brand
      if (selectedBrandId !== linkedBrands[0].id) {
        setSelectedBrandId(linkedBrands[0].id);
      }
    } else if (linkedBrands.length > 1) {
      // If there are multiple brands, ALWAYS default to "all" to avoid showing warnings about single-brand changes
      // This ensures users see "All Brands" by default when there are multiple brands
      setSelectedBrandId("all");
    }
  }, [linkedBrandIds]); // Use linkedBrandIds instead of linkedBrands to avoid unnecessary re-runs

  const isAllBrandsSelected = selectedBrandId === "all";
  const selectedBrand = isAllBrandsSelected
    ? null
    : linkedBrands.find((b) => b.id === selectedBrandId);

  // Calculate total sources across all brands for the project - DEDUPLICATE by URL
  // When "All Brands" is selected, sources are duplicated across brands, so we need to deduplicate
  const allProjectSources = useMemo(() => {
    const allSources = Array.from(sources.values()).flat();
    // Deduplicate by normalized URL
    const seenUrls = new Set<string>();
    const uniqueSources: Source[] = [];

    // Helper function to normalize URLs for duplicate detection (local to this useMemo)
    const normalizeUrlForDedup = (url: string | null | undefined): string | null => {
      if (!url) return null;
      return url
        .toLowerCase()
        .trim()
        .replace(/\/$/, "")
        .replace(/^https?:\/\/(www\.)?/, "");
    };

    for (const source of allSources) {
      const normalizedUrl = normalizeUrlForDedup(source.url);
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        uniqueSources.push(source);
      }
    }

    return uniqueSources;
  }, [sources]);

  // For "All Brands", combine sources from all brands - DEDUPLICATE by URL
  // When "All Brands" is selected, sources are duplicated across brands, so we need to deduplicate
  const currentSources = useMemo(() => {
    if (isAllBrandsSelected) {
      // Use deduplicated sources when "All Brands" is selected
      return allProjectSources;
    } else if (selectedBrandId) {
      return sources.get(selectedBrandId) || [];
    }
    return [];
  }, [isAllBrandsSelected, selectedBrandId, sources, allProjectSources]);

  // Count sources by category (using deduplicated sources)
  // Deduplicate again by URL to ensure accurate counts (in case allProjectSources deduplication missed some)
  const sourceCounts = useMemo(() => {
    // Helper to normalize URLs for counting
    const normalizeUrlForCount = (url: string | null | undefined): string | null => {
      if (!url) return null;
      return url
        .toLowerCase()
        .trim()
        .replace(/\/$/, "")
        .replace(/^https?:\/\/(www\.)?/, "");
    };

    // Count influencers (deduplicated by URL)
    const influencerUrls = new Set<string>();
    allProjectSources
      .filter((s) => s.link_type === "INFLUENCER")
      .forEach((s) => {
        const normalized = normalizeUrlForCount(s.url);
        if (normalized) influencerUrls.add(normalized);
      });

    // Count publications (all OTHER_SOURCE types: NEWS_OUTLET, BLOG, PODCAST, deduplicated by URL)
    const publicationUrls = new Set<string>();
    allProjectSources
      .filter((s) => s.link_type === "OTHER_SOURCE")
      .forEach((s) => {
        const normalized = normalizeUrlForCount(s.url);
        if (normalized) publicationUrls.add(normalized);
      });

    // Count reddit (deduplicated by URL)
    const redditUrls = new Set<string>();
    allProjectSources
      .filter((s) => s.link_type === "REDDIT")
      .forEach((s) => {
        const normalized = normalizeUrlForCount(s.url);
        if (normalized) redditUrls.add(normalized);
      });

    // Count discord (deduplicated by URL)
    const discordUrls = new Set<string>();
    allProjectSources
      .filter((s) => s.link_type === "DISCORD")
      .forEach((s) => {
        const normalized = normalizeUrlForCount(s.url);
        if (normalized) discordUrls.add(normalized);
      });

    const influencers = influencerUrls.size;
    const publications = publicationUrls.size;
    const reddit = redditUrls.size;
    const discord = discordUrls.size;
    const total = influencers + publications + reddit + discord;

    return { influencers, publications, reddit, discord, total };
  }, [allProjectSources]);

  const fetchExistingSources = async () => {
    if (!selectedBrandId) return;

    setIsLoadingSources(true);
    try {
      // Get sources from the current sources map (already loaded)
      const brandSources = sources.get(selectedBrandId) || [];

      // Group sources by platform/source category
      const grouped: Record<
        string,
        Array<{
          id: string;
          url: string;
          name?: string | null;
          platform?: string;
          sourceCategory?: string;
          linkType: string;
        }>
      > = {};

      for (const source of brandSources) {
        let key: string;
        if (source.link_type === "REDDIT") {
          key = "REDDIT";
        } else if (source.link_type === "DISCORD") {
          key = "DISCORD";
        } else if (source.link_type === "INFLUENCER" && source.platform) {
          key = source.platform;
        } else if (source.link_type === "OTHER_SOURCE" && source.source_category) {
          key = source.source_category;
        } else {
          continue;
        }

        if (!grouped[key]) {
          grouped[key] = [];
        }

        grouped[key].push({
          id: source.id || `temp-${Date.now()}-${Math.random()}`,
          url: source.url,
          name: source.channel_name || null,
          platform: source.platform,
          sourceCategory: source.source_category,
          linkType: source.link_type,
        });
      }

      setExistingSources(grouped);
    } catch (error) {
      console.error("Error fetching existing sources:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch sources",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSources(false);
    }
  };

  const getSourcesByType = (
    type: LinkType,
    platform?: InfluencerPlatform,
    category?: SourceCategory
  ) => {
    return currentSources.filter((s) => {
      if (s.link_type !== type) return false;
      if (type === "INFLUENCER" && platform) {
        return s.platform === platform;
      }
      if (type === "OTHER_SOURCE" && category) {
        return s.source_category === category;
      }
      return true;
    });
  };

  // Helper function to normalize URLs for duplicate detection
  const normalizeUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url
      .toLowerCase()
      .trim()
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
  };

  // Deduplicate search results within each platform
  const deduplicateSearchResults = (
    results: Record<
      string,
      Array<{ name?: string | null; url: string | null; selected: boolean; isDuplicate?: boolean }>
    >,
    currentUrls: Set<string>
  ): Record<
    string,
    Array<{ name?: string | null; url: string | null; selected: boolean; isDuplicate?: boolean }>
  > => {
    const deduplicated: Record<
      string,
      Array<{ name?: string | null; url: string | null; selected: boolean; isDuplicate?: boolean }>
    > = {};
    const seenUrls = new Set<string>();

    for (const [platform, platformResults] of Object.entries(results)) {
      const uniqueResults: Array<{
        name?: string | null;
        url: string | null;
        selected: boolean;
        isDuplicate?: boolean;
      }> = [];
      const seenInPlatform = new Set<string>();

      for (const result of platformResults) {
        const normalizedUrl = normalizeUrl(result.url);

        // Check if it's a duplicate against existing sources
        const isDuplicateAgainstExisting = normalizedUrl ? currentUrls.has(normalizedUrl) : false;

        // Check if it's a duplicate within this platform
        const isDuplicateInPlatform = normalizedUrl ? seenInPlatform.has(normalizedUrl) : false;

        // Skip duplicates within the platform
        if (isDuplicateInPlatform) {
          continue;
        }

        // Track this URL
        if (normalizedUrl) {
          seenInPlatform.add(normalizedUrl);
          seenUrls.add(normalizedUrl);
        }

        uniqueResults.push({
          ...result,
          isDuplicate: isDuplicateAgainstExisting,
          selected: !isDuplicateAgainstExisting && result.selected !== false,
        });
      }

      deduplicated[platform] = uniqueResults;
    }

    return deduplicated;
  };

  const handleAddSource = () => {
    if (!selectedBrandId) return;

    const url = newSourceData.url?.trim();
    if (!url) {
      toast({
        title: "Error",
        description: "URL is required",
        variant: "destructive",
      });
      return;
    }

    if (activeTab === "influencers" && !newSourceData.platform) {
      toast({
        title: "Error",
        description: "Platform is required for influencers",
        variant: "destructive",
      });
      return;
    }

    if (activeTab === "other" && !newSourceData.source_category) {
      toast({
        title: "Error",
        description: "Source category is required",
        variant: "destructive",
      });
      return;
    }

    const newSource: Source = {
      link_type:
        activeTab === "reddit"
          ? "REDDIT"
          : activeTab === "discord"
            ? "DISCORD"
            : activeTab === "influencers"
              ? "INFLUENCER"
              : "OTHER_SOURCE",
      platform: activeTab === "influencers" ? newSourceData.platform : undefined,
      source_category: activeTab === "other" ? newSourceData.source_category : undefined,
      url,
      channel_name: newSourceData.channel_name?.trim() || undefined,
    };

    const updatedSourcesMap = new Map(sources);

    if (isAllBrandsSelected) {
      // Add to all brands
      for (const brand of linkedBrands) {
        const brandSources = sources.get(brand.id) || [];
        updatedSourcesMap.set(brand.id, [...brandSources, newSource]);
      }
      toast({
        title: "Success",
        description: `Added source to all ${linkedBrands.length} brands`,
      });
    } else {
      // Add to selected brand
      const updatedSources = [...currentSources, newSource];
      updatedSourcesMap.set(selectedBrandId, updatedSources);
    }

    setSources(updatedSourcesMap);
    setNewSourceData({});
  };

  const handleEditSource = (index: number) => {
    if (!selectedBrandId) return;
    const source = currentSources[index];
    setEditingSource({ brandId: selectedBrandId, index });
    setNewSourceData({
      url: source.url,
      channel_name: source.channel_name,
      platform: source.platform,
      source_category: source.source_category,
    });
  };

  const handleSaveEdit = () => {
    if (!selectedBrandId || !editingSource) return;

    const url = newSourceData.url?.trim();
    if (!url) {
      toast({
        title: "Error",
        description: "URL is required",
        variant: "destructive",
      });
      return;
    }

    const updatedSourcesMap = new Map(sources);

    if (isAllBrandsSelected) {
      // Find the original source by URL and update it in all brands that have it
      const originalSource = currentSources[editingSource.index];
      const originalUrl = originalSource.url;

      const updatedSource: Source = {
        ...originalSource,
        url,
        channel_name: newSourceData.channel_name?.trim() || undefined,
        platform: newSourceData.platform,
        source_category: newSourceData.source_category,
      };

      // Update in all brands that have this source
      for (const brand of linkedBrands) {
        const brandSources = sources.get(brand.id) || [];
        const sourceIndex = brandSources.findIndex((s) => s.url === originalUrl);
        if (sourceIndex !== -1) {
          const updatedBrandSources = [...brandSources];
          updatedBrandSources[sourceIndex] = updatedSource;
          updatedSourcesMap.set(brand.id, updatedBrandSources);
        }
      }

      toast({
        title: "Success",
        description: `Updated source in all brands that had it`,
      });
    } else {
      // Update in selected brand only
      const updatedSources = [...currentSources];
      updatedSources[editingSource.index] = {
        ...updatedSources[editingSource.index],
        url,
        channel_name: newSourceData.channel_name?.trim() || undefined,
        platform: newSourceData.platform,
        source_category: newSourceData.source_category,
      };
      updatedSourcesMap.set(selectedBrandId, updatedSources);
    }

    setSources(updatedSourcesMap);
    setEditingSource(null);
    setNewSourceData({});
  };

  const handleDeleteSource = (index: number) => {
    if (!selectedBrandId) return;

    const sourceToDelete = currentSources[index];
    const updatedSourcesMap = new Map(sources);

    if (isAllBrandsSelected) {
      // Delete from all brands that have this source
      const urlToDelete = sourceToDelete.url;
      for (const brand of linkedBrands) {
        const brandSources = sources.get(brand.id) || [];
        const filteredSources = brandSources.filter((s) => s.url !== urlToDelete);
        updatedSourcesMap.set(brand.id, filteredSources);
      }
      toast({
        title: "Success",
        description: `Deleted source from all brands that had it`,
      });
    } else {
      // Delete from selected brand only
      const updatedSources = currentSources.filter((_, i) => i !== index);
      updatedSourcesMap.set(selectedBrandId, updatedSources);
    }

    setSources(updatedSourcesMap);
  };

  // Expose methods via ref for parent forms to call
  useImperativeHandle(ref, () => ({
    getSourcesForBrand: (brandId: string) => {
      return sources.get(brandId) || [];
    },
    getAllSources: () => {
      return sources;
    },
    saveSourcesForProject: async (projectIdToSave: string) => {
      setIsSaving(true);
      try {
        for (const [brandId, brandSources] of sources.entries()) {
          if (brandSources.length > 0) {
            const response = await fetch(`/api/projects/${projectIdToSave}/brand-sources`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                brandId,
                sources: brandSources,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || `Failed to save sources for brand ${brandId}`);
            }
          } else {
            // Brand has no sources in UI – clear project overrides so backend reverts to defaults
            const response = await fetch(
              `/api/projects/${projectIdToSave}/brand-sources?brandId=${encodeURIComponent(brandId)}`,
              { method: "DELETE", credentials: "include" }
            );

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || `Failed to clear sources for brand ${brandId}`);
            }
          }
        }
      } catch (error) {
        console.error("[BrandRelatedSources] Error saving sources:", error);
        throw error; // Re-throw so parent can handle
      } finally {
        setIsSaving(false);
      }
    },
  }));

  if (linkedBrands.length === 0) {
    return null; // Don't show section if no linked brands
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand Related Sources</CardTitle>
        <CardDescription>
          Customize which sources and links to scrape for each brand in this project. Sources
          default to brand directory and taxonomy data, but can be overridden per project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Brand Selection */}
        <div className="space-y-2">
          <Label>Select Brand</Label>
          <Select
            value={selectedBrandId || ""}
            onValueChange={(value) => {
              setSelectedBrandId(value);
              setActiveTab("reddit");
              setEditingSource(null);
              setNewSourceData({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a brand" />
            </SelectTrigger>
            <SelectContent>
              {linkedBrands.length > 1 && <SelectItem value="all">All Brands</SelectItem>}
              {linkedBrands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.brand_name} ({brand.company_name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {linkedBrands.length > 0 && (
            <div className="mt-2 text-sm text-muted-foreground">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Total Sources:</span>
                  <span className="font-semibold">{sourceCounts.total}</span>
                </div>
                <div className="text-xs flex items-center gap-3 flex-wrap">
                  <span>{sourceCounts.influencers} Influencers</span>
                  <span>{sourceCounts.publications} Publications</span>
                  <span>{sourceCounts.reddit} Reddit</span>
                  <span>{sourceCounts.discord} Discord</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Search Sources Button */}
        {selectedBrandId && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsSearchDialogOpen(true)}
              disabled={isLoading || isSaving}
            >
              <Search className="h-4 w-4 mr-2" />
              Search Sources
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : selectedBrand || isAllBrandsSelected ? (
          <>
            {selectedBrand && !isAllBrandsSelected && linkedBrands.length > 1 && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  <strong>{selectedBrand.brand_name}</strong> - You are editing sources for this
                  brand only. You can add brand-specific sources, remove sources that don't apply,
                  or modify existing ones. These changes will only affect{" "}
                  <strong>{selectedBrand.brand_name}</strong> and will not impact other brands in
                  this project.
                </p>
              </div>
            )}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="influencers">Influencers</TabsTrigger>
                <TabsTrigger value="other">Publications</TabsTrigger>
                <TabsTrigger value="reddit">Reddit</TabsTrigger>
                <TabsTrigger value="discord">Discord</TabsTrigger>
              </TabsList>

              {/* Influencers */}
              <TabsContent value="influencers" className="space-y-4 mt-4">
                <div className="space-y-4">
                  {/* Platform Summary */}
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <Label className="text-sm font-medium mb-2 block">Sources by Platform</Label>
                    <div className="flex flex-wrap gap-2">
                      {INFLUENCER_PLATFORMS.map((platform) => {
                        const count = getSourcesByType("INFLUENCER", platform).length;
                        if (count === 0) return null;
                        return (
                          <div
                            key={platform}
                            className={`px-2 py-1 rounded text-xs ${
                              activePlatform === platform
                                ? "bg-primary text-primary-foreground"
                                : "bg-background border"
                            }`}
                          >
                            {platform === "TWITTER" ? "X" : platform}: {count}
                          </div>
                        );
                      })}
                      {INFLUENCER_PLATFORMS.every(
                        (p) => getSourcesByType("INFLUENCER", p).length === 0
                      ) && (
                        <span className="text-xs text-muted-foreground">
                          No influencers added yet
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Platform</Label>
                    <Select
                      value={activePlatform}
                      onValueChange={(v) => setActivePlatform(v as InfluencerPlatform)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INFLUENCER_PLATFORMS.map((platform) => {
                          const count = getSourcesByType("INFLUENCER", platform).length;
                          return (
                            <SelectItem key={platform} value={platform}>
                              {platform === "TWITTER" ? "Twitter (X)" : platform}
                              {count > 0 && ` (${count})`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <Label>
                      {activePlatform === "TWITTER" ? "Twitter (X)" : activePlatform} Influencers
                      {getSourcesByType("INFLUENCER", activePlatform).length > 0 && (
                        <span className="text-muted-foreground ml-2">
                          ({getSourcesByType("INFLUENCER", activePlatform).length})
                        </span>
                      )}
                    </Label>
                    <div className="border rounded-lg p-2 max-h-[280px] overflow-y-auto">
                      <div className="space-y-2">
                        {getSourcesByType("INFLUENCER", activePlatform).map((source, index) => {
                          const globalIndex = currentSources.findIndex(
                            (s) =>
                              s.link_type === "INFLUENCER" &&
                              s.platform === activePlatform &&
                              s.url === source.url
                          );
                          return (
                            <div key={index} className="flex items-center gap-2 p-2 border rounded">
                              <div className="flex-1">
                                {source.channel_name && (
                                  <div className="font-medium">{source.channel_name}</div>
                                )}
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {source.url}
                                </a>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditSource(globalIndex)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteSource(globalIndex)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        })}
                        {getSourcesByType("INFLUENCER", activePlatform).length === 0 && (
                          <div className="text-sm text-muted-foreground text-center py-4">
                            No {activePlatform === "TWITTER" ? "Twitter (X)" : activePlatform}{" "}
                            influencers added yet
                          </div>
                        )}
                      </div>
                    </div>
                    {editingSource &&
                      getSourcesByType("INFLUENCER", activePlatform)[editingSource.index] && (
                        <div className="p-2 border rounded space-y-2">
                          <Input
                            placeholder="Name (optional)"
                            value={newSourceData.channel_name || ""}
                            onChange={(e) =>
                              setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                            }
                          />
                          <Input
                            placeholder="Profile URL"
                            value={newSourceData.url || ""}
                            onChange={(e) =>
                              setNewSourceData({ ...newSourceData, url: e.target.value })
                            }
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleSaveEdit}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingSource(null);
                                setNewSourceData({});
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    {(!editingSource ||
                      getSourcesByType("INFLUENCER", activePlatform)[editingSource.index] ===
                        undefined) && (
                      <div className="space-y-2 mt-8">
                        <Input
                          placeholder="Name (optional)"
                          value={newSourceData.channel_name || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                          }
                        />
                        <Input
                          placeholder="Profile URL"
                          value={newSourceData.url || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, url: e.target.value })
                          }
                        />
                        <Button
                          type="button"
                          onClick={() => {
                            setNewSourceData({ ...newSourceData, platform: activePlatform });
                            handleAddSource();
                          }}
                          size="sm"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add {activePlatform === "TWITTER" ? "Twitter (X)" : activePlatform}{" "}
                          Influencer
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Other Sources */}
              <TabsContent value="other" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Source Category</Label>
                    <Select
                      value={activeCategory}
                      onValueChange={(v) => setActiveCategory(v as SourceCategory)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NEWS_OUTLET">Publications</SelectItem>
                        <SelectItem value="BLOG">Blogs</SelectItem>
                        <SelectItem value="PODCAST">Podcasts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <Label>
                      {activeCategory === "NEWS_OUTLET"
                        ? "Publications"
                        : activeCategory === "BLOG"
                          ? "Blogs"
                          : "Podcasts"}
                    </Label>
                    <div className="border rounded-lg p-2 max-h-[280px] overflow-y-auto">
                      <div className="space-y-2">
                        {getSourcesByType("OTHER_SOURCE", undefined, activeCategory).map(
                          (source, index) => {
                            const globalIndex = currentSources.findIndex(
                              (s) =>
                                s.link_type === "OTHER_SOURCE" &&
                                s.source_category === activeCategory &&
                                s.url === source.url
                            );
                            return (
                              <div
                                key={index}
                                className="flex items-center gap-2 p-2 border rounded"
                              >
                                <div className="flex-1">
                                  {source.channel_name && (
                                    <div className="font-medium">{source.channel_name}</div>
                                  )}
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {source.url}
                                  </a>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditSource(globalIndex)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteSource(globalIndex)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            );
                          }
                        )}
                        {getSourcesByType("OTHER_SOURCE", undefined, activeCategory).length ===
                          0 && (
                          <div className="text-sm text-muted-foreground text-center py-4">
                            No{" "}
                            {activeCategory === "NEWS_OUTLET"
                              ? "publications"
                              : activeCategory === "BLOG"
                                ? "blogs"
                                : "podcasts"}{" "}
                            added yet
                          </div>
                        )}
                      </div>
                    </div>
                    {editingSource &&
                      getSourcesByType("OTHER_SOURCE", undefined, activeCategory)[
                        editingSource.index
                      ] && (
                        <div className="p-2 border rounded space-y-2">
                          <Input
                            placeholder="Name (optional)"
                            value={newSourceData.channel_name || ""}
                            onChange={(e) =>
                              setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                            }
                          />
                          <Input
                            placeholder="Source URL"
                            value={newSourceData.url || ""}
                            onChange={(e) =>
                              setNewSourceData({ ...newSourceData, url: e.target.value })
                            }
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleSaveEdit}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingSource(null);
                                setNewSourceData({});
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    {(!editingSource ||
                      getSourcesByType("OTHER_SOURCE", undefined, activeCategory)[
                        editingSource.index
                      ] === undefined) && (
                      <div className="space-y-2 mt-8">
                        <Input
                          placeholder="Name (optional)"
                          value={newSourceData.channel_name || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                          }
                        />
                        <Input
                          placeholder="Source URL"
                          value={newSourceData.url || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, url: e.target.value })
                          }
                        />
                        <Button
                          type="button"
                          onClick={() => {
                            setNewSourceData({ ...newSourceData, source_category: activeCategory });
                            handleAddSource();
                          }}
                          size="sm"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add{" "}
                          {activeCategory === "NEWS_OUTLET"
                            ? "Publication"
                            : activeCategory === "BLOG"
                              ? "Blog"
                              : "Podcast"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Reddit */}
              <TabsContent value="reddit" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <Label>Reddit</Label>
                  <div className="border rounded-lg p-2 max-h-[280px] overflow-y-auto">
                    <div className="space-y-2">
                      {getSourcesByType("REDDIT").map((source, index) => {
                        const globalIndex = currentSources.findIndex(
                          (s) => s.link_type === "REDDIT" && s.url === source.url
                        );
                        return (
                          <div key={index} className="flex items-center gap-2 p-2 border rounded">
                            <div className="flex-1">
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {source.url}
                              </a>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditSource(globalIndex)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSource(globalIndex)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                      {getSourcesByType("REDDIT").length === 0 && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          No Reddit links added yet
                        </div>
                      )}
                    </div>
                  </div>
                  {editingSource && currentSources[editingSource.index]?.link_type === "REDDIT" && (
                    <div className="p-2 border rounded space-y-2">
                      <Input
                        placeholder="Reddit URL"
                        value={newSourceData.url || ""}
                        onChange={(e) =>
                          setNewSourceData({ ...newSourceData, url: e.target.value })
                        }
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveEdit}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingSource(null);
                            setNewSourceData({});
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  {(!editingSource ||
                    currentSources[editingSource?.index ?? -1]?.link_type !== "REDDIT") && (
                    <div className="space-y-2 mt-8">
                      <Input
                        placeholder="Reddit URL"
                        value={newSourceData.url || ""}
                        onChange={(e) =>
                          setNewSourceData({ ...newSourceData, url: e.target.value })
                        }
                      />
                      <Button type="button" onClick={handleAddSource} size="sm">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Reddit Link
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Discord */}
              <TabsContent value="discord" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <Label>Discord</Label>
                  <div className="border rounded-lg p-2 max-h-[280px] overflow-y-auto">
                    <div className="space-y-2">
                      {getSourcesByType("DISCORD").map((source, index) => {
                        const globalIndex = currentSources.findIndex(
                          (s) => s.link_type === "DISCORD" && s.url === source.url
                        );
                        return (
                          <div key={index} className="flex items-center gap-2 p-2 border rounded">
                            <div className="flex-1">
                              {source.channel_name && (
                                <div className="font-medium">{source.channel_name}</div>
                              )}
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {source.url}
                              </a>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditSource(globalIndex)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSource(globalIndex)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                      {getSourcesByType("DISCORD").length === 0 && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          No Discord links added yet
                        </div>
                      )}
                    </div>
                  </div>
                  {editingSource &&
                    currentSources[editingSource.index]?.link_type === "DISCORD" && (
                      <div className="p-2 border rounded space-y-2">
                        <Input
                          placeholder="Channel Name (optional)"
                          value={newSourceData.channel_name || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                          }
                        />
                        <Input
                          placeholder="Discord URL"
                          value={newSourceData.url || ""}
                          onChange={(e) =>
                            setNewSourceData({ ...newSourceData, url: e.target.value })
                          }
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEdit}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSource(null);
                              setNewSourceData({});
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  {(!editingSource ||
                    currentSources[editingSource?.index ?? -1]?.link_type !== "DISCORD") && (
                    <div className="space-y-2 mt-8">
                      <Input
                        placeholder="Channel Name (optional)"
                        value={newSourceData.channel_name || ""}
                        onChange={(e) =>
                          setNewSourceData({ ...newSourceData, channel_name: e.target.value })
                        }
                      />
                      <Input
                        placeholder="Discord URL"
                        value={newSourceData.url || ""}
                        onChange={(e) =>
                          setNewSourceData({ ...newSourceData, url: e.target.value })
                        }
                      />
                      <Button type="button" onClick={handleAddSource} size="sm">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Discord Link
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : null}

        {/* Search Sources Dialog */}
        <Dialog
          open={isSearchDialogOpen}
          onOpenChange={(open) => {
            setIsSearchDialogOpen(open);
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
                BLOG: {
                  enabled: false,
                  count: 10,
                  linkType: "OTHER_SOURCE",
                  sourceCategory: "BLOG",
                },
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
            }
          }}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Search Sources</DialogTitle>
              <DialogDescription>
                {isAllBrandsSelected
                  ? `Find sources using the shared business category for all brands. Influencer relevance uses your project keywords when set; otherwise brand directory keywords.`
                  : selectedBrand
                    ? `Find sources for ${selectedBrand.brand_name}. Influencer relevance uses your project keywords when set; otherwise the directory keywords stored for that brand.`
                    : "Search for sources"}
              </DialogDescription>
            </DialogHeader>
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
                    type="button"
                    variant="outline"
                    onClick={() => setIsSearchDialogOpen(false)}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
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

                      if (!selectedBrandId) return;

                      setIsSearching(true);
                      setIsSaving(true);

                      try {
                        const relevanceKeywords = Array.from(
                          new Set(projectKeywords.map((k) => k.trim()).filter(Boolean))
                        );

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

                        let response: Response;

                        if (isAllBrandsSelected) {
                          // Use taxonomy-based search for "All Brands"
                          // Get taxonomy from the first brand (all brands should share the same category)
                          if (linkedBrands.length === 0) {
                            throw new Error("No brands available");
                          }

                          // Fetch taxonomy from first brand
                          const taxonomyResponse = await fetch(
                            `/api/admin/brand-directory/brands/${linkedBrands[0].id}`,
                            { credentials: "include" }
                          );
                          if (!taxonomyResponse.ok) {
                            throw new Error("Failed to fetch brand taxonomy");
                          }
                          const brandData = await taxonomyResponse.json();

                          if (!brandData.brand?.businessTaxonomy) {
                            throw new Error("Brands must have a taxonomy assigned");
                          }

                          // Construct taxonomy node
                          const taxonomy = brandData.brand.businessTaxonomy;
                          let taxonomyNode: {
                            type: "category" | "subcategory" | "sub_subcategory";
                            category?: string;
                            subcategory?: string;
                            sub_subcategory?: string;
                          };

                          if (taxonomy.sub_subcategory) {
                            taxonomyNode = {
                              type: "sub_subcategory",
                              category: taxonomy.category || undefined,
                              subcategory: taxonomy.subcategory || undefined,
                              sub_subcategory: taxonomy.sub_subcategory,
                            };
                          } else if (taxonomy.subcategory) {
                            taxonomyNode = {
                              type: "subcategory",
                              category: taxonomy.category || undefined,
                              subcategory: taxonomy.subcategory,
                            };
                          } else if (taxonomy.category) {
                            taxonomyNode = {
                              type: "category",
                              category: taxonomy.category,
                            };
                          } else {
                            throw new Error("Invalid taxonomy structure");
                          }

                          // When project keywords are set, use them for relevance; else aggregate brand-directory keywords
                          const allBrandKeywords: string[] = [];
                          if (relevanceKeywords.length === 0) {
                            for (const brand of linkedBrands) {
                              try {
                                const brandResponse = await fetch(
                                  `/api/admin/brand-directory/brands/${brand.id}`,
                                  { credentials: "include" }
                                );
                                if (brandResponse.ok) {
                                  const brandData = await brandResponse.json();
                                  if (brandData.brand?.keywords) {
                                    const keywords = brandData.brand.keywords
                                      .filter((kw: any) => kw.deleted_at === null)
                                      .map((kw: any) => kw.keyword);
                                    allBrandKeywords.push(...keywords);
                                  }
                                }
                              } catch (error) {
                                console.error(
                                  `Error fetching keywords for brand ${brand.id}:`,
                                  error
                                );
                              }
                            }
                          }
                          const uniqueKeywords = Array.from(new Set(allBrandKeywords));

                          response = await fetch(
                            `/api/admin/brand-directory/taxonomy-sources/search`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                taxonomyNode,
                                platforms,
                                brandKeywords: uniqueKeywords,
                                projectKeywords: relevanceKeywords,
                              }),
                            }
                          );
                        } else {
                          response = await fetch(
                            `/api/admin/brand-directory/brands/${selectedBrandId}/search-sources`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                brandId: selectedBrandId,
                                platforms,
                                projectKeywords: relevanceKeywords,
                              }),
                            }
                          );
                        }

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

                              // Mark duplicates against current sources
                              // Deduplicate URLs first (in case same source exists in multiple brands when "All Brands" is selected)
                              const allUrls = (currentSources || [])
                                .map((s) => normalizeUrl(s.url))
                                .filter((url): url is string => url !== null);
                              const currentUrls = new Set(allUrls); // Set automatically deduplicates

                              // First, process results and mark duplicates against existing sources
                              const processedResults = Object.entries(
                                progressData.results || {}
                              ).reduce(
                                (acc, [platform, results]) => {
                                  acc[platform] = (results as any[]).map((result) => {
                                    // Skip duplicate checking if URL is null
                                    if (!result.url) {
                                      return {
                                        ...result,
                                        isDuplicate: false,
                                        selected: true, // Select items without URLs by default
                                      };
                                    }
                                    const normalized = normalizeUrl(result.url);
                                    const isDuplicate = normalized
                                      ? currentUrls.has(normalized)
                                      : false;
                                    return {
                                      ...result,
                                      isDuplicate,
                                      selected: !isDuplicate, // Don't select duplicates by default
                                    };
                                  });
                                  return acc;
                                },
                                {} as Record<
                                  string,
                                  Array<{
                                    name?: string | null;
                                    url: string | null;
                                    selected: boolean;
                                    isDuplicate?: boolean;
                                  }>
                                >
                              );

                              // Deduplicate within each platform
                              const deduplicatedResults = deduplicateSearchResults(
                                processedResults,
                                currentUrls
                              );

                              // Log for debugging
                              Object.entries(deduplicatedResults).forEach(([platform, results]) => {
                                console.log(
                                  `[BrandRelatedSources] ${platform}: ${results.length} unique results after deduplication`
                                );
                              });

                              setSearchResults(deduplicatedResults);
                              setIsSearching(false);
                              setIsSaving(false);
                            } else if (progressData.status === "error") {
                              clearInterval(pollInterval);
                              setSearchProgress({ progress: 0, status: "error" });
                              toast({
                                title: "Error",
                                description: progressData.error || "Search failed",
                                variant: "destructive",
                              });
                              setIsSearching(false);
                              setIsSaving(false);
                            } else {
                              setSearchProgress({
                                progress: progressData.progress || 0,
                                currentPlatform: progressData.currentPlatform,
                                status: progressData.status,
                              });
                              // Mark duplicates in partial results too
                              // Deduplicate URLs first (in case same source exists in multiple brands when "All Brands" is selected)
                              const allUrls = (currentSources || [])
                                .map((s) => normalizeUrl(s.url))
                                .filter((url): url is string => url !== null);
                              const currentUrls = new Set(allUrls); // Set automatically deduplicates
                              const processedResults = Object.entries(
                                progressData.results || {}
                              ).reduce(
                                (acc, [platform, results]) => {
                                  acc[platform] = (results as any[]).map((result) => {
                                    // Skip duplicate checking if URL is null
                                    if (!result.url) {
                                      return {
                                        ...result,
                                        isDuplicate: false,
                                        selected: result.selected !== false,
                                      };
                                    }
                                    const normalized = normalizeUrl(result.url);
                                    const isDuplicate = normalized
                                      ? currentUrls.has(normalized)
                                      : false;
                                    return {
                                      ...result,
                                      isDuplicate,
                                      selected: result.selected !== false && !isDuplicate,
                                    };
                                  });
                                  return acc;
                                },
                                {} as Record<
                                  string,
                                  Array<{
                                    name?: string | null;
                                    url: string | null;
                                    selected: boolean;
                                    isDuplicate?: boolean;
                                  }>
                                >
                              );

                              // Deduplicate within each platform
                              const deduplicatedResults = deduplicateSearchResults(
                                processedResults,
                                currentUrls
                              );

                              // Log for debugging
                              Object.entries(deduplicatedResults).forEach(([platform, results]) => {
                                console.log(
                                  `[BrandRelatedSources] ${platform}: ${results.length} unique results (partial)`
                                );
                              });

                              setSearchResults(deduplicatedResults);
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
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving || Object.values(selectedPlatforms).every((p) => !p.enabled)}
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
                  // Sort platforms: BLUESKY always last
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
                      setIsSearchDialogOpen(false);
                      setSearchResults({});
                      setIsSearching(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!selectedBrandId) return;

                      setIsSaving(true);
                      try {
                        // Collect all selected links
                        const linksToAdd: Source[] = [];

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
                              linksToAdd.push({
                                link_type: config.linkType as LinkType,
                                platform:
                                  config.linkType === "INFLUENCER"
                                    ? (platform as InfluencerPlatform)
                                    : undefined,
                                source_category:
                                  config.linkType === "OTHER_SOURCE"
                                    ? (config.sourceCategory as SourceCategory)
                                    : undefined,
                                url: result.url.trim(),
                                channel_name: result.name || undefined,
                              });
                            }
                          }
                        }

                        if (linksToAdd.length === 0) {
                          toast({
                            title: "Error",
                            description: "Please select at least one result to add",
                            variant: "destructive",
                          });
                          setIsSaving(false);
                          return;
                        }

                        // Add to sources - for "All Brands", add to all brands
                        const updatedSourcesMap = new Map(sources);

                        if (isAllBrandsSelected) {
                          // Add sources to all brands
                          for (const brand of linkedBrands) {
                            const currentBrandSources = sources.get(brand.id) || [];
                            const updatedBrandSources = [...currentBrandSources, ...linksToAdd];
                            updatedSourcesMap.set(brand.id, updatedBrandSources);
                          }
                          console.log(
                            `[BrandRelatedSources] Adding ${linksToAdd.length} sources to all ${linkedBrands.length} brands`
                          );
                        } else {
                          // Add sources to selected brand
                          const currentSourcesList = currentSources || [];
                          console.log(
                            `[BrandRelatedSources] Before adding: ${currentSourcesList.length} sources`
                          );
                          console.log(
                            `[BrandRelatedSources] Adding ${linksToAdd.length} new sources:`,
                            linksToAdd
                          );
                          const updatedSources = [...currentSourcesList, ...linksToAdd];
                          console.log(
                            `[BrandRelatedSources] After adding: ${updatedSources.length} total sources`
                          );
                          updatedSourcesMap.set(selectedBrandId, updatedSources);
                        }

                        setSources(updatedSourcesMap);

                        toast({
                          title: "Success",
                          description: isAllBrandsSelected
                            ? `Added ${linksToAdd.length} source(s) to all ${linkedBrands.length} brands. Sources will be saved when you save the project.`
                            : `Added ${linksToAdd.length} source(s) to ${selectedBrand?.brand_name}. Sources will be saved when you save the project.`,
                        });

                        setIsSearchDialogOpen(false);
                        setSearchResults({});
                        setIsSearching(false);
                      } catch (error) {
                        console.error("Error adding sources:", error);
                        toast({
                          title: "Error",
                          description:
                            error instanceof Error ? error.message : "Failed to add sources",
                          variant: "destructive",
                        });
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={
                      isSaving ||
                      Object.values(searchResults)
                        .flat()
                        .every((r) => !r.selected || r.isDuplicate)
                    }
                  >
                    Add Selected (
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
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
});

BrandRelatedSourcesSection.displayName = "BrandRelatedSourcesSection";
