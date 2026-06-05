"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ResponseObjective } from "@prisma/client";
import {
  listResponseObjectives,
  createResponseObjective,
  updateResponseObjective,
  deleteResponseObjective,
} from "@/app/actions/response-objectives";
import {
  SOURCE_TABLE_ROWS,
  defaultSourceReplyTableState,
  serializeSourceReplyTable,
  sourceReplyTableFromObjective,
  type SourceReplyRowState,
  type SourceReplyTableState,
} from "@/lib/response-objective-sources";

const PERSONAS = ["Founder", "CTO", "Engineering", "Marketing", "Sales"] as const;

interface ResponseObjectivesManagerProps {
  projectId: string;
}

interface FormState {
  name: string;
  description: string;
  sourceReplyTable: SourceReplyTableState;
  persona: (typeof PERSONAS)[number];
  relevance_guidelines: string;
  style_guidelines: string;
  example_responses_json: string;
}

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  sourceReplyTable: defaultSourceReplyTableState(),
  persona: "Founder",
  relevance_guidelines: "",
  style_guidelines: "",
  example_responses_json: "",
});

function objectiveToForm(o: ResponseObjective): FormState {
  let examplesJson = "";
  if (o.example_responses != null) {
    try {
      examplesJson = JSON.stringify(o.example_responses, null, 2);
    } catch {
      examplesJson = "";
    }
  }
  return {
    name: o.name,
    description: o.description ?? "",
    sourceReplyTable: sourceReplyTableFromObjective({
      source_reply_settings: o.source_reply_settings,
      allowed_sources: o.allowed_sources,
      excluded_sources: o.excluded_sources,
      is_org_identified: o.is_org_identified,
    }),
    persona: (PERSONAS.includes(o.persona as (typeof PERSONAS)[number])
      ? o.persona
      : "Founder") as (typeof PERSONAS)[number],
    relevance_guidelines: o.relevance_guidelines ?? "",
    style_guidelines: o.style_guidelines ?? "",
    example_responses_json: examplesJson,
  };
}

