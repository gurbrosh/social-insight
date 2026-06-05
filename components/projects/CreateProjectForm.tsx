"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { parseKeywords } from "./KeywordsInput";
import { KeywordsSection } from "./KeywordsSection";
import { BrandsSection } from "./BrandsSection";
import {
  BrandRelatedSourcesSection,
  type BrandRelatedSourcesSectionRef,
} from "./BrandRelatedSourcesSection";
import { EngagementThresholdsForm } from "./EngagementThresholdsForm";
import { generateMonitoringFocus } from "@/lib/projects/monitoring-focus-generator";

interface Theme {
  id: string;
  theme_name: string;
  description: string;
  is_active: boolean;
}

export function CreateProjectForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [description, setDescription] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [brands, setBrands] = useState<
    Array<{ id: string; brand_name: string; company_name: string }>
  >([]);
  const [requireKeywordsWithBrands, setRequireKeywordsWithBrands] = useState(false);
  const [profiles, setProfiles] = useState<{
    [platform: string]: Array<{
      id: string;
      name: string;
      url: string;
      type: "person" | "company" | "channel";
      selected: boolean;
    }>;
  }>({});

  // Initialize default themes
  const [themes, setThemes] = useState<Theme[]>([
    {
      id: "temp-1",
      theme_name: "Frustrated with [brand name]",
      description: "Users who are upset or frustrated with brand [brand name]",
      is_active: false,
    },
    {
      id: "temp-2",
      theme_name: "Pricing & Cost",
      description:
        "Posts about service costs, pricing models, fees, value for money, and affordability",
      is_active: false,
    },
    {
      id: "temp-3",
      theme_name: "Security & Privacy",
      description:
        "Posts about security issues, privacy concerns, data protection, vulnerabilities, and safety",
      is_active: false,
    },
  ]);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const brandSourcesRef = useRef<BrandRelatedSourcesSectionRef>(null);

  const handleThemeUpdate = (themeId: string, updates: Partial<Theme>) => {
    setThemes((prev) =>
      prev.map((t) =>
        t.id === themeId ? { ...t, ...updates, is_active: true } : t
      )
    );
    setEditingTheme(null);
  };

  const handleThemeDelete = (themeId: string) => {
    if (confirm("Are you sure you want to delete this theme?")) {
      setThemes(themes.filter((t) => t.id !== themeId));
    }
  };

  const handleThemeToggleActive = (themeId: string, isActive: boolean) => {
    setThemes(themes.map((t) => (t.id === themeId ? { ...t, is_active: isActive } : t)));
  };

  const handleThemeAdd = () => {
    const newTheme: Theme = {
      id: `temp-${crypto.randomUUID()}`,
      theme_name: "New theme",
      description: "",
      is_active: true,
    };
    setThemes((prev) => [...prev, newTheme]);
    setEditingTheme(newTheme);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Project name required",
        description: "Please enter a name for your project.",
        variant: "destructive",
      });
      return;
    }

    const validKeywords = parseKeywords(keywordsInput);
    const selectedBrands = brands.map((brand) => ({
      id: brand.id,
      brand_name: brand.brand_name,
      company_name: brand.company_name,
    }));

    // Validate combined limit (12 total: keywords + brands)
    const totalItems = validKeywords.length + brands.length;
    if (totalItems > 12) {
      toast({
        title: "Too many items",
        description: `You can only add up to 12 items total (keywords + brands). Currently: ${validKeywords.length} keywords + ${brands.length} brands = ${totalItems} items.`,
        variant: "destructive",
      });
      return;
    }

    // Flatten profiles data for submission - send ALL profiles (both selected and unselected)
    const allProfiles = Object.entries(profiles).flatMap(([platform, platformProfiles]) =>
      platformProfiles.map((profile) => ({
        platform,
        name: profile.name,
        url: profile.url,
        type: profile.type,
        is_selected: profile.selected,
      }))
    );

    // Auto-generate monitoring focus
    const monitoringFocus = generateMonitoringFocus({
      keywords: validKeywords,
      brands: selectedBrands.map((b) => b.brand_name),
    });

    if (validKeywords.length === 0 && brands.length === 0) {
      toast({
        title: "Keywords or brands required",
        description: "Please add at least one keyword or brand to monitor.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Read engagement thresholds from hidden inputs
      const linkedinInput = document.getElementById(
        "linkedin_engagement_threshold"
      ) as HTMLInputElement;
      const facebookInput = document.getElementById(
        "facebook_engagement_threshold"
      ) as HTMLInputElement;
      const twitterInput = document.getElementById(
        "twitter_engagement_threshold"
      ) as HTMLInputElement;

      const linkedin_engagement_threshold = linkedinInput?.value
        ? parseInt(linkedinInput.value)
        : null;
      const facebook_engagement_threshold = facebookInput?.value
        ? parseInt(facebookInput.value)
        : null;
      const twitter_engagement_threshold = twitterInput?.value
        ? parseInt(twitterInput.value)
        : null;

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          monitoring_focus: monitoringFocus,
          keywords: validKeywords,
          brands: selectedBrands,
          profiles: allProfiles,
          themes: themes.map(({ id, ...rest }) => rest), // Exclude temp id
          linkedin_engagement_threshold,
          facebook_engagement_threshold,
          twitter_engagement_threshold,
          require_keywords_with_brands: requireKeywordsWithBrands,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create project");
      }

      const project = await response.json();

      // Save brand sources if any were configured
      if (brandSourcesRef.current && brands.length > 0 && brands.some((b) => b.id)) {
        try {
          await brandSourcesRef.current.saveSourcesForProject(project.id);
        } catch (error) {
          console.error("Error saving brand sources:", error);
          // Don't block navigation, but log the error
        }
      }

      toast({
        title: "Project created",
        description: "Your project has been created successfully.",
      });

      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast({
        title: "Error",
        description: "Failed to create project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id="create-project-form" onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Brand Monitoring, Product Launch"
              required
            />
          </div>

          {/* Keywords and Brands Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Keywords Section */}
            <KeywordsSection
              value={keywordsInput}
              onChange={setKeywordsInput}
              maxTotal={12}
              currentBrandCount={brands.length}
              selectedBrandIds={brands.map((b) => b.id).filter((id) => id)}
            />

            {/* Brands Section and Brand Related Sources */}
            <div className="space-y-6">
              {/* Brands Section */}
              <BrandsSection
                brands={brands}
                onBrandsChange={setBrands}
                keywords={parseKeywords(keywordsInput)}
                maxTotal={12}
                currentKeywordCount={parseKeywords(keywordsInput).length}
              />

              {/* Brand Related Sources Section */}
              {brands.length > 0 && brands.some((b) => b.id) && (
                <BrandRelatedSourcesSection
                  ref={brandSourcesRef}
                  projectId={null}
                  brands={brands}
                  projectKeywords={parseKeywords(keywordsInput)}
                />
              )}
            </div>
          </div>

          {/* Relevance Mode Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="require-keywords-with-brands" className="text-base">
                Require keywords to focus on brands
              </Label>
              <p className="text-sm text-muted-foreground">
                When enabled, records qualify only when content mentions both a keyword and a brand.
                When disabled, keywords and brands qualify independently.
              </p>
            </div>
            <Switch
              id="require-keywords-with-brands"
              checked={requireKeywordsWithBrands}
              onCheckedChange={setRequireKeywordsWithBrands}
              disabled={brands.length === 0}
            />
          </div>
        </CardContent>
      </Card>

      {/* Conversation Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Filter</CardTitle>
          <CardDescription>
            For projects that have high social media engagement, use filters to eliminate shorter
            conversations that have fewer likes/ comments/ shares
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EngagementThresholdsForm
            initialThresholds={{
              linkedin: null,
              facebook: null,
              twitter: null,
            }}
            formId="create-project-form"
          />
        </CardContent>
      </Card>

      {/* Themes Management */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle>Themes</CardTitle>
              <CardDescription>
                Define Themes to capture specific conversations that matter to you, like &ldquo;cost
                of service&rdquo;, &ldquo;security concerns&rdquo;, or &ldquo;user experience&rdquo;
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleThemeAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add theme
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {themes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No themes defined</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[250px]">Theme Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px] text-center">Active</TableHead>
                    <TableHead className="w-[120px] text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {themes.map((theme) => (
                    <TableRow key={theme.id}>
                      <TableCell className="font-medium">{theme.theme_name}</TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {theme.description || "No description"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={theme.is_active}
                          onCheckedChange={(checked) => handleThemeToggleActive(theme.id, checked)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Dialog
                            open={editingTheme?.id === theme.id}
                            onOpenChange={(open) => {
                              if (!open) {
                                setEditingTheme(null);
                              } else {
                                setEditingTheme(theme);
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingTheme(theme)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Edit Theme</DialogTitle>
                                <DialogDescription>Update the theme details</DialogDescription>
                              </DialogHeader>
                              {editingTheme && editingTheme.id === theme.id && (
                                <>
                                  <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                      <Label htmlFor="edit-theme-name">Theme Name *</Label>
                                      <Input
                                        id="edit-theme-name"
                                        value={editingTheme.theme_name}
                                        onChange={(e) =>
                                          setEditingTheme({
                                            ...editingTheme,
                                            theme_name: e.target.value,
                                          })
                                        }
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="edit-theme-description">Description</Label>
                                      <Textarea
                                        id="edit-theme-description"
                                        value={editingTheme.description || ""}
                                        onChange={(e) =>
                                          setEditingTheme({
                                            ...editingTheme,
                                            description: e.target.value,
                                          })
                                        }
                                        rows={3}
                                      />
                                    </div>
                                  </div>
                                  <DialogFooter>
                                    <Button
                                      onClick={() => {
                                        if (editingTheme) {
                                          handleThemeUpdate(editingTheme.id, {
                                            theme_name: editingTheme.theme_name,
                                            description: editingTheme.description,
                                          });
                                        }
                                      }}
                                    >
                                      Save Changes
                                    </Button>
                                  </DialogFooter>
                                </>
                              )}
                            </DialogContent>
                          </Dialog>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleThemeDelete(theme.id)}
                          >
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={() => router.back()} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  );
}
