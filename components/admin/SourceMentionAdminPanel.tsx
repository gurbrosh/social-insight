"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Trash2, Download, Loader2, Database } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type SourceMentionAdminPanelProps = {
  /** e.g. refresh Database Viewer table data after delete/export */
  onAfterMutation?: () => void;
};

export function SourceMentionAdminPanel({ onAfterMutation }: SourceMentionAdminPanelProps = {}) {
  const router = useRouter();
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refreshCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const res = await fetch("/api/admin/source-mentions");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load count");
      setActiveCount(typeof data.activeCount === "number" ? data.activeCount : 0);
    } catch (e) {
      setActiveCount(null);
      toast({
        title: "Could not load count",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingCount(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/admin/source-mentions/export");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition");
      const match = dispo?.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `source-mentions-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export started", description: `Saved as ${filename}` });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setConfirmOpen(false);
    try {
      const res = await fetch("/api/admin/source-mentions", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Clear failed");
      toast({
        title: "SourceMention cleared",
        description: `Removed ${data.deleted ?? 0} row(s) permanently.`,
      });
      await refreshCount();
      router.refresh();
      onAfterMutation?.();
    } catch (e) {
      toast({
        title: "Clear failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>SourceMention (HN ingest)</CardTitle>
              <CardDescription>
                Rows written by Hacker News Algolia ingest (custom task tests and scheduled runs).
                Export first if you need a backup. Delete all removes rows permanently so they
                disappear from the Database Viewer.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground mr-auto">
            Rows:{" "}
            {loadingCount ? (
              <Loader2 className="inline h-4 w-4 animate-spin" />
            ) : (
              <span className="font-medium text-foreground">{activeCount ?? "—"}</span>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || loadingCount || activeCount === 0}
            onClick={() => void handleExport()}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={clearing || loadingCount || activeCount === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {clearing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete all
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all SourceMention rows?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every row in SourceMention ({activeCount ?? "…"}). New
              ingests will insert fresh rows. Export a CSV first if you need a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleClear()}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
