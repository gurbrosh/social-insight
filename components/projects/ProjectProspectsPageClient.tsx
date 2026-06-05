"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export type ProspectSettingsPayload = {
  employment_confidence_for_title_company_in_copy: number;
  minimum_evidence_for_auto_route: number;
  default_competitor_list_id: string | null;
};

export type ProspectRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  notes: string | null;
  condition_logic: string;
  conditions_json: string;
  actions_json: string;
};

export type ProspectTemplateRow = {
  id: string;
  name: string;
  channel: string;
  template_type: string;
  enabled: boolean;
  priority: number;
};

export type ProspectCandidateRow = {
  id: string;
  platform: string;
  relevance_score_cached: number | null;
  headline_snapshot: string | null;
  identity: {
    id: string;
    display_name: string | null;
    linkedin_url_normalized: string;
    manual_classification_locked: boolean;
    manual_routing_locked: boolean;
  };
  snapshot: {
    routing_recommendation: string;
    needs_review: boolean;
    overall_confidence: number;
    employment_confidence: number;
  } | null;
  assignment: {
    bucket: string;
    reason: string | null;
    status: string;
  } | null;
};

type Props = {
  projectId: string;
  projectName: string;
  initialSettings: ProspectSettingsPayload | null;
  initialRules: ProspectRuleRow[];
  initialTemplates: ProspectTemplateRow[];
  initialCandidates: ProspectCandidateRow[];
  fixtureOptions: { id: string; label: string }[];
  /** When true, rendered inside Email reports (no page chrome). */
  embedded?: boolean;
};

