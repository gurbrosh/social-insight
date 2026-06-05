"use client";

import { useCallback, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SystemActivity } from "@/lib/system-activity";
import { TaskAnalysisProgress } from "@/components/projects/TaskAnalysisProgress";

interface SystemActivityBannerProps {
  initialActivity: SystemActivity;
  /** When set, poll `/api/system/activity?projectId=…` so task-analysis pipeline status is included. */
  pollProjectId?: string;
}

function formatRelativeTimestamp(value: string): string {
  const timestamp = new Date(value);
  const diffMs = Date.now() - timestamp.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) {
    return rtf.format(-diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(-diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(-diffDays, "day");
}

function computeBannerPollMs(a: SystemActivity, pollProjectId: string | undefined): number {
  if (!pollProjectId) {
    return 60_000;
  }
  if (a.taskAnalysis?.isPipelineActive) {
    return 60_000;
  }
  if (a.orchestration || a.analysis) {
    return 45_000;
  }
  return 30_000;
}

export function SystemActivityBanner({
  initialActivity,
  pollProjectId,
}: SystemActivityBannerProps) {
  const [activity, setActivity] = useState<SystemActivity>(initialActivity);
  const [pollMs, setPollMs] = useState(() => computeBannerPollMs(initialActivity, pollProjectId));

  const fetchActivity = useCallback(async () => {
    try {
      const url = pollProjectId
        ? `/api/system/activity?projectId=${encodeURIComponent(pollProjectId)}`
        : "/api/system/activity";
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data?.activity) {
        const next = data.activity as SystemActivity;
        setActivity(next);
        setPollMs(computeBannerPollMs(next, pollProjectId));
      }
    } catch (error) {
      console.error("Failed to refresh system activity status:", error);
    }
  }, [pollProjectId]);

  useVisibilityAwarePolling({
    onPoll: fetchActivity,
    intervalMs: pollMs,
    hiddenIntervalMs: 120_000,
    enabled: true,
  });

  const orchestration = activity.orchestration;
  const analysis = activity.analysis;
  const taskAnalysis = activity.taskAnalysis;
  const hasActivity = Boolean(
    orchestration || analysis || taskAnalysis?.isRunning || taskAnalysis?.isPipelineActive
  );

  const activityBadgeClass = hasActivity
    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
    : "bg-gray-100 text-gray-800 border border-gray-200";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">System Activity</CardTitle>
        <CardDescription>
          Real-time view of orchestration and analysis processes running in the background.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={activityBadgeClass}>
            {hasActivity ? "Active" : "Idle"}
          </Badge>
          <span className="text-xs text-muted-foreground leading-snug">
            {hasActivity
              ? "Background tasks are currently running."
              : "No orchestrations, analysis locks, or task pipeline work in progress."}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="rounded border border-border bg-muted/30 p-3">
            <p className="font-medium text-foreground mb-1">Orchestration</p>
            {orchestration ? (
              <p className="text-muted-foreground">
                “{orchestration.name}” in progress (
                {formatRelativeTimestamp(orchestration.startedAt)})
              </p>
            ) : (
              <p className="text-muted-foreground">No active orchestration runs.</p>
            )}
          </div>

          <div className="rounded border border-border bg-muted/30 p-3">
            <p className="font-medium text-foreground mb-1">Analysis</p>
            {analysis ? (
              <p className="text-muted-foreground">
                {analysis.mode === "manual" ? "Manual analysis" : "Analysis"} running{" "}
                {analysis.projectName ? `for ${analysis.projectName}` : ""} (
                {formatRelativeTimestamp(analysis.startedAt)})
              </p>
            ) : (
              <p className="text-muted-foreground">No active analysis jobs.</p>
            )}
          </div>

          {taskAnalysis && (
            <div className="rounded border border-border bg-muted/30 p-3">
              <p className="font-medium text-foreground mb-1">Task-based analysis</p>
              <TaskAnalysisProgress taskAnalysis={taskAnalysis} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
