"use client";

import { useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MonitoringFocusFieldProps {
  value: string;
  onChange: (value: string) => void;
  projectId?: string;
  keywords?: string[];
}

export function MonitoringFocusField({
  value,
  onChange,
  projectId,
  keywords = [],
}: MonitoringFocusFieldProps) {
  const [isReviewing, setIsReviewing] = useState(false);
  const [suggestion, setSuggestion] = useState<string>("");
  const lastRequestedRef = useRef<number>(0);

  const handleReview = useCallback(async () => {
    const text = value.trim();
    if (!text) {
      setSuggestion("");
      return;
    }
    setIsReviewing(true);
    lastRequestedRef.current = Date.now();
    try {
      const response = await fetch("/api/projects/analyze-focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focusText: text, projectId, keywords, rewrite: true }),
      });
      if (!response.ok) {
        setSuggestion("");
        return;
      }
      const data = await response.json();
      const rewritten = (data?.rewrittenText || "").trim();
      setSuggestion(rewritten);
    } catch {
      setSuggestion("");
    } finally {
      setIsReviewing(false);
    }
  }, [value, projectId, keywords]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="monitoring_focus">
          Monitoring Focus <span className="text-muted-foreground">(Recommended)</span>
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleReview}
          disabled={isReviewing || value.trim().length === 0}
        >
          {isReviewing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Reviewing...
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              Review with AI
            </>
          )}
        </Button>
      </div>

      <Textarea
        id="monitoring_focus"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe what you're specifically looking for. Be concise and concrete."
        rows={4}
      />

      {suggestion && (
        <div className="pt-2 border-t">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            AI suggestion
          </div>
          <div className={cn("rounded-md border p-3 text-sm bg-muted/30")}>{suggestion}</div>
        </div>
      )}
    </div>
  );
}
