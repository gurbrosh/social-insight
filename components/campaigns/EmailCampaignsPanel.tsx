"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { listCampaignExclusionGroups } from "@/lib/campaigns/campaign-criteria-mapping";
import { listCampaignCompanyRoleGroups } from "@/lib/campaigns/company-role-search-mapping";
import type { CampaignCompanyRoleGroupId } from "@/lib/campaigns/company-role-search-mapping";
import {
  CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT,
  CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT,
} from "@/lib/campaigns/constants";
import {
  downloadCampaignEnrichedCsvClient,
  downloadCampaignPhase1CsvClient,
} from "@/lib/campaigns/download-csv-client";
import { mergeCampaignCandidates } from "@/lib/campaigns/merge-campaign-candidates";
import { computePhase1SummaryCounts } from "@/lib/campaigns/phase1-summary";
import type {
  CampaignCandidatePreviewRow,
  CampaignEnrichedCandidateRow,
  CampaignEnrichmentRunStats,
  CampaignExclusionCriterionId,
  CampaignMergeStats,
  CampaignPostBasedCollectStats,
  CampaignPrerequisiteResult,
} from "@/lib/campaigns/types";
import type { EmailReportRangeUnit } from "@/app/actions/email-report-settings";
import { AlertCircle, Download, Play, RefreshCw } from "lucide-react";

const DEFAULT_CAMPAIGN_MIN_RELEVANCE_PERCENT = "80";
const DEFAULT_LOOKBACK_AMOUNT = "7";

type Props = {
  projectId: string;
  projectName: string;
};

