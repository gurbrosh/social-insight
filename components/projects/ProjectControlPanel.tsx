"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SystemActivity } from "@/lib/system-activity";
import { TaskAnalysisProgress } from "@/components/projects/TaskAnalysisProgress";

interface RecipeSummary {
  id: string;
  name: string;
  isActive: boolean;
  nextRunDisplay: string;
}

interface ProjectControlPanelProps {
  recipes: RecipeSummary[];
  projectId: string;
  initialActivity?: SystemActivity;
}

function defaultActivity(): SystemActivity {
  return { orchestration: null, analysis: null, taskAnalysis: null };
}

/** Slower polling while the task pipeline runs — reduces SQLite contention with the analysis worker. */
function computeActivityPollMs(a: SystemActivity): number {
  if (a.taskAnalysis?.isPipelineActive) {
    return 60_000;
  }
  if (a.orchestration || a.analysis) {
    return 45_000;
  }
  return 30_000;
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

export function ProjectControlPanel({
  recipes: initialRecipes,
  projectId,
  initialActivity,
}: ProjectControlPanelProps) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>(initialRecipes);
  const [loading, setLoading] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState(initialRecipes[0]?.id ?? "");
  const [activity, setActivity] = useState<SystemActivity>(initialActivity ?? defaultActivity());
  const [activityPollMs, setActivityPollMs] = useState(() =>
    computeActivityPollMs(initialActivity ?? defaultActivity())
  );
  const { toast } = useToast();
  const taskPipelineBusy = Boolean(activity.taskAnalysis?.isPipelineActive);
  const busyActivity = activity.orchestration ?? activity.analysis;
  const isBusy = Boolean(busyActivity || taskPipelineBusy);

  useEffect(() => {
    const next = initialActivity ?? defaultActivity();
    setActivity(next);
    setActivityPollMs(computeActivityPollMs(next));
  }, [initialActivity]);

  const fetchActivity = useCallback(async () => {
    try {
      const response = await fetch(`/api/system/activity?projectId=${projectId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data?.activity) {
        const next = data.activity as SystemActivity;
        setActivity(next);
        setActivityPollMs(computeActivityPollMs(next));
      }
    } catch (error) {
      console.error("Failed to refresh project activity status:", error);
    }
  }, [projectId]);

  useVisibilityAwarePolling({
    onPoll: fetchActivity,
    intervalMs: activityPollMs,
    hiddenIntervalMs: 120_000,
    enabled: true,
  });

  const activeRecipe = useMemo(() => recipes.find((recipe) => recipe.isActive), [recipes]);
  const hasRecipes = recipes.length > 0;

  const statusText = !hasRecipes ? "Not Configured" : activeRecipe ? "Running" : "Stopped";

  const statusBadgeClass = !hasRecipes
    ? "bg-gray-100 text-gray-800 border border-gray-200"
    : activeRecipe
      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
      : "bg-amber-100 text-amber-800 border border-amber-200";

  const message = !hasRecipes
    ? "No orchestration recipe linked to this project yet."
    : activeRecipe
      ? `Next scrape: ${activeRecipe.nextRunDisplay}`
      : "Recipe is stopped. No future scrapes are scheduled.";

  const activityBadgeClass = isBusy
    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
    : "bg-gray-100 text-gray-800 border border-gray-200";

  const activityText = activity.orchestration
    ? `Orchestration "${activity.orchestration.name}" is running (${formatRelativeTimestamp(
        activity.orchestration.startedAt
      )}).`
    : activity.analysis
      ? `Analysis in progress${activity.analysis.projectName ? ` for ${activity.analysis.projectName}` : ""} (${formatRelativeTimestamp(activity.analysis.startedAt)}).`
      : activity.taskAnalysis?.isPipelineActive
        ? "Latest run pipeline is active (progress below)."
        : activity.taskAnalysis?.headline
          ? activity.taskAnalysis.headline
          : "No orchestration collection in progress.";

  const resetDialogState = () => {
    setShowStartDialog(false);
    setSelectedRecipeId(recipes[0]?.id ?? "");
  };

  const stopRecipe = async (recipeId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/orchestration-recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to stop recipe");
      }

      setRecipes((prev) =>
        prev.map((recipe) => (recipe.id === recipeId ? { ...recipe, isActive: false } : recipe))
      );

      toast({
        title: "Project control updated",
        description: "Project orchestration has been stopped.",
      });
    } catch (error) {
      console.error("Error stopping recipe:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update project control status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startRecipe = async (recipeId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/orchestration-recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start recipe");
      }

      setRecipes((prev) =>
        prev.map((recipe) =>
          recipe.id === recipeId ? { ...recipe, isActive: true } : { ...recipe, isActive: false }
        )
      );

      const startedRecipe =
        recipes.find((recipe) => recipe.id === recipeId) ??
        initialRecipes.find((recipe) => recipe.id === recipeId);

      try {
        const executeResponse = await fetch("/api/admin/orchestration-timer-tasks/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!executeResponse.ok) {
          const executeData = await executeResponse.json().catch(() => null);
          throw new Error(executeData?.error || "Failed to trigger orchestration run");
        }
      } catch (triggerError) {
        console.error("Error triggering orchestration run:", triggerError);
        toast({
          title: "Triggered with warnings",
          description:
            triggerError instanceof Error
              ? triggerError.message
              : "Recipe started, but we could not trigger the run automatically. It will execute at the next scheduled slot.",
          variant: "destructive",
        });
      }

      toast({
        title: "Project control updated",
        description: startedRecipe
          ? `Project orchestration is now running. Next scrape: ${startedRecipe.nextRunDisplay}`
          : "Project orchestration is now running.",
      });

      setShowStartDialog(false);
      setSelectedRecipeId(recipeId);
    } catch (error) {
      console.error("Error starting recipe:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update project control status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (loading) return;

    if (activeRecipe) {
      void stopRecipe(activeRecipe.id);
      return;
    }

    if (!hasRecipes) {
      toast({
        title: "No recipes configured",
        description: "Create a scheduling recipe in the admin orchestrator before starting.",
        variant: "destructive",
      });
      return;
    }

    setSelectedRecipeId(recipes[0]?.id ?? "");
    setShowStartDialog(true);
  };

  const handleConfirmStart = () => {
    if (!selectedRecipeId) return;
    void startRecipe(selectedRecipeId);
  };

  const toggleLabel = activeRecipe ? "Stop" : "Start";

  return (
    <>
      <div className="border border-border rounded-md px-4 py-3 bg-background min-w-[260px] shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Project Control
          </span>
          <Badge variant="outline" className={statusBadgeClass}>
            {statusText}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={activityBadgeClass}>
              {isBusy ? "Activity" : "Idle"}
            </Badge>
            <span className="text-xs text-muted-foreground leading-snug">{activityText}</span>
          </div>
          {activity.taskAnalysis && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <Badge
                variant="outline"
                className={
                  activity.taskAnalysis.isFinished && !activity.taskAnalysis.isPipelineActive
                    ? "shrink-0 border-emerald-200 bg-emerald-50 text-emerald-900"
                    : activity.taskAnalysis.isPipelineActive
                      ? "shrink-0 border-amber-200 bg-amber-50 text-amber-900"
                      : "shrink-0"
                }
              >
                {activity.taskAnalysis.pipelinePhase === "collecting"
                  ? "Collecting"
                  : activity.taskAnalysis.pipelinePhase === "preparing_analysis"
                    ? "Prep"
                    : activity.taskAnalysis.pipelinePhase === "analyzing"
                      ? "Starting"
                      : activity.taskAnalysis.isRunning
                        ? "Tasks"
                        : activity.taskAnalysis.isFinished
                          ? "Done"
                          : "Tasks"}
              </Badge>
              <div className="min-w-0 flex-1">
                <TaskAnalysisProgress taskAnalysis={activity.taskAnalysis} />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggle}
            disabled={loading}
            className="min-w-[96px]"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {toggleLabel}
          </Button>
          {!hasRecipes && (
            <span className="text-xs text-muted-foreground">
              Configure a recipe in the admin orchestrator to enable controls.
            </span>
          )}
        </div>
      </div>

      <Dialog
        open={showStartDialog}
        onOpenChange={(open) => {
          if (!loading) {
            setShowStartDialog(open);
          }
          if (!open) {
            resetDialogState();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select recipe to run</DialogTitle>
            <DialogDescription>
              Choose which scheduling recipe should run for this project.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={selectedRecipeId}
            onValueChange={setSelectedRecipeId}
            className="mt-4 space-y-3"
          >
            {recipes.map((recipe) => (
              <label
                key={recipe.id}
                className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40"
              >
                <RadioGroupItem value={recipe.id} />
                <div className="space-y-1">
                  <div className="font-medium">{recipe.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Next run: {recipe.nextRunDisplay}
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>
          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowStartDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmStart}
              disabled={!selectedRecipeId || loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start recipe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
