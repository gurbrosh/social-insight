"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Zap } from "lucide-react";

export function TaskBasedAnalysisToggle() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/config");
      const data = await response.json();
      if (data.success) {
        const raw = data.config?.performance?.use_task_based_analysis?.value;
        // Default on: matches task-based pipeline; only show Off when explicitly false in config.
        setEnabled(raw !== false);
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to load analysis mode setting",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    try {
      setSaving(true);
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "performance",
          key: "use_task_based_analysis",
          value: checked,
          dataType: "boolean",
        }),
      });
      const data = await response.json();
      if (data.success) {
        setEnabled(checked);
        toast({
          title: "Updated",
          description: checked
            ? "Task-based analysis enabled. New runs will use per-record tasks."
            : "Cursor-based analysis enabled. New runs will use the legacy path.",
        });
      } else {
        throw new Error(data.error || "Failed to update");
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to update analysis mode",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Analysis Mode</CardTitle>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Task-Based Analysis</CardTitle>
        <Zap className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-2">
          <Switch
            id="task-based-analysis"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving}
          />
          <Label htmlFor="task-based-analysis" className="text-sm font-normal">
            {enabled ? "On" : "Off"}
          </Label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {enabled
            ? "Uses per-record tasks for better throughput. Requires ingested_run_id stamping."
            : "Uses cursor-based AnalysisProgress (legacy)."}
        </p>
      </CardContent>
    </Card>
  );
}
