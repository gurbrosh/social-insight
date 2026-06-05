"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { parseKeywords } from "./KeywordsInput";
import { KeywordsSection } from "./KeywordsSection";
import { BrandsSection } from "./BrandsSection";
import {
  BrandRelatedSourcesSection,
  type BrandRelatedSourcesSectionRef,
} from "./BrandRelatedSourcesSection";
import { generateMonitoringFocus } from "@/lib/projects/monitoring-focus-generator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface EditProjectFormProps {
  projectId: string;
  initialData: {
    name: string;
    description: string;
    monitoring_focus?: string;
    keywords: string[];
    brands: Array<{ id: string; brand_name: string; company_name?: string }> | string[]; // Support both formats
    profiles?: Array<{
      platform: string;
      name: string;
      url: string;
      type: "person" | "company" | "channel";
      is_selected: boolean;
    }>;
    require_keywords_with_brands?: boolean;
    analysis_profile?: "full" | "minimal";
    analysis_sample_post_limit?: number | null;
  };
}

type ProjectPurgeAction = "none" | "analysis" | "records";

type ProfileEntry = {
  id: string;
  name: string;
  url: string;
  type: "person" | "company" | "channel";
  selected: boolean;
};

type ProfileState = Record<string, ProfileEntry[]>;

interface ProjectUpdateRequest {
  projectId: string;
  name: string;
  description: string;
  monitoring_focus?: string;
  keywords: string[];
  brands: Array<string | { id: string; brand_name: string; company_name?: string }>;
  profiles: Array<{
    platform: string;
    name: string;
    url: string;
    type: "person" | "company" | "channel";
    is_selected: boolean;
  }>;
  linkedin_engagement_threshold?: number | null;
  facebook_engagement_threshold?: number | null;
  twitter_engagement_threshold?: number | null;
  require_keywords_with_brands?: boolean;
  analysis_profile?: "full" | "minimal";
  analysis_sample_post_limit?: number | null;
}

const normalizeStringArray = (values: string[] | undefined | null): string[] => {
  if (!values) {
    return [];
  }

  const normalized = values
    .map((value) => value?.trim())
    .filter((value): value is string => !!value && value.length > 0);

  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
};

const normalizeProfilesComparable = (
  profiles: Array<{
    platform: string;
    name: string;
    url: string;
    type: "person" | "company" | "channel";
    selected: boolean;
  }>
): string[] =>
  profiles
    .map((profile) => ({
      platform: profile.platform.trim(),
      name: profile.name.trim(),
      url: profile.url.trim(),
      type: profile.type,
      selected: profile.selected,
    }))
    .map(
      (profile) =>
        `${profile.platform}::${profile.name}::${profile.url}::${profile.type}::${profile.selected ? "1" : "0"}`
    )
    .sort((a, b) => a.localeCompare(b));

