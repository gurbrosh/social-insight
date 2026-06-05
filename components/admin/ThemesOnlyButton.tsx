"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export function ThemesOnlyButton({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/admin/run-themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      console.log("Themes-only response", await res.json());
    } catch (e) {
      console.error("Run themes-only failed", e);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleRun} disabled={running}>
      {running ? (
        <>Analyzing Themes…</>
      ) : (
        <>
          <Play className="mr-2 h-4 w-4" /> Run Themes Only
        </>
      )}
    </Button>
  );
}
