"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Settings, Play, Brain } from "lucide-react";
import {
  ScraperOrchestrator,
  type OrchestrationConfig,
} from "@/components/admin/ScraperOrchestrator";
import { OrchestrationRecipeManager } from "@/components/admin/OrchestrationRecipeManager";
import { GlobalActionsPanel } from "@/components/admin/GlobalActionsPanel";
import { SystemActivityBanner } from "@/components/admin/SystemActivityBanner";
import { RunningAnalysisTasksCard } from "@/components/admin/RunningAnalysisTasksCard";
import { TaskBasedAnalysisToggle } from "@/components/admin/TaskBasedAnalysisToggle";
import type { SystemActivity } from "@/lib/system-activity";

interface ProjectForPicker {
  id: string;
  name: string;
  keywords: { keyword: string }[];
  _count: { jobs: number };
}

interface ProjectForReset {
  id: string;
  name: string;
  description?: string | null;
  keywordCount: number;
  scrapeCount: number;
}

interface OrchestrationSummary {
  id: string;
  name: string;
}

interface OrchestrationPageClientProps {
  projects: ProjectForPicker[];
  projectsForReset: ProjectForReset[];
  scrapers: { id: string; name: string; platform: string; is_active: boolean }[];
  searchSourceTasks: { id: string; name: string; target?: string }[];
  orchestrations: OrchestrationConfig[];
  orchestrationsForRecipeManager: OrchestrationSummary[];
  systemActivity: SystemActivity;
  /** When provided (e.g. from /projects/[id]/orchestration), pre-select these projects. */
  initialSelectedProjectIds?: string[];
  /** When true, hide the project picker (used for project-scoped view). */
  hideProjectPicker?: boolean;
  /** Pass to System Activity banner so polling includes task-analysis status for this project. */
  systemActivityPollProjectId?: string;
}

export function OrchestrationPageClient({
  projects,
  projectsForReset,
  scrapers,
  searchSourceTasks,
  orchestrations,
  orchestrationsForRecipeManager,
  systemActivity,
  initialSelectedProjectIds,
  hideProjectPicker,
  systemActivityPollProjectId,
}: OrchestrationPageClientProps) {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    initialSelectedProjectIds ?? []
  );

  const handleSelectAll = (checked: boolean | "indeterminate") => {
    if (checked) {
      setSelectedProjectIds(projects.map((p) => p.id));
    } else {
      setSelectedProjectIds([]);
    }
  };

  const handleToggleProject = (projectId: string, checked: boolean | "indeterminate") => {
    if (checked) {
      setSelectedProjectIds((prev) => [...prev, projectId]);
    } else {
      setSelectedProjectIds((prev) => prev.filter((id) => id !== projectId));
    }
  };

  const preselectedProjectId = selectedProjectIds.length === 1 ? selectedProjectIds[0] : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scraper Orchestration</h1>
          <p className="text-muted-foreground">
            Design and execute multi-threaded scraping sequences across projects
          </p>
        </div>
      </div>

      <SystemActivityBanner
        initialActivity={systemActivity}
        pollProjectId={systemActivityPollProjectId}
      />

      <RunningAnalysisTasksCard
        projects={projectsForReset}
        preferredProjectId={preselectedProjectId}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
            <p className="text-xs text-muted-foreground">Available for orchestration</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Scrapers</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scrapers.length}</div>
            <p className="text-xs text-muted-foreground">Apify scrapers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Tasks</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{searchSourceTasks.length}</div>
            <p className="text-xs text-muted-foreground">Configurable search-source tasks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Orchestrations</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orchestrations.length}</div>
            <p className="text-xs text-muted-foreground">Configured sequences</p>
          </CardContent>
        </Card>

        <TaskBasedAnalysisToggle />
      </div>

      {/* Project Picker - Upfront selection (hidden when project-scoped) */}
      {!hideProjectPicker && (
        <Card>
          <CardHeader>
            <CardTitle>Select Projects</CardTitle>
            <div className="flex items-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => handleSelectAll(true)}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSelectAll(false)}>
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {selectedProjectIds.length === 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                Select one or more projects to view orchestrations and run actions.
              </p>
            )}
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div key={project.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`picker-project-${project.id}`}
                    checked={selectedProjectIds.includes(project.id)}
                    onCheckedChange={(checked) => handleToggleProject(project.id, checked)}
                  />
                  <Label htmlFor={`picker-project-${project.id}`} className="text-sm">
                    {project.name}
                    <span className="text-muted-foreground ml-1">
                      ({project.keywords.length} keywords)
                    </span>
                  </Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Global Actions</CardTitle>
          <CardDescription>
            {preselectedProjectId
              ? "Project pre-selected from above. Actions apply to the selected project."
              : "Choose a project and run high-impact maintenance tasks such as resetting analysis, purging records, or clearing the schedule horizon."}
          </CardDescription>
        </CardHeader>
        <GlobalActionsPanel
          projects={projectsForReset}
          preselectedProjectId={preselectedProjectId}
        />
      </Card>

      <OrchestrationRecipeManager orchestrations={orchestrationsForRecipeManager} />

      <ScraperOrchestrator
        projects={projects}
        scrapers={scrapers}
        searchSourceTasks={searchSourceTasks}
        orchestrations={orchestrations}
        selectedProjectIds={selectedProjectIds}
      />
    </div>
  );
}