function parseExamplesJson(
  raw: string
): { ok: true; data: { platform: string; examples: string[] }[] } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: true, data: [] };
  try {
    const parsed = JSON.parse(t) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "Must be a JSON array" };
    }
    const out: { platform: string; examples: string[] }[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const platform = typeof o.platform === "string" ? o.platform : "";
      const examples = Array.isArray(o.examples)
        ? o.examples.filter((e): e is string => typeof e === "string")
        : [];
      if (platform) out.push({ platform, examples });
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function updateSourceRow(
  prev: SourceReplyTableState,
  key: string,
  patch: Partial<Pick<SourceReplyRowState, "include" | "belongToOrg">>
): SourceReplyTableState {
  const row = prev[key] ?? { include: false, belongToOrg: false };
  if (patch.include === false) {
    return { ...prev, [key]: { include: false, belongToOrg: false } };
  }
  if (patch.include === true) {
    return {
      ...prev,
      [key]: { include: true, belongToOrg: patch.belongToOrg ?? true },
    };
  }
  const next: SourceReplyRowState = { ...row, ...patch };
  if (!next.include) {
    return { ...prev, [key]: { include: false, belongToOrg: false } };
  }
  return { ...prev, [key]: next };
}

export function ResponseObjectivesManager({ projectId }: ResponseObjectivesManagerProps) {
  const [objectives, setObjectives] = useState<ResponseObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResponseObjective | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const result = await listResponseObjectives(projectId);
      if (result.success && result.objectives) {
        setObjectives(result.objectives);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to load objectives",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to load objectives",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(o: ResponseObjective) {
    setEditing(o);
    setForm(objectiveToForm(o));
    setDialogOpen(true);
  }

  async function handleSave() {
    const serialized = serializeSourceReplyTable(form.sourceReplyTable);
    const ex = parseExamplesJson(form.example_responses_json);
    if (!ex.ok) {
      toast({ title: "Invalid examples JSON", description: ex.error, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const result = await updateResponseObjective(projectId, {
          id: editing.id,
          name: form.name.trim(),
          description: form.description,
          source_reply_settings: serialized,
          persona: form.persona,
          relevance_guidelines: form.relevance_guidelines,
          style_guidelines: form.style_guidelines,
          example_responses: ex.data.length ? ex.data : null,
        });
        if (!result.success) {
          throw new Error(result.error || "Update failed");
        }
        toast({ title: "Saved", description: "Response objective updated." });
      } else {
        const result = await createResponseObjective(projectId, {
          name: form.name.trim(),
          description: form.description,
          source_reply_settings: serialized,
          persona: form.persona,
          relevance_guidelines: form.relevance_guidelines,
          style_guidelines: form.style_guidelines,
          example_responses: ex.data.length ? ex.data : null,
        });
        if (!result.success) {
          throw new Error(result.error || "Create failed");
        }
        toast({ title: "Created", description: "Response objective added." });
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Save failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(o: ResponseObjective) {
    if (
      !window.confirm(
        `Delete objective "${o.name}"? Generated replies for this objective remain in history until removed.`
      )
    ) {
      return;
    }
    const result = await deleteResponseObjective(projectId, o.id);
    if (!result.success) {
      toast({
        title: "Error",
        description: result.error || "Delete failed",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Deleted" });
    await load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Response objectives</CardTitle>
          <CardDescription>
            Define what replies should achieve and how they should sound. Used by Generate Responses
            in Global Actions (admin).
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add objective
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : objectives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No objectives yet. Add at least one to generate theme-based replies.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead className="text-right w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {objectives.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>{o.persona}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={() => openEdit(o)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={() => void handleDelete(o)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit response objective" : "New response objective"}
              </DialogTitle>
              <DialogDescription>
                Set sources, relevance rules, and style. Saved objectives are used by Generate
                Responses in Global Actions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="ro-name">Name</Label>
                <Input
                  id="ro-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Short label"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ro-desc">Description</Label>
                <p className="text-xs text-muted-foreground">
                  Example: &quot;Engage when people ask how to evaluate options in [your domain]; offer
                  a clear, helpful perspective without a hard sell.&quot;
                </p>
                <Textarea
                  id="ro-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="What this objective is for (fed into relevance and reply prompts)"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-base">Sources and organization voice</Label>
                <p className="text-xs text-muted-foreground">
                  Order: social platforms, then forums and code, then blogs. For each source: include
                  it or not; when included, use <span className="font-medium">Identify as Org</span>{" "}
                  for insider voice (e.g. &quot;at [Company] we are building…&quot;), or leave it off for
                  outsider voice (discuss the brand in third person).
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[140px]">Source</TableHead>
                        <TableHead className="text-center w-[88px]">Include</TableHead>
                        <TableHead className="text-center min-w-[140px]">Identify as Org</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SOURCE_TABLE_ROWS.map(({ key, label }) => {
                        const row = form.sourceReplyTable[key] ?? {
                          include: false,
                          belongToOrg: false,
                        };
                        const disabled = !row.include;
                        return (
                          <TableRow key={key}>
                            <TableCell className="font-medium">{label}</TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                aria-label={`Include ${label}`}
                                checked={row.include}
                                onCheckedChange={(c) =>
                                  setForm((f) => ({
                                    ...f,
                                    sourceReplyTable: updateSourceRow(f.sourceReplyTable, key, {
                                      include: c === true,
                                    }),
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                aria-label={`Identify as Org — ${label}`}
                                disabled={disabled}
                                checked={row.belongToOrg}
                                onCheckedChange={(c) =>
                                  setForm((f) => ({
                                    ...f,
                                    sourceReplyTable: updateSourceRow(f.sourceReplyTable, key, {
                                      belongToOrg: c === true,
                                    }),
                                  }))
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Persona</Label>
                <Select
                  value={form.persona}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, persona: v as (typeof PERSONAS)[number] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONAS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ro-rel">Relevance guidelines</Label>
                <p className="text-xs text-muted-foreground">
                  Example: &quot;Treat as relevant when the thread is about [problem space] or asks
                  for comparisons; treat as not relevant for off-topic jokes, spam, or threads with
                  no question or discussion hook.&quot;
                </p>
                <Textarea
                  id="ro-rel"
                  value={form.relevance_guidelines}
                  onChange={(e) => setForm((f) => ({ ...f, relevance_guidelines: e.target.value }))}
                  rows={3}
                  placeholder="Rules for the 0–1 relevance scorer (what counts as on-brief vs noise)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ro-style">Style guidelines</Label>
                <p className="text-xs text-muted-foreground">
                  Example: &quot;Two to four sentences, conversational, first person when it fits the
                  platform; avoid hashtags unless the thread uses them; no links unless someone asks
                  for a resource.&quot;
                </p>
                <Textarea
                  id="ro-style"
                  value={form.style_guidelines}
                  onChange={(e) => setForm((f) => ({ ...f, style_guidelines: e.target.value }))}
                  rows={3}
                  placeholder="Tone, length, formatting, and things to avoid in the drafted reply"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ro-ex">Example responses (JSON)</Label>
                <Textarea
                  id="ro-ex"
                  value={form.example_responses_json}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, example_responses_json: e.target.value }))
                  }
                  rows={6}
                  className="font-mono text-xs"
                  placeholder={`[\n  { "platform": "linkedin", "examples": ["…"] }\n]`}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !form.name.trim()}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
