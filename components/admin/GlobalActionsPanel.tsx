"use client";

import { useMemo, useState, useEffect } from "react";
import { CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, CalendarX2, Play, MessageSquareText, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResetAnalysisButton } from "@/components/admin/ResetAnalysisButton";
import { purgeProjectRecordsAction } from "@/app/actions/purge-project-records";
import { deleteProjectScheduleAction } from "@/app/actions/delete-project-schedule";
import { skipPendingAnalysisTasksAction } from "@/app/actions/skip-pending-analysis-tasks";

type AnalysisCategory = "all" | "influencers" | "news" | "chatter" | "themes" | "brands";

const ANALYSIS_CATEGORIES: { value: AnalysisCategory; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "influencers", label: "Influencers" },
  { value: "news", label: "News" },
  { value: "chatter", label: "Chatter" },
  { value: "themes", label: "Themes" },
  { value: "brands", label: "Brand analysis" },
];

interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  keywordCount: number;
  scrapeCount: number;
}

interface GlobalActionsPanelProps {
  projects: ProjectSummary[];
  preselectedProjectId?: string;
}

export function GlobalActionsPanel({ projects, preselectedProjectId }: GlobalActionsPanelProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(preselectedProjectId ?? "");
  const [analysisCategory, setAnalysisCategory] = useState<AnalysisCategory>("all");
  const [analysisLimit, setAnalysisLimit] = useState<string>("");
  const [isPurgingRecords, setIsPurgingRecords] = useState(false);
  const [isDeletingSchedule, setIsDeletingSchedule] = useState(false);
  const [isSkippingPendingTasks, setIsSkippingPendingTasks] = useState(false);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [isGeneratingResponses, setIsGeneratingResponses] = useState(false);
  const { toast } = useToast();

  // Sync with preselected project when parent selection changes
  useEffect(() => {
    if (preselectedProjectId) {
      setSelectedProjectId(preselectedProjectId);
    }
  }, [preselectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  /** Theme-based reply generation only applies when the selected analysis scope includes themes. */
  const canGenerateResponses = analysisCategory === "all" || analysisCategory === "themes";

  async function handleRunAnalysis() {
    if (!selectedProject) {
      return;
    }

    setIsRunningAnalysis(true);
    toast({
      title: "Analysis started",
      description:
        "This can take several minutes. You'll see a completion toast when it's done. Check your server terminal for progress (e.g. [AnalysisWorker] step=…).",
    });
    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/analysis/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: analysisCategory,
          ...(analysisLimit.trim() ? { limit: Math.max(1, parseInt(analysisLimit, 10) || 1) } : {}),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const msg =
          data.code === "NO_RUN"
            ? data.error
            : data.error || `Failed to run ${analysisCategory} analysis`;
        throw new Error(msg);
      }

      if (data.message?.includes("No tasks to rerun")) {
        toast({
          title: "Nothing to run",
          variant: "destructive",
          description: data.message,
        });
        return;
      }

      const stats = data.stats ?? {};
      const parts: string[] = [];
      if (stats.sentimentAnalyzed != null) parts.push(`Sentiment: ${stats.sentimentAnalyzed}`);
      if (stats.conversations != null) parts.push(`Conversations: ${stats.conversations}`);
      if (stats.themesMatched != null) parts.push(`Themes: ${stats.themesMatched}`);
      if (stats.influentialPeople != null) parts.push(`Influencers: ${stats.influentialPeople}`);
      if (stats.newsItems != null) parts.push(`News: ${stats.newsItems}`);
      if (data.tasksReset != null) parts.push(`Tasks: ${data.tasksReset} reset`);

      toast({
        title: "Analysis complete",
        description: parts.length > 0 ? parts.join(", ") : `Ran ${analysisCategory} analysis.`,
      });

      if (analysisCategory === "themes" && selectedProject?.id) {
        window.dispatchEvent(
          new CustomEvent("theme-analysis-completed", {
            detail: { projectId: selectedProject.id },
          })
        );
      }
    } catch (error) {
      console.error("Error running analysis:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to run analysis",
      });
    } finally {
      setIsRunningAnalysis(false);
    }
  }

  async function handleGenerateResponses() {
    if (!selectedProject) {
      return;
    }

    setIsGeneratingResponses(true);
    toast({
      title: "Generating responses",
      description:
        "This runs synchronously and may take several minutes for large projects. Check the server log for progress.",
    });
    try {
      const response = await fetch(
        `/api/projects/${selectedProject.id}/response-generator/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: analysisCategory,
            ...(analysisLimit.trim()
              ? { limit: Math.max(1, parseInt(analysisLimit, 10) || 1) }
              : {}),
          }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate responses");
      }

      const st = data.stats ?? {};
      const parts: string[] = [];
      if (st.generated != null) parts.push(`Generated: ${st.generated}`);
      if (st.outreachBackfilled != null && st.outreachBackfilled > 0)
        parts.push(`LinkedIn email backfilled: ${st.outreachBackfilled}`);
      if (st.skippedHasResponse != null)
        parts.push(`Skipped (already have): ${st.skippedHasResponse}`);
      if (st.skippedRowAllSourcesExcluded != null && st.skippedRowAllSourcesExcluded > 0)
        parts.push(`Not in limit (all sources excluded): ${st.skippedRowAllSourcesExcluded}`);
      if (st.skippedLowRelevance != null) parts.push(`Below threshold: ${st.skippedLowRelevance}`);
      if (st.errors != null && st.errors > 0) parts.push(`Errors: ${st.errors}`);

      toast({
        title: "Response generation complete",
        description: parts.length > 0 ? parts.join(" · ") : "Finished.",
      });

      window.dispatchEvent(
        new CustomEvent("theme-responses-generated", {
          detail: { projectId: selectedProject.id },
        })
      );
    } catch (error) {
      console.error("Error generating responses:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to generate responses",
      });
    } finally {
      setIsGeneratingResponses(false);
    }
  }

  async function handleRemoveAllRecords() {
    if (!selectedProject) {
      return;
    }
    const confirmed = window.confirm(
      `Remove all scraped data for "${selectedProject.name}"?\n\nThis deletes posts, downstream staging records, and analysis data (network, news, chatter, themes, brand). This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsPurgingRecords(true);
    try {
      const result = await purgeProjectRecordsAction(selectedProject.id);
      if (!result.success) {
        throw new Error(result.error || "Failed to remove project records");
      }

      const summary = result.deleted;
      toast({
        title: "Project records removed",
        description: `Deleted ${summary.posts} posts, ${summary.downstream} downstream rows, and reset analysis tables.`,
      });
    } catch (error) {
      console.error("Error removing project records:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to remove project records",
      });
    } finally {
      setIsPurgingRecords(false);
    }
  }

  async function handleDeleteSchedule() {
    if (!selectedProject) {
      return;
    }
    const confirmed = window.confirm(
      `Delete scheduled horizon tasks for "${selectedProject.name}"?\n\nThis removes pending orchestration timer tasks so the schedule can be rebuilt from scratch the next time a recipe runs.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingSchedule(true);
    try {
      const result = await deleteProjectScheduleAction(selectedProject.id);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete project schedule");
      }

      const { deletedTasks, affectedRecipes } = result.summary;
      if (deletedTasks === 0) {
        toast({
          title: "No pending tasks",
          description: "There were no pending timer tasks to remove for this project.",
        });
      } else {
        toast({
          title: "Schedule cleared",
          description: `Removed ${deletedTasks} pending timer tasks across ${affectedRecipes.length} orchestration(s).`,
        });
      }
    } catch (error) {
      console.error("Error deleting project schedule:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to delete horizon schedule",
      });
    } finally {
      setIsDeletingSchedule(false);
    }
  }

  async function handleSkipPendingAnalysisTasks() {
    if (!selectedProject) {
      return;
    }
    const confirmed = window.confirm(
      `Skip all pending analysis tasks for "${selectedProject.name}"?\n\nEvery task that is still queued (PENDING) will be marked SKIPPED and will not run. Tasks already running (RUNNING) are left alone. Runs that become fully terminal may be finalized. This is for clearing a backlog when the queue is too large to catch up.`
    );

    if (!confirmed) {
      return;
    }

    setIsSkippingPendingTasks(true);
    try {
      const result = await skipPendingAnalysisTasksAction(selectedProject.id);
      if (!result.success) {
        throw new Error(result.error || "Failed to skip pending tasks");
      }

      if (result.skippedCount === 0) {
        toast({
          title: "No pending tasks",
          description: "There were no PENDING analysis tasks for this project.",
        });
      } else {
        const parts = [
          `Skipped ${result.skippedCount} task(s).`,
          result.finalizedRunIds.length > 0
            ? `Finalized ${result.finalizedRunIds.length} run(s).`
            : null,
        ].filter(Boolean);
        toast({
          title: "Backlog cleared",
          description: parts.join(" "),
        });
      }
    } catch (error) {
      console.error("Error skipping pending analysis tasks:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to skip pending tasks",
      });
    } finally {
      setIsSkippingPendingTasks(false);
    }
  }

  return (
    <CardContent className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="global-actions-project">Select project</Label>
        <Select value={selectedProjectId} onValueChange={(value) => setSelectedProjectId(value)}>
          <SelectTrigger id="global-actions-project" className="w-full">
            <SelectValue placeholder="Choose a project…" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProject && (
          <p className="text-sm text-muted-foreground">
            {selectedProject.description
              ? selectedProject.description
              : `${selectedProject.keywordCount} keywords · ${selectedProject.scrapeCount} scrapes`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <div className="flex-1 min-w-0 space-y-1 sm:max-w-xs">
          <Label htmlFor="global-actions-analysis-type" className="sr-only">
            Analysis category
          </Label>
          <Select
            value={analysisCategory}
            onValueChange={(v) => setAnalysisCategory(v as AnalysisCategory)}
          >
            <SelectTrigger id="global-actions-analysis-type" className="w-full">
              <SelectValue placeholder="Choose analysis type…" />
            </SelectTrigger>
            <SelectContent>
              {ANALYSIS_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-28">
          <Label htmlFor="global-actions-limit" className="text-xs text-muted-foreground">
            Limit (last N posts)
          </Label>
          <Input
            id="global-actions-limit"
            type="number"
            min={1}
            placeholder="All"
            value={analysisLimit}
            onChange={(e) => setAnalysisLimit(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-9"
          />
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handleRunAnalysis}
          disabled={!selectedProject || isRunningAnalysis}
          className="w-full sm:w-auto shrink-0"
        >
          {isRunningAnalysis ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run Analysis
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleGenerateResponses()}
          disabled={
            !selectedProject || isGeneratingResponses || isRunningAnalysis || !canGenerateResponses
          }
          className="w-full sm:w-auto shrink-0"
          title={
            !canGenerateResponses
              ? 'Choose "All categories" or "Themes" to enable Generate Responses'
              : undefined
          }
        >
          {isGeneratingResponses ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <MessageSquareText className="mr-2 h-4 w-4" />
              Generate Responses
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {canGenerateResponses ? (
          <>
            <span className="font-medium text-foreground">Generate Responses</span> uses theme
            matches (same data as the Themes step). The limit field applies: the most recent N theme
            rows (leave empty for all).
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Generate Responses</span> is available
            when the category above is{" "}
            <span className="font-medium text-foreground">All categories</span> or{" "}
            <span className="font-medium text-foreground">Themes</span>.
          </>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ResetAnalysisButton
          projectId={selectedProject?.id ?? ""}
          projectName={selectedProject?.name}
          disabled={!selectedProject}
        />

        <Button
          variant="destructive"
          size="sm"
          onClick={handleRemoveAllRecords}
          disabled={!selectedProject || isPurgingRecords}
        >
          {isPurgingRecords ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Removing records…
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove All Records
            </>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDeleteSchedule}
          disabled={!selectedProject || isDeletingSchedule}
        >
          {isDeletingSchedule ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deleting schedule…
            </>
          ) : (
            <>
              <CalendarX2 className="mr-2 h-4 w-4" />
              Delete Horizon Schedule
            </>
          )}
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={handleSkipPendingAnalysisTasks}
          disabled={!selectedProject || isSkippingPendingTasks}
        >
          {isSkippingPendingTasks ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Skipping pending tasks…
            </>
          ) : (
            <>
              <Ban className="mr-2 h-4 w-4" />
              Skip Pending Analysis Tasks
            </>
          )}
        </Button>
      </div>
    </CardContent>
  );
}
