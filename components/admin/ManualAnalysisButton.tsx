"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ManualAnalysisButtonProps {
  projectId: string;
  variant?: "default" | "outline";
  size?: "default" | "sm" | "lg";
  skipSentiment?: boolean;
  label?: string;
}

export function ManualAnalysisButton({
  projectId,
  variant = "default",
  size = "default",
  skipSentiment = false,
  label,
}: ManualAnalysisButtonProps) {
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  async function handleRunAnalysis() {
    setRunning(true);
    try {
      const response = await fetch("/api/admin/run-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId, skipSentiment }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to run analysis");
      }

      toast({
        title: "Analysis Complete!",
        description: `Conversations: ${data.stats?.conversations || 0}, Sentiment: ${data.stats?.sentimentAnalyzed || 0}, Network: ${data.stats?.influentialPeople || 0}, News: ${data.stats?.newsItems || 0}, Themes: ${data.stats?.themesMatched || 0}`,
      });

      // Reload the page to show new data
      window.location.reload();
    } catch (error) {
      console.error("Error running analysis:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to run analysis",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button onClick={handleRunAnalysis} disabled={running} variant={variant} size={size}>
      {running ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Analyzing...
        </>
      ) : (
        <>
          <Play className="mr-2 h-4 w-4" />
          {label || "Run Analysis"}
        </>
      )}
    </Button>
  );
}
