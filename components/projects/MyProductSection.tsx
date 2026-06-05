"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import type { MyProductSummaryJson } from "@/lib/my-product/summary-types";
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

type DocRow = {
  id: string;
  original_filename: string;
  byte_size: number | null;
  content_type: string | null;
  created_at: Date | string;
};

function summaryToForm(s: MyProductSummaryJson | null): {
  highLevel: string;
  ideasLines: string;
  differentiators: string;
  intendedClients: string;
} {
  if (!s) {
    return { highLevel: "", ideasLines: "", differentiators: "", intendedClients: "" };
  }
  return {
    highLevel: s.highLevelDescription,
    ideasLines: s.keyInnovativeIdeas.join("\n"),
    differentiators: s.differentiators ?? "",
    intendedClients: s.intendedClients ?? "",
  };
}

function formToSummary(f: {
  highLevel: string;
  ideasLines: string;
  differentiators: string;
  intendedClients: string;
}): MyProductSummaryJson {
  const ideas = f.ideasLines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    highLevelDescription: f.highLevel.trim(),
    keyInnovativeIdeas: ideas,
    differentiators: f.differentiators.trim() ? f.differentiators.trim() : null,
    intendedClients: f.intendedClients.trim() ? f.intendedClients.trim() : null,
  };
}

interface MyProductSectionProps {
  projectId: string;
  initialProductName: string;
  initialFocus: string;
  initialUrls: string[];
  initialDocuments: DocRow[];
  initialSummary: MyProductSummaryJson | null;
  initialSummaryUpdatedAt: string | null;
}

