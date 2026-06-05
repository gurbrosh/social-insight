"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BlogAnalysisExportButtonProps {
  projectId: string;
}

export function BlogAnalysisExportButton({ projectId }: BlogAnalysisExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/blog-analysis/export`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^";\n]+)"?/);
      const filename = match?.[1] ?? `BlogNewsAnalysis-${projectId.slice(-8)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Download started",
        description: "Blog analysis CSV is downloading.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not download CSV",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading}
      className="shrink-0"
    >
      <Download className="h-4 w-4 mr-2" />
      {loading ? "Preparing…" : "Download blog analysis (CSV)"}
    </Button>
  );
}