export function EmailCampaignsPanel({ projectId, projectName }: Props) {
  const exclusionGroups = useMemo(() => listCampaignExclusionGroups(), []);
  const companyRoleGroups = useMemo(() => listCampaignCompanyRoleGroups(), []);
  const { toast } = useToast();
  const [campaignMinRelevancePercent, setCampaignMinRelevancePercent] = useState(
    DEFAULT_CAMPAIGN_MIN_RELEVANCE_PERCENT
  );
  const [campaignLookbackAmount, setCampaignLookbackAmount] = useState(DEFAULT_LOOKBACK_AMOUNT);
  const [campaignLookbackUnit, setCampaignLookbackUnit] = useState<EmailReportRangeUnit>("days");

  const [postBasedPrerequisite, setPostBasedPrerequisite] = useState<CampaignPrerequisiteResult>({
    ok: true,
  });
  const [selectedExclusions, setSelectedExclusions] = useState<Set<CampaignExclusionCriterionId>>(
    new Set()
  );
  const [postBasedCandidates, setPostBasedCandidates] = useState<CampaignCandidatePreviewRow[]>(
    []
  );
  const [companySearchCandidates, setCompanySearchCandidates] = useState<
    CampaignCandidatePreviewRow[]
  >([]);
  const [mergeStats, setMergeStats] = useState<CampaignMergeStats | null>(null);
  const [companySearchRawCount, setCompanySearchRawCount] = useState<number | null>(null);
  const [companySearchWarnings, setCompanySearchWarnings] = useState<string[]>([]);

  const [companyUrlsText, setCompanyUrlsText] = useState("");
  const [selectedRoleGroups, setSelectedRoleGroups] = useState<Set<CampaignCompanyRoleGroupId>>(
    new Set()
  );
  const [companySearchMaxItems, setCompanySearchMaxItems] = useState("25");

  const [phase1Candidates, setPhase1Candidates] = useState<CampaignCandidatePreviewRow[] | null>(
    null
  );
  const [stats, setStats] = useState<CampaignPostBasedCollectStats | null>(null);
  const [phase1Limited, setPhase1Limited] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingCompanySearch, setLoadingCompanySearch] = useState(false);
  const [loadingPhase1, setLoadingPhase1] = useState(false);
  const [enrichedCandidates, setEnrichedCandidates] = useState<
    CampaignEnrichedCandidateRow[] | null
  >(null);
  const [enrichmentStats, setEnrichmentStats] = useState<CampaignEnrichmentRunStats | null>(
    null
  );
  const [loadingEnrichment, setLoadingEnrichment] = useState(false);
  const [prereqLoading, setPrereqLoading] = useState(false);

  const sourceParamsKey = useMemo(
    () =>
      [projectId, campaignLookbackAmount, campaignLookbackUnit, campaignMinRelevancePercent].join(
        "|"
      ),
    [projectId, campaignLookbackAmount, campaignLookbackUnit, campaignMinRelevancePercent]
  );

  useEffect(() => {
    setPostBasedCandidates([]);
    setPhase1Candidates(null);
    setStats(null);
    setPhase1Limited(false);
  }, [sourceParamsKey]);

  const loadedCandidates = useMemo(() => {
    return mergeCampaignCandidates(postBasedCandidates, companySearchCandidates).candidates;
  }, [postBasedCandidates, companySearchCandidates]);

  const loadedMergeStats = useMemo((): CampaignMergeStats | null => {
    if (postBasedCandidates.length === 0 && companySearchCandidates.length === 0) {
      return mergeStats;
    }
    return mergeCampaignCandidates(postBasedCandidates, companySearchCandidates).stats;
  }, [postBasedCandidates, companySearchCandidates, mergeStats]);

  const exclusionsKey = useMemo(
    () => [...selectedExclusions].sort().join(","),
    [selectedExclusions]
  );

  useEffect(() => {
    setPhase1Candidates(null);
    setPhase1Limited(false);
    setEnrichedCandidates(null);
    setEnrichmentStats(null);
  }, [exclusionsKey]);

  useEffect(() => {
    if (!projectId) return;
    setPrereqLoading(true);
    fetch(`/api/projects/${projectId}/campaigns/prerequisites`)
      .then((r) => r.json())
      .then((data) => {
        if (data.postBasedPrerequisite) {
          setPostBasedPrerequisite(data.postBasedPrerequisite);
        }
      })
      .catch(() => {
        setPostBasedPrerequisite({
          ok: false,
          code: "missing_product",
          message: "Could not verify campaign prerequisites for this project.",
        });
      })
      .finally(() => setPrereqLoading(false));
  }, [projectId]);

  const postBasedReady = postBasedPrerequisite.ok && !prereqLoading;

  const phase1Summary = useMemo(
    () => (phase1Candidates ? computePhase1SummaryCounts(phase1Candidates) : null),
    [phase1Candidates]
  );

  const continuingCount = phase1Summary?.continuingToLaterEnrichment ?? 0;
  const alreadyEnrichedCount = enrichedCandidates?.filter(
    (r) => r.enrichment_status === "success"
  ).length ?? 0;
  const enrichmentPendingCount = Math.max(0, continuingCount - alreadyEnrichedCount);

  const toggleExclusion = useCallback((id: CampaignExclusionCriterionId, checked: boolean) => {
    setSelectedExclusions((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const clearAllExclusions = () => setSelectedExclusions(new Set());

  const loadSourceList = async () => {
    if (!projectId) return;
    setLoadingSource(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/campaigns/post-based-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rangeAmount: Number.parseInt(campaignLookbackAmount, 10) || 7,
          rangeUnit: campaignLookbackUnit,
          minRelevancePercent: Number.parseInt(campaignMinRelevancePercent, 10) || 0,
          selectedExclusionIds: [],
          includePhase1: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.prerequisite && !data.prerequisite.ok) {
          setPostBasedPrerequisite(data.prerequisite);
          toast({
            title: "Cannot load post-based candidates",
            description: data.prerequisite.message,
            variant: "destructive",
          });
          setPostBasedCandidates([]);
          setStats(null);
          return;
        }
        throw new Error(data.error || "Load failed");
      }
      const loaded = (data.candidates ?? []) as CampaignCandidatePreviewRow[];
      setPostBasedCandidates(loaded);
      setMergeStats(mergeCampaignCandidates(loaded, companySearchCandidates).stats);
      setStats(data.stats ?? null);
      setPhase1Candidates(null);
      toast({
        title: "Source list loaded",
        description: `${data.candidates?.length ?? 0} candidate(s) for ${projectName}. Run Phase 1 on the Run tab.`,
      });
    } catch (e) {
      toast({
        title: "Load failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingSource(false);
    }
  };

  const runCompanySearch = async () => {
    if (!projectId) return;
    const companyUrls = companyUrlsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (companyUrls.length === 0) {
      toast({
        title: "Company URLs required",
        description: "Enter at least one LinkedIn company URL.",
        variant: "destructive",
      });
      return;
    }
    if (selectedRoleGroups.size === 0) {
      toast({
        title: "Role groups required",
        description: "Select at least one role group.",
        variant: "destructive",
      });
      return;
    }

    setLoadingCompanySearch(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/campaigns/company-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyUrls,
          roleGroups: [...selectedRoleGroups],
          maxItems: Number.parseInt(companySearchMaxItems, 10) || 25,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg =
          data.errors?.[0] ?? data.error ?? "Company / role search failed";
        throw new Error(errMsg);
      }
      const converted = (data.candidates ?? []) as CampaignCandidatePreviewRow[];
      setCompanySearchCandidates(converted);
      setCompanySearchRawCount(data.rawCount ?? null);
      setCompanySearchWarnings(data.warnings ?? []);
      setMergeStats(
        mergeCampaignCandidates(postBasedCandidates, converted).stats
      );
      setPhase1Candidates(null);
      toast({
        title: "Company / role search complete",
        description: `${data.normalizedCount ?? converted.length} normalized candidate(s). Merged list updated.`,
      });
    } catch (e) {
      toast({
        title: "Company / role search failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingCompanySearch(false);
    }
  };

  const toggleRoleGroup = (id: CampaignCompanyRoleGroupId, checked: boolean) => {
    setSelectedRoleGroups((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runPhase1 = async () => {
    if (!projectId || loadedCandidates.length === 0) return;
    setLoadingPhase1(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/campaigns/phase1-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: loadedCandidates,
          selectedExclusionIds: [...selectedExclusions],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Phase 1 failed");
      }
      setPhase1Candidates(data.candidates ?? []);
      setPhase1Limited(Boolean(data.phase1Limited));
      setEnrichedCandidates(null);
      setEnrichmentStats(null);
      toast({
        title: "Phase 1 complete",
        description: `Deterministic qualification applied to ${data.candidates?.length ?? 0} row(s).`,
      });
    } catch (e) {
      toast({
        title: "Phase 1 failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingPhase1(false);
    }
  };

  const runProfileEnrichment = async () => {
    if (!projectId || !phase1Candidates?.length) return;

    if (continuingCount > CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT) {
      toast({
        title: "Too many candidates",
        description: `Phase 3 supports up to ${CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT} profile enrichments at a time. Reduce the candidate list or run a smaller batch.`,
        variant: "destructive",
      });
      return;
    }

    if (
      !window.confirm(
        `This will fetch full LinkedIn profiles for ${Math.min(continuingCount, CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT)} candidate(s) using Apify and may incur cost. Continue?`
      )
    ) {
      return;
    }

    setLoadingEnrichment(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/campaigns/enrich-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: phase1Candidates,
          selectedExclusionIds: [...selectedExclusions],
          limit: CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Profile enrichment failed");
      }
      setEnrichedCandidates(data.enrichedCandidates ?? []);
      setEnrichmentStats(data.stats ?? null);
      toast({
        title: "Phase 3 enrichment complete",
        description: `${data.successful ?? 0} successful, ${data.failed ?? 0} failed, ${data.notFound ?? 0} not found.`,
      });
    } catch (e) {
      toast({
        title: "Profile enrichment failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingEnrichment(false);
    }
  };

  const downloadEnrichedCsv = () => {
    const rows = enrichedCandidates ?? [];
    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Run Phase 3 enrichment first.",
        variant: "destructive",
      });
      return;
    }
    downloadCampaignEnrichedCsvClient(rows, "campaign_enriched", [...selectedExclusions]);
    toast({
      title: "Enriched CSV downloaded",
      description: `${rows.length} row(s) from this enrichment run.`,
    });
  };

  const downloadPhase1Csv = () => {
    const rows = phase1Candidates ?? [];
    if (rows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Run Phase 1 first.",
        variant: "destructive",
      });
      return;
    }
    downloadCampaignPhase1CsvClient(rows, "campaign_phase1", [...selectedExclusions]);
    toast({
      title: "Phase 1 CSV downloaded",
      description: `${rows.length} row(s) from this run (no re-fetch).`,
    });
  };

  if (!projectId) {
    return (
      <p className="text-sm text-muted-foreground">Select a project above to configure campaigns.</p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <strong>Campaigns</strong> build CSV-first qualification lists for{" "}
        <strong>{projectName}</strong>: load sources, choose exclusions, run Phase 1 deterministic
        screening, enrich continuing candidates (Phase 3), then export. Semantic LLM qualification
        and outreach emails are later phases.
      </p>

      {!postBasedReady && !prereqLoading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Post-based source unavailable</AlertTitle>
          <AlertDescription>
            {postBasedPrerequisite.ok
              ? "Post-based source is unavailable for this project."
              : postBasedPrerequisite.message}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="sources" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="exclusions">Exclusion criteria</TabsTrigger>
          <TabsTrigger value="run">Run</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Post-based candidates</CardTitle>
              <CardDescription>
                Post-based sources reuse the same underlying data as the LinkedIn prospects export,
                but this campaign can use its own relevance threshold and lookback window. Loads
                identity and source context only — no Phase 1 qualification on this tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Lookback window</Label>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="campaign-lookback-amount"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      Amount (1–31)
                    </Label>
                    <Input
                      id="campaign-lookback-amount"
                      type="number"
                      min={1}
                      max={31}
                      className="w-24"
                      value={campaignLookbackAmount}
                      onChange={(e) => setCampaignLookbackAmount(e.target.value)}
                      disabled={!postBasedReady}
                    />
                  </div>
                  <div className="space-y-1.5 min-w-[140px]">
                    <Label
                      htmlFor="campaign-lookback-unit"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      Unit
                    </Label>
                    <Select
                      value={campaignLookbackUnit}
                      onValueChange={(v) => setCampaignLookbackUnit(v as EmailReportRangeUnit)}
                      disabled={!postBasedReady}
                    >
                      <SelectTrigger id="campaign-lookback-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="weeks">Weeks</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="campaign-min-relevance">Minimum relevance % (0–100)</Label>
                <Input
                  id="campaign-min-relevance"
                  type="number"
                  min={0}
                  max={100}
                  className="w-28"
                  value={campaignMinRelevancePercent}
                  onChange={(e) => setCampaignMinRelevancePercent(e.target.value)}
                  disabled={!postBasedReady}
                />
              </div>
              <Button
                type="button"
                disabled={!postBasedReady || loadingSource}
                onClick={loadSourceList}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingSource ? "animate-spin" : ""}`} />
                Load source list
                {postBasedCandidates.length > 0 ? ` (${postBasedCandidates.length})` : ""}
              </Button>
              {stats && (
                <p className="text-xs text-muted-foreground">
                  Window from {stats.windowStart.slice(0, 10)} · min relevance{" "}
                  {stats.minRelevancePercent}% · dropped invalid {stats.droppedInvalid} · dedup{" "}
                  {stats.droppedDedup} · supportive-only {stats.droppedSupportiveOnlyComment} · cap{" "}
                  {stats.droppedCap}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Company / role search</CardTitle>
              <CardDescription>
                Company / role search finds LinkedIn profiles from selected companies and role
                groups. It does not enrich full profiles yet. Full profile enrichment is a later
                phase.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="campaign-company-urls">LinkedIn company URLs (one per line)</Label>
                <Textarea
                  id="campaign-company-urls"
                  placeholder="https://www.linkedin.com/company/example-company/"
                  value={companyUrlsText}
                  onChange={(e) => setCompanyUrlsText(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Role categories / job-title groups</Label>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {companyRoleGroups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedRoleGroups.has(g.id)}
                        onCheckedChange={(v) => toggleRoleGroup(g.id, v === true)}
                      />
                      <span className="text-sm leading-snug">{g.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="campaign-company-max">Max people per company</Label>
                <Select
                  value={companySearchMaxItems}
                  onValueChange={setCompanySearchMaxItems}
                >
                  <SelectTrigger id="campaign-company-max">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This will call Apify and may incur cost. Phase 2 supports up to 100 company-search
                results at a time.
              </p>
              <Button
                type="button"
                disabled={loadingCompanySearch}
                onClick={runCompanySearch}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${loadingCompanySearch ? "animate-spin" : ""}`}
                />
                Run company / role search
                {companySearchCandidates.length > 0
                  ? ` (${companySearchCandidates.length})`
                  : ""}
              </Button>
              {companySearchRawCount != null && (
                <p className="text-xs text-muted-foreground">
                  Raw results: {companySearchRawCount} · Normalized:{" "}
                  {companySearchCandidates.length}
                  {companySearchWarnings.length > 0
                    ? ` · ${companySearchWarnings.join(" ")}`
                    : ""}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Loaded candidates</CardTitle>
              <CardDescription>
                Combined list from all loaded sources (deduped by LinkedIn profile URL).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadedMergeStats ? (
                <ul className="text-sm space-y-1">
                  <li>
                    Post-based loaded: <strong>{loadedMergeStats.postBasedCount}</strong>
                  </li>
                  <li>
                    Company / role search loaded:{" "}
                    <strong>{loadedMergeStats.companySearchCount}</strong>
                  </li>
                  <li>
                    Duplicates removed: <strong>{loadedMergeStats.duplicatesRemoved}</strong>
                  </li>
                  <li>
                    Total loaded candidates: <strong>{loadedMergeStats.totalLoaded}</strong>
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Load post-based candidates and/or run company / role search above.
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="opacity-60">
            <CardHeader>
              <CardTitle>Upload CSV / JSON</CardTitle>
              <CardDescription>
                Upload a pre-built candidate list from a file. Parsing and validation are planned for
                a later phase — not available in Phase 2.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" disabled>
                Upload file (coming soon)
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exclusions">
          <Card>
            <CardHeader>
              <CardTitle>Exclusion criteria</CardTitle>
              <CardDescription>
                Select categories to exclude from this campaign. Unchecked categories remain
                eligible. Unknown profiles are never disqualified in Phase 1 and always continue to
                enrichment in a later phase.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-xs text-muted-foreground rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                Open to Work exclusion only applies when Open to Work data is present in the loaded
                source. Company / role search may not include that signal until full profile
                enrichment. When Open to Work is unknown for a row, Phase 1 keeps that person (see{" "}
                <code className="text-[11px]">open_to_work_detection</code> in the Phase 1 CSV).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={clearAllExclusions}>
                  Clear all
                </Button>
                {selectedExclusions.size > 0 && (
                  <p className="text-sm text-muted-foreground self-center">
                    {selectedExclusions.size} exclusion(s) selected
                  </p>
                )}
              </div>
              {exclusionGroups.map(({ group, sections }) => (
                <div key={group} className="space-y-4">
                  <p className="text-sm font-semibold">{group}</p>
                  {(sections ?? []).map(({ section, sectionLabel, criteria }) => (
                    <div key={`${group}-${section}`} className="space-y-2 pl-0 sm:pl-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {sectionLabel}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(criteria ?? []).map((c) => (
                          <label
                            key={c.id}
                            className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={selectedExclusions.has(c.id)}
                              onCheckedChange={(v) => toggleExclusion(c.id, v === true)}
                            />
                            <span className="text-sm leading-snug">{c.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="run" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Phase 1 — deterministic qualification</CardTitle>
              <CardDescription>
                Applies exclusion rules and deterministic classification to the loaded source list.
                Does not run Apify enrichment, semantic LLM qualification, outreach emails, or
                Prospect Intelligence routing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">
                Loaded candidates:{" "}
                <strong>{loadedCandidates.length}</strong>
                {loadedCandidates.length === 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    — load a source list on the Sources tab first.
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={loadedCandidates.length === 0 || loadingPhase1}
                  onClick={runPhase1}
                >
                  <Play className={`mr-2 h-4 w-4 ${loadingPhase1 ? "animate-pulse" : ""}`} />
                  Run Phase 1
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!phase1Candidates?.length}
                  onClick={downloadPhase1Csv}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Phase 1 CSV
                </Button>
              </div>
              {phase1Limited && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Phase 1 classification runs on at most 50 rows per run; remaining rows keep source
                  fields only until a later phase supports larger batches.
                </p>
              )}
              {phase1Summary && (
                <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Total (deduped)</p>
                    <p className="text-2xl font-semibold">{phase1Summary.total}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Phase 1 disqualified</p>
                    <p className="text-2xl font-semibold">{phase1Summary.phase1Disqualified}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Continue to later enrichment</p>
                    <p className="text-2xl font-semibold">
                      {phase1Summary.continuingToLaterEnrichment}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Unknown → later enrichment</p>
                    <p className="text-2xl font-semibold">{phase1Summary.unknownContinuing}</p>
                  </div>
                </div>
                {(phase1Summary.postBasedCount > 0 ||
                  phase1Summary.companySearchCount > 0) && (
                  <div className="rounded-md border p-3 text-sm space-y-1">
                    <p className="font-medium">By source type</p>
                    <p className="text-muted-foreground">
                      Post-based only: {phase1Summary.postBasedCount - phase1Summary.bothSourcesCount}
                      {" · "}
                      Company search only:{" "}
                      {phase1Summary.companySearchCount - phase1Summary.bothSourcesCount}
                      {" · "}
                      Both sources: {phase1Summary.bothSourcesCount}
                    </p>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>

          {phase1Candidates && phase1Candidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Phase 3 — Enrich continuing candidates</CardTitle>
                <CardDescription>
                  Fetches full LinkedIn profiles via Apify for Phase 1 continuing candidates only.
                  Does not run LLM qualification, generate emails, or write campaign history.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {continuingCount > 0 && (
                  <p className="text-xs text-muted-foreground rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    This will fetch full LinkedIn profiles for up to{" "}
                    {Math.min(continuingCount, CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT)} continuing
                    candidate(s) using Apify and may incur cost.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Total loaded</p>
                    <p className="text-2xl font-semibold">{phase1Summary?.total ?? 0}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Phase 1 disqualified</p>
                    <p className="text-2xl font-semibold">
                      {phase1Summary?.phase1Disqualified ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Continuing to enrichment</p>
                    <p className="text-2xl font-semibold">{continuingCount}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Unknown continuing</p>
                    <p className="text-2xl font-semibold">
                      {phase1Summary?.unknownContinuing ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Already enriched</p>
                    <p className="text-2xl font-semibold">{alreadyEnrichedCount}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">Enrichment pending</p>
                    <p className="text-2xl font-semibold">{enrichmentPendingCount}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={
                      continuingCount === 0 ||
                      loadingEnrichment ||
                      continuingCount > CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT
                    }
                    onClick={runProfileEnrichment}
                  >
                    <Play
                      className={`mr-2 h-4 w-4 ${loadingEnrichment ? "animate-pulse" : ""}`}
                    />
                    Enrich continuing candidates
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!enrichedCandidates?.length}
                    onClick={downloadEnrichedCsv}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download enriched CSV
                  </Button>
                </div>
                {continuingCount > CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT && (
                  <p className="text-xs text-destructive">
                    Phase 3 supports up to {CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT} profile
                    enrichments at a time. Reduce the candidate list or run a smaller batch.
                  </p>
                )}
                {enrichmentStats && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Attempted</p>
                      <p className="text-xl font-semibold">{enrichmentStats.attempted}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Successful</p>
                      <p className="text-xl font-semibold">{enrichmentStats.successful}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Failed</p>
                      <p className="text-xl font-semibold">{enrichmentStats.failed}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">With experience data</p>
                      <p className="text-xl font-semibold">{enrichmentStats.withExperienceData}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Email found</p>
                      <p className="text-xl font-semibold">{enrichmentStats.withEmail}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Mobile found</p>
                      <p className="text-xl font-semibold">{enrichmentStats.withMobile}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Open to Work detected</p>
                      <p className="text-xl font-semibold">{enrichmentStats.openToWorkDetected}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">OTW still unknown</p>
                      <p className="text-xl font-semibold">
                        {enrichmentStats.openToWorkStillUnknown}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {phase1Candidates && phase1Candidates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Phase 1 preview ({phase1Candidates.length})</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Phase 1</TableHead>
                      <TableHead>Roles</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {phase1Candidates.slice(0, 100).map((r) => (
                      <TableRow key={r.linkedin_url}>
                        <TableCell>
                          {r.first_name} {r.last_name}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">
                          <a
                            href={r.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {r.linkedin_url}
                          </a>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.source_types.join(", ")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.phase1_decision ?? "—"}
                          {r.phase1_disqualified_reason ? (
                            <span className="block text-muted-foreground">
                              {r.phase1_disqualified_reason}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">
                          {r.role_categories ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
