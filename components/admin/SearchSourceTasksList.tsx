"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Settings,
  Play,
  Trash2,
  MoreHorizontal,
  Loader2,
  Download,
  ChevronDown,
  StopCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { BRAND_BLOG_SUMMARY_PROMPT } from "@/lib/brand-blog-summary-prompt";

type TaskTiming = "LAST_HOUR" | "LAST_DAY" | "LAST_7_DAYS" | "LAST_WEEK";
type TaskTarget =
  | "Post"
  | "DownstreamPost"
  | "BrandBlogNews"
  | "Scraper"
  | "HackerNews"
  | "GithubReader";

type TimingDurationUnit = "day" | "week" | "month";

interface SearchSourceTask {
  id: string;
  name: string;
  description: string | null;
  timing_definition: TaskTiming;
  timing_duration_number: number | null;
  timing_duration_unit: string | null;
  openai_prompt_text: string | null;
  target: TaskTarget;
  is_active: boolean;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

const TIMING_LABELS: Record<TaskTiming, string> = {
  LAST_HOUR: "Last hour",
  LAST_DAY: "Last day",
  LAST_7_DAYS: "Last 7 days",
  LAST_WEEK: "Last week",
};

const DURATION_UNIT_LABELS: Record<TimingDurationUnit, string> = {
  day: "days",
  week: "weeks",
  month: "months",
};

/** Only for tasks backed by the search-source runner (not part of the abstract custom-task contract). */
const TARGET_LABELS: Record<TaskTarget, string> = {
  Post: "Posts",
  DownstreamPost: "Downstream posts",
  BrandBlogNews: "Brand blog / news",
  Scraper: "Scraper output",
  HackerNews: "Hacker News",
  GithubReader: "Github Reader",
};

/** Targets shown inside the search-source implementation panel (not HN). */
const SEARCH_SOURCE_TARGETS: TaskTarget[] = ["Post", "DownstreamPost", "BrandBlogNews", "Scraper"];

function parseHnCsvFromTaskConfigJson(configJson: string | null | undefined): string {
  if (!configJson?.trim()) return "";
  try {
    const parsed = JSON.parse(configJson) as { hnKeywordCsv?: string };
    return typeof parsed.hnKeywordCsv === "string" ? parsed.hnKeywordCsv : "";
  } catch {
    return "";
  }
}

function parseGhCsvFromTaskConfigJson(configJson: string | null | undefined): string {
  if (!configJson?.trim()) return "";
  try {
    const parsed = JSON.parse(configJson) as { ghKeywordCsv?: string };
    return typeof parsed.ghKeywordCsv === "string" ? parsed.ghKeywordCsv : "";
  } catch {
    return "";
  }
}

function parseGhModesFromTaskConfigJson(configJson: string | null | undefined): string {
  if (!configJson?.trim()) return "repo,code";
  try {
    const parsed = JSON.parse(configJson) as { ghModes?: string };
    return typeof parsed.ghModes === "string" && parsed.ghModes.trim()
      ? parsed.ghModes.trim()
      : "repo,code";
  } catch {
    return "repo,code";
  }
}

function serializeGhTaskConfigJson(
  csv: string,
  testProjectId: string,
  placeholder: string,
  ghModes: string
): string | null {
  const t = csv.trim();
  const pid = testProjectId && testProjectId !== placeholder ? testProjectId.trim() : "";
  const m = ghModes.trim();
  if (!t && !pid && !m) return null;
  const o: { ghKeywordCsv?: string; testProjectId?: string; ghModes?: string } = {};
  if (t) o.ghKeywordCsv = t;
  if (pid) o.testProjectId = pid;
  if (m) o.ghModes = m;
  return JSON.stringify(o);
}

/** Saved test project id (admin UI), stored in config_json alongside other keys. */
function parseTestProjectIdFromConfigJson(configJson: string | null | undefined): string {
  if (!configJson?.trim()) return "";
  try {
    const parsed = JSON.parse(configJson) as { testProjectId?: string };
    return typeof parsed.testProjectId === "string" ? parsed.testProjectId.trim() : "";
  } catch {
    return "";
  }
}

/** Hide internal key from the search-source "Model / API config JSON" textarea. */
function stripTestProjectIdFromConfigJsonForForm(configJson: string | null | undefined): string {
  if (!configJson?.trim()) return "";
  try {
    const o = JSON.parse(configJson) as Record<string, unknown>;
    const copy = { ...o };
    delete copy.testProjectId;
    if (Object.keys(copy).length === 0) return "";
    return JSON.stringify(copy);
  } catch {
    return configJson;
  }
}

function serializeHnTaskConfigJson(
  csv: string,
  testProjectId: string,
  placeholder: string
): string | null {
  const t = csv.trim();
  const pid = testProjectId && testProjectId !== placeholder ? testProjectId.trim() : "";
  if (!t && !pid) return null;
  const o: { hnKeywordCsv?: string; testProjectId?: string } = {};
  if (t) o.hnKeywordCsv = t;
  if (pid) o.testProjectId = pid;
  return JSON.stringify(o);
}

function mergeSearchSourceConfigJsonWithTestProject(
  formConfigJsonStr: string,
  testProjectId: string,
  placeholder: string
): string | null {
  const pid = testProjectId && testProjectId !== placeholder ? testProjectId.trim() : "";
  let obj: Record<string, unknown> = {};
  const trimmed = formConfigJsonStr.trim();
  if (trimmed) {
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      if (pid) return JSON.stringify({ testProjectId: pid });
      return trimmed || null;
    }
  }
  if (pid) obj.testProjectId = pid;
  else delete obj.testProjectId;
  if (Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

/** Single CSV line: keywords then brand names, deduped (case-insensitive), RFC-style quoting when needed. */
function termsToCsvLine(keywords: string[], brandNames: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...keywords, ...brandNames]) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out
    .map((cell) => {
      if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
      return cell;
    })
    .join(",");
}

function sanitizeTestDownloadFilenameSegment(name: string): string {
  const s = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "task";
}

function triggerPlainTextFileDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Plain-text export for the custom-task test dialog (search-source + Hacker News). */
function buildTestOutputText(tr: {
  resultPreview: string | null;
  errorMessage: string | null;
  rowCount: number;
  linkBreakdown?: Array<{
    url: string;
    brandName: string;
    items: Array<{
      title: string | null;
      url: string;
      date: string | null;
      content?: string;
    }>;
  }>;
}): string {
  if (tr.linkBreakdown && tr.linkBreakdown.length > 0) {
    const lines: string[] = [];
    for (const entry of tr.linkBreakdown) {
      const label = entry.brandName ? `${entry.brandName}` : "Brand";
      lines.push(`========== ${label} ==========`);
      lines.push(`Blog/News URL: ${entry.url}`);
      lines.push("");
      if (entry.items.length === 0) {
        lines.push("None");
      } else {
        for (const item of entry.items) {
          lines.push("---");
          lines.push(item.url);
          lines.push("");
          lines.push(item.content ?? "(no content)");
          lines.push("");
        }
      }
      lines.push("");
    }
    lines.push(`Rows in window: ${tr.rowCount}`);
    if (tr.errorMessage) {
      lines.push("");
      lines.push(`Error: ${tr.errorMessage}`);
    }
    return lines.join("\n");
  }
  if (tr.resultPreview) {
    let outputText = tr.resultPreview;
    if (tr.errorMessage) {
      outputText += `\n\nError: ${tr.errorMessage}`;
    }
    return outputText;
  }
  const lines: string[] = [];
  lines.push(`Rows in window: ${tr.rowCount}`);
  if (tr.errorMessage) {
    lines.push("");
    lines.push(`Error: ${tr.errorMessage}`);
  }
  return lines.join("\n");
}