const normalizeProfilesFromArray = (
  profiles:
    | Array<{
        platform: string;
        name: string;
        url: string;
        type: "person" | "company" | "channel";
        is_selected?: boolean;
      }>
    | undefined
): string[] => {
  if (!profiles || profiles.length === 0) {
    return [];
  }

  const comparable = profiles.map((profile) => ({
    platform: profile.platform || "",
    name: profile.name || "",
    url: profile.url || "",
    type: profile.type,
    selected: profile.is_selected ?? true,
  }));

  return normalizeProfilesComparable(comparable);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const normalizeProfilesFromState = (profileState: ProfileState): string[] => {
  const comparable: Array<{
    platform: string;
    name: string;
    url: string;
    type: "person" | "company" | "channel";
    selected: boolean;
  }> = [];

  Object.entries(profileState).forEach(([platform, entries]) => {
    entries.forEach((entry) => {
      comparable.push({
        platform,
        name: entry.name,
        url: entry.url,
        type: entry.type,
        selected: entry.selected,
      });
    });
  });

  return normalizeProfilesComparable(comparable);
};

const normalizeProfilesFromRequest = (
  profiles: ProjectUpdateRequest["profiles"] | undefined
): string[] => {
  if (!profiles || profiles.length === 0) {
    return [];
  }

  const comparable = profiles.map((profile) => ({
    platform: profile.platform || "",
    name: profile.name || "",
    url: profile.url || "",
    type: profile.type,
    selected: profile.is_selected ?? true,
  }));

  return normalizeProfilesComparable(comparable);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
};

export function EditProjectForm({ projectId, initialData }: EditProjectFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialData.name);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [description, setDescription] = useState(initialData.description);
  const [keywordsInput, setKeywordsInput] = useState(initialData.keywords.join(", "));
  // Handle both string[] (legacy) and object[] formats for brands
  const [brands, setBrands] = useState<
    Array<{ id: string; brand_name: string; company_name: string }>
  >(
    initialData.brands.map((brand) => {
      if (typeof brand === "string") {
        return { id: "", brand_name: brand, company_name: brand };
      }
      return {
        id: brand.id || "",
        brand_name: brand.brand_name,
        company_name: brand.company_name || brand.brand_name,
      };
    })
  );

  // Initialize profiles state from initialData
  const [profiles, setProfiles] = useState<ProfileState>(() => {
    if (!initialData.profiles || initialData.profiles.length === 0) {
      return {};
    }

    // Group profiles by platform
    const groupedProfiles: ProfileState = {};

    initialData.profiles.forEach((profile) => {
      if (!groupedProfiles[profile.platform]) {
        groupedProfiles[profile.platform] = [];
      }

      // Use a stable ID based on platform+name+url to avoid duplicates
      const stableId = `${profile.platform}-${profile.name}-${profile.url}`.replace(
        /[^a-zA-Z0-9-]/g,
        "-"
      );

      groupedProfiles[profile.platform].push({
        id: stableId,
        name: profile.name,
        url: profile.url,
        type: profile.type,
        selected: profile.is_selected ?? true,
      });
    });

    return groupedProfiles;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPurgeDialog, setShowPurgeDialog] = useState(false);
  const [pendingRequestData, setPendingRequestData] = useState<ProjectUpdateRequest | null>(null);
  const [detectedChangeReasons, setDetectedChangeReasons] = useState<string[]>([]);
  const [dialogActionLoading, setDialogActionLoading] = useState<ProjectPurgeAction | null>(null);
  const [requireKeywordsWithBrands, setRequireKeywordsWithBrands] = useState(
    initialData.require_keywords_with_brands ?? false
  );
  const [analysisProfile, setAnalysisProfile] = useState<"full" | "minimal">(
    initialData.analysis_profile === "minimal" ? "minimal" : "full"
  );
  const [analysisSamplePostLimit, setAnalysisSamplePostLimit] = useState<string>(
    initialData.analysis_sample_post_limit != null && initialData.analysis_sample_post_limit > 0
      ? String(initialData.analysis_sample_post_limit)
      : ""
  );
  const brandSourcesRef = useRef<BrandRelatedSourcesSectionRef>(null);

  // Convert brands to strings for comparison
  const initialBrandsAsStrings = initialData.brands.map((b) =>
    typeof b === "string" ? b : b.brand_name
  );

  const initialSnapshotRef = useRef({
    monitoringFocus: (initialData.monitoring_focus || "").trim(),
    keywords: normalizeStringArray(initialData.keywords),
    brands: normalizeStringArray(initialBrandsAsStrings),
    profiles: normalizeProfilesFromArray(initialData.profiles),
  });

  const evaluateSensitiveChanges = (request: ProjectUpdateRequest) => {
    const reasons: string[] = [];

    // Monitoring focus is auto-generated now, so we don't track it as a change
    // (it will be regenerated based on keywords/brands)

    const currentKeywords = normalizeStringArray(request.keywords);
    const removedKeywords = initialSnapshotRef.current.keywords.filter(
      (keyword) => !currentKeywords.includes(keyword)
    );
    if (removedKeywords.length > 0) {
      reasons.push("Keywords");
    }

    // Convert brands to strings for comparison
    const currentBrandsAsStrings = request.brands.map((b: any) =>
      typeof b === "string" ? b : b.brand_name
    );
    const currentBrands = normalizeStringArray(currentBrandsAsStrings);
    const removedBrands = initialSnapshotRef.current.brands.filter(
      (brand) => !currentBrands.includes(brand)
    );
    if (removedBrands.length > 0) {
      reasons.push("Brands");
    }

    // Profiles section removed - will be migrated to taxonomy tree later

    return {
      hasChanges: reasons.length > 0,
      reasons,
    };
  };

  const performUpdate = async (
    requestData: ProjectUpdateRequest,
    purgeAction: ProjectPurgeAction
  ) => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    if (purgeAction !== "none") {
      setDialogActionLoading(purgeAction);
    } else {
      setDialogActionLoading(null);
    }

    let requestSucceeded = false;

    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          ...requestData,
          purge_action: purgeAction,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update project");
      }

      const description = (() => {
        switch (purgeAction) {
          case "analysis":
            return "Project updated. Analysis data will be regenerated.";
          case "records":
            return "Project updated and all project records were removed.";
          default:
            return "Your project has been updated successfully.";
        }
      })();

      toast({
        title: "Project Updated",
        description,
      });

      setPendingRequestData(null);
      setShowPurgeDialog(false);
      setDetectedChangeReasons([]);
      requestSucceeded = true;

      // Save brand sources if any were configured
      if (brandSourcesRef.current && brands.length > 0 && brands.some((b) => b.id)) {
        try {
          await brandSourcesRef.current.saveSourcesForProject(projectId);
        } catch (error) {
          console.error("Error saving brand sources:", error);
          // Don't block success, but log the error
        }
      }

      router.push(`/projects/${projectId}`);
    } catch (error) {
      console.error("Error updating project:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update project.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setDialogActionLoading(null);
      if (!requestSucceeded && purgeAction !== "none") {
        setShowPurgeDialog(true);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) {
      return;
    }

    const selectedBrands = brands.map((brand) => ({
      id: brand.id,
      brand_name: brand.brand_name,
      company_name: brand.company_name,
    }));

    // Validate combined limit (12 total: keywords + brands)
    const totalItems = parseKeywords(keywordsInput).length + brands.length;
    if (totalItems > 12) {
      toast({
        title: "Too many items",
        description: `You can only add up to 12 items total (keywords + brands). Currently: ${parseKeywords(keywordsInput).length} keywords + ${brands.length} brands = ${totalItems} items.`,
        variant: "destructive",
      });
      return;
    }

    // Auto-generate monitoring focus
    const monitoringFocus = generateMonitoringFocus({
      keywords: parseKeywords(keywordsInput),
      brands: selectedBrands.map((b) => b.brand_name),
    });

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

    // Deduplicate profiles based on platform + name + url combination
    const uniqueProfiles = allProfiles.filter(
      (profile, index, self) =>
        index ===
        self.findIndex(
          (p) => p.platform === profile.platform && p.name === profile.name && p.url === profile.url
        )
    );

    // Read threshold values from hidden inputs
    const linkedinThresholdInput = document.getElementById(
      "linkedin_engagement_threshold"
    ) as HTMLInputElement;
    const facebookThresholdInput = document.getElementById(
      "facebook_engagement_threshold"
    ) as HTMLInputElement;
    const twitterThresholdInput = document.getElementById(
      "twitter_engagement_threshold"
    ) as HTMLInputElement;

    const linkedinThreshold = linkedinThresholdInput?.value
      ? parseInt(linkedinThresholdInput.value, 10)
      : null;
    const facebookThreshold = facebookThresholdInput?.value
      ? parseInt(facebookThresholdInput.value, 10)
      : null;
    const twitterThreshold = twitterThresholdInput?.value
      ? parseInt(twitterThresholdInput.value, 10)
      : null;

    const requestData: ProjectUpdateRequest = {
      projectId,
      name,
      description,
      monitoring_focus: monitoringFocus,
      keywords: parseKeywords(keywordsInput),
      brands: selectedBrands,
      profiles: uniqueProfiles,
      linkedin_engagement_threshold: linkedinThreshold,
      facebook_engagement_threshold: facebookThreshold,
      twitter_engagement_threshold: twitterThreshold,
      require_keywords_with_brands: requireKeywordsWithBrands,
      analysis_profile: analysisProfile,
      analysis_sample_post_limit:
        analysisSamplePostLimit.trim() === ""
          ? null
          : (() => {
              const n = parseInt(analysisSamplePostLimit.trim(), 10);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
    };

    const { hasChanges, reasons } = evaluateSensitiveChanges(requestData);

    if (hasChanges) {
      setPendingRequestData(requestData);
      setDetectedChangeReasons(reasons);
      setShowPurgeDialog(true);
      return;
    }

    setDetectedChangeReasons([]);
    await performUpdate(requestData, "none");
  };

  const handlePurgeAction = async (action: ProjectPurgeAction) => {
    if (!pendingRequestData) {
      setShowPurgeDialog(false);
      return;
    }

    // Read latest threshold values from hidden inputs
    const linkedinThresholdInput = document.getElementById(
      "linkedin_engagement_threshold"
    ) as HTMLInputElement;
    const facebookThresholdInput = document.getElementById(
      "facebook_engagement_threshold"
    ) as HTMLInputElement;
    const twitterThresholdInput = document.getElementById(
      "twitter_engagement_threshold"
    ) as HTMLInputElement;

    const linkedinThreshold = linkedinThresholdInput?.value
      ? parseInt(linkedinThresholdInput.value, 10)
      : null;
    const facebookThreshold = facebookThresholdInput?.value
      ? parseInt(facebookThresholdInput.value, 10)
      : null;
    const twitterThreshold = twitterThresholdInput?.value
      ? parseInt(twitterThresholdInput.value, 10)
      : null;

    // Update request data with latest thresholds
    const updatedRequestData = {
      ...pendingRequestData,
      linkedin_engagement_threshold: linkedinThreshold,
      facebook_engagement_threshold: facebookThreshold,
      twitter_engagement_threshold: twitterThreshold,
    };

    await performUpdate(updatedRequestData, action);
  };

  const isActionLoading = (action: ProjectPurgeAction) =>
    dialogActionLoading === action && isSubmitting;

  return (
    <>
      <form id="edit-project-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Project Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Project Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter project name"
            required
            disabled={isSubmitting}
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
                projectId={projectId}
                brands={brands}
                projectKeywords={parseKeywords(keywordsInput)}
              />
            )}
          </div>
        </div>

        {/* Analysis pipeline */}
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <p className="text-base font-medium">Analysis pipeline</p>
            <p className="text-sm text-muted-foreground">
              Full runs the standard task queue. Minimal runs sentiment, themes, and brand only
              (faster). Optional sample limit caps recent posts for ad-hoc runs when the API request
              does not pass a limit.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="analysis_profile">Profile</Label>
              <Select
                value={analysisProfile}
                onValueChange={(v) => setAnalysisProfile(v as "full" | "minimal")}
                disabled={isSubmitting}
              >
                <SelectTrigger id="analysis_profile">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis_sample_post_limit">Sample post limit (optional)</Label>
              <Input
                id="analysis_sample_post_limit"
                type="number"
                min={1}
                placeholder="All posts"
                value={analysisSamplePostLimit}
                onChange={(e) => setAnalysisSamplePostLimit(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
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
            disabled={brands.length === 0 || isSubmitting}
          />
        </div>
      </form>

      <Dialog
        open={showPurgeDialog}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setShowPurgeDialog(false);
            setPendingRequestData(null);
            setDetectedChangeReasons([]);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detected project scope changes</DialogTitle>
            <DialogDescription>
              We noticed updates to key monitoring settings. Choose how you want to handle existing
              data before saving.
            </DialogDescription>
          </DialogHeader>

          {detectedChangeReasons.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium">Changes detected:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {detectedChangeReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p>Select how the existing project data should be treated:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium text-foreground">Keep existing data</span> – update the
                project without deleting historical records.
              </li>
              <li>
                <span className="font-medium text-foreground">Remove analysis data</span> – clear
                computed insights so they can be regenerated.
              </li>
              <li>
                <span className="font-medium text-foreground">Remove all records</span> – delete
                posts, jobs, and analysis related to this project.
              </li>
            </ul>
          </div>

          <DialogFooter className="mt-6 flex flex-col items-stretch space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (isSubmitting) return;
                setShowPurgeDialog(false);
                setPendingRequestData(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePurgeAction("none")}
              disabled={isSubmitting}
            >
              {isSubmitting && dialogActionLoading === null && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Keep existing data
            </Button>
            <Button onClick={() => handlePurgeAction("analysis")} disabled={isSubmitting}>
              {isActionLoading("analysis") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove analysis data
            </Button>
            <Button
              variant="destructive"
              onClick={() => handlePurgeAction("records")}
              disabled={isSubmitting}
            >
              {isActionLoading("records") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove all records
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
