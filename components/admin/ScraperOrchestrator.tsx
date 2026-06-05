"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Play,
  Plus,
  Trash2,
  Save,
  Settings,
  AlertCircle,
  Pause,
  RotateCcw,
  Loader2,
  FileText,
  Brain,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";

interface Project {
  id: string;
  name: string;
  description?: string;
  keywords: { keyword: string }[];
  _count: {
    jobs: number;
  };
}

interface Scraper {
  id: string;
  name: string;
  platform: string;
  is_active: boolean;
}

interface SearchSourceTaskItem {
  id: string;
  name: string;
  target?: string;
}

/** Step in threads JSON: scraper (default) or openai_task */
interface OrchestrationStep {
  id: string;
  type?: "scraper" | "openai_task";
  scraperId?: string;
  scraperName?: string;
  platform?: string;
  taskId?: string;
  taskName?: string;
  target?: string;
  sequence: number;
  threadId: string;
}

interface OrchestrationThread {
  id: string;
  threadNumber: number;
  name: string;
  steps: OrchestrationStep[];
}

interface TableCell {
  threadId: string;
  stepNumber: number;
  sourceType: "scraper" | "openai_task" | null;
  scraperId: string | null;
  scraperName: string | null;
  platform: string | null;
  taskId: string | null;
  taskName: string | null;
}

export interface OrchestrationConfig {
  id: string;
  name: string;
  description?: string;
  projectIds: string[];
  threads: OrchestrationThread[];
  isRunning: boolean;
  createdAt: string;
}

interface ScraperOrchestratorProps {
  projects: Project[];
  scrapers: Scraper[];
  searchSourceTasks: SearchSourceTaskItem[];
  orchestrations: OrchestrationConfig[];
  selectedProjectIds?: string[];
}

