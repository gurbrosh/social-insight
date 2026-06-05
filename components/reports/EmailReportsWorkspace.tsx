"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import type {
  EmailReportRangeUnit,
  EmailReportSettings,
} from "@/app/actions/email-report-settings";
import { saveEmailReportSettings, sendEmailReport } from "@/app/actions/email-report-settings";
import { EmailCampaignsPanel } from "@/components/campaigns/EmailCampaignsPanel";
import { EmailReportSettingsTab } from "@/components/reports/email-reports/EmailReportSettingsTab";
import { LinkedInProspectsPipelineTab } from "@/components/reports/email-reports/LinkedInProspectsPipelineTab";
import { ProspectIntelligenceTab } from "@/components/reports/email-reports/ProspectIntelligenceTab";

type ProjectOption = { id: string; name: string };

export type EmailReportsMainTabId = "email-report" | "linkedin-prospects" | "campaigns";

export type EmailReportsTabId = EmailReportsMainTabId | "prospect-intelligence";

const MAIN_TAB_IDS: EmailReportsMainTabId[] = [
  "email-report",
  "linkedin-prospects",
  "campaigns",
];

function parseTabId(raw: string | undefined): EmailReportsTabId {
  if (raw === "prospect-intelligence") return "prospect-intelligence";
  if (raw && MAIN_TAB_IDS.includes(raw as EmailReportsMainTabId)) {
    return raw as EmailReportsMainTabId;
  }
  return "email-report";
}

function emailReportsHref(tab: EmailReportsTabId, projectId: string): string {
  const q = new URLSearchParams({ tab, project: projectId });
  return `/reports/email?${q.toString()}`;
}

function buildInitialState(
  projects: ProjectOption[],
  saved: EmailReportSettings | null,
  fallbackEmail: string | null
): EmailReportSettings {
  if (saved) {
    const projectStillExists = projects.some((p) => p.id === saved.projectId);
    return {
      projectId: projectStillExists ? saved.projectId : (projects[0]?.id ?? ""),
      rangeAmount: saved.rangeAmount,
      rangeUnit: saved.rangeUnit,
      recipients: saved.recipients.length > 0 ? [...saved.recipients] : [fallbackEmail || ""],
      linkedinProspectsMinRelevancePercent: saved.linkedinProspectsMinRelevancePercent ?? 80,
    };
  }
  return {
    projectId: projects[0]?.id ?? "",
    rangeAmount: 7,
    rangeUnit: "days",
    recipients: [fallbackEmail || ""],
    linkedinProspectsMinRelevancePercent: 80,
  };
}

