"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tags, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  getProjectThemes,
  createProjectTheme,
  updateProjectTheme,
  deleteProjectTheme,
  type ProjectThemeData,
} from "@/app/actions/themes-analysis";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

interface ThemeManagerProps {
  projectId: string;
}

export function ThemeManager({ projectId }: ThemeManagerProps) {
  const [themes, setThemes] = useState<ProjectThemeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingTheme, setEditingTheme] = useState<ProjectThemeData | null>(null);
  const [newTheme, setNewTheme] = useState({ theme_name: "", description: "" });
  const [showRunThemesDialog, setShowRunThemesDialog] = useState(false);
  const [runThemesLoading, setRunThemesLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadThemes() {
    setLoading(true);
    try {
      const result = await getProjectThemes(projectId);
      if (result.success && result.themes) {
        setThemes(result.themes);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to load themes",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading themes:", error);
      toast({
        title: "Error",
        description: "Failed to load themes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTheme.theme_name.trim()) {
      toast({
        title: "Error",
        description: "Theme name is required",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const result = await createProjectTheme(projectId, newTheme);
      if (result.success) {
        toast({
          title: "Success",
          description: "Theme created successfully",
        });
        setNewTheme({ theme_name: "", description: "" });
        await loadThemes();
        setShowRunThemesDialog(true);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to create theme",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error creating theme:", error);
      toast({
        title: "Error",
        description: "Failed to create theme",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRunThemesAnalysis() {
    if (runThemesLoading) {
      return;
    }

    setRunThemesLoading(true);
    try {
      const response = await fetch("/api/admin/run-themes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data?.error || "Failed to run theme analysis";
        throw new Error(errorMessage);
      }

      // Refresh themes list to get updated match counts
      await loadThemes();

      // Notify Themes Analysis tab to refetch matches (so list updates without full page refresh)
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("theme-analysis-completed", { detail: { projectId } })
        );
      }

      toast({
        title: "Theme analysis completed",
        description: `Found ${data.stats?.themesMatched ?? 0} theme matches. Refresh the Themes tab if the list doesn’t update.`,
      });
      setShowRunThemesDialog(false);
    } catch (error) {
      console.error("Error running theme analysis:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to start theme analysis. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRunThemesLoading(false);
    }
  }

  async function handleUpdate(themeId: string, updates: Partial<ProjectThemeData>) {
    try {
      const result = await updateProjectTheme(projectId, themeId, updates);
      if (result.success) {
        toast({
          title: "Success",
          description: "Theme updated successfully",
        });
        setEditingTheme(null);
        await loadThemes();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to update theme",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error updating theme:", error);
      toast({
        title: "Error",
        description: "Failed to update theme",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(themeId: string) {
    if (
      !confirm(
        "Are you sure you want to delete this theme? This will also remove all associated matches."
      )
    ) {
      return;
    }

    try {
      const result = await deleteProjectTheme(projectId, themeId);
      if (result.success) {
        toast({
          title: "Success",
          description: "Theme deleted successfully",
        });
        await loadThemes();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to delete theme",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error deleting theme:", error);
      toast({
        title: "Error",
        description: "Failed to delete theme",
        variant: "destructive",
      });
    }
  }

  async function handleToggleActive(themeId: string, isActive: boolean) {
    await handleUpdate(themeId, { is_active: isActive });
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            Theme Management
          </CardTitle>
          <CardDescription>
            Define Themes to capture specific conversations that matter to you, like &ldquo;cost of
            service&rdquo;, &ldquo;security concerns&rdquo;, or &ldquo;user experience&rdquo;
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-5 w-5" />
                Theme Management
              </CardTitle>
              <CardDescription>
                Define Themes to capture specific conversations that matter to you, like &ldquo;cost
                of service&rdquo;, &ldquo;security concerns&rdquo;, or &ldquo;user experience&rdquo;
              </CardDescription>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Theme
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Theme</DialogTitle>
                  <DialogDescription>
                    Define a theme to track in your scraped content. The AI will identify posts
                    discussing this theme.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="theme-name">Theme Name *</Label>
                    <Input
                      id="theme-name"
                      placeholder="e.g., Cost of Service"
                      value={newTheme.theme_name}
                      onChange={(e) => setNewTheme({ ...newTheme, theme_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme-description">Description (Optional)</Label>
                    <Textarea
                      id="theme-description"
                      placeholder="e.g., Discussions about pricing, fees, or service costs"
                      value={newTheme.description}
                      onChange={(e) => setNewTheme({ ...newTheme, description: e.target.value })}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Help the AI understand what to look for with a detailed description
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Theme"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {themes.length === 0 ? (
            <div className="text-center py-12">
              <Tags className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Themes Defined</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Create your first theme to start tracking specific topics in your scraped content.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[250px]">Theme Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px] text-center">Matches</TableHead>
                    <TableHead className="w-[100px] text-center">Active</TableHead>
                    <TableHead className="w-[120px] text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {themes.map((theme) => (
                    <TableRow key={theme.id}>
                      <TableCell className="font-medium">{theme.theme_name}</TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {theme.description || "No description"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{theme.matchCount || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={theme.is_active}
                          onCheckedChange={(checked) => handleToggleActive(theme.id, checked)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingTheme(theme)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </DialogTrigger>
                            {editingTheme?.id === theme.id && (
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Edit Theme</DialogTitle>
                                  <DialogDescription>Update the theme details</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="edit-theme-name">Theme Name *</Label>
                                    <Input
                                      id="edit-theme-name"
                                      value={editingTheme.theme_name}
                                      onChange={(e) =>
                                        setEditingTheme({
                                          ...editingTheme,
                                          theme_name: e.target.value,
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="edit-theme-description">Description</Label>
                                    <Textarea
                                      id="edit-theme-description"
                                      value={editingTheme.description || ""}
                                      onChange={(e) =>
                                        setEditingTheme({
                                          ...editingTheme,
                                          description: e.target.value,
                                        })
                                      }
                                      rows={3}
                                    />
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button
                                    onClick={() =>
                                      handleUpdate(editingTheme.id, {
                                        theme_name: editingTheme.theme_name,
                                        description: editingTheme.description,
                                      })
                                    }
                                  >
                                    Save Changes
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            )}
                          </Dialog>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(theme.id)}
                          >
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showRunThemesDialog}
        onOpenChange={(open) => {
          if (!runThemesLoading) {
            setShowRunThemesDialog(open);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run theme analysis now?</DialogTitle>
            <DialogDescription>
              We can immediately scan your existing posts with the updated theme list to surface
              matches.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Selecting <span className="text-foreground font-medium">Run analysis</span> will
              launch a themes-only pass without re-running sentiment, chatter, or network jobs.
            </p>
            <p>You can always run this later from the admin analysis tools.</p>
          </div>
          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowRunThemesDialog(false)}
              disabled={runThemesLoading}
            >
              Not now
            </Button>
            <Button type="button" onClick={handleRunThemesAnalysis} disabled={runThemesLoading}>
              {runThemesLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Run theme analysis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