export function ScraperOrchestrator({
  projects,
  scrapers,
  searchSourceTasks,
  orchestrations,
  selectedProjectIds,
}: ScraperOrchestratorProps) {
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [threads, setThreads] = useState<OrchestrationThread[]>([]);
  const [tableData, setTableData] = useState<TableCell[][]>([]);
  const [maxSteps, setMaxSteps] = useState(5);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [maxThreads, setMaxThreads] = useState(5);
  const [isCreating, setIsCreating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [newOrchestrationName, setNewOrchestrationName] = useState("");
  const [newOrchestrationDescription, setNewOrchestrationDescription] = useState("");
  const [savedOrchestrations, setSavedOrchestrations] = useState<OrchestrationConfig[]>([]);
  const [editingOrchestrationId, setEditingOrchestrationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewOrchestrationForm, setShowNewOrchestrationForm] = useState(false);
  const [isAnalyzingSentiment, setIsAnalyzingSentiment] = useState(false);
  const [analyzingProject, setAnalyzingProject] = useState<string | null>(null);
  const [sentimentResults, setSentimentResults] = useState<{
    [projectId: string]: {
      processed: number;
      skipped: number;
      errors: number;
      duration: number;
      lastRun: string;
    };
  }>({});

  // Refs so Save always reads latest table/threads. Updated synchronously whenever we set state.
  const tableDataRef = useRef<TableCell[][]>([]);
  const threadsRef = useRef<OrchestrationThread[]>([]);
  /** Steps to save: threadId -> list of steps. Updated in updateCellSource and loadOrchestration so Save never misses. */
  const stepsByThreadRef = useRef<Record<string, OrchestrationStep[]>>({});

  const setTableDataAndRef = useCallback(
    (value: TableCell[][] | ((prev: TableCell[][]) => TableCell[][])) => {
      if (typeof value === "function") {
        setTableData((prev) => {
          const next = value(prev);
          tableDataRef.current = next;
          return next;
        });
      } else {
        tableDataRef.current = value;
        setTableData(value);
      }
    },
    []
  );

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // Sentiment analysis function
  const runSentimentAnalysis = async (projectId: string) => {
    setIsAnalyzingSentiment(true);
    setAnalyzingProject(projectId);
    try {
      const response = await fetch("/api/sentiment-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to run sentiment analysis");
      }

      // Store results in state for UI display
      if (data.results) {
        setSentimentResults((prev) => ({
          ...prev,
          [projectId]: {
            processed: data.results.processed,
            skipped: data.results.skipped,
            errors: data.results.errors,
            duration: data.results.duration,
            lastRun: new Date().toLocaleString(),
          },
        }));
      }

      // Enhanced toast with detailed results
      const results = data.results;
      const postsPerSecond =
        results && results.processed > 0 ? (results.processed / results.duration).toFixed(2) : "0";

      toast({
        title: "Sentiment Analysis Complete",
        description: `Processed ${results?.processed || 0} posts, skipped ${results?.skipped || 0}, ${results?.errors || 0} errors in ${results?.duration?.toFixed(1) || 0}s`,
      });

      // Log detailed results to console for debugging
      if (data.results) {
        console.log("🧠 Sentiment Analysis Results:", {
          processed: data.results.processed,
          skipped: data.results.skipped,
          errors: data.results.errors,
          duration: `${data.results.duration.toFixed(1)} seconds`,
          postsPerSecond: postsPerSecond,
        });
      }
    } catch (error) {
      console.error("Error running sentiment analysis:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to run sentiment analysis",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingSentiment(false);
      setAnalyzingProject(null);
    }
  };

  // Filter orchestrations by selected projects when selection is provided
  const displayedOrchestrations = useMemo(() => {
    if (!selectedProjectIds || selectedProjectIds.length === 0) return savedOrchestrations;
    return savedOrchestrations.filter((orch) =>
      (orch.projectIds ?? []).some((id: string) => selectedProjectIds.includes(id))
    );
  }, [savedOrchestrations, selectedProjectIds]);

  // Check if any orchestration is currently running
  const hasRunningOrchestrations = useMemo(
    () => savedOrchestrations.some((orch) => orch.isRunning),
    [savedOrchestrations]
  );

  // Load orchestrations from database
  const loadOrchestrations = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setIsLoading(true);
      }
      console.log("🔄 Loading orchestrations from API...");
      const response = await fetch("/api/admin/orchestrations", {
        cache: "no-cache",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (response.ok) {
        const data = await response.json();
        console.log("📊 Raw API response:", data);
        console.log(
          "🔍 Orchestration isRunning states:",
          data.map((o: any) => ({ id: o.id, name: o.name, isRunning: o.isRunning }))
        );
        setSavedOrchestrations(data);
      } else {
        console.error("❌ Failed to load orchestrations:", response.statusText);
      }
    } catch (error) {
      console.error("💥 Error loading orchestrations:", error);
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Debug logging
  useEffect(() => {
    console.log("🎯 Current savedOrchestrations:", savedOrchestrations);
    console.log("🚦 hasRunningOrchestrations:", hasRunningOrchestrations);
    console.log(
      "📋 Running orchestrations:",
      savedOrchestrations.filter((orch) => orch.isRunning)
    );
  }, [savedOrchestrations, hasRunningOrchestrations]);

  // Load orchestrations on component mount
  useEffect(() => {
    void loadOrchestrations();
  }, [loadOrchestrations]);

  useVisibilityAwarePolling({
    onPoll: () => {
      console.log("Refreshing orchestration status...");
      void loadOrchestrations({ silent: true });
    },
    intervalMs: 30_000,
    hiddenIntervalMs: 120_000,
    enabled: hasRunningOrchestrations,
  });

  // Initialize threads with generic names
  const initializeThreads = useCallback(() => {
    const newThreads: OrchestrationThread[] = [];
    for (let i = 0; i < 3; i++) {
      // Start with 3 threads
      newThreads.push({
        id: `thread-${i + 1}`,
        threadNumber: i + 1,
        name: `Thread ${i + 1}`,
        steps: [],
      });
    }
    setThreads(newThreads);
  }, []);

  // Update thread name
  const updateThreadName = (threadId: string, newName: string) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, name: newName } : t)));
  };

  // Add/remove thread
  const addThread = () => {
    const newThreadNumber = threads.length + 1;

    const newThread: OrchestrationThread = {
      id: `thread-${newThreadNumber}`,
      threadNumber: newThreadNumber,
      name: `Thread ${newThreadNumber}`,
      steps: [],
    };

    setThreads((prev) => [...prev, newThread]);

    // Add new column to existing table data
    setTableDataAndRef((prev) =>
      prev.map((row) => [
        ...row,
        {
          threadId: newThread.id,
          stepNumber: row[0]?.stepNumber || 1,
          sourceType: null,
          scraperId: null,
          scraperName: null,
          platform: null,
          taskId: null,
          taskName: null,
        },
      ])
    );
  };

  const removeThread = (threadId: string) => {
    if (threads.length <= 1) return; // Keep at least one thread

    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    // Remove corresponding column from table data
    setTableDataAndRef((prev) =>
      prev.map((row) => row.filter((cell) => cell.threadId !== threadId))
    );
  };

  // Update cell source: value is "none" | "scraper:<id>" | "task:<id>"
  // Updates table (display) and stepsByThreadRef (what gets saved) synchronously.
  const updateCellSource = (threadId: string, stepNumber: number, value: string) => {
    const prev = tableDataRef.current;
    let next: TableCell[][];
    const stepsForThread = { ...stepsByThreadRef.current };
    if (!stepsForThread[threadId]) stepsForThread[threadId] = [];

    if (value === "none") {
      stepsForThread[threadId] = stepsForThread[threadId].filter((s) => s.sequence !== stepNumber);
      next = prev.map((row, rowIndex) =>
        rowIndex === stepNumber - 1
          ? row.map((cell) =>
              cell.threadId === threadId && cell.stepNumber === stepNumber
                ? {
                    ...cell,
                    sourceType: null,
                    scraperId: null,
                    scraperName: null,
                    platform: null,
                    taskId: null,
                    taskName: null,
                  }
                : cell
            )
          : row
      );
    } else if (value.startsWith("scraper:")) {
      const scraperId = value.slice("scraper:".length);
      const scraper = scrapers.find((s) => s.id === scraperId);
      const newStep: OrchestrationStep = {
        id: `step-${threadId}-${stepNumber}`,
        type: "scraper",
        scraperId,
        scraperName: scraper?.name ?? "",
        platform: scraper?.platform ?? "",
        sequence: stepNumber,
        threadId,
      };
      stepsForThread[threadId] = stepsForThread[threadId]
        .filter((s) => s.sequence !== stepNumber)
        .concat(newStep)
        .sort((a, b) => a.sequence - b.sequence);
      next = prev.map((row, rowIndex) =>
        rowIndex === stepNumber - 1
          ? row.map((cell) =>
              cell.threadId === threadId && cell.stepNumber === stepNumber
                ? {
                    ...cell,
                    sourceType: "scraper" as const,
                    scraperId: scraperId,
                    scraperName: scraper?.name || null,
                    platform: scraper?.platform || null,
                    taskId: null,
                    taskName: null,
                  }
                : cell
            )
          : row
      );
    } else if (value.startsWith("task:")) {
      const taskId = value.slice("task:".length);
      const task = searchSourceTasks.find((t) => t.id === taskId);
      const newStep: OrchestrationStep = {
        id: `step-${threadId}-${stepNumber}`,
        type: "openai_task",
        taskId,
        taskName: task?.name ?? "Custom Task",
        target: task?.target,
        sequence: stepNumber,
        threadId,
      };
      stepsForThread[threadId] = stepsForThread[threadId]
        .filter((s) => s.sequence !== stepNumber)
        .concat(newStep)
        .sort((a, b) => a.sequence - b.sequence);
      next = prev.map((row, rowIndex) =>
        rowIndex === stepNumber - 1
          ? row.map((cell) =>
              cell.threadId === threadId && cell.stepNumber === stepNumber
                ? {
                    ...cell,
                    sourceType: "openai_task" as const,
                    scraperId: null,
                    scraperName: null,
                    platform: null,
                    taskId: taskId,
                    taskName: task?.name || null,
                  }
                : cell
            )
          : row
      );
    } else {
      return;
    }
    stepsByThreadRef.current = stepsForThread;
    tableDataRef.current = next;
    setTableData(next);
  };

  // Add/remove steps
  const addStep = () => {
    setMaxSteps((prev) => prev + 1);
    const newStepNumber = maxSteps + 1;
    const newRow: TableCell[] = threads.map((thread) => ({
      threadId: thread.id,
      stepNumber: newStepNumber,
      sourceType: null,
      scraperId: null,
      scraperName: null,
      platform: null,
      taskId: null,
      taskName: null,
    }));
    setTableDataAndRef((prev) => [...prev, newRow]);
  };

  const removeStep = (stepNumber: number) => {
    if (maxSteps <= 1) return; // Keep at least one step

    setMaxSteps((prev) => prev - 1);
    setTableDataAndRef((prev) => prev.filter((_, index) => index !== stepNumber - 1));
  };

  // Reset table to clear all data
  const resetTable = () => {
    const newTableData: TableCell[][] = [];
    for (let step = 1; step <= maxSteps; step++) {
      const row: TableCell[] = [];
      for (let threadIndex = 0; threadIndex < threads.length; threadIndex++) {
        row.push({
          threadId: threads[threadIndex].id,
          stepNumber: step,
          sourceType: null,
          scraperId: null,
          scraperName: null,
          platform: null,
          taskId: null,
          taskName: null,
        });
      }
      newTableData.push(row);
    }
    setTableDataAndRef(newTableData);
  };

  // Create new orchestration
  const createOrchestration = async () => {
    // Validation
    if (!newOrchestrationName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the orchestration",
        variant: "destructive",
      });
      return;
    }

    if (selectedProjects.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one project",
        variant: "destructive",
      });
      return;
    }

    // Use steps from ref (updated in updateCellSource and loadOrchestration) so Save always has current steps.
    const latestThreads = threadsRef.current;
    const stepsByThread = stepsByThreadRef.current;
    const totalStepsToSave = Object.values(stepsByThread).reduce(
      (s, arr) => s + (arr?.length ?? 0),
      0
    );
    console.log(
      "[Save] Building payload: threads=",
      latestThreads.length,
      "steps=",
      totalStepsToSave,
      "stepsByThread=",
      stepsByThread
    );

    setIsCreating(true);

    try {
      // Save to database
      if (editingOrchestrationId) {
        // Update existing orchestration
        const updateData = {
          name: newOrchestrationName,
          description: newOrchestrationDescription,
          projectIds: selectedProjects,
          threads: latestThreads.map((thread) => ({
            ...thread,
            steps: stepsByThread[thread.id] || [],
          })),
        };

        console.log("=== UPDATING ORCHESTRATION ===");
        console.log("Orchestration ID:", editingOrchestrationId);
        console.log("Update data:", JSON.stringify(updateData, null, 2));

        const response = await fetch(`/api/admin/orchestrations/${editingOrchestrationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        console.log("Update response status:", response.status);
        console.log("Update response ok:", response.ok);

        if (!response.ok) {
          throw new Error("Failed to update orchestration");
        }

        setEditingOrchestrationId(null);
        setShowNewOrchestrationForm(false);
        toast({
          title: "Success",
          description: `Orchestration "${newOrchestrationName}" updated successfully!`,
        });
      } else {
        // Create new orchestration
        const requestData = {
          name: newOrchestrationName,
          description: newOrchestrationDescription,
          projectIds: selectedProjects,
          threads: latestThreads.map((thread) => ({
            ...thread,
            steps: stepsByThread[thread.id] || [],
          })),
        };

        console.log("=== SAVING ORCHESTRATION ===");
        console.log("Request data:", JSON.stringify(requestData, null, 2));

        const response = await fetch("/api/admin/orchestrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData),
        });

        console.log("Response status:", response.status);
        console.log("Response ok:", response.ok);

        if (!response.ok) {
          throw new Error("Failed to create orchestration");
        }

        toast({
          title: "Success",
          description: `Orchestration "${newOrchestrationName}" created successfully!`,
        });
      }

      // Reload orchestrations from database
      await loadOrchestrations();

      // Hide the form after successful creation
      setShowNewOrchestrationForm(false);
    } catch (error) {
      console.error("Error creating orchestration:", error);
      toast({
        title: "Error",
        description: "Failed to create orchestration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Delete orchestration
  const deleteOrchestration = async (orchestrationId: string) => {
    try {
      const response = await fetch(`/api/admin/orchestrations/${orchestrationId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete orchestration");
      }

      // Reload orchestrations from database
      await loadOrchestrations();

      toast({
        title: "Orchestration Deleted",
        description: "The orchestration has been removed",
      });
    } catch (error) {
      console.error("Error deleting orchestration:", error);
      toast({
        title: "Error",
        description: "Failed to delete orchestration",
        variant: "destructive",
      });
    }
  };

  // Load orchestration into table for editing. Fetches latest from server so saved steps are shown.
  const loadOrchestration = async (orchestration: OrchestrationConfig) => {
    try {
      const response = await fetch(`/api/admin/orchestrations/${orchestration.id}`, {
        cache: "no-cache",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) {
        toast({
          title: "Error",
          description: "Failed to load orchestration",
          variant: "destructive",
        });
        return;
      }
      const latest: OrchestrationConfig = await response.json();
      if (!latest.threads?.length) {
        latest.threads = [{ id: "thread-1", threadNumber: 1, name: "Thread 1", steps: [] }];
      }

      setEditingOrchestrationId(latest.id);
      setNewOrchestrationName(latest.name);
      setNewOrchestrationDescription(latest.description || "");
      setSelectedProjects(latest.projectIds ?? []);
      setThreads(latest.threads);

      const maxStep = Math.max(
        ...latest.threads.map((t) => (Array.isArray(t.steps) ? t.steps.length : 0)),
        1
      );
      setMaxSteps(maxStep);

      const newTableData: TableCell[][] = [];
      for (let step = 1; step <= maxStep; step++) {
        const row: TableCell[] = [];
        for (const thread of latest.threads) {
          const steps = Array.isArray(thread.steps) ? thread.steps : [];
          const stepData = steps.find((s: { sequence?: number }) => Number(s?.sequence) === step);
          const isCustomTask = stepData?.type === "openai_task";
          row.push({
            threadId: thread.id,
            stepNumber: step,
            sourceType: isCustomTask ? "openai_task" : stepData?.scraperId ? "scraper" : null,
            scraperId: isCustomTask ? null : (stepData?.scraperId ?? null),
            scraperName: isCustomTask ? null : (stepData?.scraperName ?? null),
            platform: isCustomTask ? null : (stepData?.platform ?? null),
            taskId: isCustomTask ? (stepData?.taskId ?? null) : null,
            taskName: isCustomTask ? (stepData?.taskName ?? null) : null,
          });
        }
        newTableData.push(row);
      }
      const stepsByThread: Record<string, OrchestrationStep[]> = {};
      for (const thread of latest.threads) {
        const rawSteps = Array.isArray(thread.steps) ? thread.steps : [];
        stepsByThread[thread.id] = rawSteps.map((s: OrchestrationStep) => {
          if (s.type === "openai_task" && (!s.taskId || s.taskId === "") && s.taskName) {
            const resolvedId = searchSourceTasks.find((t) => t.name === s.taskName)?.id;
            if (resolvedId) return { ...s, taskId: resolvedId };
          }
          return s;
        });
      }
      stepsByThreadRef.current = stepsByThread;
      setTableDataAndRef(newTableData);

      toast({
        title: "Orchestration Loaded",
        description: `"${latest.name}" loaded for editing`,
      });
    } catch (err) {
      console.error("Error loading orchestration:", err);
      toast({
        title: "Error",
        description: "Failed to load orchestration",
        variant: "destructive",
      });
    }
  };

  // Build orchestration config from current form state (threads + table steps, selected projects).
  // Used when executing so unsaved edits are included if this orchestration is loaded for editing.
  const buildConfigFromCurrentState = useCallback(
    (base: OrchestrationConfig): OrchestrationConfig => {
      const threadSteps: { [threadId: string]: OrchestrationStep[] } = {};
      for (const thread of threads) {
        threadSteps[thread.id] = [];
        for (let rowIndex = 0; rowIndex < tableData.length; rowIndex++) {
          const row = tableData[rowIndex];
          const cell = row.find((c) => c.threadId === thread.id);
          if (!cell) continue;
          if (cell.scraperId) {
            threadSteps[thread.id].push({
              id: `step-${cell.threadId}-${cell.stepNumber}`,
              type: "scraper",
              scraperId: cell.scraperId,
              scraperName: cell.scraperName ?? "",
              platform: cell.platform ?? "",
              sequence: cell.stepNumber,
              threadId: cell.threadId,
            });
          } else {
            const taskId =
              cell.taskId ?? searchSourceTasks.find((t) => t.name === cell.taskName)?.id ?? "";
            if (taskId) {
              const task = searchSourceTasks.find((t) => t.id === taskId);
              threadSteps[thread.id].push({
                id: `step-${cell.threadId}-${cell.stepNumber}`,
                type: "openai_task",
                taskId,
                taskName: cell.taskName ?? task?.name ?? "Custom Task",
                target: task?.target,
                sequence: cell.stepNumber,
                threadId: cell.threadId,
              });
            }
          }
        }
      }
      return {
        ...base,
        projectIds: selectedProjects.length > 0 ? selectedProjects : base.projectIds,
        threads: threads.map((thread) => ({
          ...thread,
          steps: threadSteps[thread.id] || [],
        })),
      };
    },
    [threads, tableData, selectedProjects, searchSourceTasks]
  );

  // Resolve empty taskIds in steps from searchSourceTasks (by name or target) so execute payload always has taskId.
  const resolveStepTaskIds = useCallback(
    (config: OrchestrationConfig): OrchestrationConfig => {
      const tasks = searchSourceTasks;
      if (!config.threads?.length || tasks.length === 0) return config;
      return {
        ...config,
        threads: config.threads.map((thread) => ({
          ...thread,
          steps: (thread.steps ?? []).map((step) => {
            if (step.type !== "openai_task") return step;
            const taskId = (step.taskId ?? "").trim();
            if (taskId) return step;
            const byName = step.taskName
              ? tasks.find((t) => t.name === (step.taskName ?? "").trim())
              : undefined;
            const byTarget = step.target
              ? tasks.find((t) => t.target === (step.target ?? "").trim())
              : undefined;
            const resolvedId = byName?.id ?? byTarget?.id ?? "";
            if (!resolvedId) return step;
            return { ...step, taskId: resolvedId };
          }),
        })),
      };
    },
    [searchSourceTasks]
  );

  /**
   * When the user has a non-empty project scope (e.g. /projects/[id]/orchestration or admin picker),
   * only run the orchestration for projects in BOTH the saved orchestration and that scope.
   * Otherwise a multi-project orchestration can still scrape project A while you expect project B.
   */
  const applyOrchestrationProjectScope = useCallback(
    (config: OrchestrationConfig): OrchestrationConfig | null => {
      if (!selectedProjectIds || selectedProjectIds.length === 0) {
        return config;
      }
      const saved = config.projectIds ?? [];
      const scoped = saved.filter((id) => selectedProjectIds.includes(id));
      if (scoped.length === 0) {
        return null;
      }
      return { ...config, projectIds: scoped };
    },
    [selectedProjectIds]
  );

  // Execute orchestration
  const executeOrchestration = async (orchestration: OrchestrationConfig) => {
    setIsRunning(true);
    try {
      // Execute API uses saved project_ids from DB. Persist the form first when editing so DB matches the UI.
      if (editingOrchestrationId === orchestration.id) {
        if (!newOrchestrationName.trim()) {
          toast({
            title: "Error",
            description: "Please enter a name for the orchestration before running",
            variant: "destructive",
          });
          return;
        }
        if (selectedProjects.length === 0) {
          toast({
            title: "Error",
            description: "Please select at least one project before running",
            variant: "destructive",
          });
          return;
        }
        const latestThreads = threadsRef.current;
        const stepsByThread = stepsByThreadRef.current;
        const updateData = {
          name: newOrchestrationName.trim(),
          description: newOrchestrationDescription,
          projectIds: selectedProjects,
          threads: latestThreads.map((thread) => ({
            ...thread,
            steps: stepsByThread[thread.id] || [],
          })),
        };
        const persistRes = await fetch(`/api/admin/orchestrations/${editingOrchestrationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });
        if (!persistRes.ok) {
          throw new Error("Failed to save orchestration before run");
        }
        await loadOrchestrations();
      }

      // If this orchestration is loaded for editing, use current form state so unsaved steps are included
      let configToExecute: OrchestrationConfig =
        editingOrchestrationId === orchestration.id
          ? buildConfigFromCurrentState(orchestration)
          : orchestration;
      configToExecute = resolveStepTaskIds(configToExecute);

      const scopedConfig = applyOrchestrationProjectScope(configToExecute);
      if (scopedConfig === null) {
        toast({
          title: "No project overlap",
          description:
            "This orchestration is not linked to any of the projects in the current scope. Open the orchestration editor, add this project under Project Selection, save, then run again.",
          variant: "destructive",
        });
        return;
      }
      configToExecute = scopedConfig;

      console.log("=== UI EXECUTING ORCHESTRATION ===");
      console.log("Orchestration ID:", configToExecute.id);
      console.log(
        "Using",
        editingOrchestrationId === orchestration.id
          ? "current form state (including unsaved steps)"
          : "saved config"
      );
      console.log("Orchestration config:", JSON.stringify(configToExecute, null, 2));

      const requestBody = { orchestration: configToExecute };
      console.log("Request body:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(`/api/admin/orchestrations/${configToExecute.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      console.log("Response status:", response.status);
      console.log("Response ok:", response.ok);

      if (!response.ok) {
        const errorData = await response.json();
        console.log("Error response:", errorData);
        throw new Error(errorData.error || "Failed to execute orchestration");
      }

      const result = await response.json();
      console.log("Success response:", result);

      toast({
        title: "Success",
        description: result.message || "Orchestration execution started",
      });

      // Reload orchestrations to get updated status
      await loadOrchestrations();
    } catch (error) {
      console.error("Error executing orchestration:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to start orchestration execution",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const stopOrchestration = async (orchestration: OrchestrationConfig) => {
    setIsRunning(true);
    try {
      const response = await fetch(`/api/admin/orchestrations/${orchestration.id}/execute`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to stop orchestration");
      }

      const result = await response.json();

      toast({
        title: "Success",
        description: result.message || "Orchestration execution stopped",
      });

      // Reload orchestrations to get updated status
      await loadOrchestrations();
    } catch (error) {
      console.error("Error stopping orchestration:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to stop orchestration execution",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const viewExecutionLogs = async (orchestration: OrchestrationConfig) => {
    try {
      const response = await fetch(`/api/admin/orchestrations/${orchestration.id}/logs`, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get execution logs");
      }

      const data = await response.json();

      // Open logs in a new window/tab
      const logsWindow = window.open("", "_blank");
      if (logsWindow) {
        logsWindow.document.write(`
          <html>
            <head>
              <title>Execution Logs - ${orchestration.name}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .log-entry { border: 1px solid #ddd; margin: 10px 0; padding: 10px; border-radius: 5px; }
                .status-completed { border-left: 4px solid #4CAF50; }
                .status-failed { border-left: 4px solid #f44336; }
                .status-cancelled { border-left: 4px solid #ff9800; }
                .status-started { border-left: 4px solid #2196F3; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
              </style>
            </head>
            <body>
              <h1>Execution Logs - ${orchestration.name}</h1>
              <div class="summary">
                <h3>Summary</h3>
                <p><strong>Orchestration ID:</strong> ${data.orchestrationId}</p>
                <p><strong>Total Records Collected:</strong> ${data.summary.totalRecordsCollected || 0}</p>
                <p><strong>Total Records Inserted:</strong> ${data.summary.totalRecordsInserted || 0}</p>
                <p><strong>Total Records New:</strong> ${data.summary.totalRecordsNew || 0}</p>
                <p><strong>Total Records Updated:</strong> ${data.summary.totalRecordsUpdated || 0}</p>
                <p><strong>Total Records Discarded:</strong> ${data.summary.totalRecordsDiscarded || 0}</p>
                <p><strong>Total Duplicate Records:</strong> ${data.summary.totalDuplicateRecords || 0}</p>
                <p><strong>Average Duration:</strong> ${(data.summary.averageDuration || 0).toFixed(3)} seconds</p>
                
                ${
                  data.summary.sentimentAnalysis &&
                  data.summary.sentimentAnalysis.totalProcessed > 0
                    ? `
                  <h3>Sentiment Analysis Summary</h3>
                  <p><strong>Records Analyzed:</strong> ${data.summary.sentimentAnalysis.totalProcessed}</p>
                  <p><strong>Skipped:</strong> ${data.summary.sentimentAnalysis.totalSkipped}</p>
                  <p><strong>Errors:</strong> ${data.summary.sentimentAnalysis.totalErrors}</p>
                  <p><strong>Duration:</strong> ${data.summary.sentimentAnalysis.totalDuration.toFixed(3)} seconds</p>
                  <p><strong>Sentiment Breakdown:</strong></p>
                  <ul>
                    <li>Positive: ${data.summary.sentimentAnalysis.sentimentBreakdown.POSITIVE}</li>
                    <li>Negative: ${data.summary.sentimentAnalysis.sentimentBreakdown.NEGATIVE}</li>
                    <li>Neutral: ${data.summary.sentimentAnalysis.sentimentBreakdown.NEUTRAL}</li>
                    <li>Mixed: ${data.summary.sentimentAnalysis.sentimentBreakdown.MIXED}</li>
                  </ul>
                `
                    : ""
                }
              </div>
              <h3>Execution Details</h3>
              ${
                data.executions
                  ? data.executions
                      .map(
                        (execution: any, index: number) => `
                <div class="log-entry status-${execution.status.toLowerCase()}">
                  <h4>Execution ${index + 1} - ${execution.status}</h4>
                  <p><strong>Execution ID:</strong> ${execution.executionId}</p>
                  <p><strong>Start Time:</strong> ${new Date(execution.startTime).toLocaleString()}</p>
                  ${execution.endTime ? `<p><strong>End Time:</strong> ${new Date(execution.endTime).toLocaleString()}</p>` : ""}
                  ${execution.duration ? `<p><strong>Total Duration:</strong> ${execution.duration.toFixed(3)} seconds</p>` : ""}
                  
                  <h5>Scrapers Run:</h5>
                  ${execution.scrapers
                    .map(
                      (scraper: any) => `
                    <div style="margin-left: 20px; border-left: 2px solid #ddd; padding-left: 10px; margin-bottom: 10px;">
                      <p><strong>${scraper.scraperName} (${scraper.platform})</strong> - ${scraper.status}</p>
                      ${scraper.duration ? `<p><strong>Duration:</strong> ${scraper.duration.toFixed(3)} seconds</p>` : ""}
                      ${scraper.recordsCollected !== undefined ? `<p><strong>Records Collected:</strong> ${scraper.recordsCollected}</p>` : ""}
                      ${scraper.recordsInserted !== undefined ? `<p><strong>Records Inserted:</strong> ${scraper.recordsInserted}</p>` : ""}
                      ${scraper.recordsNew !== undefined ? `<p><strong>Records New:</strong> ${scraper.recordsNew}</p>` : ""}
                      ${scraper.recordsUpdated !== undefined ? `<p><strong>Records Updated:</strong> ${scraper.recordsUpdated}</p>` : ""}
                      ${scraper.recordsDiscarded !== undefined ? `<p><strong>Records Discarded:</strong> ${scraper.recordsDiscarded}</p>` : ""}
                      ${scraper.duplicateRecords !== undefined ? `<p><strong>Duplicate Records:</strong> ${scraper.duplicateRecords}</p>` : ""}
                      ${scraper.errorMessage ? `<p><strong>Error:</strong> ${scraper.errorMessage}</p>` : ""}
                    </div>
                  `
                    )
                    .join("")}
                  
                </div>
              `
                      )
                      .join("")
                  : ""
              }
            </body>
          </html>
        `);
        logsWindow.document.close();
      }
    } catch (error) {
      console.error("Error viewing execution logs:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to view execution logs",
        variant: "destructive",
      });
    }
  };

  // Initialize on component mount only
  useEffect(() => {
    if (threads.length === 0) {
      initializeThreads();
    }
  }, [initializeThreads]);

  // Initialize table only once when threads are first created
  useEffect(() => {
    if (threads.length > 0 && tableData.length === 0) {
      const newTableData: TableCell[][] = [];
      for (let step = 1; step <= maxSteps; step++) {
        const row: TableCell[] = [];
        for (let threadIndex = 0; threadIndex < threads.length; threadIndex++) {
          row.push({
            threadId: threads[threadIndex].id,
            stepNumber: step,
            sourceType: null,
            scraperId: null,
            scraperName: null,
            platform: null,
            taskId: null,
            taskName: null,
          });
        }
        newTableData.push(row);
      }
      setTableDataAndRef(newTableData);
    }
  }, [threads.length, maxSteps, setTableDataAndRef]); // Remove tableData.length and initializeTable from dependencies

  return (
    <div className="space-y-6">
      {/* Saved Orchestrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Saved Orchestrations</CardTitle>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  console.log("Manual refresh triggered");
                  await loadOrchestrations();
                  toast({
                    title: "Refreshed",
                    description: "Orchestration status updated",
                  });
                }}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  console.log("🚨 NUCLEAR REFRESH - Clearing all state");
                  setSavedOrchestrations([]);
                  setIsRunning(false);
                  setTimeout(() => {
                    loadOrchestrations();
                  }, 100);
                  toast({
                    title: "Nuclear Refresh",
                    description: "All state cleared and reloaded",
                  });
                }}
              >
                <AlertCircle className="h-4 w-4 mr-1" />
                Force Reset
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!hasRunningOrchestrations}
                onClick={async () => {
                  try {
                    const response = await fetch("/api/admin/orchestrations/stop-all", {
                      method: "POST",
                    });

                    if (!response.ok) {
                      const errorData = await response.json();
                      throw new Error(errorData.error || "Failed to stop orchestrations");
                    }

                    toast({
                      title: "Success",
                      description: "All orchestrations stopped successfully",
                    });

                    // Reload orchestrations to get updated status
                    await loadOrchestrations();
                  } catch (error) {
                    console.error("Error stopping orchestrations:", error);
                    toast({
                      title: "Error",
                      description:
                        error instanceof Error ? error.message : "Failed to stop orchestrations",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Pause className="h-4 w-4 mr-1" />
                Stop All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Show saved orchestrations first */}
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Loading orchestrations...</p>
              </div>
            ) : displayedOrchestrations.length === 0 && orchestrations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>
                  {selectedProjectIds && selectedProjectIds.length > 0
                    ? "No orchestrations include the selected project(s). Create one below."
                    : "Saved Orchestrations: None"}
                </p>
                <p className="text-xs mt-2">
                  Create your first orchestration using the form below.
                </p>
              </div>
            ) : (
              <>
                {displayedOrchestrations.map((orchestration) => (
                  <div key={orchestration.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-medium">{orchestration.name}</h4>
                        {orchestration.description && (
                          <p className="text-sm text-muted-foreground">
                            {orchestration.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={orchestration.isRunning ? "default" : "secondary"}>
                          {orchestration.isRunning ? "Running" : "Stopped"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => loadOrchestration(orchestration)}
                        >
                          <Settings className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewExecutionLogs(orchestration)}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Logs
                        </Button>
                        {orchestration.isRunning ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => stopOrchestration(orchestration)}
                            disabled={isRunning}
                          >
                            {isRunning ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Pause className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => executeOrchestration(orchestration)}
                            disabled={isRunning}
                          >
                            {isRunning ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deleteOrchestration(orchestration.id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      Projects: {orchestration.projectIds?.length || 0} | Threads:{" "}
                      {orchestration.threads?.length || 0} | Created:{" "}
                      {orchestration.createdAt
                        ? new Date(orchestration.createdAt).toLocaleDateString()
                        : "N/A"}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* New Orchestration Button - Only show when there are saved orchestrations and form is not visible */}
      {savedOrchestrations.length > 0 && !showNewOrchestrationForm && !editingOrchestrationId && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => {
              setEditingOrchestrationId(null);
              setNewOrchestrationName("");
              setNewOrchestrationDescription("");
              setSelectedProjects(selectedProjectIds ?? []);
              setThreads([]);
              stepsByThreadRef.current = {};
              setTableDataAndRef([]);
              setShowNewOrchestrationForm(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Orchestration
          </Button>
        </div>
      )}

      {/* Configuration Form - Only show when creating new or editing, or when no orchestrations exist */}
      {(showNewOrchestrationForm || editingOrchestrationId || savedOrchestrations.length === 0) && (
        <>
          {/* Project Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Project Selection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="select-all"
                    checked={selectedProjects.length === projects.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedProjects(projects.map((p) => p.id));
                      } else {
                        setSelectedProjects([]);
                      }
                    }}
                  />
                  <Label htmlFor="select-all">Select All Projects</Label>
                </div>

                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`project-${project.id}`}
                        checked={selectedProjects.includes(project.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedProjects((prev) => [...prev, project.id]);
                          } else {
                            setSelectedProjects((prev) => prev.filter((id) => id !== project.id));
                          }
                        }}
                      />
                      <Label htmlFor={`project-${project.id}`} className="text-sm">
                        {project.name}
                        <span className="text-muted-foreground ml-1">
                          ({project.keywords.length} keywords)
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Orchestration Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Scraper Orchestration Table</CardTitle>
                <div className="flex items-center space-x-2">
                  <Button onClick={addThread} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Thread
                  </Button>
                  <Button onClick={addStep} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Step
                  </Button>
                  <Button onClick={resetTable} variant="outline" size="sm">
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset Table
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Step</TableHead>
                      {threads.map((thread) => (
                        <TableHead key={thread.id} className="min-w-48">
                          <div className="flex items-center space-x-2">
                            <Input
                              value={thread.name}
                              onChange={(e) => updateThreadName(thread.id, e.target.value)}
                              className="h-8 text-sm font-medium"
                            />
                            {threads.length > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeThread(thread.id)}
                                className="h-6 w-6 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        <TableCell className="font-medium">
                          <div className="flex items-center space-x-2">
                            <span>Step {rowIndex + 1}</span>
                            {maxSteps > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeStep(rowIndex + 1)}
                                className="h-6 w-6 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        {row.map((cell) => {
                          const resolvedTaskId =
                            cell.taskId ??
                            searchSourceTasks.find((t) => t.name === cell.taskName)?.id;
                          const cellValue = cell.scraperId
                            ? `scraper:${cell.scraperId}`
                            : resolvedTaskId
                              ? `task:${resolvedTaskId}`
                              : "none";
                          const displayLabel = cell.scraperName
                            ? `${cell.scraperName}${cell.platform ? ` (${cell.platform})` : ""}`
                            : cell.taskName || resolvedTaskId
                              ? `Custom: ${cell.taskName ?? searchSourceTasks.find((t) => t.id === resolvedTaskId)?.name ?? "Task"}`
                              : "Select source...";
                          return (
                            <TableCell key={`${cell.threadId}-${cell.stepNumber}`}>
                              <Select
                                key={`select-${cell.threadId}-${cell.stepNumber}`}
                                value={cellValue}
                                onValueChange={(v) =>
                                  updateCellSource(cell.threadId, cell.stepNumber, v)
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select source...">
                                    {displayLabel}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {scrapers.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel>Apify Scrapers</SelectLabel>
                                      {scrapers.map((scraper) => (
                                        <SelectItem
                                          key={scraper.id}
                                          value={`scraper:${scraper.id}`}
                                        >
                                          {scraper.name} ({scraper.platform})
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {searchSourceTasks.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel>Custom Tasks</SelectLabel>
                                      {searchSourceTasks.map((task) => (
                                        <SelectItem key={task.id} value={`task:${task.id}`}>
                                          {task.name}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {scrapers.length === 0 && searchSourceTasks.length === 0 && (
                                    <SelectItem value="no-sources" disabled>
                                      No scrapers or tasks configured
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Save Orchestration Section */}
          <Card>
            <CardHeader>
              <CardTitle>Save Orchestration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {editingOrchestrationId && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      <strong>Editing Mode:</strong> You are currently editing an existing
                      orchestration. Changes will update the original instead of creating a new one.
                    </p>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="orchestration-name">Orchestration Name *</Label>
                    <Input
                      id="orchestration-name"
                      value={newOrchestrationName}
                      onChange={(e) => setNewOrchestrationName(e.target.value)}
                      placeholder="Enter orchestration name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="orchestration-description">Description (Optional)</Label>
                    <Input
                      id="orchestration-description"
                      value={newOrchestrationDescription}
                      onChange={(e) => setNewOrchestrationDescription(e.target.value)}
                      placeholder="Enter description"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {(() => {
                      const cellHasStep = (cell: TableCell) =>
                        !!cell.scraperId ||
                        !!cell.taskId ||
                        !!(
                          cell.taskName && searchSourceTasks.some((t) => t.name === cell.taskName)
                        );
                      const hasSources = tableData.some((row) => row.some(cellHasStep));
                      const configuredSteps = tableData.filter((row) =>
                        row.some(cellHasStep)
                      ).length;

                      if (selectedProjects.length === 0) {
                        return "⚠️ Please select at least one project to save orchestration";
                      } else if (!hasSources) {
                        return "Configure the table above by selecting at least one scraper or custom task, then save.";
                      } else {
                        return `✅ Table configured with ${configuredSteps} step(s) - Ready to save!`;
                      }
                    })()}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      onClick={createOrchestration}
                      disabled={
                        isCreating || !newOrchestrationName.trim() || selectedProjects.length === 0
                      }
                    >
                      {isCreating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {editingOrchestrationId ? "Update Orchestration" : "Save Orchestration"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Sentiment Analysis */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Sentiment Analysis
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Analyze sentiment for posts across all projects using OpenAI. Only posts without
              existing sentiment will be processed.
            </p>

            {/* Project Buttons */}
            <div className="flex gap-2 flex-wrap">
              {projects.map((project) => (
                <Button
                  key={project.id}
                  variant="outline"
                  size="sm"
                  onClick={() => runSentimentAnalysis(project.id)}
                  disabled={isAnalyzingSentiment}
                  className="flex items-center gap-2"
                >
                  {isAnalyzingSentiment && analyzingProject === project.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4" />
                  )}
                  {isAnalyzingSentiment && analyzingProject === project.id
                    ? `Analyzing ${project.name}...`
                    : project.name}
                </Button>
              ))}
            </div>

            {/* Results Display */}
            {Object.keys(sentimentResults).length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Recent Analysis Results
                </h4>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(sentimentResults).map(([projectId, results]) => {
                    const project = projects.find((p) => p.id === projectId);
                    const postsPerSecond =
                      results.processed > 0
                        ? (results.processed / results.duration).toFixed(2)
                        : "0";

                    return (
                      <div key={projectId} className="border rounded-lg p-3 bg-muted/30">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="font-medium text-sm">
                            {project?.name || "Unknown Project"}
                          </h5>
                          <Badge variant="outline" className="text-xs">
                            {results.lastRun}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div className="flex justify-between">
                            <span>Processed:</span>
                            <span className="font-medium text-green-600">{results.processed}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Skipped:</span>
                            <span className="font-medium text-blue-600">{results.skipped}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Errors:</span>
                            <span className="font-medium text-red-600">{results.errors}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Duration:</span>
                            <span className="font-medium">{results.duration.toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Speed:</span>
                            <span className="font-medium">{postsPerSecond} posts/s</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No projects available for sentiment analysis.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