export function EmailReportsWorkspace({
  projects,
  initialSettings,
  userEmail,
  defaultTab,
  initialProjectId,
}: {
  projects: ProjectOption[];
  initialSettings: EmailReportSettings | null;
  userEmail: string | null;
  defaultTab?: string;
  /** From URL ?project= when redirecting from legacy routes */
  initialProjectId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useMemo(
    () => buildInitialState(projects, initialSettings, userEmail),
    [projects, initialSettings, userEmail]
  );

  const tabParam = searchParams.get("tab");
  const activeTab = useMemo(
    () => parseTabId(tabParam ?? defaultTab),
    [tabParam, defaultTab]
  );

  const [projectId, setProjectId] = useState(initial.projectId);
  const [rangeAmount, setRangeAmount] = useState(String(initial.rangeAmount));
  const [rangeUnit, setRangeUnit] = useState<EmailReportRangeUnit>(initial.rangeUnit);
  const [recipients, setRecipients] = useState<string[]>(initial.recipients);
  const [linkedinMinRelevancePercent, setLinkedinMinRelevancePercent] = useState(
    String(initial.linkedinProspectsMinRelevancePercent)
  );
  const [isPendingSave, startSaveTransition] = useTransition();
  const [isPendingSend, startSendTransition] = useTransition();

  useEffect(() => {
    const urlProject = searchParams.get("project") ?? initialProjectId;
    if (urlProject && projects.some((p) => p.id === urlProject)) {
      setProjectId(urlProject);
    }
  }, [searchParams, initialProjectId, projects]);

  const navigateToTab = (tab: EmailReportsTabId) => {
    if (!projectId) return;
    router.replace(emailReportsHref(tab, projectId), { scroll: false });
  };

  const hasProjects = projects.length > 0;
  const selectedProject = projects.find((p) => p.id === projectId);
  const isProspectIntelligenceView = activeTab === "prospect-intelligence";
  const prospectIntelligenceHref = projectId
    ? emailReportsHref("prospect-intelligence", projectId)
    : null;

  const linkedInProspectsExportHref = (() => {
    if (!projectId) return null;
    const amount = (() => {
      const n = parseInt(rangeAmount, 10);
      if (!Number.isFinite(n) || n < 1) return 7;
      return Math.min(31, n);
    })();
    const relN = (() => {
      const n = parseInt(linkedinMinRelevancePercent, 10);
      if (!Number.isFinite(n) || n < 0) return 80;
      return Math.min(100, n);
    })();
    const q = new URLSearchParams();
    q.set("rangeAmount", String(amount));
    q.set("rangeUnit", rangeUnit);
    q.set("minRelevancePercent", String(relN));
    return `/api/projects/${projectId}/linkedin-prospects-export?${q.toString()}`;
  })();

  function persistSettings(onSuccess?: () => void) {
    const amount = parseInt(rangeAmount, 10);
    const rel = parseInt(linkedinMinRelevancePercent, 10);
    startSaveTransition(async () => {
      const result = await saveEmailReportSettings({
        projectId,
        rangeAmount: amount,
        rangeUnit,
        recipients,
        linkedinProspectsMinRelevancePercent: Number.isFinite(rel)
          ? Math.min(100, Math.max(0, rel))
          : 80,
      });
      if (result.ok) {
        toast({ title: "Saved", description: "Email report settings were updated." });
        onSuccess?.();
        return;
      }
      const first =
        result.fieldErrors &&
        Object.values(result.fieldErrors).find((msgs) => msgs && msgs.length > 0);
      toast({
        title: "Could not save",
        description: first?.[0] ?? result.error,
        variant: "destructive",
      });
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    persistSettings();
  }

  function handleSendReport(e: React.MouseEvent) {
    e.preventDefault();
    const amount = parseInt(rangeAmount, 10);
    startSendTransition(async () => {
      const rel = parseInt(linkedinMinRelevancePercent, 10);
      const result = await sendEmailReport({
        projectId,
        rangeAmount: amount,
        rangeUnit,
        recipients,
        linkedinProspectsMinRelevancePercent: Number.isFinite(rel)
          ? Math.min(100, Math.max(0, rel))
          : 80,
      });
      if (result.ok) {
        toast({
          title: "Report sent",
          description: `Email sent to ${result.recipientCount} recipient${result.recipientCount === 1 ? "" : "s"}.`,
        });
        return;
      }
      toast({
        title: "Could not send report",
        description: result.error,
        variant: "destructive",
      });
    });
  }

  if (!hasProjects) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email reports</CardTitle>
          <CardDescription>
            Create a project first, then return here to configure email reports, LinkedIn exports,
            and qualification campaigns.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-muted/30">
        <CardHeader>
          <CardTitle>Project & reporting window</CardTitle>
          <CardDescription>
            Select which project the reporting and qualification sections below apply to. The date
            range is shared by the email report, LinkedIn prospects export, and campaigns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="email-workspace-project">Project</Label>
            <Select
              value={projectId}
              onValueChange={(id) => {
                setProjectId(id);
                router.replace(emailReportsHref(activeTab, id), { scroll: false });
              }}
              required
            >
              <SelectTrigger id="email-workspace-project" className="max-w-md">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Reporting window</Label>
            <p className="text-xs text-muted-foreground">
              How far back to include data (1–31 days, weeks, or months).
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="email-workspace-amount"
                  className="text-xs font-normal text-muted-foreground"
                >
                  Amount
                </Label>
                <Input
                  id="email-workspace-amount"
                  type="number"
                  min={1}
                  max={31}
                  className="w-24"
                  value={rangeAmount}
                  onChange={(e) => setRangeAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 min-w-[140px]">
                <Label
                  htmlFor="email-workspace-unit"
                  className="text-xs font-normal text-muted-foreground"
                >
                  Unit
                </Label>
                <Select
                  value={rangeUnit}
                  onValueChange={(v) => setRangeUnit(v as EmailReportRangeUnit)}
                >
                  <SelectTrigger id="email-workspace-unit">
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
        </CardContent>
      </Card>

      {isProspectIntelligenceView ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link
                href={
                  projectId
                    ? emailReportsHref("campaigns", projectId)
                    : "/reports/email?tab=campaigns"
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to email reports & campaigns
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Automation — Prospect Intelligence (routing & templates)
            </p>
          </div>
          <ProspectIntelligenceTab projectId={projectId} />
        </div>
      ) : (
        <>
          <Tabs
            value={activeTab}
            onValueChange={(v) => navigateToTab(parseTabId(v))}
            className="space-y-4"
          >
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="email-report">Email report</TabsTrigger>
              <TabsTrigger value="linkedin-prospects">LinkedIn prospects</TabsTrigger>
              <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            </TabsList>

            <TabsContent value="email-report">
              <EmailReportSettingsTab
                recipients={recipients}
                onRecipientsChange={setRecipients}
                isPendingSave={isPendingSave}
                isPendingSend={isPendingSend}
                onSave={handleSubmit}
                onSend={handleSendReport}
              />
            </TabsContent>

            <TabsContent value="linkedin-prospects">
              <LinkedInProspectsPipelineTab
                projectId={projectId}
                rangeAmount={rangeAmount}
                rangeUnit={rangeUnit}
                linkedinMinRelevancePercent={linkedinMinRelevancePercent}
                onLinkedinMinRelevanceChange={setLinkedinMinRelevancePercent}
                exportHref={linkedInProspectsExportHref}
              />
              <p className="text-xs text-muted-foreground mt-3 max-w-lg">
                Save configuration on the Email report tab to persist the relevance threshold with
                your other email report settings.
              </p>
            </TabsContent>

            <TabsContent value="campaigns">
              {selectedProject ? (
                <EmailCampaignsPanel
                  projectId={projectId}
                  projectName={selectedProject.name}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Select a project above.</p>
              )}
            </TabsContent>
          </Tabs>

          {prospectIntelligenceHref && (
            <div className="rounded-lg border border-dashed bg-muted/25 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Automation</p>
                <p className="text-xs text-muted-foreground max-w-xl">
                  Prospect Intelligence handles routing, templates, and manual review. It is not
                  part of the Campaigns Phase 1 workflow (sources → exclusions → run → export).
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <Link href={prospectIntelligenceHref}>
                  Advanced: Prospect Intelligence routing
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
