"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resetProjectAnalysisAction } from "@/app/actions/reset-project-analysis";

interface ResetAnalysisButtonProps {
  projectId: string;
  projectName?: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  onReset?: () => void;
  disabled?: boolean;
}

export function ResetAnalysisButton({
  projectId,
  projectName,
  variant = "destructive",
  size = "sm",
  onReset,
  disabled = false,
}: ResetAnalysisButtonProps) {
  const [isResetting, setIsResetting] = useState(false);
  const { toast } = useToast();

  async function handleReset() {
    if (!projectId) {
      toast({
        title: "Select a project",
        variant: "destructive",
        description: "Choose a project before resetting analysis.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Reset analysis progress for "${projectName || projectId}"?\n\nThis will remove all Network, Chatter, Themes, News, and Brand analysis records associated with this project and reset its analysis cursor to 0.`
    );

    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    try {
      const result = await resetProjectAnalysisAction(projectId);

      if (!result.success) {
        throw new Error(result.error || "Failed to reset analysis progress");
      }

      toast({
        title: "Analysis Reset",
        description: `Removed ${result.deleted.chatter} chatter, ${result.deleted.network} network, ${result.deleted.themes} theme, ${result.deleted.news} news, ${result.deleted.brand} brand records.`,
      });

      if (onReset) {
        onReset();
      }
    } catch (error) {
      console.error("Error resetting analysis progress:", error);
      toast({
        title: "Error",
        variant: "destructive",
        description: error instanceof Error ? error.message : "Failed to reset analysis progress",
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <Button onClick={handleReset} variant={variant} size={size} disabled={isResetting || disabled}>
      {isResetting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Resetting...
        </>
      ) : (
        <>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset Analysis
        </>
      )}
    </Button>
  );
}
