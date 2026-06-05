"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { BrandStage } from "@prisma/client";
import { Plus, X, ExternalLink, Sparkles, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { validateBrandData } from "@/lib/brand-directory/brand-validation";
import { parseKeywords } from "@/components/projects/KeywordsInput";

interface Taxonomy {
  id: string;
  category: string;
  subcategory: string;
  sub_subcategory: string;
}

/** Returned after a brand is created or updated from this dialog (e.g. add to project list). */
export interface AddedBrandSummary {
  id: string;
  brand_name: string;
  company_name: string;
}

interface AddBrandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxonomies: Taxonomy[];
  onBrandAdded?: (brand?: AddedBrandSummary) => void;
}

interface BrandFormData {
  company_name: string;
  brand_name: string;
  business_taxonomy_id: string;
  brand_stage: BrandStage;
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
}

interface DuplicateBrandInfo {
  id: string;
  company_name: string;
  brand_name: string;
  website_url: string | null;
  businessTaxonomy: {
    category: string;
    subcategory: string;
    sub_subcategory: string;
  };
}

export function AddBrandDialog({
  open,
  onOpenChange,
  taxonomies,
  onBrandAdded,
}: AddBrandDialogProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<BrandFormData>({
    company_name: "",
    brand_name: "",
    business_taxonomy_id: "",
    brand_stage: "ESTABLISHED",
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
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateBrandInfo | null>(null);
  const [showDuplicateOptions, setShowDuplicateOptions] = useState<boolean>(false);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [approvedWarnings, setApprovedWarnings] = useState<Set<string>>(new Set());
  const [taxonomySearch, setTaxonomySearch] = useState<string>("");
  const [isTaxonomyDropdownOpen, setIsTaxonomyDropdownOpen] = useState<boolean>(false);
  const taxonomyDropdownRef = useRef<HTMLDivElement>(null);

  /** Badge list plus any text still in the keyword field (comma- or newline-separated). */
  const getEffectiveKeywords = (): string[] => {
    const fromInput = parseKeywords(newKeyword);
    const merged = [...formData.keywords];
    for (const k of fromInput) {
      if (!merged.includes(k)) merged.push(k);
    }
    return merged.filter((k) => k.trim() !== "");
  };

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setFormData({
        company_name: "",
        brand_name: "",
        business_taxonomy_id: "",
        brand_stage: "ESTABLISHED",
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
      setNewKeyword("");
      setDuplicateInfo(null);
      setShowDuplicateOptions(false);
      setValidationWarnings([]);
      setValidationErrors([]);
      setApprovedWarnings(new Set());
      setTaxonomySearch("");
    }
  }, [open]);

  // Re-validate when form data changes (but only if we have enough data)
  useEffect(() => {
    if (!open || isSearching || isSaving) return;

    // Only validate if we have brand name and at least one URL
    if (
      formData.brand_name.trim() &&
      (formData.website_url.trim() ||
        formData.linkedin_url.trim() ||
        formData.facebook_url.trim() ||
        formData.x_url.trim() ||
        formData.instagram_url.trim())
    ) {
      const validation = validateBrandData({
        brand_name: formData.brand_name,
        company_name: formData.company_name || formData.brand_name,
        website_url: formData.website_url,
        linkedin_url: formData.linkedin_url,
        facebook_url: formData.facebook_url,
        x_url: formData.x_url,
        instagram_url: formData.instagram_url,
        tiktok_url: formData.tiktok_url,
        youtube_url: formData.youtube_url,
        discord_url: formData.discord_url,
      });

      // Filter out already approved warnings
      const unapprovedWarnings = validation.warnings.filter(
        (warning) => !approvedWarnings.has(warning)
      );

      setValidationWarnings(unapprovedWarnings);
      setValidationErrors(validation.errors);
    } else {
      // Clear validation if not enough data
      setValidationWarnings([]);
      setValidationErrors([]);
    }
  }, [formData, open, isSearching, isSaving, approvedWarnings]);

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

  const handleAddKeyword = () => {
    const parts = parseKeywords(newKeyword);
    if (parts.length === 0) return;
    setFormData((prev) => {
      const next = [...prev.keywords];
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }
      return { ...prev, keywords: next };
    });
    setNewKeyword("");
  };

  const handleRemoveKeyword = (keyword: string) => {
    setFormData({
      ...formData,
      keywords: formData.keywords.filter((k) => k !== keyword),
    });
  };

  const handleSearchWithOpenAI = async () => {
    if (!formData.brand_name.trim()) {
      toast({
        title: "Error",
        description: "Brand name is required to search with OpenAI",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setDuplicateInfo(null);
    setShowDuplicateOptions(false);

    try {
      const response = await fetch("/api/admin/brand-directory/brands/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          brand_name: formData.brand_name.trim(),
          company_name: formData.company_name.trim() || undefined,
          website_url: formData.website_url.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to search for brand");
      }

      // Check if duplicate was found
      if (data.duplicate) {
        setDuplicateInfo(data.duplicate);
        setShowDuplicateOptions(true);
        return;
      }

      // Check if brand was found
      if (data.brand) {
        // Fill all fields with OpenAI results
        setFormData({
          company_name: data.brand.company_name || formData.company_name,
          brand_name: data.brand.brand_name || formData.brand_name,
          business_taxonomy_id: data.brand.business_taxonomy_id || formData.business_taxonomy_id,
          brand_stage: data.brand.brand_stage || formData.brand_stage,
          keywords: data.brand.keywords || [],
          website_url: data.brand.website_url || "",
          careers_url: data.brand.careers_url || "",
          blog_news_url: data.brand.blog_news_url || "",
          linkedin_url: data.brand.linkedin_url || "",
          facebook_url: data.brand.facebook_url || "",
          x_url: data.brand.x_url || "",
          instagram_url: data.brand.instagram_url || "",
          tiktok_url: data.brand.tiktok_url || "",
          youtube_url: data.brand.youtube_url || "",
          discord_url: data.brand.discord_url || "",
        });

        // Update taxonomy search display if taxonomy was found
        if (data.brand.business_taxonomy_id) {
          const foundTaxonomy = taxonomies.find((t) => t.id === data.brand.business_taxonomy_id);
          if (foundTaxonomy) {
            setTaxonomySearch(
              `${foundTaxonomy.category} > ${foundTaxonomy.subcategory} > ${foundTaxonomy.sub_subcategory}`
            );
          }
        }

        toast({
          title: "Success",
          description: "Brand information found and filled in",
        });
      } else {
        // Brand not found
        toast({
          title: "Brand Not Found",
          description:
            "Could not find brand information. Try adding the company's homepage URL for better results.",
          variant: "default",
        });
      }
    } catch (error: any) {
      console.error("Error searching for brand:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to search for brand",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleDuplicateAbort = () => {
    setShowDuplicateOptions(false);
    setDuplicateInfo(null);
    onOpenChange(false);
  };

  const handleDuplicateAdd = async () => {
    // Create new brand anyway (ignore duplicate)
    setShowDuplicateOptions(false);
    setDuplicateInfo(null);
    await handleSave(true); // Pass flag to skip duplicate check
  };

  const handleDuplicateOverride = async () => {
    // Update existing brand
    if (!duplicateInfo) return;

    setIsSaving(true);
    try {
      const updateData: any = {
        company_name: formData.company_name.trim(),
        brand_name: formData.brand_name.trim(),
        business_taxonomy_id: formData.business_taxonomy_id,
        brand_stage: formData.brand_stage,
        keywords: getEffectiveKeywords(),
        website_url: formData.website_url.trim() || null,
        careers_url: formData.careers_url.trim() || null,
        blog_news_url: formData.blog_news_url.trim() || null,
        linkedin_url: formData.linkedin_url.trim() || null,
        facebook_url: formData.facebook_url.trim() || null,
        x_url: formData.x_url.trim() || null,
        instagram_url: formData.instagram_url.trim() || null,
        tiktok_url: formData.tiktok_url.trim() || null,
        youtube_url: formData.youtube_url.trim() || null,
        discord_url: formData.discord_url.trim() || null,
      };

      const response = await fetch(`/api/admin/brand-directory/brands/${duplicateInfo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update brand");
      }

      toast({
        title: "Success",
        description: "Brand updated successfully",
      });

      setShowDuplicateOptions(false);
      setDuplicateInfo(null);
      onOpenChange(false);
      if (onBrandAdded) {
        onBrandAdded(
          data.brand
            ? {
                id: data.brand.id,
                brand_name: data.brand.brand_name,
                company_name: data.brand.company_name ?? data.brand.brand_name,
              }
            : undefined
        );
      }
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

  const handleSave = async (skipDuplicateCheck: boolean = false) => {
    // Validation
    if (!formData.company_name.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.brand_name.trim()) {
      toast({
        title: "Validation Error",
        description: "Brand name is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.business_taxonomy_id) {
      toast({
        title: "Validation Error",
        description: "Category is required",
        variant: "destructive",
      });
      return;
    }

    const effectiveKeywords = getEffectiveKeywords();
    if (effectiveKeywords.length === 0) {
      toast({
        title: "Validation Error",
        description:
          "At least one keyword is required. Add keywords with the + button or Enter, or paste comma-separated keywords and save.",
        variant: "destructive",
      });
      return;
    }

    // Validate brand data consistency
    const validation = validateBrandData({
      brand_name: formData.brand_name,
      company_name: formData.company_name,
      website_url: formData.website_url,
      blog_news_url: formData.blog_news_url,
      linkedin_url: formData.linkedin_url,
      facebook_url: formData.facebook_url,
      x_url: formData.x_url,
      instagram_url: formData.instagram_url,
      tiktok_url: formData.tiktok_url,
      youtube_url: formData.youtube_url,
      discord_url: formData.discord_url,
    });

    // Filter out approved warnings
    const unapprovedWarnings = validation.warnings.filter(
      (warning) => !approvedWarnings.has(warning)
    );

    // Show unapproved warnings but allow user to proceed
    if (unapprovedWarnings.length > 0) {
      setValidationWarnings(unapprovedWarnings);
      setValidationErrors(validation.errors);
      toast({
        title: "Validation Warning",
        description:
          "Please review the validation warnings below. You can approve them to proceed.",
        variant: "default",
      });
      return; // Don't proceed until warnings are approved or dismissed
    }

    // Block on errors (non-typo errors)
    if (validation.errors.length > 0) {
      setValidationErrors(validation.errors);
      toast({
        title: "Validation Error",
        description: validation.errors.join("; "),
        variant: "destructive",
      });
      return;
    }

    // Clear validation state if all warnings are approved
    setValidationWarnings([]);
    setValidationErrors([]);

    setIsSaving(true);
    try {
      const createData: any = {
        company_name: formData.company_name.trim(),
        brand_name: formData.brand_name.trim(),
        business_taxonomy_id: formData.business_taxonomy_id,
        brand_stage: formData.brand_stage,
        keywords: effectiveKeywords,
        website_url: formData.website_url.trim() || null,
        careers_url: formData.careers_url.trim() || null,
        blog_news_url: formData.blog_news_url.trim() || null,
        linkedin_url: formData.linkedin_url.trim() || null,
        facebook_url: formData.facebook_url.trim() || null,
        x_url: formData.x_url.trim() || null,
        instagram_url: formData.instagram_url.trim() || null,
        tiktok_url: formData.tiktok_url.trim() || null,
        youtube_url: formData.youtube_url.trim() || null,
        discord_url: formData.discord_url.trim() || null,
      };

      const response = await fetch("/api/admin/brand-directory/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(createData),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's a duplicate error
        if (
          !skipDuplicateCheck &&
          data.error &&
          (data.error.includes("already exists") || data.error.includes("duplicate"))
        ) {
          // Try to fetch the existing brand
          const duplicateResponse = await fetch(
            `/api/admin/brand-directory/brands?search=${encodeURIComponent(formData.brand_name)}`,
            {
              credentials: "include",
            }
          );
          if (duplicateResponse.ok) {
            const duplicateData = await duplicateResponse.json();
            if (duplicateData.brands && duplicateData.brands.length > 0) {
              const existingBrand = duplicateData.brands[0];
              setDuplicateInfo({
                id: existingBrand.id,
                company_name: existingBrand.company_name,
                brand_name: existingBrand.brand_name,
                website_url: existingBrand.website_url,
                businessTaxonomy: existingBrand.businessTaxonomy,
              });
              setShowDuplicateOptions(true);
              setIsSaving(false);
              return;
            }
          }
        }
        throw new Error(data.error || "Failed to create brand");
      }

      toast({
        title: "Success",
        description: "Brand created successfully",
      });

      onOpenChange(false);
      if (onBrandAdded) {
        onBrandAdded(
          data.brand
            ? {
                id: data.brand.id,
                brand_name: data.brand.brand_name,
                company_name: data.brand.company_name ?? data.brand.brand_name,
              }
            : undefined
        );
      }
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create brand",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedTaxonomy = taxonomies.find((t) => t.id === formData.business_taxonomy_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Brand</DialogTitle>
          <DialogDescription>
            Enter brand information manually or use OpenAI to search and complete the details
          </DialogDescription>
        </DialogHeader>

        {showDuplicateOptions && duplicateInfo && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">Brand already exists:</p>
                <p>
                  <strong>Company:</strong> {duplicateInfo.company_name}
                </p>
                <p>
                  <strong>Brand:</strong> {duplicateInfo.brand_name}
                </p>
                {duplicateInfo.website_url && (
                  <p>
                    <strong>Homepage:</strong>{" "}
                    <a
                      href={duplicateInfo.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {duplicateInfo.website_url}
                    </a>
                  </p>
                )}
                <p>
                  <strong>Category:</strong> {duplicateInfo.businessTaxonomy.category} &gt;{" "}
                  {duplicateInfo.businessTaxonomy.subcategory} &gt;{" "}
                  {duplicateInfo.businessTaxonomy.sub_subcategory}
                </p>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDuplicateAbort}
                    disabled={isSaving}
                  >
                    Abort
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDuplicateAdd}
                    disabled={isSaving}
                  >
                    Add Anyway
                  </Button>
                  <Button size="sm" onClick={handleDuplicateOverride} disabled={isSaving}>
                    Override
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {validationWarnings.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">Validation Warnings:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {validationWarnings.map((warning, index) => (
                    <li key={index} className="flex items-start justify-between gap-2">
                      <span className="flex-1">{warning}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setApprovedWarnings((prev) => new Set([...prev, warning]));
                          setValidationWarnings((prev) => prev.filter((w) => w !== warning));
                        }}
                        disabled={isSaving || isSearching}
                      >
                        Approve
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Approve all warnings
                      const allWarnings = new Set(validationWarnings);
                      setApprovedWarnings((prev) => new Set([...prev, ...allWarnings]));
                      setValidationWarnings([]);
                    }}
                    disabled={isSaving || isSearching}
                  >
                    Approve All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setValidationWarnings([]);
                      setValidationErrors([]);
                    }}
                    disabled={isSaving || isSearching}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">Validation Errors:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand_name">Brand Name *</Label>
              <Input
                id="brand_name"
                value={formData.brand_name}
                onChange={(e) => setFormData({ ...formData, brand_name: e.target.value })}
                disabled={isSaving || isSearching}
                placeholder="Enter brand name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                id="company_name"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                disabled={isSaving || isSearching}
                placeholder="Enter company name"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSearchWithOpenAI}
              disabled={isSearching || isSaving || !formData.brand_name.trim()}
              className="flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Search with OpenAI
                </>
              )}
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <div className="relative" ref={taxonomyDropdownRef}>
                <div className="flex items-center">
                  <Input
                    id="category"
                    placeholder="Type to search taxonomy..."
                    value={
                      formData.business_taxonomy_id
                        ? selectedTaxonomy
                          ? `${selectedTaxonomy.category} > ${selectedTaxonomy.subcategory} > ${selectedTaxonomy.sub_subcategory}`
                          : taxonomySearch
                        : taxonomySearch
                    }
                    onChange={(e) => {
                      setTaxonomySearch(e.target.value);
                      setIsTaxonomyDropdownOpen(true);
                      if (formData.business_taxonomy_id) {
                        setFormData({ ...formData, business_taxonomy_id: "" });
                      }
                    }}
                    onFocus={() => setIsTaxonomyDropdownOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setIsTaxonomyDropdownOpen(false);
                      }
                    }}
                    className="pr-8"
                    disabled={isSaving || isSearching}
                  />
                  <ChevronDown className="absolute right-2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                {isTaxonomyDropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                    {taxonomies
                      .filter((tax) => {
                        if (!tax.id || tax.id.trim() === "") return false;
                        if (!taxonomySearch.trim()) return true;

                        const searchLower = taxonomySearch.toLowerCase().trim();
                        const searchWords = searchLower.split(/\s+/).filter((w) => w.length > 0);
                        const fullTaxonomyText =
                          `${tax.category} > ${tax.subcategory} > ${tax.sub_subcategory}`.toLowerCase();
                        const categoryLower = tax.category.toLowerCase();
                        const subcategoryLower = tax.subcategory.toLowerCase();
                        const subSubcategoryLower = tax.sub_subcategory.toLowerCase();

                        const allWordsMatch = searchWords.every((word) => {
                          return (
                            categoryLower.includes(word) ||
                            subcategoryLower.includes(word) ||
                            subSubcategoryLower.includes(word) ||
                            fullTaxonomyText.includes(word)
                          );
                        });

                        const exactMatch =
                          categoryLower.includes(searchLower) ||
                          subcategoryLower.includes(searchLower) ||
                          subSubcategoryLower.includes(searchLower) ||
                          fullTaxonomyText.includes(searchLower);

                        return allWordsMatch || exactMatch;
                      })
                      .slice(0, 50)
                      .map((tax) => (
                        <div
                          key={tax.id}
                          className="p-1 cursor-pointer hover:bg-accent"
                          onClick={() => {
                            setFormData({ ...formData, business_taxonomy_id: tax.id });
                            setTaxonomySearch("");
                            setIsTaxonomyDropdownOpen(false);
                          }}
                        >
                          <div className="px-2 py-1.5 text-sm">
                            {tax.category} &gt; {tax.subcategory} &gt; {tax.sub_subcategory}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand_stage">Brand Stage *</Label>
              <Select
                value={formData.brand_stage}
                onValueChange={(value) =>
                  setFormData({ ...formData, brand_stage: value as BrandStage })
                }
                disabled={isSaving || isSearching}
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
            <Label>Keywords *</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {formData.keywords.map((keyword, index) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1">
                  {keyword}
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(keyword)}
                    disabled={isSaving || isSearching}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Type one or more keywords separated by commas, then press Enter or +. Text in this
              field is included when you save even if you don&apos;t press +.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. cloud security or paste: term one, term two"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
                disabled={isSaving || isSearching}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddKeyword}
                disabled={isSaving || isSearching || !newKeyword.trim()}
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
                  {formData.website_url.trim() && (
                    <a
                      href={formData.website_url.trim()}
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
                  value={formData.website_url}
                  onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="careers_url">Careers URL</Label>
                  {formData.careers_url.trim() && (
                    <a
                      href={formData.careers_url.trim()}
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
                  value={formData.careers_url}
                  onChange={(e) => setFormData({ ...formData, careers_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="blog_news_url">Blog/News URL</Label>
                  {formData.blog_news_url.trim() && (
                    <a
                      href={formData.blog_news_url.trim()}
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
                  value={formData.blog_news_url}
                  onChange={(e) => setFormData({ ...formData, blog_news_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="linkedin_url">LinkedIn URL</Label>
                  {formData.linkedin_url.trim() && (
                    <a
                      href={formData.linkedin_url.trim()}
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
                  value={formData.linkedin_url}
                  onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="facebook_url">Facebook URL</Label>
                  {formData.facebook_url.trim() && (
                    <a
                      href={formData.facebook_url.trim()}
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
                  value={formData.facebook_url}
                  onChange={(e) => setFormData({ ...formData, facebook_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="x_url">X (Twitter) URL</Label>
                  {formData.x_url.trim() && (
                    <a
                      href={formData.x_url.trim()}
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
                  value={formData.x_url}
                  onChange={(e) => setFormData({ ...formData, x_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="instagram_url">Instagram URL</Label>
                  {formData.instagram_url.trim() && (
                    <a
                      href={formData.instagram_url.trim()}
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
                  value={formData.instagram_url}
                  onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tiktok_url">TikTok URL</Label>
                  {formData.tiktok_url.trim() && (
                    <a
                      href={formData.tiktok_url.trim()}
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
                  value={formData.tiktok_url}
                  onChange={(e) => setFormData({ ...formData, tiktok_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="youtube_url">YouTube URL</Label>
                  {formData.youtube_url.trim() && (
                    <a
                      href={formData.youtube_url.trim()}
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
                  value={formData.youtube_url}
                  onChange={(e) => setFormData({ ...formData, youtube_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="discord_url">Discord URL</Label>
                  {formData.discord_url.trim() && (
                    <a
                      href={formData.discord_url.trim()}
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
                  id="discord_url"
                  type="url"
                  placeholder="https://discord.gg/example"
                  value={formData.discord_url}
                  onChange={(e) => setFormData({ ...formData, discord_url: e.target.value })}
                  disabled={isSaving || isSearching}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving || isSearching}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSave()}
            disabled={
              isSaving ||
              isSearching ||
              showDuplicateOptions ||
              validationWarnings.length > 0 ||
              validationErrors.length > 0
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Brand"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