export function SearchSourceTasksList() {
  const [tasks, setTasks] = useState<SearchSourceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<SearchSourceTask | null>(null);
  /** Id of the task being edited; set when opening edit so we always send PUT with correct id */
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    resultPreview: string | null;
    errorMessage: string | null;
    rowCount: number;
    linkBreakdown?: Array<{
      url: string;
      brandName: string;
      items: Array<{
        title: string | null;
        url: string;
        date: string | null;
        content?: string;
      }>;
    }>;
    scraperRunId?: string;
    scraperError?: string;
    ingestResult?: { inserted: number; updated: number; skipped: number; errors: string[] };
  } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [testProjectId, setTestProjectId] = useState<string>("");
  const PROJECT_SELECT_PLACEHOLDER = "__placeholder__";
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    task: SearchSourceTask | null;
  }>({
    open: false,
    task: null,
  });

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTiming, setFormTiming] = useState<TaskTiming>("LAST_DAY");
  const [formDurationNumber, setFormDurationNumber] = useState<number | "">("");
  const [formDurationUnit, setFormDurationUnit] = useState<TimingDurationUnit | "">("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formTarget, setFormTarget] = useState<TaskTarget>("BrandBlogNews");
  const [formActive, setFormActive] = useState(true);
  const [formConfigJson, setFormConfigJson] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  /** Search-source runner fields (timing, prompt, target): hidden until expanded. */
  const [searchSourceImplOpen, setSearchSourceImplOpen] = useState(false);
  /** HN test: project keywords / brands from API */
  const [hnListening, setHnListening] = useState<{
    keywords: string[];
    brandNames: string[];
  } | null>(null);
  const [hnListeningLoading, setHnListeningLoading] = useState(false);
  /** HN test: comma/newline-separated override (non-empty replaces project terms for this run only). */
  const [hnCsvOverride, setHnCsvOverride] = useState("");
  /** Github Reader: same pattern as HN keywords; stored as ghKeywordCsv in config_json. */
  const [ghCsvOverride, setGhCsvOverride] = useState("");
  /** Comma-separated: repo, code (default both). */
  const [formGhModes, setFormGhModes] = useState("repo,code");
  /** When true, Keywords (CSV) is filled from the selected project’s keywords + brand names (updates when the project or terms load). */
  const [hnUseAllTermsAsCsv, setHnUseAllTermsAsCsv] = useState(false);
  /** Prevents background re-fetch from overwriting user edits when opening a task. */
  const formTouchedRef = useRef(false);
  /** Abort in-flight test request (Hacker News cooperative cancel on server). */
  const testAbortRef = useRef<AbortController | null>(null);
  /** When true, save test output to a .txt file in the browser Downloads folder when a test finishes. */
  const [autoDownloadTestTxt, setAutoDownloadTestTxt] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("customtask-auto-download-test") !== "false";
    } catch {
      return true;
    }
  });

  const isHnRunner = formTarget === "HackerNews";
  const isGhRunner = formTarget === "GithubReader";
  const isKeywordRunner = isHnRunner || isGhRunner;
  /** Test dialog: keyword runners (HN or GitHub) show project terms + CSV + lookback. */
  const isKeywordTestForm =
    formTarget === "HackerNews" ||
    formTarget === "GithubReader" ||
    (editingTask != null &&
      (editingTask.target === "HackerNews" || editingTask.target === "GithubReader"));

  /** HN lookback: number + unit only (server falls back to `timing_definition` when unset). */
  const hnTimeRangeFields = (
    <div className="grid gap-2">
      <Label>Custom duration (optional)</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={1}
          max={365}
          placeholder="e.g. 3"
          value={formDurationNumber === "" ? "" : formDurationNumber}
          onChange={(e) => {
            formTouchedRef.current = true;
            const v = e.target.value;
            if (v === "") setFormDurationNumber("");
            else {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n)) setFormDurationNumber(Math.max(1, Math.min(365, n)));
            }
          }}
          className="w-20"
        />
        <Select
          value={formDurationUnit || "__none__"}
          onValueChange={(v) => {
            formTouchedRef.current = true;
            setFormDurationUnit(v === "__none__" ? "" : (v as TimingDurationUnit));
          }}
        >
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Unit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">—</SelectItem>
            {(Object.keys(DURATION_UNIT_LABELS) as TimingDurationUnit[]).map((u) => (
              <SelectItem key={u} value={u}>
                {DURATION_UNIT_LABELS[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Set both fields to cap how far back ingest searches. If left empty, the task’s stored
        default window is used (new tasks default to last day).
      </p>
    </div>
  );

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/search-source-tasks");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load custom tasks.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.projects)
            ? data.projects
            : [];
        setProjects(list.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
      })
      .catch(() => setProjects([]));
  }, [formOpen]);

  useEffect(() => {
    if (!formOpen) {
      setHnListening(null);
      return;
    }
    const isKeyword =
      formTarget === "HackerNews" ||
      formTarget === "GithubReader" ||
      (editingTask != null &&
        (editingTask.target === "HackerNews" || editingTask.target === "GithubReader"));
    if (!isKeyword) {
      setHnListening(null);
      return;
    }
    const pid =
      testProjectId && testProjectId !== PROJECT_SELECT_PLACEHOLDER ? testProjectId.trim() : "";
    if (!pid) {
      setHnListening(null);
      return;
    }
    let cancelled = false;
    setHnListeningLoading(true);
    fetch(`/api/admin/projects/${pid}/listening-terms`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load terms");
        return r.json() as Promise<{ keywords?: string[]; brandNames?: string[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setHnListening({
            keywords: data.keywords ?? [],
            brandNames: data.brandNames ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setHnListening(null);
      })
      .finally(() => {
        if (!cancelled) setHnListeningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formOpen, editingTask, formTarget, testProjectId]);

  useEffect(() => {
    if (!hnUseAllTermsAsCsv || !hnListening || hnListeningLoading) return;
    const line = termsToCsvLine(hnListening.keywords, hnListening.brandNames);
    formTouchedRef.current = true;
    if (formTarget === "HackerNews") setHnCsvOverride(line);
    else if (formTarget === "GithubReader") setGhCsvOverride(line);
  }, [hnUseAllTermsAsCsv, hnListening, hnListeningLoading, formTarget]);

  const openCreate = () => {
    setEditingTask(null);
    setEditingTaskId(null);
    setFormName("");
    setFormDescription("");
    setFormTiming("LAST_DAY");
    setFormDurationNumber("");
    setFormDurationUnit("");
    setFormPrompt("");
    setFormTarget("BrandBlogNews");
    setFormActive(true);
    setFormConfigJson("");
    setSearchSourceImplOpen(false);
    setHnCsvOverride("");
    setGhCsvOverride("");
    setFormGhModes("repo,code");
    setHnUseAllTermsAsCsv(false);
    setHnListening(null);
    setTestResult(null);
    setTestProjectId(PROJECT_SELECT_PLACEHOLDER);
    setFormOpen(true);
  };

  const openEdit = (task: SearchSourceTask) => {
    formTouchedRef.current = false;
    setEditingTask(task);
    const taskId = task.id ?? null;
    setEditingTaskId(taskId);
    setFormName(task.name);
    setFormDescription(task.description ?? "");
    setFormTiming(task.timing_definition);
    setFormDurationNumber(task.timing_duration_number ?? "");
    setFormDurationUnit((task.timing_duration_unit as TimingDurationUnit) ?? "");
    setFormPrompt(
      task.target === "BrandBlogNews"
        ? BRAND_BLOG_SUMMARY_PROMPT
        : task.target === "HackerNews" || task.target === "GithubReader"
          ? ""
          : (task.openai_prompt_text ?? "")
    );
    setFormTarget(task.target as TaskTarget);
    setFormActive(task.is_active);
    setFormConfigJson(
      task.target === "HackerNews" || task.target === "GithubReader"
        ? ""
        : stripTestProjectIdFromConfigJsonForForm(task.config_json)
    );
    setHnCsvOverride(
      task.target === "HackerNews" ? parseHnCsvFromTaskConfigJson(task.config_json) : ""
    );
    setGhCsvOverride(
      task.target === "GithubReader" ? parseGhCsvFromTaskConfigJson(task.config_json) : ""
    );
    setFormGhModes(
      task.target === "GithubReader"
        ? parseGhModesFromTaskConfigJson(task.config_json)
        : "repo,code"
    );
    setHnUseAllTermsAsCsv(false);
    setTestProjectId(
      parseTestProjectIdFromConfigJson(task.config_json) || PROJECT_SELECT_PLACEHOLDER
    );
    setTestResult(null);
    setSearchSourceImplOpen(false);
    setHnListening(null);
    setFormOpen(true);
    // Re-fetch latest from server so we show saved state; only apply if user hasn't edited yet
    const fetchLatest = async () => {
      try {
        if (taskId && String(taskId).trim() !== "") {
          const res = await fetch(`/api/admin/search-source-tasks/${taskId}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.task && !formTouchedRef.current) {
            setEditingTask(data.task);
            setFormName(data.task.name);
            setFormDescription(data.task.description ?? "");
            setFormTiming(data.task.timing_definition);
            setFormDurationNumber(data.task.timing_duration_number ?? "");
            setFormDurationUnit((data.task.timing_duration_unit as TimingDurationUnit) ?? "");
            setFormPrompt(
              data.task.target === "BrandBlogNews"
                ? BRAND_BLOG_SUMMARY_PROMPT
                : data.task.target === "HackerNews" || data.task.target === "GithubReader"
                  ? ""
                  : (data.task.openai_prompt_text ?? "")
            );
            setFormTarget(data.task.target as TaskTarget);
            setFormActive(data.task.is_active);
            setFormConfigJson(
              data.task.target === "HackerNews" || data.task.target === "GithubReader"
                ? ""
                : stripTestProjectIdFromConfigJsonForForm(data.task.config_json)
            );
            setHnCsvOverride(
              data.task.target === "HackerNews"
                ? parseHnCsvFromTaskConfigJson(data.task.config_json)
                : ""
            );
            setGhCsvOverride(
              data.task.target === "GithubReader"
                ? parseGhCsvFromTaskConfigJson(data.task.config_json)
                : ""
            );
            setFormGhModes(
              data.task.target === "GithubReader"
                ? parseGhModesFromTaskConfigJson(data.task.config_json)
                : "repo,code"
            );
            setTestProjectId(
              parseTestProjectIdFromConfigJson(data.task.config_json) || PROJECT_SELECT_PLACEHOLDER
            );
            return;
          }
        }
        if (formTouchedRef.current) return;
        const listRes = await fetch("/api/admin/search-source-tasks");
        if (!listRes.ok) return;
        const listData = await listRes.json();
        const tasksList = listData.tasks ?? [];
        const latest = tasksList.find((t: SearchSourceTask) => t.name === task.name);
        if (latest) {
          setEditingTask(latest);
          setEditingTaskId(latest.id ?? null);
          setFormName(latest.name);
          setFormDescription(latest.description ?? "");
          setFormTiming(latest.timing_definition);
          setFormDurationNumber(latest.timing_duration_number ?? "");
          setFormDurationUnit((latest.timing_duration_unit as TimingDurationUnit) ?? "");
          setFormPrompt(
            latest.target === "BrandBlogNews"
              ? BRAND_BLOG_SUMMARY_PROMPT
              : latest.target === "HackerNews" || latest.target === "GithubReader"
                ? ""
                : (latest.openai_prompt_text ?? "")
          );
          setFormTarget(latest.target as TaskTarget);
          setFormActive(latest.is_active);
          setFormConfigJson(
            latest.target === "HackerNews" || latest.target === "GithubReader"
              ? ""
              : stripTestProjectIdFromConfigJsonForForm(latest.config_json)
          );
          setHnCsvOverride(
            latest.target === "HackerNews" ? parseHnCsvFromTaskConfigJson(latest.config_json) : ""
          );
          setGhCsvOverride(
            latest.target === "GithubReader" ? parseGhCsvFromTaskConfigJson(latest.config_json) : ""
          );
          setFormGhModes(
            latest.target === "GithubReader"
              ? parseGhModesFromTaskConfigJson(latest.config_json)
              : "repo,code"
          );
          setTestProjectId(
            parseTestProjectIdFromConfigJson(latest.config_json) || PROJECT_SELECT_PLACEHOLDER
          );
        }
      } catch {
        // keep form as already set from task
      }
    };
    fetchLatest();
  };

  const saveTask = async () => {
    if (!formName.trim()) {
      toast({ title: "Validation", description: "Name is required.", variant: "destructive" });
      return;
    }
    setFormSaving(true);
    try {
      const durationNum =
        typeof formDurationNumber === "number"
          ? formDurationNumber
          : formDurationNumber === "" || formDurationNumber === null
            ? null
            : Number(formDurationNumber);
      const durationUnit =
        formDurationUnit && ["day", "week", "month"].includes(formDurationUnit)
          ? formDurationUnit
          : null;
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        timing_definition: formTiming,
        timing_duration_number: durationNum ?? null,
        timing_duration_unit: durationUnit ?? null,
        openai_prompt_text:
          formTarget === "HackerNews" || formTarget === "GithubReader"
            ? ""
            : formTarget === "BrandBlogNews"
              ? BRAND_BLOG_SUMMARY_PROMPT
              : formPrompt.trim() || null,
        target: formTarget,
        is_active: formActive,
        config_json:
          formTarget === "HackerNews"
            ? serializeHnTaskConfigJson(hnCsvOverride, testProjectId, PROJECT_SELECT_PLACEHOLDER)
            : formTarget === "GithubReader"
              ? serializeGhTaskConfigJson(
                  ghCsvOverride,
                  testProjectId,
                  PROJECT_SELECT_PLACEHOLDER,
                  formGhModes
                )
              : mergeSearchSourceConfigJsonWithTestProject(
                  formConfigJson,
                  testProjectId,
                  PROJECT_SELECT_PLACEHOLDER
                ),
      };
      // Use PUT when we have a non-empty id, or when we're editing (by name) for tasks with empty id
      const hasId = editingTaskId && String(editingTaskId).trim() !== "";
      const isUpdateByName = !hasId && editingTask != null;
      const isUpdate = hasId || isUpdateByName;
      let url: string;
      let method: string;
      let body: string;
      if (hasId) {
        url = `/api/admin/search-source-tasks/${editingTaskId}`;
        method = "PUT";
        body = JSON.stringify(payload);
      } else if (isUpdateByName) {
        url = "/api/admin/search-source-tasks/by-name";
        method = "PUT";
        body = JSON.stringify({ current_name: editingTask.name, ...payload });
      } else {
        url = "/api/admin/search-source-tasks";
        method = "POST";
        body = JSON.stringify(payload);
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      let data: { task?: SearchSourceTask; error?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          // non-JSON response (e.g. HTML error page)
        }
      }
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast({
        title: isUpdate ? "Task updated" : "Task created",
        description: formName,
      });
      setFormOpen(false);
      setEditingTask(null);
      setEditingTaskId(null);
      fetchTasks();
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setFormSaving(false);
    }
  };

  const runTestFromDialog = async () => {
    if (!editingTask) return;
    const effectiveProjectId =
      testProjectId === PROJECT_SELECT_PLACEHOLDER ? "" : (testProjectId ?? "").trim();
    if (!effectiveProjectId) {
      toast({
        title: "Select a project",
        description: "Choose a project from the list to run the test.",
        variant: "destructive",
      });
      return;
    }
    const projectName = projects.find((p) => p.id === effectiveProjectId)?.name?.trim() ?? "";
    if (!projectName) {
      toast({
        title: "Project not found",
        description: "Could not resolve the selected project name.",
        variant: "destructive",
      });
      return;
    }
    const taskId = (editingTask?.id ?? editingTaskId ?? "").trim();
    const useRunTestByName = !taskId;
    testAbortRef.current?.abort();
    const ac = new AbortController();
    testAbortRef.current = ac;
    setTestingId((taskId || editingTask.name) ?? "run-test");
    setTestResult(null);
    try {
      const url = useRunTestByName
        ? "/api/admin/search-source-tasks/run-test"
        : `/api/admin/search-source-tasks/${taskId}/test`;
      const hnForTest = editingTask.target === "HackerNews" || formTarget === "HackerNews";
      const ghForTest = editingTask.target === "GithubReader" || formTarget === "GithubReader";
      const body = useRunTestByName
        ? {
            taskName: editingTask.name,
            projectName,
            ...(hnForTest && hnCsvOverride.trim() ? { hnKeywordCsv: hnCsvOverride.trim() } : {}),
            ...(ghForTest && ghCsvOverride.trim() ? { ghKeywordCsv: ghCsvOverride.trim() } : {}),
          }
        : {
            projectName,
            ...(hnForTest && hnCsvOverride.trim() ? { hnKeywordCsv: hnCsvOverride.trim() } : {}),
            ...(ghForTest && ghCsvOverride.trim() ? { ghKeywordCsv: ghCsvOverride.trim() } : {}),
          };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data.error ?? data.errorMessage ?? "Request failed";
        setTestResult({
          success: false,
          resultPreview: null,
          errorMessage: errMsg,
          rowCount: 0,
        });
        toast({
          title: "Test failed",
          description: String(errMsg),
          variant: "destructive",
        });
        return;
      }
      const nextResult = {
        success: data.success ?? false,
        resultPreview: data.resultPreview ?? null,
        errorMessage: data.errorMessage ?? data.error ?? null,
        rowCount: data.rowCount ?? 0,
        linkBreakdown: data.linkBreakdown,
        scraperRunId: data.scraperRunId,
        scraperError: data.scraperError,
        ingestResult: data.ingestResult,
      };
      setTestResult(nextResult);

      const rawName = (editingTask?.name ?? formName ?? "task").trim() || "task";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const downloadFilename = `test-result-${sanitizeTestDownloadFilenameSegment(rawName)}-${stamp}.txt`;
      let autoSavedFilename: string | null = null;
      if (autoDownloadTestTxt) {
        const text = buildTestOutputText(nextResult);
        triggerPlainTextFileDownload(text, downloadFilename);
        autoSavedFilename = downloadFilename;
      }

      const hasIngest =
        data.ingestResult && data.ingestResult.inserted + data.ingestResult.updated > 0;
      toast({
        title: "Test completed",
        description: autoSavedFilename
          ? `Output saved as ${autoSavedFilename} in your Downloads folder.`
          : data.scraperRunId != null
            ? hasIngest
              ? "Scraper finished. Output ingested into BlogPost table. Use Download results to save a .txt copy."
              : "See output below. URLs sent to scraper. Use Download results to save a .txt file."
            : "See output below. Use Download results to save a .txt file.",
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setTestResult({
          success: false,
          resultPreview: null,
          errorMessage: "Test stopped.",
          rowCount: 0,
        });
        toast({
          title: "Test stopped",
          description: "The request was cancelled. You can run the test again.",
        });
        return;
      }
      const msg = e instanceof Error ? e.message : "Request failed";
      setTestResult({
        success: false,
        resultPreview: null,
        errorMessage: msg,
        rowCount: 0,
      });
      toast({
        title: "Test failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      testAbortRef.current = null;
      setTestingId(null);
    }
  };

  const stopTestFromDialog = () => {
    testAbortRef.current?.abort();
  };

  const deleteTask = async () => {
    if (!deleteDialog.task) return;
    try {
      const res = await fetch(`/api/admin/search-source-tasks/${deleteDialog.task.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Task deleted", description: deleteDialog.task.name });
      setDeleteDialog({ open: false, task: null });
      fetchTasks();
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete task.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Custom Tasks</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const testOutputText = testResult ? buildTestOutputText(testResult) : "";

  const getTestDownloadFilename = () => {
    const raw = (editingTask?.name ?? formName ?? "task").trim() || "task";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `test-result-${sanitizeTestDownloadFilenameSegment(raw)}-${stamp}.txt`;
  };

  const downloadTestResult = () => {
    if (!testResult) return;
    const text = buildTestOutputText(testResult);
    const filename = getTestDownloadFilename();
    triggerPlainTextFileDownload(text, filename);
    toast({
      title: "Downloaded",
      description: `Saved ${filename} to your downloads folder.`,
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Custom Tasks</CardTitle>
          <CardDescription>
            With the dev server running (<span className="font-mono text-xs">npm run dev</span>),
            open a task → <span className="font-medium">Run test</span> to execute it locally
            against a project. Output appears below; use{" "}
            <span className="font-medium">Download results</span> for a{" "}
            <span className="font-mono text-xs">.txt</span> file, or enable auto-save on the test
            panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-12">
              <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No custom tasks yet</h3>
              <p className="text-muted-foreground mb-4">
                Add a task with a name and description. Expand search-source settings when the task
                uses that runner.
              </p>
              <Button onClick={openCreate}>
                <Settings className="mr-2 h-4 w-4" />
                Add task
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{task.name}</h3>
                      <Badge variant={task.is_active ? "default" : "secondary"}>
                        {task.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">
                        {task.timing_duration_number != null &&
                        task.timing_duration_unit &&
                        ["day", "week", "month"].includes(task.timing_duration_unit)
                          ? `${task.timing_duration_number} ${DURATION_UNIT_LABELS[task.timing_duration_unit as TimingDurationUnit]}`
                          : TIMING_LABELS[task.timing_definition]}
                      </Badge>
                    </div>
                    {task.description && (
                      <p className="text-sm text-muted-foreground">{task.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(task)}>
                          <Settings className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteDialog({ open: true, task })}
                          className="text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={openCreate} className="w-full">
                Add task
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit task" : "Add custom task"}</DialogTitle>
            <DialogDescription>
              Set a display name and optional description. Choose a runner, then when editing run a
              test against a project. Search-source timing and LLM fields apply only to the search
              source runner.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Runner</Label>
              <Select
                value={isHnRunner ? "hn" : isGhRunner ? "gh" : "ss"}
                onValueChange={(v) => {
                  formTouchedRef.current = true;
                  if (v === "hn") {
                    setFormTarget("HackerNews");
                    setFormPrompt("");
                    setFormConfigJson("");
                    setSearchSourceImplOpen(false);
                  } else if (v === "gh") {
                    setFormTarget("GithubReader");
                    setFormPrompt("");
                    setFormConfigJson("");
                    setSearchSourceImplOpen(false);
                  } else {
                    setFormTarget("BrandBlogNews");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ss">Search source (LLM over data)</SelectItem>
                  <SelectItem value="hn">Hacker News</SelectItem>
                  <SelectItem value="gh">Github Reader</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Hacker News and Github Reader use project keywords (or a CSV on the task / test).
                Github Reader searches repositories and code via the GitHub API (requires{" "}
                <span className="font-mono text-xs">GITHUB_TOKEN</span> on the server). Search
                source uses timing, prompts, and data targets below.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-name">Name *</Label>
              <Input
                id="task-name"
                value={formName}
                onChange={(e) => {
                  formTouchedRef.current = true;
                  setFormName(e.target.value);
                }}
                placeholder={
                  isGhRunner
                    ? "e.g. Weekly GitHub repo & code scan"
                    : isHnRunner
                      ? "e.g. HN keyword digest"
                      : "e.g. Summarize recent posts"
                }
              />
              <p className="text-xs text-muted-foreground">
                Must be unique in the database. This label is separate from the runner you chose
                above—use a distinct name (for example a project or schedule), not the runner title.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-desc">Description</Label>
              <Input
                id="task-desc"
                value={formDescription}
                onChange={(e) => {
                  formTouchedRef.current = true;
                  setFormDescription(e.target.value);
                }}
                placeholder="Optional"
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="task-active"
                  checked={formActive}
                  onCheckedChange={(v) => {
                    formTouchedRef.current = true;
                    setFormActive(v === true);
                  }}
                />
                <Label htmlFor="task-active">Active</Label>
              </div>
            </div>
            {isKeywordRunner && editingTask === null && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <h4 className="text-sm font-medium">
                  {isHnRunner ? "Hacker News" : "Github Reader"} keywords & time window
                </h4>
                <div className="grid gap-2">
                  <Label>Project (keywords & brands)</Label>
                  <Select
                    value={testProjectId || undefined}
                    onValueChange={setTestProjectId}
                    disabled={projects.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={projects.length === 0 ? "No projects" : "Select a project"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Loads this project&apos;s listening keywords and brand names below. Optional
                    test project id is saved on the task when you create it (same as Hacker News
                    tasks).
                  </p>
                </div>
                <div className="space-y-3 rounded-md border bg-background/50 p-3 text-sm">
                  {testProjectId && testProjectId !== PROJECT_SELECT_PLACEHOLDER && (
                    <>
                      <p className="font-medium text-foreground">Terms from this project</p>
                      {hnListeningLoading && (
                        <p className="text-muted-foreground">
                          Loading project keywords and brands…
                        </p>
                      )}
                      {!hnListeningLoading && hnListening && (
                        <>
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">
                              Keywords
                            </p>
                            {hnListening.keywords.length === 0 ? (
                              <p className="text-muted-foreground">None</p>
                            ) : (
                              <ul className="mt-1 list-disc pl-5">
                                {hnListening.keywords.map((k) => (
                                  <li key={`create-kw-${k}`}>{k}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">
                              Brand names
                            </p>
                            {hnListening.brandNames.length === 0 ? (
                              <p className="text-muted-foreground">None</p>
                            ) : (
                              <ul className="mt-1 list-disc pl-5">
                                {hnListening.brandNames.map((b) => (
                                  <li key={`create-br-${b}`}>{b}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="flex items-start gap-2 pt-1">
                            <Checkbox
                              id="keyword-fill-csv-from-project-create"
                              checked={hnUseAllTermsAsCsv}
                              disabled={
                                hnListeningLoading ||
                                !hnListening ||
                                (hnListening.keywords.length === 0 &&
                                  hnListening.brandNames.length === 0)
                              }
                              onCheckedChange={(v) => {
                                formTouchedRef.current = true;
                                setHnUseAllTermsAsCsv(v === true);
                              }}
                            />
                            <div className="space-y-0.5">
                              <Label
                                htmlFor="keyword-fill-csv-from-project-create"
                                className="text-sm font-normal leading-snug cursor-pointer"
                              >
                                Use all project keywords and brand names in Keywords (CSV)
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                When checked, the CSV field below is filled with every keyword and
                                brand name. Uncheck to edit without syncing.
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {formTarget === "HackerNews" && (
                    <div className="grid gap-2 pt-1">
                      <Label htmlFor="hn-csv-override-create">Keywords (CSV)</Label>
                      <textarea
                        id="hn-csv-override-create"
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={hnCsvOverride}
                        onChange={(e) => {
                          formTouchedRef.current = true;
                          setHnCsvOverride(e.target.value);
                        }}
                        placeholder="Override: comma or newline separated. Leave empty to use project terms when the task runs."
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Saved on create. Leave empty to use only the project&apos;s keywords and
                        brands at run time.
                      </p>
                    </div>
                  )}
                  {formTarget === "GithubReader" && (
                    <div className="grid gap-2 pt-1">
                      <Label htmlFor="gh-csv-override-create">Keywords (CSV)</Label>
                      <textarea
                        id="gh-csv-override-create"
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={ghCsvOverride}
                        onChange={(e) => {
                          formTouchedRef.current = true;
                          setGhCsvOverride(e.target.value);
                        }}
                        placeholder="Override: comma or newline separated. Leave empty to use project terms when the task runs."
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Saved on create as <span className="font-mono">ghKeywordCsv</span>. Leave
                        empty to use only the project&apos;s keywords and brands at run time.
                      </p>
                      <Label htmlFor="gh-modes-create">Search modes</Label>
                      <Input
                        id="gh-modes-create"
                        value={formGhModes}
                        onChange={(e) => {
                          formTouchedRef.current = true;
                          setFormGhModes(e.target.value);
                        }}
                        placeholder="repo,code"
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Comma-separated: <span className="font-mono">repo</span> (repository
                        search), <span className="font-mono">code</span> (code search).
                      </p>
                    </div>
                  )}
                  {hnTimeRangeFields}
                </div>
              </div>
            )}
            {editingTask !== null && (
              <div className="grid gap-3 rounded-lg border p-4">
                <h4 className="text-sm font-medium">Test run</h4>
                <div className="grid gap-2">
                  <Label>Project (for test)</Label>
                  <Select
                    value={testProjectId || undefined}
                    onValueChange={setTestProjectId}
                    disabled={projects.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={projects.length === 0 ? "No projects" : "Select a project"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Saved with the task when you click Update.
                  </p>
                </div>
                {isKeywordTestForm && (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
                    {testProjectId && testProjectId !== PROJECT_SELECT_PLACEHOLDER && (
                      <>
                        <p className="font-medium text-foreground">Terms for this test</p>
                        {hnListeningLoading && (
                          <p className="text-muted-foreground">
                            Loading project keywords and brands…
                          </p>
                        )}
                        {!hnListeningLoading && hnListening && (
                          <>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">
                                Keywords
                              </p>
                              {hnListening.keywords.length === 0 ? (
                                <p className="text-muted-foreground">None</p>
                              ) : (
                                <ul className="mt-1 list-disc pl-5">
                                  {hnListening.keywords.map((k) => (
                                    <li key={`kw-${k}`}>{k}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">
                                Brand names
                              </p>
                              {hnListening.brandNames.length === 0 ? (
                                <p className="text-muted-foreground">None</p>
                              ) : (
                                <ul className="mt-1 list-disc pl-5">
                                  {hnListening.brandNames.map((b) => (
                                    <li key={`br-${b}`}>{b}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="flex items-start gap-2 pt-1">
                              <Checkbox
                                id="hn-fill-csv-from-project"
                                checked={hnUseAllTermsAsCsv}
                                disabled={
                                  hnListeningLoading ||
                                  !hnListening ||
                                  (hnListening.keywords.length === 0 &&
                                    hnListening.brandNames.length === 0)
                                }
                                onCheckedChange={(v) => {
                                  formTouchedRef.current = true;
                                  setHnUseAllTermsAsCsv(v === true);
                                }}
                              />
                              <div className="space-y-0.5">
                                <Label
                                  htmlFor="hn-fill-csv-from-project"
                                  className="text-sm font-normal leading-snug cursor-pointer"
                                >
                                  Use all project keywords and brand names in Keywords (CSV)
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  When checked, the keyword field below is set to a comma-separated
                                  list of every keyword and brand name above. Uncheck to stop
                                  syncing when you change the test project; your text is not
                                  cleared.
                                </p>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {formTarget === "HackerNews" && (
                      <div className="grid gap-2">
                        <Label htmlFor="hn-csv-override">Keywords (CSV)</Label>
                        <textarea
                          id="hn-csv-override"
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={hnCsvOverride}
                          onChange={(e) => {
                            formTouchedRef.current = true;
                            setHnCsvOverride(e.target.value);
                          }}
                          placeholder="Comma or newline separated. Click Update to save. When set, used for tests and orchestration instead of the project lists above."
                          spellCheck={false}
                        />
                        <p className="text-xs text-muted-foreground">
                          Saved on the task as JSON config. Leave empty to use only project keywords
                          and brand names.
                        </p>
                      </div>
                    )}
                    {formTarget === "GithubReader" && (
                      <div className="grid gap-2">
                        <Label htmlFor="gh-csv-override">Keywords (CSV)</Label>
                        <textarea
                          id="gh-csv-override"
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={ghCsvOverride}
                          onChange={(e) => {
                            formTouchedRef.current = true;
                            setGhCsvOverride(e.target.value);
                          }}
                          placeholder="Comma or newline separated. Click Update to save."
                          spellCheck={false}
                        />
                        <p className="text-xs text-muted-foreground">
                          Saved as <span className="font-mono">ghKeywordCsv</span> in task config.
                          Leave empty to use only project keywords and brand names.
                        </p>
                        <Label htmlFor="gh-modes-edit">Search modes</Label>
                        <Input
                          id="gh-modes-edit"
                          value={formGhModes}
                          onChange={(e) => {
                            formTouchedRef.current = true;
                            setFormGhModes(e.target.value);
                          }}
                          placeholder="repo,code"
                          spellCheck={false}
                        />
                        <p className="text-xs text-muted-foreground">
                          Comma-separated: <span className="font-mono">repo</span>,{" "}
                          <span className="font-mono">code</span>.
                        </p>
                      </div>
                    )}
                    {hnTimeRangeFields}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={runTestFromDialog}
                    disabled={
                      !!testingId ||
                      projects.length === 0 ||
                      !testProjectId ||
                      testProjectId === PROJECT_SELECT_PLACEHOLDER
                    }
                  >
                    {testingId ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {testingId ? "Running test…" : "Run test"}
                  </Button>
                  {isKeywordTestForm && testingId && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={stopTestFromDialog}
                    >
                      <StopCircle className="mr-2 h-4 w-4" />
                      Stop test
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={downloadTestResult}
                    disabled={!testResult || !!testingId}
                    title={
                      !testResult
                        ? "Run a test first, then download the output as a .txt file"
                        : "Download last test output as a .txt file"
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download results
                  </Button>
                </div>
                <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-2">
                  <Checkbox
                    id="auto-download-test-txt"
                    checked={autoDownloadTestTxt}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setAutoDownloadTestTxt(on);
                      try {
                        localStorage.setItem(
                          "customtask-auto-download-test",
                          on ? "true" : "false"
                        );
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="auto-download-test-txt"
                      className="text-sm font-normal leading-snug cursor-pointer"
                    >
                      Save test output to a .txt file automatically when the test finishes
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Writes to your browser&apos;s Downloads folder (same as Download results). You
                      can still download again after the run.
                    </p>
                  </div>
                </div>
                {testingId && (
                  <div className="mt-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center gap-2 font-medium text-primary">
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                      Test running…
                    </div>
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      <p>Step 1: Sending request to server…</p>
                      <p>Step 2: Fetching data and running the task. This may take a minute.</p>
                      {isKeywordTestForm && (
                        <p>
                          Use <span className="font-medium">Stop test</span> to cancel. The server
                          stops between keywords when possible
                          {formTarget === "HackerNews"
                            ? " (and between Hacker News stories)."
                            : "."}
                        </p>
                      )}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    </div>
                  </div>
                )}
                {!testingId && testResult && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm font-medium">Output</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={downloadTestResult}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                    <textarea
                      readOnly
                      className="flex min-h-[280px] w-full rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={testOutputText}
                      spellCheck={false}
                    />
                    {(testResult.scraperRunId != null || testResult.scraperError != null) && (
                      <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                        {testResult.scraperRunId != null ? (
                          <p className="text-muted-foreground">
                            Scraper finished — run ID:{" "}
                            <a
                              href={`https://console.apify.com/actors/runs/${testResult.scraperRunId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-primary underline"
                            >
                              {testResult.scraperRunId}
                            </a>
                          </p>
                        ) : (
                          <p className="text-destructive">
                            Scraper error: {testResult.scraperError}
                          </p>
                        )}
                      </div>
                    )}
                    {testResult.ingestResult != null && (
                      <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm space-y-1">
                        <p className="font-medium text-muted-foreground">BlogPost table</p>
                        <p className="text-muted-foreground">
                          {testResult.ingestResult.inserted} inserted,{" "}
                          {testResult.ingestResult.updated} updated,{" "}
                          {testResult.ingestResult.skipped} skipped
                        </p>
                        {testResult.ingestResult.errors.length > 0 && (
                          <p className="text-destructive text-xs">
                            Errors: {testResult.ingestResult.errors.join("; ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isKeywordRunner && (
              <div className="rounded-lg border bg-muted/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-medium hover:bg-muted/40"
                  onClick={() => setSearchSourceImplOpen((o) => !o)}
                >
                  <span>Search source implementation</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${searchSourceImplOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {!searchSourceImplOpen && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    {TARGET_LABELS[formTarget]}
                    {" · "}
                    {formDurationNumber !== "" && formDurationUnit
                      ? `${formDurationNumber} ${DURATION_UNIT_LABELS[formDurationUnit]}`
                      : TIMING_LABELS[formTiming]}
                  </p>
                )}
                {searchSourceImplOpen && (
                  <div className="space-y-4 border-t px-3 pb-4 pt-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      These fields apply only to tasks that run through the search-source pipeline
                      (fetch rows or brand blog URLs, then optional LLM). They are not part of the
                      generic custom-task contract (name, description, test).
                    </p>
                    <div className="grid gap-2">
                      <Label htmlFor="task-target">Data target</Label>
                      <Select
                        value={formTarget}
                        onValueChange={(v) => {
                          formTouchedRef.current = true;
                          setFormTarget(v as TaskTarget);
                        }}
                      >
                        <SelectTrigger id="task-target">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SEARCH_SOURCE_TARGETS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {TARGET_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="task-timing-preset">Default time window</Label>
                      <Select
                        value={formTiming}
                        onValueChange={(v) => {
                          formTouchedRef.current = true;
                          setFormTiming(v as TaskTiming);
                        }}
                      >
                        <SelectTrigger id="task-timing-preset">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TIMING_LABELS) as TaskTiming[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {TIMING_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Used when the custom duration below is not set.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <Label>Custom duration (optional)</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          placeholder="e.g. 3"
                          value={formDurationNumber === "" ? "" : formDurationNumber}
                          onChange={(e) => {
                            formTouchedRef.current = true;
                            const v = e.target.value;
                            if (v === "") setFormDurationNumber("");
                            else {
                              const n = parseInt(v, 10);
                              if (!Number.isNaN(n))
                                setFormDurationNumber(Math.max(1, Math.min(365, n)));
                            }
                          }}
                          className="w-20"
                        />
                        <Select
                          value={formDurationUnit || "__none__"}
                          onValueChange={(v) => {
                            formTouchedRef.current = true;
                            setFormDurationUnit(v === "__none__" ? "" : (v as TimingDurationUnit));
                          }}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue placeholder="Unit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {(Object.keys(DURATION_UNIT_LABELS) as TimingDurationUnit[]).map(
                              (u) => (
                                <SelectItem key={u} value={u}>
                                  {DURATION_UNIT_LABELS[u]}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">
                          Overrides default window
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="task-prompt">
                        LLM prompt (optional)
                        {formTarget === "BrandBlogNews" && (
                          <span className="ml-2 text-muted-foreground font-normal">
                            — fixed for this target
                          </span>
                        )}
                      </Label>
                      <textarea
                        id="task-prompt"
                        className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80 disabled:cursor-not-allowed"
                        value={
                          formTarget === "BrandBlogNews" ? BRAND_BLOG_SUMMARY_PROMPT : formPrompt
                        }
                        readOnly={formTarget === "BrandBlogNews"}
                        onChange={(e) => {
                          if (formTarget === "BrandBlogNews") return;
                          formTouchedRef.current = true;
                          setFormPrompt(e.target.value);
                        }}
                        placeholder="Placeholders: {{DATA}} — default used if empty (except brand blog target)"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="task-config">Model / API config JSON (optional)</Label>
                      <Input
                        id="task-config"
                        value={formConfigJson}
                        onChange={(e) => {
                          formTouchedRef.current = true;
                          setFormConfigJson(e.target.value);
                        }}
                        placeholder='{"model":"gpt-4o-mini","temperature":0.2,"max_tokens":2048}'
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTask} disabled={formSaving}>
              {formSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingTask ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, task: deleteDialog.task })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.task?.name}&quot;? This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteTask} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
