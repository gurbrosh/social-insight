"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Edit,
  Clock,
  Calendar,
  Play,
  Pause,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { createRecipeStepAction } from "@/app/actions/orchestration-recipe-steps";
import { previewRecipeScheduleAction } from "@/app/actions/orchestration-recipe-schedule";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Orchestration {
  id: string;
  name: string;
  description?: string | null;
}

interface RecipeStep {
  id: string;
  recipe_id: string;
  orchestration_id: string;
  sequence: number;
  initial_enabled: boolean;
  initial_run_type: "NOW" | "SCHEDULED";
  initial_schedule_time?: string | null;
  hourly_interval?: number | null;
  daily_interval?: number | null;
  daily_time?: string | null;
  orchestration: {
    id: string;
    name: string;
    description?: string | null;
  };
  _count: {
    timerTasks: number;
  };
  skipConfigurations?: Array<{
    skip_step_id: string;
    skipStep?: {
      id: string;
      sequence: number;
      orchestration: {
        id: string;
        name: string;
      };
    } | null;
  }>;
}

interface OrchestrationRecipe {
  id: string;
  name: string;
  description?: string | null;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  steps: RecipeStep[];
}

type StepTaskType = "initial" | "hourly" | "daily";

interface ScheduleRun {
  stepId: string;
  stepSequence: number;
  orchestrationId: string;
  orchestrationName: string;
  taskType: StepTaskType;
  scheduledAtUtc: string;
  scheduledAtLocal: string;
  status: string;
  executedAtUtc?: string;
  executedAtLocal?: string;
  errorMessage?: string;
}

interface ScheduleSkippedRun extends ScheduleRun {
  skippedBecauseStepId: string;
  skippedBecauseStepSequence: number;
}

interface OrchestrationRecipeManagerProps {
  orchestrations: Array<{ id: string; name: string }>;
}