export function ProjectProspectsPageClient({
  projectId,
  projectName,
  initialSettings,
  initialRules,
  initialTemplates,
  initialCandidates,
  fixtureOptions,
  embedded = false,
}: Props) {
  const { toast } = useToast();
  const [settings, setSettings] = useState(
    initialSettings ?? {
      employment_confidence_for_title_company_in_copy: 0.75,
      minimum_evidence_for_auto_route: 0.35,
      default_competitor_list_id: null,
    }
  );
  const [rules, setRules] = useState(initialRules);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [savingSettings, setSavingSettings] = useState(false);
  const [fixtureId, setFixtureId] = useState(fixtureOptions[0]?.id ?? "");
  const [fixtureResult, setFixtureResult] = useState<string | null>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);

  useEffect(() => {
    setSettings(
      initialSettings ?? {
        employment_confidence_for_title_company_in_copy: 0.75,
        minimum_evidence_for_auto_route: 0.35,
        default_competitor_list_id: null,
      }
    );
    setRules(initialRules);
    setCandidates(initialCandidates);
    setFixtureId(fixtureOptions[0]?.id ?? "");
    setFixtureResult(null);
  }, [projectId, initialSettings, initialRules, initialCandidates, initialTemplates, fixtureOptions]);

  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.priority - b.priority), [rules]);

  async function persistSettings() {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/prospect-intelligence/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employment_confidence_for_title_company_in_copy:
            settings.employment_confidence_for_title_company_in_copy,
          minimum_evidence_for_auto_route: settings.minimum_evidence_for_auto_route,
          default_competitor_list_id: settings.default_competitor_list_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Save failed");
      }
      const s = (data as { settings: ProspectSettingsPayload }).settings;
      if (s) {
        setSettings({
          employment_confidence_for_title_company_in_copy:
            s.employment_confidence_for_title_company_in_copy,
          minimum_evidence_for_auto_route: s.minimum_evidence_for_auto_route,
          default_competitor_list_id: s.default_competitor_list_id,
        });
      }
      toast({ title: "Saved prospect intelligence settings" });
    } catch (e) {
      toast({
        title: "Could not save settings",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function refreshRules() {
    const res = await fetch(`/api/projects/${projectId}/prospect-routing-rules`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray((data as { rules?: ProspectRuleRow[] }).rules)) {
      setRules((data as { rules: ProspectRuleRow[] }).rules);
    }
  }

  async function patchRule(ruleId: string, patch: Partial<Pick<ProspectRuleRow, "enabled">>) {
    const res = await fetch(`/api/projects/${projectId}/prospect-routing-rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({
        title: "Rule update failed",
        description: (data as { error?: string }).error,
        variant: "destructive",
      });
      return;
    }
    await refreshRules();
  }

  async function refreshCandidates() {
    const res = await fetch(`/api/projects/${projectId}/prospect-candidates`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray((data as { candidates?: unknown }).candidates)) {
      return;
    }
    type ApiCand = {
      id: string;
      platform: string;
      relevance_score_cached: number | null;
      headline_snapshot: string | null;
      prospectIdentity: {
        id: string;
        display_name: string | null;
        linkedin_url_normalized: string;
        manual_classification_locked: boolean;
        manual_routing_locked: boolean;
        snapshots: Array<{
          routing_recommendation: string;
          needs_review: boolean;
          overall_confidence: number;
          employment_confidence: number;
        }>;
      };
      bucketAssignments: Array<{ bucket: string; reason: string | null; status: string }>;
    };
    const rows = (data as { candidates: ApiCand[] }).candidates.map((c): ProspectCandidateRow => {
      const snap = c.prospectIdentity.snapshots[0] ?? null;
      const asg = c.bucketAssignments[0] ?? null;
      return {
        id: c.id,
        platform: c.platform,
        relevance_score_cached: c.relevance_score_cached,
        headline_snapshot: c.headline_snapshot,
        identity: {
          id: c.prospectIdentity.id,
          display_name: c.prospectIdentity.display_name,
          linkedin_url_normalized: c.prospectIdentity.linkedin_url_normalized,
          manual_classification_locked: c.prospectIdentity.manual_classification_locked,
          manual_routing_locked: c.prospectIdentity.manual_routing_locked,
        },
        snapshot: snap,
        assignment: asg ? { bucket: asg.bucket, reason: asg.reason, status: asg.status } : null,
      };
    });
    setCandidates(rows);
  }

  async function patchIdentity(
    identityId: string,
    patch: {
      manual_classification_locked?: boolean;
      manual_routing_locked?: boolean;
    }
  ) {
    const res = await fetch(`/api/projects/${projectId}/prospect-identities/${identityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast({ title: "Could not update identity locks", variant: "destructive" });
      return;
    }
    await refreshCandidates();
    toast({ title: "Updated override locks" });
  }

  async function runFixtureTest() {
    if (!fixtureId) return;
    setFixtureLoading(true);
    setFixtureResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/prospect-rules/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      });
      const data = await res.json();
      setFixtureResult(JSON.stringify(data, null, 2));
      if (!res.ok) {
        toast({
          title: "Fixture test failed",
          description: (data as { error?: string }).error,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Fixture test failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setFixtureLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <>
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              { label: projectName, href: `/projects/${projectId}` },
              { label: "Prospects" },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Prospect intelligence</h1>
              <p className="text-muted-foreground">
                Routing rules, thresholds, templates, and review queue for this project.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}/edit`}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Edit project
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}`}>Project home</Link>
              </Button>
            </div>
          </div>
        </>
      )}

      {embedded && (
        <p className="text-sm text-muted-foreground">
          Prospect intelligence for <strong>{projectName}</strong> — routing, templates, and review
          queue.
        </p>
      )}

      <Tabs defaultValue="settings">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="rules">Routing rules</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Classification thresholds</CardTitle>
              <CardDescription>
                Title and company variables in outreach only apply when employment confidence meets
                the template gate; these defaults apply across the project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="emp-confidence">
                  Employment confidence for title/company in copy
                </Label>
                <Input
                  id="emp-confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.employment_confidence_for_title_company_in_copy}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      employment_confidence_for_title_company_in_copy: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="min-evidence">Minimum evidence for auto-route</Label>
                <Input
                  id="min-evidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.minimum_evidence_for_auto_route}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      minimum_evidence_for_auto_route: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="competitor-list">Default competitor list id (optional)</Label>
                <Input
                  id="competitor-list"
                  value={settings.default_competitor_list_id ?? ""}
                  placeholder="ULID of CompetitorList"
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_competitor_list_id: e.target.value.trim() || null,
                    }))
                  }
                />
              </div>
              <Button type="button" onClick={persistSettings} disabled={savingSettings}>
                Save settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ordered rules</CardTitle>
              <CardDescription>
                Lower priority number runs first. Toggle to disable without deleting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Priority</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.priority}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="font-medium">{r.name}</div>
                        {r.notes ? (
                          <p className="text-xs text-muted-foreground truncate">{r.notes}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={(checked) => patchRule(r.id, { enabled: checked })}
                          aria-label={`Toggle ${r.name}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Test with fixture</CardTitle>
              <CardDescription>
                Runs deterministic classification and the active rule set on canned headlines.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px]">
                  <Label>Fixture</Label>
                  <Select value={fixtureId} onValueChange={setFixtureId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick fixture" />
                    </SelectTrigger>
                    <SelectContent>
                      {fixtureOptions.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  onClick={runFixtureTest}
                  disabled={fixtureLoading || !fixtureId}
                >
                  {fixtureLoading ? "Running…" : "Run test"}
                </Button>
              </div>
              {fixtureResult ? (
                <pre className="text-xs overflow-auto max-h-96 rounded-md border bg-muted/40 p-3">
                  {fixtureResult}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle>Outreach templates</CardTitle>
              <CardDescription>
                Seeded defaults can be edited in the database or extended with future template APIs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Priority</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialTemplates
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.priority}</TableCell>
                        <TableCell>{t.name}</TableCell>
                        <TableCell>{t.channel}</TableCell>
                        <TableCell>{t.template_type}</TableCell>
                        <TableCell>{t.enabled ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Recent prospect candidates</CardTitle>
                <CardDescription>
                  Manual classification and routing locks prevent automated overwrites on the next
                  sync.
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => refreshCandidates()}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead>Classifier</TableHead>
                    <TableHead>Locks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No candidates yet. Run theme analysis or LinkedIn export to populate
                        prospects.
                      </TableCell>
                    </TableRow>
                  ) : (
                    candidates.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="max-w-[220px]">
                          <div className="font-medium truncate">
                            {c.identity.display_name ?? "Unknown"}
                          </div>
                          <a
                            className="text-xs text-primary underline truncate block"
                            href={c.identity.linkedin_url_normalized}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {c.identity.linkedin_url_normalized}
                          </a>
                          {c.headline_snapshot ? (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                              {c.headline_snapshot}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div>{c.assignment?.bucket ?? "—"}</div>
                          {c.assignment?.reason ? (
                            <p className="text-xs text-muted-foreground">{c.assignment.reason}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.snapshot ? (
                            <>
                              <div>{c.snapshot.routing_recommendation}</div>
                              <div className="text-xs text-muted-foreground">
                                conf {c.snapshot.overall_confidence.toFixed(2)} · emp{" "}
                                {c.snapshot.employment_confidence.toFixed(2)}
                                {c.snapshot.needs_review ? " · review" : ""}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={c.identity.manual_classification_locked}
                                onCheckedChange={(checked) =>
                                  patchIdentity(c.identity.id, {
                                    manual_classification_locked: checked,
                                  })
                                }
                                aria-label="Lock classification"
                              />
                              <span className="text-xs">Classify lock</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={c.identity.manual_routing_locked}
                                onCheckedChange={(checked) =>
                                  patchIdentity(c.identity.id, {
                                    manual_routing_locked: checked,
                                  })
                                }
                                aria-label="Lock routing"
                              />
                              <span className="text-xs">Route lock</span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
