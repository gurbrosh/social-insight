"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
type BrandStage = "ESTABLISHED" | "EMERGING" | "SMALL";

// Helper function to get missing links for a brand
function getMissingLinks(brand: Brand): string[] {
  const missing: string[] = [];

  const linkChecks: Array<{ url: string | null; label: string }> = [
    { url: brand.website_url, label: "Website" },
    { url: brand.careers_url, label: "Careers page" },
    { url: brand.blog_news_url, label: "Blog/News" },
    { url: brand.linkedin_url, label: "LinkedIn" },
    { url: brand.facebook_url, label: "Facebook" },
    { url: brand.x_url, label: "X (Twitter)" },
    { url: brand.instagram_url, label: "Instagram" },
    { url: brand.tiktok_url, label: "TikTok" },
    { url: brand.youtube_url, label: "YouTube" },
    { url: brand.discord_url, label: "Discord" },
  ];

  for (const { url, label } of linkChecks) {
    if (!url || url.trim() === "") {
      missing.push(label);
    }
  }

  return missing;
}

// Status cell component
function StatusCell({ brand }: { brand: Brand }) {
  const missingLinks = getMissingLinks(brand);
  const hasAllLinks = missingLinks.length === 0;
  const isApproved = brand.approved;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {/* Approval Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              {isApproved ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-gray-400" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isApproved ? "Approved" : "Not approved"}</p>
          </TooltipContent>
        </Tooltip>

        {/* Link Completion Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              {hasAllLinks ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {hasAllLinks ? (
              <p>All links provided</p>
            ) : (
              <div>
                <p className="font-semibold mb-1">Missing links:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {missingLinks.map((link, idx) => (
                    <li key={idx} className="text-sm">
                      {link}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

interface Taxonomy {
  id: string;
  category: string;
  subcategory: string;
  sub_subcategory: string;
}

interface Brand {
  id: string;
  company_name: string;
  brand_name: string;
  brand_stage: BrandStage;
  approved: boolean;
  website_url: string | null;
  careers_url: string | null;
  blog_news_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  discord_url: string | null;
  businessTaxonomy: {
    id: string;
    category: string;
    subcategory: string;
    sub_subcategory: string;
  };
  keywords: Array<{ id?: string; keyword: string }>;
  redditLinks?: Array<{
    id: string;
    url: string;
  }>;
}

interface BrandDirectoryPanelProps {
  initialPage: number;
  initialTaxonomyId?: string;
  initialBrandStage?: BrandStage;
  initialSearch?: string;
  taxonomies: Taxonomy[];
  itemsPerPage: number;
}

export function BrandDirectoryPanel({
  initialPage,
  initialTaxonomyId,
  initialBrandStage,
  initialSearch,
  taxonomies,
  itemsPerPage,
}: BrandDirectoryPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(initialPage);
  const [taxonomyId, setTaxonomyId] = useState<string>(initialTaxonomyId || "all");
  const [brandStage, setBrandStage] = useState<BrandStage | "all">(
    (initialBrandStage || "all") as BrandStage | "all"
  );
  const [search, setSearch] = useState<string>(initialSearch || "");
  const [taxonomySearch, setTaxonomySearch] = useState<string>("");
  const [isTaxonomyDropdownOpen, setIsTaxonomyDropdownOpen] = useState<boolean>(false);
  const taxonomyDropdownRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<
    "company_name" | "brand_name" | "category" | "brand_stage" | null
  >(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isAdditionalLinksDialogOpen, setIsAdditionalLinksDialogOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"reddit" | "discord" | "influencers" | "other">(
    "reddit"
  );
  const [activeInfluencerPlatform, setActiveInfluencerPlatform] = useState<
    "TWITTER" | "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "BLUESKY" | "YOUTUBE"
  >("TWITTER");
  const [activeSourceCategory, setActiveSourceCategory] = useState<
    "NEWS_OUTLET" | "BLOG" | "PODCAST"
  >("NEWS_OUTLET");

  // Link state for each type
  const [redditLinks, setRedditLinks] = useState<
    Array<{ id: string; url: string; link_type: string }>
  >([]);
  const [discordLinks, setDiscordLinks] = useState<
    Array<{ id: string; url: string; link_type: string; channel_name?: string | null }>
  >([]);
  const [influencerLinks, setInfluencerLinks] = useState<
    Record<
      string,
      Array<{
        id: string;
        url: string;
        link_type: string;
        platform: string;
        channel_name?: string | null;
      }>
    >
  >({
    TWITTER: [],
    LINKEDIN: [],
    FACEBOOK: [],
    INSTAGRAM: [],
    TIKTOK: [],
    BLUESKY: [],
    YOUTUBE: [],
  });

  // New link inputs
  const [newRedditLinks, setNewRedditLinks] = useState<string[]>([""]);
  const [newDiscordLinks, setNewDiscordLinks] = useState<
    Array<{ channel_name: string; url: string }>
  >([{ channel_name: "", url: "" }]);
  const [newInfluencerLinks, setNewInfluencerLinks] = useState<
    Record<string, Array<{ channel_name: string; url: string }>>
  >({
    TWITTER: [{ channel_name: "", url: "" }],
    LINKEDIN: [{ channel_name: "", url: "" }],
    FACEBOOK: [{ channel_name: "", url: "" }],
    INSTAGRAM: [{ channel_name: "", url: "" }],
    TIKTOK: [{ channel_name: "", url: "" }],
    BLUESKY: [{ channel_name: "", url: "" }],
    YOUTUBE: [{ channel_name: "", url: "" }],
  });

  // Other Sources state
  const [otherSourceLinks, setOtherSourceLinks] = useState<
    Record<
      string,
      Array<{
        id: string;
        url: string;
        link_type: string;
        source_category: string;
        channel_name?: string | null;
      }>
    >
  >({
    NEWS_OUTLET: [],
    BLOG: [],
    PODCAST: [],
  });

  const [newOtherSourceLinks, setNewOtherSourceLinks] = useState<
    Record<string, Array<{ channel_name: string; url: string }>>
  >({
    NEWS_OUTLET: [{ channel_name: "", url: "" }],
    BLOG: [{ channel_name: "", url: "" }],
    PODCAST: [{ channel_name: "", url: "" }],
  });

  // Edit form state
  const [editFormData, setEditFormData] = useState<{
    company_name: string;
    brand_name: string;
    business_taxonomy_id: string;
    brand_stage: BrandStage;
    approved: boolean;
    keywords: string[];
    website_url: string;
    careers_url: string;
    blog_news_url: string;
    linkedin_url: string;
    facebook_url: string;
    x_url: string;
    instagram_url: string;
    tiktok_url: string;
    youtube_url: string;
    discord_url: string;
  }>({
    company_name: "",
    brand_name: "",
    business_taxonomy_id: "",
    brand_stage: "ESTABLISHED",
    approved: false,
    keywords: [],
    website_url: "",
    careers_url: "",
    blog_news_url: "",
    linkedin_url: "",
    facebook_url: "",
    x_url: "",
    instagram_url: "",
    tiktok_url: "",
    youtube_url: "",
    discord_url: "",
  });

  const [newKeyword, setNewKeyword] = useState<string>("");

  const fetchBrands = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (taxonomyId && taxonomyId !== "all") params.set("taxonomyId", taxonomyId);
      if (brandStage && brandStage !== "all") params.set("brandStage", brandStage);
      if (search) params.set("search", search);
      if (sortBy) {
        params.set("sortBy", sortBy);
        params.set("sortOrder", sortOrder);
      }
      params.set("limit", itemsPerPage.toString());
      params.set("offset", ((page - 1) * itemsPerPage).toString());

      const response = await fetch(`/api/admin/brand-directory/brands?${params.toString()}`, {
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch brands");
      }

      setBrands(data.brands || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Error fetching brands:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch brands",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, taxonomyId, brandStage, sortBy, sortOrder]);

  // Debounced search: trigger search as user types
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (search !== undefined) {
        setPage(1);
        fetchBrands();
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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

  const handleSearch = () => {
    setPage(1);
    fetchBrands();
  };

  const handleClearFilters = () => {
    setTaxonomyId("all");
    setBrandStage("all" as BrandStage | "all");
    setSearch("");
    setSortBy(null);
    setSortOrder("asc");
    setPage(1);
  };

  const handleSort = (column: "company_name" | "brand_name" | "category" | "brand_stage") => {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      // Set new sort column and default to ascending
      setSortBy(column);
      setSortOrder("asc");
    }
    setPage(1); // Reset to first page when sorting changes
  };

  const handleEditClick = async (brand: Brand) => {
    setSelectedBrand(brand);

    // Fetch fresh brand data with keywords to ensure we have the latest
    try {
      const response = await fetch(`/api/admin/brand-directory/brands/${brand.id}`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        const freshBrand = data.brand;
        setEditFormData({
          company_name: freshBrand.company_name,
          brand_name: freshBrand.brand_name,
          business_taxonomy_id: freshBrand.businessTaxonomy.id,
          brand_stage: freshBrand.brand_stage,
          approved: freshBrand.approved,
          keywords: (freshBrand.keywords || [])
            .map((k: { keyword: string }) => k.keyword)
            .filter((k: string) => k && k.trim() !== ""),
          website_url: freshBrand.website_url || "",
          careers_url: freshBrand.careers_url || "",
          blog_news_url: freshBrand.blog_news_url || "",
          linkedin_url: freshBrand.linkedin_url || "",
          facebook_url: freshBrand.facebook_url || "",
          x_url: freshBrand.x_url || "",
          instagram_url: freshBrand.instagram_url || "",
          tiktok_url: freshBrand.tiktok_url || "",
          youtube_url: freshBrand.youtube_url || "",
          discord_url: freshBrand.discord_url || "",
        });
      } else {
        // Fallback to using the brand from the list
        setEditFormData({
          company_name: brand.company_name,
          brand_name: brand.brand_name,
          business_taxonomy_id: brand.businessTaxonomy.id,
          brand_stage: brand.brand_stage,
          approved: brand.approved,
          keywords: (brand.keywords || [])
            .map((k) => k.keyword)
            .filter((k) => k && k.trim() !== ""),
          website_url: brand.website_url || "",
          careers_url: brand.careers_url || "",
          blog_news_url: brand.blog_news_url || "",
          linkedin_url: brand.linkedin_url || "",
          facebook_url: brand.facebook_url || "",
          x_url: brand.x_url || "",
          instagram_url: brand.instagram_url || "",
          tiktok_url: brand.tiktok_url || "",
          youtube_url: brand.youtube_url || "",
          discord_url: brand.discord_url || "",
        });
      }
    } catch (error) {
      console.error("Error fetching brand details:", error);
      // Fallback to using the brand from the list
      setEditFormData({
        company_name: brand.company_name,
        brand_name: brand.brand_name,
        business_taxonomy_id: brand.businessTaxonomy.id,
        brand_stage: brand.brand_stage,
        approved: brand.approved,
        keywords: (brand.keywords || []).map((k) => k.keyword).filter((k) => k && k.trim() !== ""),
        website_url: brand.website_url || "",
        careers_url: brand.careers_url || "",
        blog_news_url: brand.blog_news_url || "",
        linkedin_url: brand.linkedin_url || "",
        facebook_url: brand.facebook_url || "",
        x_url: brand.x_url || "",
        instagram_url: brand.instagram_url || "",
        tiktok_url: brand.tiktok_url || "",
        youtube_url: brand.youtube_url || "",
        discord_url: brand.discord_url || "",
      });
    }

    setNewKeyword("");

    // Fetch Reddit links
    try {
      const redditResponse = await fetch(
        `/api/admin/brand-directory/brands/${brand.id}/reddit-links`,
        {
          credentials: "include",
        }
      );
      if (redditResponse.ok) {
        const redditData = await redditResponse.json();
        setRedditLinks(redditData.links || []);
      }
    } catch (error) {
      console.error("Error fetching Reddit links:", error);
      setRedditLinks([]);
    }

    setIsEditDialogOpen(true);
  };

  const handleAddKeyword = () => {
    if (newKeyword.trim() && !editFormData.keywords.includes(newKeyword.trim())) {
      setEditFormData({
        ...editFormData,
        keywords: [...editFormData.keywords, newKeyword.trim()],
      });
      setNewKeyword("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    setEditFormData({
      ...editFormData,
      keywords: editFormData.keywords.filter((k) => k !== keyword),
    });
  };

  const handleSave = async () => {
    if (!selectedBrand) return;

    setIsSaving(true);
    try {
      // Ensure keywords array is preserved - log for debugging
      const keywordsToSave = (editFormData.keywords || []).filter((k) => k && k.trim() !== "");
      console.log(
        `[handleSave] Saving brand ${selectedBrand.id} with ${keywordsToSave.length} keywords:`,
        keywordsToSave
      );

      const updateData: Record<string, unknown> = {
        company_name: editFormData.company_name.trim(),
        brand_name: editFormData.brand_name.trim(),
        business_taxonomy_id: editFormData.business_taxonomy_id,
        brand_stage: editFormData.brand_stage,
        approved: editFormData.approved,
        keywords: keywordsToSave,
        website_url: editFormData.website_url.trim() || null,
        careers_url: editFormData.careers_url.trim() || null,
        blog_news_url: editFormData.blog_news_url.trim() || null,
        linkedin_url: editFormData.linkedin_url.trim() || null,
        facebook_url: editFormData.facebook_url.trim() || null,
        x_url: editFormData.x_url.trim() || null,
        instagram_url: editFormData.instagram_url.trim() || null,
        tiktok_url: editFormData.tiktok_url.trim() || null,
        youtube_url: editFormData.youtube_url.trim() || null,
        discord_url: editFormData.discord_url.trim() || null,
      };

      const response = await fetch(`/api/admin/brand-directory/brands/${selectedBrand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update brand");
      }

      // Update local state with the response to ensure keywords are preserved
      if (data.brand) {
        const updatedBrand = data.brand;
        setSelectedBrand({
          ...updatedBrand,
          keywords: (updatedBrand.keywords || []).map((k: { id?: string; keyword: string }) => ({
            id: k.id || "",
            keyword: k.keyword,
          })),
        });
        // Also update editFormData to keep it in sync
        setEditFormData({
          company_name: updatedBrand.company_name,
          brand_name: updatedBrand.brand_name,
          business_taxonomy_id: updatedBrand.businessTaxonomy.id,
          brand_stage: updatedBrand.brand_stage,
          approved: updatedBrand.approved,
          keywords: (updatedBrand.keywords || [])
            .map((k: { keyword: string }) => k.keyword)
            .filter((k: string) => k && k.trim() !== ""),
          website_url: updatedBrand.website_url || "",
          careers_url: updatedBrand.careers_url || "",
          blog_news_url: updatedBrand.blog_news_url || "",
          linkedin_url: updatedBrand.linkedin_url || "",
          facebook_url: updatedBrand.facebook_url || "",
          x_url: updatedBrand.x_url || "",
          instagram_url: updatedBrand.instagram_url || "",
          tiktok_url: updatedBrand.tiktok_url || "",
          youtube_url: updatedBrand.youtube_url || "",
          discord_url: updatedBrand.discord_url || "",
        });
      }

      toast({
        title: "Success",
        description: "Brand updated successfully.",
      });

      setIsEditDialogOpen(false);
      fetchBrands(); // Refresh the list
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update brand",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedBrand) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/brand-directory/brands/${selectedBrand.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete brand");
      }

      toast({
        title: "Success",
        description: `Brand "${selectedBrand.brand_name}" deleted successfully.`,
      });

      setIsDeleteDialogOpen(false);
      setIsEditDialogOpen(false);
      setSelectedBrand(null);
      fetchBrands(); // Refresh the list
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete brand",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / itemsPerPage);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter brands by taxonomy, stage, or search</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="taxonomy">Taxonomy</Label>
              <div className="relative" ref={taxonomyDropdownRef}>
                <div className="flex items-center">
                  <Input
                    id="taxonomy"
                    placeholder="Type to search taxonomy..."
                    value={
                      taxonomyId === "all"
                        ? taxonomySearch
                        : taxonomies.find((t) => t.id === taxonomyId)
                          ? `${taxonomies.find((t) => t.id === taxonomyId)?.category} > ${taxonomies.find((t) => t.id === taxonomyId)?.subcategory} > ${taxonomies.find((t) => t.id === taxonomyId)?.sub_subcategory}`
                          : taxonomySearch
                    }
                    onChange={(e) => {
                      setTaxonomySearch(e.target.value);
                      setIsTaxonomyDropdownOpen(true);
                      // Clear selection if user starts typing
                      if (taxonomyId !== "all") {
                        setTaxonomyId("all");
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
                    <div
                      className="p-1 cursor-pointer hover:bg-accent"
                      onClick={() => {
                        setTaxonomyId("all");
                        setTaxonomySearch("");
                        setIsTaxonomyDropdownOpen(false);
                      }}
                    >
                      <div className="px-2 py-1.5 text-sm">All categories</div>
                    </div>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="brandStage">Brand Stage</Label>
              <Select
                value={brandStage}
                onValueChange={(value) =>
                  setBrandStage(
                    value === "all" ? ("all" as BrandStage | "all") : (value as BrandStage)
                  )
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

            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <div className="flex gap-2">
                <Input
                  id="search"
                  placeholder="Company or brand name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button onClick={handleSearch} size="icon">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSearch}>Apply Filters</Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brands</CardTitle>
          <CardDescription>
            Showing {brands.length} of {total} brands
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading brands...</div>
          ) : brands.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No brands found. Try adjusting your filters or discover new brands.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        onClick={() => handleSort("company_name")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Company
                        {sortBy === "company_name" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("brand_name")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Brand
                        {sortBy === "brand_name" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("category")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Category
                        {sortBy === "category" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("brand_stage")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Stage
                        {sortBy === "brand_stage" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-50" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands.map((brand) => (
                    <TableRow key={brand.id}>
                      <TableCell className="font-medium">{brand.company_name}</TableCell>
                      <TableCell>{brand.brand_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {brand.businessTaxonomy.sub_subcategory}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{brand.brand_stage}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {brand.keywords.slice(0, 3).map((k, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {k.keyword}
                            </Badge>
                          ))}
                          {brand.keywords.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{brand.keywords.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusCell brand={brand} />
                      </TableCell>
                      <TableCell>
                        <Dialog
                          open={isEditDialogOpen && selectedBrand?.id === brand.id}
                          onOpenChange={(open) => {
                            if (!open) {
                              setIsEditDialogOpen(false);
                              setSelectedBrand(null);
                            }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(brand)}
                            >
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Edit Brand</DialogTitle>
                              <DialogDescription>
                                Update brand information and links
                              </DialogDescription>
                            </DialogHeader>
                            {selectedBrand && (
                              <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="company_name">Company Name *</Label>
                                    <Input
                                      id="company_name"
                                      value={editFormData.company_name}
                                      onChange={(e) =>
                                        setEditFormData({
                                          ...editFormData,
                                          company_name: e.target.value,
                                        })
                                      }
                                      disabled={isSaving}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="brand_name">Brand Name *</Label>
                                    <Input
                                      id="brand_name"
                                      value={editFormData.brand_name}
                                      onChange={(e) =>
                                        setEditFormData({
                                          ...editFormData,
                                          brand_name: e.target.value,
                                        })
                                      }
                                      disabled={isSaving}
                                    />
                                  </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="category">Category *</Label>
                                    <Select
                                      value={editFormData.business_taxonomy_id}
                                      onValueChange={(value) =>
                                        setEditFormData({
                                          ...editFormData,
                                          business_taxonomy_id: value,
                                        })
                                      }
                                      disabled={isSaving}
                                    >
                                      <SelectTrigger id="category">
                                        <SelectValue placeholder="Select category" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {taxonomies
                                          .filter((tax) => tax.id && tax.id.trim() !== "")
                                          .map((tax) => (
                                            <SelectItem key={tax.id} value={tax.id}>
                                              {tax.category} &gt; {tax.subcategory} &gt;{" "}
                                              {tax.sub_subcategory}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="brand_stage">Brand Stage *</Label>
                                    <Select
                                      value={editFormData.brand_stage}
                                      onValueChange={(value) =>
                                        setEditFormData({
                                          ...editFormData,
                                          brand_stage: value as BrandStage,
                                        })
                                      }
                                      disabled={isSaving}
                                    >
                                      <SelectTrigger id="brand_stage">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="ESTABLISHED">Established</SelectItem>
                                        <SelectItem value="EMERGING">Emerging</SelectItem>
                                        <SelectItem value="SMALL">Small</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <Label>Keywords</Label>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {editFormData.keywords.map((keyword, index) => (
                                      <Badge
                                        key={index}
                                        variant="secondary"
                                        className="flex items-center gap-1"
                                      >
                                        {keyword}
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveKeyword(keyword)}
                                          disabled={isSaving}
                                          className="ml-1 hover:text-destructive"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <Input
                                      placeholder="Add keyword"
                                      value={newKeyword}
                                      onChange={(e) => setNewKeyword(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleAddKeyword();
                                        }
                                      }}
                                      disabled={isSaving}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={handleAddKeyword}
                                      disabled={isSaving || !newKeyword.trim()}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <Label>Links</Label>
                                  <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="website_url">Website URL</Label>
                                        {editFormData.website_url.trim() && (
                                          <a
                                            href={editFormData.website_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="website_url"
                                        type="url"
                                        placeholder="https://example.com"
                                        value={editFormData.website_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            website_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="careers_url">Careers URL</Label>
                                        {editFormData.careers_url.trim() && (
                                          <a
                                            href={editFormData.careers_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="careers_url"
                                        type="url"
                                        placeholder="https://example.com/careers"
                                        value={editFormData.careers_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            careers_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="blog_news_url">Blog/News URL</Label>
                                        {editFormData.blog_news_url.trim() && (
                                          <a
                                            href={editFormData.blog_news_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="blog_news_url"
                                        type="url"
                                        placeholder="https://example.com/blog or newsroom"
                                        value={editFormData.blog_news_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            blog_news_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="linkedin_url">LinkedIn URL</Label>
                                        {editFormData.linkedin_url.trim() && (
                                          <a
                                            href={editFormData.linkedin_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="linkedin_url"
                                        type="url"
                                        placeholder="https://linkedin.com/company/example"
                                        value={editFormData.linkedin_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            linkedin_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="facebook_url">Facebook URL</Label>
                                        {editFormData.facebook_url.trim() && (
                                          <a
                                            href={editFormData.facebook_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="facebook_url"
                                        type="url"
                                        placeholder="https://facebook.com/example"
                                        value={editFormData.facebook_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            facebook_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="x_url">X (Twitter) URL</Label>
                                        {editFormData.x_url.trim() && (
                                          <a
                                            href={editFormData.x_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="x_url"
                                        type="url"
                                        placeholder="https://x.com/example"
                                        value={editFormData.x_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            x_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="instagram_url">Instagram URL</Label>
                                        {editFormData.instagram_url.trim() && (
                                          <a
                                            href={editFormData.instagram_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="instagram_url"
                                        type="url"
                                        placeholder="https://instagram.com/example"
                                        value={editFormData.instagram_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            instagram_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="tiktok_url">TikTok URL</Label>
                                        {editFormData.tiktok_url.trim() && (
                                          <a
                                            href={editFormData.tiktok_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="tiktok_url"
                                        type="url"
                                        placeholder="https://tiktok.com/@example"
                                        value={editFormData.tiktok_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            tiktok_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label htmlFor="youtube_url">YouTube URL</Label>
                                        {editFormData.youtube_url.trim() && (
                                          <a
                                            href={editFormData.youtube_url.trim()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800"
                                            title="Open in new tab"
                                          >
                                            <ExternalLink className="h-4 w-4" />
                                          </a>
                                        )}
                                      </div>
                                      <Input
                                        id="youtube_url"
                                        type="url"
                                        placeholder="https://youtube.com/@example"
                                        value={editFormData.youtube_url}
                                        onChange={(e) =>
                                          setEditFormData({
                                            ...editFormData,
                                            youtube_url: e.target.value,
                                          })
                                        }
                                        disabled={isSaving}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Label>Additional Links</Label>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={async () => {
                                            if (!selectedBrand) return;
                                            try {
                                              // Load all link types
                                              const [
                                                redditRes,
                                                discordRes,
                                                influencerRes,
                                                otherSourceRes,
                                              ] = await Promise.all([
                                                fetch(
                                                  `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links?link_type=REDDIT`,
                                                  { credentials: "include" }
                                                ),
                                                fetch(
                                                  `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links?link_type=DISCORD`,
                                                  { credentials: "include" }
                                                ),
                                                fetch(
                                                  `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links?link_type=INFLUENCER`,
                                                  { credentials: "include" }
                                                ),
                                                fetch(
                                                  `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links?link_type=OTHER_SOURCE`,
                                                  { credentials: "include" }
                                                ),
                                              ]);

                                              if (redditRes.ok) {
                                                const redditData = await redditRes.json();
                                                console.log(
                                                  "[BrandDirectoryPanel] Reddit links response:",
                                                  redditData
                                                );
                                                // Deduplicate Reddit links
                                                const seenUrls = new Set<string>();
                                                const uniqueReddit = (
                                                  redditData.links || []
                                                ).filter((link: any) => {
                                                  const normalizedUrl =
                                                    link.url
                                                      ?.toLowerCase()
                                                      .trim()
                                                      .replace(/\/+$/, "") || "";
                                                  if (seenUrls.has(normalizedUrl)) return false;
                                                  seenUrls.add(normalizedUrl);
                                                  return true;
                                                });
                                                console.log(
                                                  "[BrandDirectoryPanel] Reddit links after dedup:",
                                                  uniqueReddit.length,
                                                  "from",
                                                  (redditData.links || []).length
                                                );
                                                setRedditLinks(uniqueReddit);
                                                setNewRedditLinks([""]);
                                              }

                                              if (discordRes.ok) {
                                                const discordData = await discordRes.json();
                                                setDiscordLinks(discordData.links || []);
                                                setNewDiscordLinks([{ channel_name: "", url: "" }]);
                                              }

                                              if (influencerRes.ok) {
                                                const influencerData = await influencerRes.json();
                                                const grouped: Record<string, any[]> = {
                                                  TWITTER: [],
                                                  LINKEDIN: [],
                                                  FACEBOOK: [],
                                                  INSTAGRAM: [],
                                                  TIKTOK: [],
                                                  BLUESKY: [],
                                                  YOUTUBE: [],
                                                };
                                                (influencerData.links || []).forEach(
                                                  (link: any) => {
                                                    if (link.platform && grouped[link.platform]) {
                                                      grouped[link.platform].push(link);
                                                    }
                                                  }
                                                );
                                                setInfluencerLinks(grouped);
                                                setNewInfluencerLinks({
                                                  TWITTER: [{ channel_name: "", url: "" }],
                                                  LINKEDIN: [{ channel_name: "", url: "" }],
                                                  FACEBOOK: [{ channel_name: "", url: "" }],
                                                  INSTAGRAM: [{ channel_name: "", url: "" }],
                                                  TIKTOK: [{ channel_name: "", url: "" }],
                                                  BLUESKY: [{ channel_name: "", url: "" }],
                                                  YOUTUBE: [{ channel_name: "", url: "" }],
                                                });
                                              }

                                              if (otherSourceRes.ok) {
                                                const otherSourceData = await otherSourceRes.json();
                                                console.log(
                                                  "[BrandDirectoryPanel] Other source links response:",
                                                  otherSourceData
                                                );
                                                const grouped: Record<string, any[]> = {
                                                  NEWS_OUTLET: [],
                                                  BLOG: [],
                                                  PODCAST: [],
                                                };
                                                // Deduplicate by source_category + URL
                                                const seenKeys = new Set<string>();
                                                (otherSourceData.links || []).forEach(
                                                  (link: any) => {
                                                    if (
                                                      link.source_category &&
                                                      grouped[link.source_category]
                                                    ) {
                                                      const normalizedUrl =
                                                        link.url
                                                          ?.toLowerCase()
                                                          .trim()
                                                          .replace(/\/+$/, "") || "";
                                                      const key = `${link.source_category}:${normalizedUrl}`;
                                                      if (!seenKeys.has(key)) {
                                                        seenKeys.add(key);
                                                        grouped[link.source_category].push(link);
                                                      }
                                                    }
                                                  }
                                                );
                                                console.log(
                                                  "[BrandDirectoryPanel] Other source links after dedup:",
                                                  Object.entries(grouped).map(([c, arr]) => [
                                                    c,
                                                    arr.length,
                                                  ])
                                                );
                                                setOtherSourceLinks(grouped);
                                                setNewOtherSourceLinks({
                                                  NEWS_OUTLET: [{ channel_name: "", url: "" }],
                                                  BLOG: [{ channel_name: "", url: "" }],
                                                  PODCAST: [{ channel_name: "", url: "" }],
                                                });
                                              }

                                              setIsAdditionalLinksDialogOpen(true);
                                            } catch (error) {
                                              console.error(
                                                "Error fetching additional links:",
                                                error
                                              );
                                            }
                                          }}
                                        >
                                          Manage
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
                              <div className="flex gap-2">
                                <Button
                                  variant={editFormData.approved ? "default" : "outline"}
                                  onClick={() => {
                                    const currentKeywords = editFormData.keywords || [];
                                    console.log(
                                      `[Approve] Preserving ${currentKeywords.length} keywords:`,
                                      currentKeywords
                                    );
                                    setEditFormData((prev) => {
                                      const preservedKeywords =
                                        prev.keywords && prev.keywords.length > 0
                                          ? prev.keywords
                                          : (selectedBrand?.keywords || [])
                                              .map((k) => k.keyword)
                                              .filter((k) => k && k.trim() !== "");
                                      console.log(`[Approve] Setting keywords:`, preservedKeywords);
                                      return {
                                        ...prev,
                                        approved: true,
                                        keywords: preservedKeywords,
                                      };
                                    });
                                  }}
                                  disabled={isSaving}
                                  className={
                                    editFormData.approved ? "bg-green-600 hover:bg-green-700" : ""
                                  }
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                  Approve
                                </Button>
                                <Button
                                  variant={!editFormData.approved ? "default" : "outline"}
                                  onClick={() => {
                                    const currentKeywords = editFormData.keywords || [];
                                    console.log(
                                      `[Unapprove] Preserving ${currentKeywords.length} keywords:`,
                                      currentKeywords
                                    );
                                    setEditFormData((prev) => {
                                      const preservedKeywords =
                                        prev.keywords && prev.keywords.length > 0
                                          ? prev.keywords
                                          : (selectedBrand?.keywords || [])
                                              .map((k) => k.keyword)
                                              .filter((k) => k && k.trim() !== "");
                                      console.log(
                                        `[Unapprove] Setting keywords:`,
                                        preservedKeywords
                                      );
                                      return {
                                        ...prev,
                                        approved: false,
                                        keywords: preservedKeywords,
                                      };
                                    });
                                  }}
                                  disabled={isSaving}
                                  className={
                                    !editFormData.approved ? "bg-gray-600 hover:bg-gray-700" : ""
                                  }
                                >
                                  <XCircle className="mr-2 h-4 w-4" />
                                  Unapprove
                                </Button>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="destructive"
                                  onClick={() => setIsDeleteDialogOpen(true)}
                                  disabled={isSaving || isDeleting}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setIsEditDialogOpen(false);
                                    setSelectedBrand(null);
                                  }}
                                  disabled={isSaving || isDeleting}
                                >
                                  Cancel
                                </Button>
                                <Button onClick={handleSave} disabled={isSaving || isDeleting}>
                                  {isSaving ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Saving...
                                    </>
                                  ) : (
                                    "Save Changes"
                                  )}
                                </Button>
                              </div>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        {/* Delete Confirmation Dialog */}
                        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Brand</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{selectedBrand?.brand_name}"? This
                                action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {isDeleting ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Deleting...
                                  </>
                                ) : (
                                  "Delete"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1 || isLoading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages || isLoading}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Additional Links Dialog */}
      <Dialog open={isAdditionalLinksDialogOpen} onOpenChange={setIsAdditionalLinksDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Additional Links</DialogTitle>
            <DialogDescription>
              Add, edit, or remove additional links for {selectedBrand?.brand_name || "this brand"}
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="reddit">Related Reddit Links</TabsTrigger>
              <TabsTrigger value="discord">Discord Links</TabsTrigger>
              <TabsTrigger value="influencers">Influencers</TabsTrigger>
              <TabsTrigger value="other">Other Sources</TabsTrigger>
            </TabsList>

            {/* Reddit Links Tab */}
            <TabsContent value="reddit" className="space-y-4 mt-4">
              {redditLinks.length > 0 && (
                <div className="space-y-2">
                  <Label>Existing Reddit Links</Label>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {redditLinks.map((link) => (
                      <div key={link.id} className="flex items-center gap-2 p-2 border rounded">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-sm text-blue-600 hover:text-blue-800 truncate"
                        >
                          {link.url}
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!selectedBrand) return;
                            try {
                              const response = await fetch(
                                `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links/${link.id}`,
                                {
                                  method: "DELETE",
                                  credentials: "include",
                                }
                              );
                              if (response.ok) {
                                setRedditLinks(redditLinks.filter((l) => l.id !== link.id));
                                toast({
                                  title: "Success",
                                  description: "Link deleted",
                                });
                              }
                            } catch (error) {
                              console.error("Error deleting link:", error);
                              toast({
                                title: "Error",
                                description: "Failed to delete link",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Add New Reddit Links</Label>
                <div className="space-y-2">
                  {newRedditLinks.map((url, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        placeholder="https://reddit.com/r/..."
                        value={url}
                        onChange={(e) => {
                          const updated = [...newRedditLinks];
                          updated[index] = e.target.value;
                          setNewRedditLinks(updated);
                        }}
                      />
                      {newRedditLinks.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setNewRedditLinks(newRedditLinks.filter((_, i) => i !== index));
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setNewRedditLinks([...newRedditLinks, ""])}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another Link
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Discord Links Tab */}
            <TabsContent value="discord" className="space-y-4 mt-4">
              {discordLinks.length > 0 && (
                <div className="space-y-2">
                  <Label>Existing Discord Links</Label>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {discordLinks.map((link) => (
                      <div key={link.id} className="flex items-center gap-2 p-2 border rounded">
                        <div className="flex-1 min-w-0">
                          {link.channel_name && (
                            <div className="text-sm font-medium text-gray-700 mb-1">
                              {link.channel_name}
                            </div>
                          )}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:text-blue-800 truncate block"
                          >
                            {link.url}
                          </a>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!selectedBrand) return;
                            try {
                              const response = await fetch(
                                `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links/${link.id}`,
                                {
                                  method: "DELETE",
                                  credentials: "include",
                                }
                              );
                              if (response.ok) {
                                setDiscordLinks(discordLinks.filter((l) => l.id !== link.id));
                                toast({
                                  title: "Success",
                                  description: "Link deleted",
                                });
                              }
                            } catch (error) {
                              console.error("Error deleting link:", error);
                              toast({
                                title: "Error",
                                description: "Failed to delete link",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Add New Discord Links</Label>
                <div className="space-y-3">
                  {newDiscordLinks.map((link, index) => (
                    <div key={index} className="space-y-2 p-3 border rounded">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label
                            htmlFor={`discord-channel-${index}`}
                            className="text-xs text-muted-foreground"
                          >
                            Channel Name (optional)
                          </Label>
                          <Input
                            id={`discord-channel-${index}`}
                            placeholder="e.g., General, Announcements"
                            value={link.channel_name}
                            onChange={(e) => {
                              const updated = [...newDiscordLinks];
                              updated[index] = { ...updated[index], channel_name: e.target.value };
                              setNewDiscordLinks(updated);
                            }}
                          />
                        </div>
                        {newDiscordLinks.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setNewDiscordLinks(newDiscordLinks.filter((_, i) => i !== index));
                            }}
                            className="mt-6"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div>
                        <Label
                          htmlFor={`discord-url-${index}`}
                          className="text-xs text-muted-foreground"
                        >
                          Link URL <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id={`discord-url-${index}`}
                          placeholder="https://discord.gg/..."
                          value={link.url}
                          onChange={(e) => {
                            const updated = [...newDiscordLinks];
                            updated[index] = { ...updated[index], url: e.target.value };
                            setNewDiscordLinks(updated);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewDiscordLinks([...newDiscordLinks, { channel_name: "", url: "" }])
                    }
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another Link
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Influencers Tab */}
            <TabsContent value="influencers" className="space-y-4 mt-4">
              <Tabs
                value={activeInfluencerPlatform}
                onValueChange={(v) =>
                  setActiveInfluencerPlatform(v as typeof activeInfluencerPlatform)
                }
              >
                <TabsList className="grid w-full grid-cols-3 lg:grid-cols-7">
                  <TabsTrigger value="TWITTER">Twitter (X)</TabsTrigger>
                  <TabsTrigger value="LINKEDIN">LinkedIn</TabsTrigger>
                  <TabsTrigger value="FACEBOOK">Facebook</TabsTrigger>
                  <TabsTrigger value="INSTAGRAM">Instagram</TabsTrigger>
                  <TabsTrigger value="TIKTOK">TikTok</TabsTrigger>
                  <TabsTrigger value="BLUESKY">BlueSky</TabsTrigger>
                  <TabsTrigger value="YOUTUBE">YouTube</TabsTrigger>
                </TabsList>

                {(
                  [
                    "TWITTER",
                    "LINKEDIN",
                    "FACEBOOK",
                    "INSTAGRAM",
                    "TIKTOK",
                    "BLUESKY",
                    "YOUTUBE",
                  ] as const
                ).map((platform) => (
                  <TabsContent key={platform} value={platform} className="space-y-4 mt-4">
                    {influencerLinks[platform]?.length > 0 && (
                      <div className="space-y-2">
                        <Label>
                          Existing{" "}
                          {platform === "TWITTER"
                            ? "Twitter (X)"
                            : platform.charAt(0) + platform.slice(1).toLowerCase()}{" "}
                          Links
                        </Label>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {influencerLinks[platform].map((link) => (
                            <div
                              key={link.id}
                              className="flex items-center gap-2 p-2 border rounded"
                            >
                              <div className="flex-1 min-w-0">
                                {link.channel_name && (
                                  <div className="text-sm font-medium text-gray-700 mb-1">
                                    {link.channel_name}
                                  </div>
                                )}
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-600 hover:text-blue-800 truncate block"
                                >
                                  {link.url}
                                </a>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (!selectedBrand) return;
                                  try {
                                    const response = await fetch(
                                      `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links/${link.id}`,
                                      {
                                        method: "DELETE",
                                        credentials: "include",
                                      }
                                    );
                                    if (response.ok) {
                                      setInfluencerLinks({
                                        ...influencerLinks,
                                        [platform]: influencerLinks[platform].filter(
                                          (l) => l.id !== link.id
                                        ),
                                      });
                                      toast({
                                        title: "Success",
                                        description: "Link deleted",
                                      });
                                    }
                                  } catch (error) {
                                    console.error("Error deleting link:", error);
                                    toast({
                                      title: "Error",
                                      description: "Failed to delete link",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>
                        Add New{" "}
                        {platform === "TWITTER"
                          ? "Twitter (X)"
                          : platform.charAt(0) + platform.slice(1).toLowerCase()}{" "}
                        Links
                      </Label>
                      <div className="space-y-3">
                        {(newInfluencerLinks[platform] || [{ channel_name: "", url: "" }]).map(
                          (link, index) => (
                            <div key={index} className="space-y-2 p-3 border rounded">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <Label
                                    htmlFor={`${platform}-channel-${index}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    Name (optional)
                                  </Label>
                                  <Input
                                    id={`${platform}-channel-${index}`}
                                    placeholder="e.g., John Doe, @username"
                                    value={link.channel_name}
                                    onChange={(e) => {
                                      const updated = [
                                        ...(newInfluencerLinks[platform] || [
                                          { channel_name: "", url: "" },
                                        ]),
                                      ];
                                      updated[index] = {
                                        ...updated[index],
                                        channel_name: e.target.value,
                                      };
                                      setNewInfluencerLinks({
                                        ...newInfluencerLinks,
                                        [platform]: updated,
                                      });
                                    }}
                                  />
                                </div>
                                {(newInfluencerLinks[platform] || [{ channel_name: "", url: "" }])
                                  .length > 1 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setNewInfluencerLinks({
                                        ...newInfluencerLinks,
                                        [platform]: (
                                          newInfluencerLinks[platform] || [
                                            { channel_name: "", url: "" },
                                          ]
                                        ).filter((_, i) => i !== index),
                                      });
                                    }}
                                    className="mt-6"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                              <div>
                                <Label
                                  htmlFor={`${platform}-url-${index}`}
                                  className="text-xs text-muted-foreground"
                                >
                                  Link URL <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id={`${platform}-url-${index}`}
                                  placeholder={`https://${platform === "TWITTER" ? "x.com" : platform.toLowerCase()}.com/...`}
                                  value={link.url}
                                  onChange={(e) => {
                                    const updated = [
                                      ...(newInfluencerLinks[platform] || [
                                        { channel_name: "", url: "" },
                                      ]),
                                    ];
                                    updated[index] = { ...updated[index], url: e.target.value };
                                    setNewInfluencerLinks({
                                      ...newInfluencerLinks,
                                      [platform]: updated,
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          )
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNewInfluencerLinks({
                              ...newInfluencerLinks,
                              [platform]: [
                                ...(newInfluencerLinks[platform] || [
                                  { channel_name: "", url: "" },
                                ]),
                                { channel_name: "", url: "" },
                              ],
                            });
                          }}
                          className="w-full"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Another Link
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>

            {/* Other Sources Tab */}
            <TabsContent value="other" className="space-y-4 mt-4">
              <Tabs
                value={activeSourceCategory}
                onValueChange={(v) => setActiveSourceCategory(v as typeof activeSourceCategory)}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="NEWS_OUTLET">Publications</TabsTrigger>
                  <TabsTrigger value="BLOG">Blogs</TabsTrigger>
                  <TabsTrigger value="PODCAST">Podcasts</TabsTrigger>
                </TabsList>

                {(["NEWS_OUTLET", "BLOG", "PODCAST"] as const).map((category) => (
                  <TabsContent key={category} value={category} className="space-y-4 mt-4">
                    {otherSourceLinks[category]?.length > 0 && (
                      <div className="space-y-2">
                        <Label>
                          Existing{" "}
                          {category === "NEWS_OUTLET"
                            ? "Publication"
                            : category === "BLOG"
                              ? "Blog"
                              : "Podcast"}{" "}
                          Links
                        </Label>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {otherSourceLinks[category].map((link) => (
                            <div
                              key={link.id}
                              className="flex items-center gap-2 p-2 border rounded"
                            >
                              <div className="flex-1 min-w-0">
                                {link.channel_name && (
                                  <div className="text-sm font-medium text-gray-700 mb-1">
                                    {link.channel_name}
                                  </div>
                                )}
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-600 hover:text-blue-800 truncate block"
                                >
                                  {link.url}
                                </a>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (!selectedBrand) return;
                                  try {
                                    const response = await fetch(
                                      `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links/${link.id}`,
                                      {
                                        method: "DELETE",
                                        credentials: "include",
                                      }
                                    );
                                    if (response.ok) {
                                      setOtherSourceLinks({
                                        ...otherSourceLinks,
                                        [category]: otherSourceLinks[category].filter(
                                          (l) => l.id !== link.id
                                        ),
                                      });
                                      toast({
                                        title: "Success",
                                        description: "Link deleted",
                                      });
                                    }
                                  } catch (error) {
                                    console.error("Error deleting link:", error);
                                    toast({
                                      title: "Error",
                                      description: "Failed to delete link",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>
                        Add New{" "}
                        {category === "NEWS_OUTLET"
                          ? "Publication"
                          : category === "BLOG"
                            ? "Blog"
                            : "Podcast"}{" "}
                        Links
                      </Label>
                      <div className="space-y-3">
                        {(newOtherSourceLinks[category] || [{ channel_name: "", url: "" }]).map(
                          (link, index) => (
                            <div key={index} className="space-y-2 p-3 border rounded">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <Label
                                    htmlFor={`${category}-name-${index}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    Name (optional)
                                  </Label>
                                  <Input
                                    id={`${category}-name-${index}`}
                                    placeholder={`e.g., ${category === "NEWS_OUTLET" ? "TechCrunch" : category === "BLOG" ? "Tech Blog" : "Tech Podcast"}`}
                                    value={link.channel_name}
                                    onChange={(e) => {
                                      const updated = [
                                        ...(newOtherSourceLinks[category] || [
                                          { channel_name: "", url: "" },
                                        ]),
                                      ];
                                      updated[index] = {
                                        ...updated[index],
                                        channel_name: e.target.value,
                                      };
                                      setNewOtherSourceLinks({
                                        ...newOtherSourceLinks,
                                        [category]: updated,
                                      });
                                    }}
                                  />
                                </div>
                                {(newOtherSourceLinks[category] || [{ channel_name: "", url: "" }])
                                  .length > 1 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setNewOtherSourceLinks({
                                        ...newOtherSourceLinks,
                                        [category]: (
                                          newOtherSourceLinks[category] || [
                                            { channel_name: "", url: "" },
                                          ]
                                        ).filter((_, i) => i !== index),
                                      });
                                    }}
                                    className="mt-6"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                              <div>
                                <Label
                                  htmlFor={`${category}-url-${index}`}
                                  className="text-xs text-muted-foreground"
                                >
                                  Link URL <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id={`${category}-url-${index}`}
                                  placeholder="https://..."
                                  value={link.url}
                                  onChange={(e) => {
                                    const updated = [
                                      ...(newOtherSourceLinks[category] || [
                                        { channel_name: "", url: "" },
                                      ]),
                                    ];
                                    updated[index] = { ...updated[index], url: e.target.value };
                                    setNewOtherSourceLinks({
                                      ...newOtherSourceLinks,
                                      [category]: updated,
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          )
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNewOtherSourceLinks({
                              ...newOtherSourceLinks,
                              [category]: [
                                ...(newOtherSourceLinks[category] || [
                                  { channel_name: "", url: "" },
                                ]),
                                { channel_name: "", url: "" },
                              ],
                            });
                          }}
                          className="w-full"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Another Link
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAdditionalLinksDialogOpen(false);
                setNewRedditLinks([""]);
                setNewDiscordLinks([{ channel_name: "", url: "" }]);
                setNewInfluencerLinks({
                  TWITTER: [{ channel_name: "", url: "" }],
                  LINKEDIN: [{ channel_name: "", url: "" }],
                  FACEBOOK: [{ channel_name: "", url: "" }],
                  INSTAGRAM: [{ channel_name: "", url: "" }],
                  TIKTOK: [{ channel_name: "", url: "" }],
                  BLUESKY: [{ channel_name: "", url: "" }],
                  YOUTUBE: [{ channel_name: "", url: "" }],
                });
                setNewOtherSourceLinks({
                  NEWS_OUTLET: [{ channel_name: "", url: "" }],
                  BLOG: [{ channel_name: "", url: "" }],
                  PODCAST: [{ channel_name: "", url: "" }],
                });
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAllLinks}
              disabled={
                newRedditLinks.every((url) => !url.trim()) &&
                newDiscordLinks.every((link) => !link.url.trim()) &&
                Object.values(newInfluencerLinks).every((links) =>
                  links.every((link) => !link.url.trim())
                ) &&
                Object.values(newOtherSourceLinks).every((links) =>
                  links.every((link) => !link.url.trim())
                )
              }
            >
              Save All Links
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  async function handleSaveAllLinks() {
    if (!selectedBrand) return;

    const linksToAdd: Array<{
      link_type: "REDDIT" | "DISCORD" | "INFLUENCER" | "OTHER_SOURCE";
      platform?:
        | "TWITTER"
        | "LINKEDIN"
        | "FACEBOOK"
        | "INSTAGRAM"
        | "TIKTOK"
        | "BLUESKY"
        | "YOUTUBE";
      source_category?: "NEWS_OUTLET" | "BLOG" | "PODCAST";
      urls: Array<{ url: string; channel_name?: string }>;
    }> = [];

    // Collect Reddit links
    const validRedditUrls = newRedditLinks.filter((url) => url.trim().length > 0);
    if (validRedditUrls.length > 0) {
      linksToAdd.push({
        link_type: "REDDIT",
        urls: validRedditUrls.map((url) => ({ url: url.trim() })),
      });
    }

    // Collect Discord links
    const validDiscordLinks = newDiscordLinks.filter((link) => link.url.trim().length > 0);
    if (validDiscordLinks.length > 0) {
      linksToAdd.push({
        link_type: "DISCORD",
        urls: validDiscordLinks.map((link) => ({
          url: link.url.trim(),
          channel_name: link.channel_name.trim() || undefined,
        })),
      });
    }

    // Collect Influencer links by platform
    (
      ["TWITTER", "LINKEDIN", "FACEBOOK", "INSTAGRAM", "TIKTOK", "BLUESKY", "YOUTUBE"] as const
    ).forEach((platform) => {
      const validLinks = (newInfluencerLinks[platform] || []).filter(
        (link) => link.url.trim().length > 0
      );
      if (validLinks.length > 0) {
        linksToAdd.push({
          link_type: "INFLUENCER",
          platform,
          urls: validLinks.map((link) => ({
            url: link.url.trim(),
            channel_name: link.channel_name.trim() || undefined,
          })),
        });
      }
    });

    // Collect Other Source links by category
    (["NEWS_OUTLET", "BLOG", "PODCAST"] as const).forEach((category) => {
      const validLinks = (newOtherSourceLinks[category] || []).filter(
        (link) => link.url.trim().length > 0
      );
      if (validLinks.length > 0) {
        linksToAdd.push({
          link_type: "OTHER_SOURCE",
          source_category: category,
          urls: validLinks.map((link) => ({
            url: link.url.trim(),
            channel_name: link.channel_name.trim() || undefined,
          })),
        });
      }
    });

    if (linksToAdd.length === 0) {
      toast({
        title: "Error",
        description: "Please enter at least one link URL",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/brand-directory/brands/${selectedBrand.id}/additional-links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ links: linksToAdd }),
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to save links");
      }

      // Update state with new links
      const createdLinks = data.links || [];
      createdLinks.forEach((link: any) => {
        if (link.link_type === "REDDIT") {
          setRedditLinks((prev) => [...prev, link]);
        } else if (link.link_type === "DISCORD") {
          setDiscordLinks((prev) => [...prev, link]);
        } else if (link.link_type === "INFLUENCER" && link.platform) {
          setInfluencerLinks((prev) => ({
            ...prev,
            [link.platform]: [...(prev[link.platform] || []), link],
          }));
        } else if (link.link_type === "OTHER_SOURCE" && link.source_category) {
          setOtherSourceLinks((prev) => ({
            ...prev,
            [link.source_category]: [...(prev[link.source_category] || []), link],
          }));
        }
      });

      // Reset input fields
      setNewRedditLinks([""]);
      setNewDiscordLinks([{ channel_name: "", url: "" }]);
      setNewInfluencerLinks({
        TWITTER: [{ channel_name: "", url: "" }],
        LINKEDIN: [{ channel_name: "", url: "" }],
        FACEBOOK: [{ channel_name: "", url: "" }],
        INSTAGRAM: [{ channel_name: "", url: "" }],
        TIKTOK: [{ channel_name: "", url: "" }],
        BLUESKY: [{ channel_name: "", url: "" }],
        YOUTUBE: [{ channel_name: "", url: "" }],
      });
      setNewOtherSourceLinks({
        NEWS_OUTLET: [{ channel_name: "", url: "" }],
        BLOG: [{ channel_name: "", url: "" }],
        PODCAST: [{ channel_name: "", url: "" }],
      });

      toast({
        title: "Success",
        description: `Added ${createdLinks.length} link(s)`,
      });

      // Refresh brand data
      fetchBrands();
    } catch (error) {
      console.error("Error saving links:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save links",
        variant: "destructive",
      });
    }
  }
}
