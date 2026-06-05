"use client";

import { Progress } from "@/components/ui/progress";
import type { TaskAnalysisStatus } from "@/lib/system-activity";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface TaskAnalysisProgressProps {
  taskAnalysis: TaskAnalysisStatus;
  className?: string;
}

/**
 * Task pipeline UI: progress bar and % while analysis tasks run; collection phase + hints before tasks exist.
 */
export function TaskAnalysisProgress({ taskAnalysis, className }: TaskAnalysisProgressProps) {
  const {
    totalTasks,
    completedTasks,
    percentComplete,
    pendingTasks,
    isRunning,
    headline,
    isFinished,
    isPipelineActive,
    pipelinePhase,
    activeStepLabel,
    scrapeJobHint,
    status,
    failedTaskCount,
    failedTaskSampleError,
  } = taskAnalysis;

  const finishedWithTaskFailures =
    isFinished &&
    (status === "COMPLETED_WITH_ERRORS" || status === "FAILED" || failedTaskCount > 0);
  const finishedClean = isFinished && !finishedWithTaskFailures && status === "COMPLETED";

  if (totalTasks === 0) {
    const showPipelineSpinner =
      isPipelineActive &&
      (pipelinePhase === "collecting" ||
        pipelinePhase === "preparing_analysis" ||
        pipelinePhase === "analyzing");

    return (
      <div className={cn("space-y-1.5 text-xs leading-snug", className)}>
        <div className="flex items-start gap-2">
          {showPipelineSpinner ? (
            <Loader2
              className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400"
              aria-hidden
            />
          ) : null}
          <span
            className={cn(
              "text-foreground",
              finishedClean && "text-emerald-800 dark:text-emerald-200",
              finishedWithTaskFailures && "text-amber-900 dark:text-amber-100"
            )}
          >
            {headline}
          </span>
        </div>
        {pipelinePhase === "collecting" ? (
          <div className="pl-5 space-y-0.5 text-muted-foreground">
            {activeStepLabel ? <p className="leading-snug">{activeStepLabel}</p> : null}
            {scrapeJobHint ? <p className="leading-snug">{scrapeJobHint}</p> : null}
            {!activeStepLabel && !scrapeJobHint ? (
              <p className="leading-snug italic text-[11px] text-muted-foreground/90">
                No active step right now — between steps, or the run is starting.
              </p>
            ) : null}
          </div>
        ) : null}
        {finishedWithTaskFailures && failedTaskSampleError ? (
          <p
            className="pl-5 text-[11px] leading-snug text-amber-800/95 dark:text-amber-200/95 whitespace-pre-wrap break-words"
            title={failedTaskSampleError}
          >
            {failedTaskSampleError}
          </p>
        ) : null}
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className={cn("w-full min-w-0 space-y-2", className)}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">Analysis running</span>
          <span className="tabular-nums text-muted-foreground">{percentComplete}%</span>
        </div>
        <Progress value={percentComplete} className="h-2" aria-label="Analysis task completion" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {completedTasks.toLocaleString()}
          </span>
          {" of "}
          <span className="tabular-nums">{totalTasks.toLocaleString()}</span>
          {" tasks complete"}
          {pendingTasks > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums">{pendingTasks.toLocaleString()}</span>
              {" remaining"}
            </>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <p
        className={cn(
          "text-xs leading-snug text-foreground",
          finishedClean && "text-emerald-800 dark:text-emerald-200",
          finishedWithTaskFailures && "text-amber-900 dark:text-amber-100"
        )}
      >
        {headline}
      </p>
      {finishedWithTaskFailures && failedTaskSampleError ? (
        <p
          className="text-[11px] leading-snug text-amber-800/95 dark:text-amber-200/95 whitespace-pre-wrap break-words"
          title={failedTaskSampleError}
        >
          {failedTaskSampleError}
        </p>
      ) : null}
    </div>
  );
}
