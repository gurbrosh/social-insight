"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";

type StepKey = "THEMES" | "CHATTER" | "NEWS" | "NETWORK" | "BLOG_NEWS_ANALYSIS";

const STEP_LABELS: { key: StepKey; label: string }[] = [
  { key: "THEMES", label: "Themes" },
  { key: "CHATTER", label: "Chatter" },
  { key: "NEWS", label: "News" },
  { key: "NETWORK", label: "Network" },
  { key: "BLOG_NEWS_ANALYSIS", label: "Blog" },
];

interface ProjectOption {
  id: string;
  name: string;
}

interface RunningPayload {
  projectId: string;
  projectName: string;
  byStep: Record<StepKey, number>;
  otherStepsRunning: number;
  totalRunning: number;
}

interface RunningAnalysisTasksCardProps {
  projects: ProjectOption[];
  /** When exactly one project is selected in the page picker, sync the dropdown to it. */
  preferredProjectId?: string;
}

export function RunningAnalysisTasksCard({
  projects,
  preferredProjectId,
}: RunningAnalysisTasksCardProps) {
  const [projectId, setProjectId] = useState<string>(() => {
    if (preferredProjectId && projects.some((p) => p.id === preferredProjectId)) {
      return preferredProjectId;
    }
    return projects[0]?.id ?? "";
  });

  /** When the page project picker settles on exactly one project, mirror it here. */
  useEffect(() => {
    if (preferredProjectId && projects.some((p) => p.id === preferredProjectId)) {
      setProjectId(preferredProjectId);
    }
  }, [preferredProjectId, projects]);

  const [data, setData] = useState<RunningPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!projectId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/analysis-tasks/running?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : res.statusText);
      }
      const json = (await res.json()) as RunningPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useVisibilityAwarePolling({
    onPoll: fetchCounts,
    intervalMs: 10_000,
    hiddenIntervalMs: 60_000,
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  if (projects.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Running analysis tasks</CardTitle>
        <CardDescription>
          Counts of <span className="font-medium text-foreground">RUNNING</span> task-based analysis
          steps for the selected project. Updates every few seconds while this tab is visible.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <Label htmlFor="running-analysis-project">Project</Label>
          <Select value={projectId} onValueChange={setProjectId} disabled={projects.length === 0}>
            <SelectTrigger id="running-analysis-project">
              <SelectValue placeholder="Choose a project" />
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

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="rounded-md border relative">
          {loading && !data && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-md">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {STEP_LABELS.map(({ label }) => (
                  <TableHead key={label} className="text-center">
                    {label}
                  </TableHead>
                ))}
                <TableHead className="text-center w-[100px]">Other steps</TableHead>
                <TableHead className="text-center font-semibold w-[90px]">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {STEP_LABELS.map(({ key }) => (
                  <TableCell key={key} className="text-center tabular-nums">
                    {data?.byStep?.[key] ?? "—"}
                  </TableCell>
                ))}
                <TableCell className="text-center tabular-nums text-muted-foreground">
                  {data ? data.otherStepsRunning : "—"}
                </TableCell>
                <TableCell className="text-center tabular-nums font-medium">
                  {data ? data.totalRunning : "—"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Other steps includes SENTIMENT and BRAND when those tasks are in{" "}
          <code className="text-xs">RUNNING</code> state.
        </p>
      </CardContent>
    </Card>
  );
}