export function MyProductSection({
  projectId,
  initialProductName,
  initialFocus,
  initialUrls,
  initialDocuments,
  initialSummary,
  initialSummaryUpdatedAt,
}: MyProductSectionProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productName, setProductName] = useState(initialProductName);
  const [focusText, setFocusText] = useState(initialFocus);
  const [urls, setUrls] = useState<string[]>(initialUrls.length > 0 ? initialUrls : [""]);
  const [documents, setDocuments] = useState<DocRow[]>(initialDocuments);

  const [highLevel, setHighLevel] = useState(() => summaryToForm(initialSummary).highLevel);
  const [ideasLines, setIdeasLines] = useState(() => summaryToForm(initialSummary).ideasLines);
  const [diffText, setDiffText] = useState(() => summaryToForm(initialSummary).differentiators);
  const [clientsText, setClientsText] = useState(
    () => summaryToForm(initialSummary).intendedClients
  );
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<string | null>(initialSummaryUpdatedAt);

  const [materialsSaving, setMaterialsSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summarySaving, setSummarySaving] = useState(false);

  const [summaryDirty, setSummaryDirty] = useState(false);
  const [confirmSummarizeOpen, setConfirmSummarizeOpen] = useState(false);

  useEffect(() => {
    setProductName(initialProductName);
    setFocusText(initialFocus);
    setUrls(initialUrls.length > 0 ? initialUrls : [""]);
    setDocuments(initialDocuments);
    const f = summaryToForm(initialSummary);
    setHighLevel(f.highLevel);
    setIdeasLines(f.ideasLines);
    setDiffText(f.differentiators);
    setClientsText(f.intendedClients);
    setSummaryUpdatedAt(initialSummaryUpdatedAt);
    setSummaryDirty(false);
  }, [
    initialProductName,
    initialFocus,
    initialUrls,
    initialDocuments,
    initialSummary,
    initialSummaryUpdatedAt,
    projectId,
  ]);

  const trackSummaryEdit = useCallback(() => {
    setSummaryDirty(true);
  }, []);

  const saveMaterials = async (): Promise<boolean> => {
    const urlList = urls.map((u) => u.trim()).filter(Boolean);
    setMaterialsSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/my-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          my_product_name: productName.trim() || null,
          my_product_focus_text: focusText.trim() || null,
          my_product_reference_urls: urlList,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      }
      toast({ title: "Saved", description: "My Product details updated." });
      return true;
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Could not save",
        variant: "destructive",
      });
      return false;
    } finally {
      setMaterialsSaving(false);
    }
  };

  const saveSummary = async () => {
    const summary = formToSummary({
      highLevel,
      ideasLines,
      differentiators: diffText,
      intendedClients: clientsText,
    });
    setSummarySaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/my-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ my_product_summary: summary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      }
      setSummaryDirty(false);
      setSummaryUpdatedAt(new Date().toISOString());
      toast({ title: "Saved", description: "Product summary updated." });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Could not save summary",
        variant: "destructive",
      });
    } finally {
      setSummarySaving(false);
    }
  };

  const runSummarize = async () => {
    const saved = await saveMaterials();
    if (!saved) return;
    setSummarizing(true);
    setConfirmSummarizeOpen(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/my-product/summarize`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Summarize failed");
      }
      const s = data.summary as MyProductSummaryJson | undefined;
      if (s) {
        const f = summaryToForm(s);
        setHighLevel(f.highLevel);
        setIdeasLines(f.ideasLines);
        setDiffText(f.differentiators);
        setClientsText(f.intendedClients);
        setSummaryDirty(false);
        setSummaryUpdatedAt(new Date().toISOString());
      }
      const warnings = data.warnings as string[] | undefined;
      toast({
        title: "Summary ready",
        description:
          warnings && warnings.length > 0
            ? `Generated with notes: ${warnings.slice(0, 2).join("; ")}${warnings.length > 2 ? "…" : ""}`
            : "Structured summary generated from your materials.",
      });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Summarization failed",
        variant: "destructive",
      });
    } finally {
      setSummarizing(false);
    }
  };

  const onSummarizeClick = () => {
    if (summaryDirty) {
      setConfirmSummarizeOpen(true);
      return;
    }
    void runSummarize();
  };

  const addUrlRow = () => setUrls((u) => [...u, ""]);
  const removeUrlRow = (i: number) => setUrls((u) => u.filter((_, j) => j !== i));

  const onUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/my-product/documents`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      }
      if (data.document) {
        setDocuments((d) => [...d, data.document]);
      }
      toast({ title: "Uploaded", description: file.name });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Could not upload",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (docId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/my-product/documents/${docId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Delete failed");
      }
      setDocuments((d) => d.filter((x) => x.id !== docId));
      toast({ title: "Removed", description: "Document removed." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not remove",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>My product</CardTitle>
          <CardDescription>
            Describe what your product is focused on, add reference URLs and documents, then run
            Summarize to build a structured overview. Save materials before summarizing if you
            changed them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="my-product-name">Product name</Label>
            <Textarea
              id="my-product-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              rows={2}
              placeholder="Name of your product or offering as you want it referred to…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="my-product-focus">Product focus</Label>
            <Textarea
              id="my-product-focus"
              value={focusText}
              onChange={(e) => setFocusText(e.target.value)}
              rows={5}
              placeholder="What your product does, who it serves, and what problems it addresses…"
            />
          </div>

          <div className="space-y-2">
            <Label>Reference URLs</Label>
            <p className="text-xs text-muted-foreground">
              Pages that describe your product (https only).
            </p>
            <div className="space-y-2">
              {urls.map((u, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={u}
                    onChange={(e) =>
                      setUrls((prev) => {
                        const next = [...prev];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="https://…"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeUrlRow(i)}
                    disabled={urls.length <= 1}
                    aria-label="Remove URL"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addUrlRow}>
                <Plus className="mr-2 h-4 w-4" />
                Add URL
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Documents</Label>
            <p className="text-xs text-muted-foreground">
              txt, md, pdf, docx, or html — max 15MB each.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.pdf,.docx,.html,.htm,text/plain,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onUploadChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload file
            </Button>
            {documents.length > 0 && (
              <ul className="text-sm border rounded-md divide-y">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate">{d.original_filename}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive shrink-0"
                      onClick={() => void deleteDoc(d.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveMaterials()} disabled={materialsSaving}>
              {materialsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save product details
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onSummarizeClick}
              disabled={summarizing}
            >
              {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Summarize
            </Button>
          </div>

          <div className="space-y-4 border-t pt-6">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-base">Structured summary</Label>
              {summaryUpdatedAt && (
                <span className="text-xs text-muted-foreground">
                  Last updated: {new Date(summaryUpdatedAt).toLocaleString()}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sum-high">High-level description</Label>
              <Textarea
                id="sum-high"
                value={highLevel}
                onChange={(e) => {
                  setHighLevel(e.target.value);
                  trackSummaryEdit();
                }}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sum-ideas">Key innovative ideas</Label>
              <Textarea
                id="sum-ideas"
                value={ideasLines}
                onChange={(e) => {
                  setIdeasLines(e.target.value);
                  trackSummaryEdit();
                }}
                rows={5}
                placeholder="One idea per line"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sum-diff">Product differentiators</Label>
              <Textarea
                id="sum-diff"
                value={diffText}
                onChange={(e) => {
                  setDiffText(e.target.value);
                  trackSummaryEdit();
                }}
                rows={3}
                placeholder="Leave blank if unclear"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sum-clients">Intended clients</Label>
              <Textarea
                id="sum-clients"
                value={clientsText}
                onChange={(e) => {
                  setClientsText(e.target.value);
                  trackSummaryEdit();
                }}
                rows={3}
                placeholder="Leave blank if unclear"
              />
            </div>
            <Button
              type="button"
              onClick={() => void saveSummary()}
              disabled={summarySaving || !summaryDirty}
            >
              {summarySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save summary edits
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmSummarizeOpen} onOpenChange={setConfirmSummarizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate summary?</AlertDialogTitle>
            <AlertDialogDescription>
              Summarize will replace the structured summary with new AI-generated text. Unsaved
              edits in the summary fields will be lost unless you cancel and save first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSummarize()}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