export function OrchestrationRecipeManager({ orchestrations }: OrchestrationRecipeManagerProps) {
  /** Refreshed from GET /api/admin/orchestrations so the step dialog stays in sync after create/rename/delete on the same page. */
  const [orchestrationOptions, setOrchestrationOptions] =
    useState<Array<{ id: string; name: string }>>(orchestrations);

  const fetchOrchestrationOptions = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/orchestrations", { cache: "no-store" });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!Array.isArray(data)) return;
      setOrchestrationOptions(
        data.map((o: { id: string; name: string }) => ({ id: o.id, name: o.name }))
      );
    } catch (e) {
      console.error("Failed to refresh orchestrations for recipe manager", e);
    }
  }, []);

  const [recipes, setRecipes] = useState<OrchestrationRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRecipeDialogOpen, setIsRecipeDialogOpen] = useState(false);
  const [isStepDialogOpen, setIsStepDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<OrchestrationRecipe | null>(null);
  const [editingStep, setEditingStep] = useState<RecipeStep | null>(null);
  const [currentRecipeId, setCurrentRecipeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingRecipeId, setTogglingRecipeId] = useState<string | null>(null);
  const [isDeleteRecipeDialogOpen, setIsDeleteRecipeDialogOpen] = useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState<OrchestrationRecipe | null>(null);
  const [deleteRecipeLoading, setDeleteRecipeLoading] = useState(false);

  // Schedule preview state
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([]);
  const [scheduleSkippedRuns, setScheduleSkippedRuns] = useState<ScheduleSkippedRun[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
  const [scheduleRecipeName, setScheduleRecipeName] = useState("");
  const [scheduleGeneratedAt, setScheduleGeneratedAt] = useState<string | null>(null);

  // Recipe form state
  const [recipeName, setRecipeName] = useState("");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [recipeTimezone, setRecipeTimezone] = useState("UTC");
  const [recipeIsActive, setRecipeIsActive] = useState(false);

  // Step form state
  const [stepOrchestrationId, setStepOrchestrationId] = useState<string>("");
  const [stepSequence, setStepSequence] = useState<number>(1);
  const [stepInitialEnabled, setStepInitialEnabled] = useState(false);
  const [stepInitialRunType, setStepInitialRunType] = useState<"NOW" | "SCHEDULED">("NOW");
  const [stepInitialScheduleTime, setStepInitialScheduleTime] = useState("");
  const [stepHourlyInterval, setStepHourlyInterval] = useState<number | null>(null);
  const [stepDailyInterval, setStepDailyInterval] = useState<number | null>(null);
  const [stepDailyTime, setStepDailyTime] = useState("");
  const [stepSkipStepIds, setStepSkipStepIds] = useState<string[]>([]);

  useEffect(() => {
    fetchRecipes();
  }, []);

  useEffect(() => {
    void fetchOrchestrationOptions();
  }, [fetchOrchestrationOptions]);

  const fetchRecipes = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/orchestration-recipes");
      if (!response.ok) throw new Error("Failed to fetch recipes");
      const data = await response.json();
      setRecipes(data.recipes || []);
    } catch (error) {
      console.error("Error fetching recipes:", error);
      toast({
        title: "Error",
        description: "Failed to load recipes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetRecipeForm = () => {
    setRecipeName("");
    setRecipeDescription("");
    setRecipeTimezone("UTC");
    setRecipeIsActive(false);
    setEditingRecipe(null);
  };

  const resetStepForm = () => {
    setStepOrchestrationId("");
    setStepSequence(1);
    setStepInitialEnabled(false);
    setStepInitialRunType("NOW");
    setStepInitialScheduleTime("");
    setStepHourlyInterval(null);
    setStepDailyInterval(null);
    setStepDailyTime("");
    setEditingStep(null);
    setCurrentRecipeId(null);
    setStepSkipStepIds([]);
  };

  const resetSchedulePreview = () => {
    setScheduleRuns([]);
    setScheduleSkippedRuns([]);
    setScheduleError(null);
    setScheduleGeneratedAt(null);
    setScheduleRecipeName("");
    setScheduleTimezone("UTC");
  };

  const openCreateRecipeDialog = () => {
    resetRecipeForm();
    setIsRecipeDialogOpen(true);
  };

  const openEditRecipeDialog = (recipe: OrchestrationRecipe) => {
    setRecipeName(recipe.name);
    setRecipeDescription(recipe.description || "");
    setRecipeTimezone(recipe.timezone);
    setRecipeIsActive(recipe.is_active);
    setEditingRecipe(recipe);
    setIsRecipeDialogOpen(true);
  };

  const openCreateStepDialog = async (recipeId: string) => {
    await fetchOrchestrationOptions();
    resetStepForm();
    setCurrentRecipeId(recipeId);
    const recipe = recipes.find((r) => r.id === recipeId);
    if (recipe) {
      // Set sequence to next available (use max sequence + 1, not just length + 1)
      // This handles cases where steps were deleted and sequences have gaps
      const sequences = recipe.steps
        .map((s) =>
          typeof s.sequence === "number" ? s.sequence : parseInt(String(s.sequence), 10)
        )
        .filter((n) => !isNaN(n) && n > 0);
      const maxSequence = sequences.length > 0 ? Math.max(...sequences) : 0;
      const nextSequence = Math.min(maxSequence + 1, 1000); // Cap at 1000
      setStepSequence(nextSequence);
    } else {
      setStepSequence(1);
    }
    setIsStepDialogOpen(true);
  };

  const openEditStepDialog = async (step: RecipeStep) => {
    await fetchOrchestrationOptions();
    setStepOrchestrationId(step.orchestration_id);
    setStepSequence(step.sequence);
    setStepInitialEnabled(step.initial_enabled);
    setStepInitialRunType(step.initial_run_type || "NOW");
    setStepInitialScheduleTime(step.initial_schedule_time || "");
    setStepHourlyInterval(step.hourly_interval ?? null);
    setStepDailyInterval(step.daily_interval ?? null);
    setStepDailyTime(step.daily_time || "");
    setStepSkipStepIds(step.skipConfigurations?.map((cfg) => cfg.skip_step_id) || []);
    setEditingStep(step);
    setCurrentRecipeId(step.recipe_id);
    setIsStepDialogOpen(true);
  };

  const handleSaveRecipe = async () => {
    if (!recipeName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);
      const recipeData: any = {
        name: recipeName.trim(),
        timezone: recipeTimezone,
        is_active: recipeIsActive,
      };

      // Only include description if it has a value
      if (recipeDescription.trim()) {
        recipeData.description = recipeDescription.trim();
      }

      if (editingRecipe) {
        const response = await fetch(`/api/admin/orchestration-recipes/${editingRecipe.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipeData),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error("Recipe update error:", errorData);
          const errorMessage = errorData.details
            ? `${errorData.error}: ${JSON.stringify(errorData.details)}`
            : errorData.error || "Failed to update recipe";
          throw new Error(errorMessage);
        }
        toast({
          title: "Success",
          description: "Recipe updated successfully",
        });
      } else {
        const response = await fetch("/api/admin/orchestration-recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipeData),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error("Recipe creation error:", errorData);
          const errorMessage = errorData.details
            ? `${errorData.error}: ${JSON.stringify(errorData.details)}`
            : errorData.error || "Failed to create recipe";
          throw new Error(errorMessage);
        }
        toast({
          title: "Success",
          description: "Recipe created successfully",
        });
      }

      setIsRecipeDialogOpen(false);
      resetRecipeForm();
      fetchRecipes();
    } catch (error) {
      console.error("Error saving recipe:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save recipe",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStep = async () => {
    if (!currentRecipeId) {
      toast({
        title: "Validation Error",
        description: "Recipe ID is missing",
        variant: "destructive",
      });
      return;
    }

    if (!stepOrchestrationId) {
      toast({
        title: "Validation Error",
        description: "Orchestration is required",
        variant: "destructive",
      });
      return;
    }

    if (stepInitialEnabled && stepInitialRunType === "SCHEDULED" && !stepInitialScheduleTime) {
      toast({
        title: "Validation Error",
        description: "Initial scheduled time is required when initial run is set to Scheduled",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);
      // Ensure sequence is always a valid number
      const sequenceNum =
        typeof stepSequence === "number"
          ? Math.max(1, Math.min(stepSequence, 1000))
          : parseInt(String(stepSequence), 10);
      const finalSequence = isNaN(sequenceNum) || sequenceNum < 1 ? 1 : Math.min(sequenceNum, 1000);

      const stepPayload = {
        orchestration_id: stepOrchestrationId,
        sequence: finalSequence,
        initial_enabled: stepInitialEnabled,
        initial_run_type: stepInitialEnabled ? stepInitialRunType : "NOW",
        initial_schedule_time:
          (stepInitialEnabled && stepInitialRunType === "SCHEDULED") || stepHourlyInterval
            ? stepInitialScheduleTime || null
            : null,
        hourly_interval: stepHourlyInterval ?? null,
        daily_interval: stepDailyInterval ?? null,
        daily_time: stepDailyInterval ? stepDailyTime || null : null,
        skip_step_ids: stepSkipStepIds,
      };

      if (editingStep) {
        const response = await fetch(
          `/api/admin/orchestration-recipes/${currentRecipeId}/steps/${editingStep.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stepPayload),
          }
        );

        if (!response.ok) {
          let errorMessage = "Failed to update step";
          try {
            const errorData = await response.json();
            errorMessage = errorData.details
              ? `${errorData.error}: ${JSON.stringify(errorData.details)}`
              : errorData.error || errorMessage;
          } catch (parseError) {
            console.error("Error parsing update step response:", parseError);
          }
          throw new Error(errorMessage);
        }
      } else {
        const result = await createRecipeStepAction(currentRecipeId, stepPayload);

        if (!result.success) {
          throw new Error(result.error || "Failed to create step");
        }
      }

      toast({
        title: "Success",
        description: editingStep ? "Step updated successfully" : "Step added successfully",
      });

      setIsStepDialogOpen(false);
      resetStepForm();
      fetchRecipes();
    } catch (error) {
      console.error("Error saving step:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save step",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestSchedule = async (recipe: OrchestrationRecipe) => {
    resetSchedulePreview();
    setScheduleTimezone(recipe.timezone || "UTC");
    setScheduleRecipeName(recipe.name);
    setIsScheduleDialogOpen(true);
    setScheduleLoading(true);

    try {
      const result = await previewRecipeScheduleAction(recipe.id);
      if (!result.success) {
        throw new Error(result.error || "Failed to preview schedule");
      }

      setScheduleRuns(result.data.runs);
      setScheduleSkippedRuns(result.data.skipped);
      setScheduleGeneratedAt(result.data.generatedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to preview schedule";
      setScheduleError(message);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setScheduleLoading(false);
    }
  };

  const openDeleteRecipeDialog = (recipe: OrchestrationRecipe) => {
    setRecipeToDelete(recipe);
    setIsDeleteRecipeDialogOpen(true);
  };

  const closeDeleteRecipeDialog = () => {
    if (deleteRecipeLoading) return;
    setIsDeleteRecipeDialogOpen(false);
    setRecipeToDelete(null);
  };

  const handleDeleteRecipe = async () => {
    if (!recipeToDelete) return;
    setDeleteRecipeLoading(true);
    try {
      const response = await fetch(`/api/admin/orchestration-recipes/${recipeToDelete.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete recipe");

      toast({
        title: "Success",
        description: "Recipe deleted successfully",
      });
      fetchRecipes();
      closeDeleteRecipeDialog();
    } catch (error) {
      console.error("Error deleting recipe:", error);
      toast({
        title: "Error",
        description: "Failed to delete recipe",
        variant: "destructive",
      });
    } finally {
      setDeleteRecipeLoading(false);
    }
  };

  const handleDeleteStep = async (recipeId: string, stepId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this step? This will cancel all pending timer tasks for this step."
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/admin/orchestration-recipes/${recipeId}/steps/${stepId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete step");
      }

      toast({
        title: "Success",
        description: "Step deleted successfully",
      });

      // Check if Test Schedule dialog is open for this recipe before refreshing
      const needsScheduleRefresh = isScheduleDialogOpen && scheduleRecipeName;
      const recipeForSchedule = recipes.find((r) => r.id === recipeId);
      const shouldRefreshSchedule =
        needsScheduleRefresh && recipeForSchedule && scheduleRecipeName === recipeForSchedule.name;

      // Force refresh recipes to update the UI
      await fetchRecipes();

      // If the Test Schedule dialog is open for this recipe, recalculate the schedule
      // (after recipes are refreshed, the schedule should reflect the deleted step)
      if (shouldRefreshSchedule) {
        setScheduleLoading(true);
        try {
          const result = await previewRecipeScheduleAction(recipeId);
          if (result.success) {
            setScheduleRuns(result.data.runs);
            setScheduleSkippedRuns(result.data.skipped);
            setScheduleGeneratedAt(result.data.generatedAt);
            setScheduleError(null);
          } else {
            setScheduleError(result.error || "Failed to recalculate schedule");
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to recalculate schedule";
          setScheduleError(message);
        } finally {
          setScheduleLoading(false);
        }
      }
    } catch (error) {
      console.error("Error deleting step:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete step";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const currentRecipeForStep = currentRecipeId
    ? recipes.find((recipe) => recipe.id === currentRecipeId)
    : undefined;
  const availableSkipSteps = currentRecipeForStep
    ? currentRecipeForStep.steps.filter((step) => !editingStep || step.id !== editingStep.id)
    : [];

  const handleToggleRecipe = async (recipe: OrchestrationRecipe) => {
    const newStatus = !recipe.is_active;
    const action = newStatus ? "start" : "stop";

    setTogglingRecipeId(recipe.id);
    try {
      const response = await fetch(`/api/admin/orchestration-recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: newStatus }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${action} recipe`);
      }

      toast({
        title: "Success",
        description: `Recipe ${newStatus ? "started" : "stopped"} successfully`,
      });
      fetchRecipes();
    } catch (error) {
      console.error(`Error ${action}ing recipe:`, error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : `Failed to ${action} recipe`,
        variant: "destructive",
      });
    } finally {
      setTogglingRecipeId(null);
    }
  };

  const handleMoveStep = async (recipeId: string, stepId: string, direction: "up" | "down") => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    const step = recipe.steps.find((s) => s.id === stepId);
    if (!step) return;

    const newSequence = direction === "up" ? step.sequence - 1 : step.sequence + 1;

    if (newSequence < 1 || newSequence > recipe.steps.length) {
      return; // Can't move beyond bounds
    }

    try {
      const response = await fetch(`/api/admin/orchestration-recipes/${recipeId}/steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence: newSequence }),
      });

      if (!response.ok) throw new Error("Failed to reorder step");

      toast({
        title: "Success",
        description: "Step reordered successfully",
      });
      fetchRecipes();
    } catch (error) {
      console.error("Error reordering step:", error);
      toast({
        title: "Error",
        description: "Failed to reorder step",
        variant: "destructive",
      });
    }
  };

  const formatRelativeTime = (isoTimestamp: string) => {
    const targetMs = new Date(isoTimestamp).getTime();
    if (Number.isNaN(targetMs)) {
      return "";
    }
    const nowMs = Date.now();
    const diffMinutes = Math.round((targetMs - nowMs) / (60 * 1000));
    const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (Math.abs(diffMinutes) < 60) {
      return relativeFormatter.format(diffMinutes, "minute");
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
      return relativeFormatter.format(diffHours, "hour");
    }

    const diffDays = Math.round(diffHours / 24);
    return relativeFormatter.format(diffDays, "day");
  };

  const formatInTimezone = (isoTimestamp: string, timezone: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(isoTimestamp));
    } catch (error) {
      console.error("Failed to format timestamp", error);
      return new Date(isoTimestamp).toLocaleString();
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Orchestration Recipes</CardTitle>
            <Dialog open={isRecipeDialogOpen} onOpenChange={setIsRecipeDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreateRecipeDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Recipe
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingRecipe ? "Edit Recipe" : "Create Recipe"}</DialogTitle>
                  <DialogDescription>
                    {editingRecipe
                      ? "Update the recipe settings"
                      : "Create a new recipe to define orchestration sequences"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="recipeName">Name *</Label>
                    <Input
                      id="recipeName"
                      value={recipeName}
                      onChange={(e) => setRecipeName(e.target.value)}
                      placeholder="e.g., Daily Social Media Scrape"
                    />
                  </div>

                  <div>
                    <Label htmlFor="recipeDescription">Description</Label>
                    <Input
                      id="recipeDescription"
                      value={recipeDescription}
                      onChange={(e) => setRecipeDescription(e.target.value)}
                      placeholder="Optional description"
                    />
                  </div>

                  <div>
                    <Label htmlFor="recipeTimezone">Timezone</Label>
                    <select
                      id="recipeTimezone"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={recipeTimezone}
                      onChange={(e) => setRecipeTimezone(e.target.value)}
                    >
                      <option value="UTC">UTC (Coordinated Universal Time)</option>
                      <option value="America/Los_Angeles">
                        Pacific Time (America/Los_Angeles) - PST/PDT
                      </option>
                      <option value="America/New_York">
                        Eastern Time (America/New_York) - EST/EDT
                      </option>
                      <option value="America/Chicago">
                        Central Time (America/Chicago) - CST/CDT
                      </option>
                      <option value="America/Denver">
                        Mountain Time (America/Denver) - MST/MDT
                      </option>
                      <option value="Europe/London">London (Europe/London) - GMT/BST</option>
                      <option value="Europe/Paris">Paris (Europe/Paris) - CET/CEST</option>
                      <option value="Asia/Tokyo">Tokyo (Asia/Tokyo) - JST</option>
                      <option value="Asia/Shanghai">Shanghai (Asia/Shanghai) - CST</option>
                      <option value="Australia/Sydney">
                        Sydney (Australia/Sydney) - AEDT/AEST
                      </option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use IANA timezone format (e.g., America/Los_Angeles) for automatic DST
                      handling
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="recipeIsActive"
                      checked={recipeIsActive}
                      onCheckedChange={(checked) => setRecipeIsActive(checked === true)}
                    />
                    <Label htmlFor="recipeIsActive" className="font-normal cursor-pointer">
                      Active (generate timer tasks)
                    </Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsRecipeDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveRecipe} disabled={isSaving}>
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingRecipe ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {recipes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No recipes configured</p>
              <p className="text-sm">Create a recipe to define orchestration sequences</p>
            </div>
          ) : (
            <div className="space-y-6">
              {recipes.map((recipe) => (
                <Card key={recipe.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{recipe.name}</CardTitle>
                        {recipe.description && (
                          <p className="text-sm text-muted-foreground mt-1">{recipe.description}</p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {recipe.is_active ? (
                          <Badge className="bg-green-500">
                            <Play className="h-3 w-3 mr-1" />
                            Running
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Pause className="h-3 w-3 mr-1" />
                            Stopped
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestSchedule(recipe)}
                          disabled={scheduleLoading && scheduleRecipeName === recipe.name}
                        >
                          <Clock className="h-4 w-4 mr-1" />
                          Test Schedule
                        </Button>
                        <Button
                          variant={recipe.is_active ? "outline" : "default"}
                          size="sm"
                          onClick={() => handleToggleRecipe(recipe)}
                          disabled={togglingRecipeId === recipe.id || isSaving}
                        >
                          {togglingRecipeId === recipe.id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              {recipe.is_active ? "Stopping..." : "Starting..."}
                            </>
                          ) : recipe.is_active ? (
                            <>
                              <Pause className="h-4 w-4 mr-1" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-1" />
                              Start
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditRecipeDialog(recipe)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteRecipeDialog(recipe)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label>Orchestration Steps ({recipe.steps.length})</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openCreateStepDialog(recipe.id)}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Step
                        </Button>
                      </div>

                      {recipe.steps.length === 0 ? (
                        <div className="text-center py-4 text-sm text-muted-foreground">
                          No steps configured. Add steps to define the orchestration sequence.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">#</TableHead>
                              <TableHead>Orchestration</TableHead>
                              <TableHead>Timing</TableHead>
                              <TableHead>Pending Tasks</TableHead>
                              <TableHead className="w-32">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recipe.steps.map((step, index) => (
                              <TableRow key={step.id}>
                                <TableCell>
                                  <div className="flex items-center space-x-1">
                                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">{step.sequence}</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{step.orchestration.name}</div>
                                    {step.orchestration.description && (
                                      <div className="text-sm text-muted-foreground">
                                        {step.orchestration.description}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    {step.initial_enabled && (
                                      <Badge variant="outline" className="mr-1">
                                        <Play className="h-3 w-3 mr-1" />
                                        {step.initial_run_type === "SCHEDULED" &&
                                        step.initial_schedule_time
                                          ? `Start @ ${step.initial_schedule_time}`
                                          : "Start Now"}
                                      </Badge>
                                    )}
                                    {step.hourly_interval && (
                                      <Badge variant="outline" className="mr-1">
                                        <Clock className="h-3 w-3 mr-1" />
                                        Every {step.hourly_interval}h
                                      </Badge>
                                    )}
                                    {step.daily_interval && (
                                      <Badge variant="outline">
                                        <Calendar className="h-3 w-3 mr-1" />
                                        Every {step.daily_interval}d @ {step.daily_time}
                                      </Badge>
                                    )}
                                    {!step.initial_enabled &&
                                      !step.hourly_interval &&
                                      !step.daily_interval && (
                                        <span className="text-sm text-muted-foreground">
                                          No timing configured
                                        </span>
                                      )}
                                    {step.skipConfigurations &&
                                      step.skipConfigurations.length > 0 && (
                                        <div className="text-xs text-muted-foreground">
                                          Skips if overlapping:{" "}
                                          {step.skipConfigurations
                                            .map((cfg) => {
                                              const target = cfg.skipStep;
                                              if (!target) return "Unknown step";
                                              return `Step ${target.sequence} (${target.orchestration.name})`;
                                            })
                                            .join(", ")}
                                        </div>
                                      )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{step._count.timerTasks}</Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center space-x-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleMoveStep(recipe.id, step.id, "up")}
                                      disabled={index === 0}
                                      title="Move up"
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleMoveStep(recipe.id, step.id, "down")}
                                      disabled={index === recipe.steps.length - 1}
                                      title="Move down"
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEditStepDialog(step)}
                                      title="Edit"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteStep(recipe.id, step.id)}
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step Dialog */}
      <Dialog open={isStepDialogOpen} onOpenChange={setIsStepDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingStep ? "Edit Step" : "Add Step"}</DialogTitle>
            <DialogDescription>
              {editingStep
                ? "Update the step configuration"
                : "Add an orchestration step to the recipe sequence"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="stepOrchestration">Orchestration *</Label>
              <select
                id="stepOrchestration"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={stepOrchestrationId}
                onChange={(e) => setStepOrchestrationId(e.target.value)}
              >
                <option value="">Select an orchestration</option>
                {orchestrationOptions.map((orch) => (
                  <option key={orch.id} value={orch.id}>
                    {orch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="stepSequence">Sequence Position *</Label>
              <Input
                id="stepSequence"
                type="number"
                min="1"
                max="1000"
                value={typeof stepSequence === "number" ? stepSequence : ""}
                onChange={(e) => {
                  const inputValue = e.target.value;

                  // If empty, set to 1
                  if (inputValue === "" || inputValue === null || inputValue === undefined) {
                    setStepSequence(1);
                    return;
                  }

                  // Parse as integer - this prevents string concatenation
                  const numValue = parseInt(inputValue, 10);

                  // Only update if it's a valid number within range
                  if (!isNaN(numValue) && numValue >= 1 && numValue <= 1000) {
                    setStepSequence(numValue);
                  }
                  // If invalid, don't update (prevents weird values)
                }}
                onBlur={(e) => {
                  // On blur, ensure we have a valid number
                  const numValue = parseInt(e.target.value, 10);
                  if (isNaN(numValue) || numValue < 1 || numValue > 1000) {
                    setStepSequence(1);
                  } else {
                    setStepSequence(numValue);
                  }
                }}
                placeholder="1, 2, 3..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Position in the recipe sequence (1 = first, 2 = second, etc.)
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="stepInitial"
                    checked={stepInitialEnabled}
                    onCheckedChange={(checked) => setStepInitialEnabled(checked === true)}
                  />
                  <Label htmlFor="stepInitial" className="font-normal cursor-pointer">
                    Start Now (runs once immediately when the recipe is active)
                  </Label>
                </div>
                {stepInitialEnabled && (
                  <div className="ml-6 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Initial Run Timing</Label>
                      <Select
                        value={stepInitialRunType}
                        onValueChange={(value) =>
                          setStepInitialRunType(value as "NOW" | "SCHEDULED")
                        }
                      >
                        <SelectTrigger className="w-60">
                          <SelectValue placeholder="Choose timing" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NOW">
                            Start immediately when the recipe starts
                          </SelectItem>
                          <SelectItem value="SCHEDULED">Schedule at a specific time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {stepInitialRunType === "SCHEDULED" && (
                      <div className="space-y-1">
                        <Label htmlFor="initialScheduleTime" className="text-sm font-medium">
                          Scheduled Time (HH:MM)
                        </Label>
                        <Input
                          id="initialScheduleTime"
                          type="time"
                          value={stepInitialScheduleTime}
                          onChange={(e) => setStepInitialScheduleTime(e.target.value)}
                          className="w-40"
                        />
                        <p className="text-xs text-muted-foreground">
                          The initial run will execute at the next occurrence of this time in the
                          recipe&apos;s timezone.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-l-2 pl-4 space-y-2">
                <Label>Hourly Interval</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    min="1"
                    max="23"
                    placeholder="Hours (1-23)"
                    value={stepHourlyInterval || ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      if (val === null || (val >= 1 && val <= 23)) {
                        setStepHourlyInterval(val);
                      }
                    }}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
                {stepHourlyInterval && (
                  <div className="space-y-1 mt-2">
                    <Label htmlFor="hourlyStartTime" className="text-sm font-medium">
                      Start Time (HH:MM)
                    </Label>
                    <Input
                      id="hourlyStartTime"
                      type="time"
                      value={stepInitialScheduleTime}
                      onChange={(e) => setStepInitialScheduleTime(e.target.value)}
                      className="w-40"
                    />
                    <p className="text-xs text-muted-foreground">
                      The first hourly run will execute at this time, then repeat every{" "}
                      {stepHourlyInterval} hour(s).
                    </p>
                  </div>
                )}
                {!stepHourlyInterval && (
                  <p className="text-xs text-muted-foreground">
                    Leave empty to disable hourly runs
                  </p>
                )}
              </div>

              <div className="border-l-2 pl-4 space-y-2">
                <Label>Daily Interval</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    placeholder="Days (1-100)"
                    value={stepDailyInterval || ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      if (val === null || (val >= 1 && val <= 100)) {
                        setStepDailyInterval(val);
                      }
                    }}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">Leave empty to disable daily runs</p>
                <Input
                  type="time"
                  value={stepDailyTime}
                  onChange={(e) => setStepDailyTime(e.target.value)}
                  className="w-40"
                  disabled={!stepDailyInterval}
                />
                <p className="text-xs text-muted-foreground">
                  Time of day for daily runs (recipe timezone)
                </p>
              </div>

              {availableSkipSteps.length > 0 && (
                <div className="border-l-2 pl-4 space-y-2">
                  <Label>Skip when overlapping with</Label>
                  <p className="text-xs text-muted-foreground">
                    If this step is scheduled at the same time as any selected steps, it will be
                    cancelled.
                  </p>
                  <div className="space-y-2">
                    {availableSkipSteps.map((stepOption) => {
                      const optionId = `skip-step-${stepOption.id}`;
                      const checked = stepSkipStepIds.includes(stepOption.id);
                      return (
                        <div className="flex items-center space-x-2" key={stepOption.id}>
                          <Checkbox
                            id={optionId}
                            checked={checked}
                            onCheckedChange={(value) => {
                              setStepSkipStepIds((prev) => {
                                const isChecked = value === true;
                                if (isChecked) {
                                  if (prev.includes(stepOption.id)) return prev;
                                  return [...prev, stepOption.id];
                                }
                                return prev.filter((id) => id !== stepOption.id);
                              });
                            }}
                          />
                          <Label htmlFor={optionId} className="font-normal cursor-pointer">
                            Step {stepOption.sequence}: {stepOption.orchestration.name}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStepDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveStep} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingStep ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Preview Dialog */}
      <Dialog
        open={isScheduleDialogOpen}
        onOpenChange={(open) => {
          setIsScheduleDialogOpen(open);
          if (!open) {
            setScheduleLoading(false);
            resetSchedulePreview();
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule Preview</DialogTitle>
            <DialogDescription>
              Next 100 runs for &quot;{scheduleRecipeName}&quot; ({scheduleTimezone})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {scheduleLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : scheduleError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                {scheduleError}
              </div>
            ) : (
              <>
                {/* Check if recipe is inactive - if so, show warning about CANCELLED tasks */}
                {recipes.find((r) => r.name === scheduleRecipeName)?.is_active === false && (
                  <div className="rounded-md border border-yellow-300/70 bg-yellow-100/40 p-4 text-sm text-yellow-900">
                    <div className="font-medium mb-2">⚠️ Recipe is Inactive</div>
                    <div className="text-sm">
                      This recipe is currently <strong>inactive</strong>. When a recipe is
                      deactivated, all PENDING timer tasks are automatically set to{" "}
                      <strong>CANCELLED</strong>.
                      <br />
                      <br />
                      To see an active schedule, please <strong>activate the recipe</strong> first.
                      Activating the recipe will generate new timer tasks based on the current
                      configuration.
                    </div>
                  </div>
                )}
                {(() => {
                  const filteredRuns = scheduleRuns.filter((run) => run.status !== "CANCELLED");
                  return filteredRuns.length === 0 ? (
                    <div className="rounded-md border border-dashed border-muted p-6 text-center text-sm text-muted-foreground">
                      {recipes.find((r) => r.name === scheduleRecipeName)?.is_active === false
                        ? "No active tasks found (recipe is inactive). Activate the recipe to generate timer tasks."
                        : "No upcoming runs were generated from the current configuration."}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Step</TableHead>
                            <TableHead>Orchestration</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Scheduled Time</TableHead>
                            <TableHead>Executed Time</TableHead>
                            <TableHead>Relative</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRuns.map((run, index) => {
                            const statusColors: Record<string, string> = {
                              PENDING: "bg-blue-100 text-blue-800",
                              EXECUTED: "bg-green-100 text-green-800",
                              FAILED: "bg-red-100 text-red-800",
                              CANCELLED: "bg-gray-100 text-gray-800",
                              SKIPPED: "bg-yellow-100 text-yellow-800",
                            };
                            const statusColor =
                              statusColors[run.status] || "bg-gray-100 text-gray-800";

                            return (
                              <TableRow
                                key={`${run.stepId}-${run.taskType}-${run.scheduledAtUtc}-${index}`}
                              >
                                <TableCell>{index + 1}</TableCell>
                                <TableCell>
                                  <div className="font-medium">Step {run.stepSequence}</div>
                                </TableCell>
                                <TableCell>{run.orchestrationName}</TableCell>
                                <TableCell className="capitalize">{run.taskType}</TableCell>
                                <TableCell>
                                  <Badge className={statusColor}>{run.status}</Badge>
                                  {run.errorMessage && (
                                    <div
                                      className="text-xs text-muted-foreground mt-1 max-w-xs truncate"
                                      title={run.errorMessage}
                                    >
                                      {run.errorMessage}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm font-medium">{run.scheduledAtLocal}</div>
                                </TableCell>
                                <TableCell>
                                  {run.executedAtLocal ? (
                                    <div className="text-sm font-medium">{run.executedAtLocal}</div>
                                  ) : (
                                    <div className="text-sm text-muted-foreground">—</div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm text-muted-foreground">
                                    {formatRelativeTime(run.scheduledAtUtc)}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>

                      {scheduleSkippedRuns.length > 0 && (
                        <div className="rounded-md border border-yellow-300/70 bg-yellow-100/40 p-4 text-sm text-yellow-900">
                          <div className="font-medium mb-2">Skipped due to conflicts</div>
                          <ul className="space-y-1">
                            {scheduleSkippedRuns.map((skippedRun, idx) => (
                              <li key={`${skippedRun.stepId}-skipped-${idx}`}>
                                Step {skippedRun.stepSequence} ({skippedRun.orchestrationName}) at{" "}
                                {skippedRun.scheduledAtLocal} skipped because it overlaps with step{" "}
                                {skippedRun.skippedBecauseStepSequence}.
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {scheduleGeneratedAt && (
              <div className="text-xs text-muted-foreground">
                Generated at {formatInTimezone(scheduleGeneratedAt, scheduleTimezone)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsScheduleDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteRecipeDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteRecipeDialog();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the recipe{recipeToDelete ? ` "${recipeToDelete.name}"` : ""}, remove
              all of its steps, and cancel any pending timer tasks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteRecipeDialog} disabled={deleteRecipeLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecipe}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteRecipeLoading}
            >
              {deleteRecipeLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
