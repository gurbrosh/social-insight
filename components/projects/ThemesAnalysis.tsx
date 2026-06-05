"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tags,
  Loader2,
  ExternalLink,
  Settings,
  Heart,
  MessageCircle,
  Share2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  getStoredThemesAnalysis,
  getProjectThemes,
  setThemesAnalysisReadState,
  type ThemeMatch,
  type ProjectThemeData,
} from "@/app/actions/themes-analysis";
import {
  buildThemesCsvContent,
  dedupeThemeMatchesForExport,
  getThemeMatchDestinationUrl,
} from "@/lib/themes-export-csv";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format as formatDate } from "date-fns";
import Link from "next/link";
import { EngagementOpenLink } from "@/components/projects/EngagementOpenLink";
import { normalizePlatformForDisplay } from "@/lib/utils/platform";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

interface ThemesAnalysisProps {
  projectId: string;
  dateRange?: string;
  sourceFilter?: string[];
  languageFilter?: string;
}

const platformColors: Record<string, string> = {
  facebook: "bg-blue-600",
  linkedin: "bg-blue-700",
  x: "bg-gray-900",
  twitter: "bg-gray-900",
  reddit: "bg-orange-600",
  discord: "bg-indigo-600",
  blog: "bg-emerald-600",
  youtube: "bg-red-600",
  hackernews: "bg-orange-500",
  hacker_news: "bg-orange-500",
  hn: "bg-orange-500",
  github: "bg-slate-800",
};

const platformLabels: Record<string, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  reddit: "Reddit",
  discord: "Discord",
  blog: "Blogs",
  youtube: "YouTube",
  hackernews: "Hacker News",
  hacker_news: "Hacker News",
  hn: "Hacker News",
  github: "GitHub",
};

const sentimentColors: Record<string, string> = {
  POSITIVE: "text-green-600",
  NEGATIVE: "text-red-600",
  NEUTRAL: "text-gray-600",
  MIXED: "text-yellow-600",
};

/** Short labels for compact table column */
const sentimentShortLabel: Record<string, string> = {
  POSITIVE: "Pos",
  NEGATIVE: "Neg",
  NEUTRAL: "Neu",
  MIXED: "Mix",
};

const THEMES_TABLE_COL_COUNT = 10;
const THEMES_DEFAULT_COL_WIDTHS = [10, 7, 10, 28, 8, 10, 5, 6, 5, 11] as const;

function themesTableStorageKey(projectId: string): string {
  return `themes-table-col-widths-${projectId}`;
}

function normalizeThemesColWidths(widths: number[]): number[] {
  if (widths.length !== THEMES_TABLE_COL_COUNT) return [...THEMES_DEFAULT_COL_WIDTHS];
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= 0 || Number.isNaN(sum)) return [...THEMES_DEFAULT_COL_WIDTHS];
  return widths.map((w) => (w / sum) * 100);
}

function loadThemesColWidths(projectId: string): number[] {
  if (typeof window === "undefined") return [...THEMES_DEFAULT_COL_WIDTHS];
  try {
    const raw = localStorage.getItem(themesTableStorageKey(projectId));
    if (!raw) return [...THEMES_DEFAULT_COL_WIDTHS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== THEMES_TABLE_COL_COUNT) {
      return [...THEMES_DEFAULT_COL_WIDTHS];
    }
    const nums = parsed.map((x) => Number(x));
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return [...THEMES_DEFAULT_COL_WIDTHS];
    return normalizeThemesColWidths(nums);
  } catch {
    return [...THEMES_DEFAULT_COL_WIDTHS];
  }
}

const MIN_COL_PCT = 4;

function ThemesColumnResizeHandle({
  onResizeStart,
}: {
  onResizeStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-hidden
      className="absolute right-0 top-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize select-none touch-none hover:bg-primary/20 active:bg-primary/30"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart(e);
      }}
    />
  );
}

export function ThemesAnalysis({
  projectId,
  dateRange,
  sourceFilter,
  languageFilter,
}: ThemesAnalysisProps) {
  const [themes, setThemes] = useState<ProjectThemeData[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("all");
  const [matches, setMatches] = useState<ThemeMatch[]>([]);
  /** Per-theme and total counts for current filters (sources, date, language); used in Filter by Theme dropdown */
  const [filteredThemeCounts, setFilteredThemeCounts] = useState<Record<string, number> | null>(
    null
  );
  const [filteredTotalMatches, setFilteredTotalMatches] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<
    "theme" | "platform" | "author" | "sentiment" | "engagement" | "date" | "read" | "response"
  >("engagement");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMatch, setSelectedMatch] = useState<ThemeMatch | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const itemsPerPage = 10;
  const { toast } = useToast();

  const themesTableContainerRef = useRef<HTMLDivElement>(null);
  const [themesColWidths, setThemesColWidths] = useState<number[]>(() => [
    ...THEMES_DEFAULT_COL_WIDTHS,
  ]);

  useEffect(() => {
    setThemesColWidths(loadThemesColWidths(projectId));
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(themesTableStorageKey(projectId), JSON.stringify(themesColWidths));
    } catch {
      // ignore quota / private mode
    }
  }, [themesColWidths, projectId]);

  const handleThemesColumnResizeStart = useCallback(
    (pairIndex: number, e: ReactMouseEvent) => {
      e.preventDefault();
      const container = themesTableContainerRef.current;
      if (!container) return;
      const startX = e.clientX;
      const startWidths = [...themesColWidths];
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        const w = container.offsetWidth;
        if (w <= 0) return;
        const deltaPct = ((moveEvent.clientX - startX) / w) * 100;
        const a = startWidths[pairIndex];
        const b = startWidths[pairIndex + 1];
        const pair = a + b;
        const newA = Math.min(Math.max(a + deltaPct, MIN_COL_PCT), pair - MIN_COL_PCT);
        const newB = pair - newA;
        setThemesColWidths((prev) => {
          const next = [...prev];
          next[pairIndex] = newA;
          next[pairIndex + 1] = newB;
          return next;
        });
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [themesColWidths]
  );

  useEffect(() => {
    loadThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Refetch matches when theme analysis is re-run (from Theme Manager or Global Actions)
  useEffect(() => {
    const handler = (e: CustomEvent<{ projectId: string }>) => {
      if (e.detail?.projectId === projectId && themes.length > 0) {
        loadMatches();
      }
    };
    window.addEventListener("theme-analysis-completed", handler as EventListener);
    return () => window.removeEventListener("theme-analysis-completed", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, themes.length]);

  useEffect(() => {
    const handler = (e: CustomEvent<{ projectId: string }>) => {
      if (e.detail?.projectId === projectId && themes.length > 0) {
        loadMatches();
      }
    };
    window.addEventListener("theme-responses-generated", handler as EventListener);
    return () => window.removeEventListener("theme-responses-generated", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, themes.length]);

  useEffect(() => {
    if (themes.length > 0) {
      loadMatches();
    } else if (!loading) {
      // No themes, but not initial load - set loading to false
      setLoading(false);
    }
    // Reset to first page when filters change
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedThemeId, dateRange, sourceFilter, languageFilter, themes.length]);

  async function loadThemes() {
    setLoading(true);
    try {
      const result = await getProjectThemes(projectId);
      if (result.success && result.themes) {
        setThemes(result.themes);
        if (result.themes.length === 0) {
          setLoading(false); // No themes, stop loading
        }
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error("Error loading themes:", error);
      setLoading(false);
    }
  }

  async function loadMatches() {
    setLoading(true);
    try {
      const result = await getStoredThemesAnalysis(projectId, {
        themeId: selectedThemeId !== "all" ? selectedThemeId : undefined,
        platforms: sourceFilter,
        minRelevance: 50,
        limit: 100,
        dateRange: dateRange || "all",
        language: languageFilter,
      });

      if (result.success && result.matches) {
        // Server-side deduplication already handles thread-based deduplication
        // (one entry per thread per theme, preferring root posts)
        setMatches(result.matches);
        setFilteredThemeCounts(result.themeCounts ?? null);
        setFilteredTotalMatches(result.totalMatches ?? null);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to load theme matches",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading matches:", error);
      toast({
        title: "Error",
        description: "Failed to load themes data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSort(column: typeof sortBy) {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  }

  function getSortedMatches(): ThemeMatch[] {
    const sorted = [...matches];

    sorted.sort((a, b) => {
      let comparison = 0;
      let shouldNegate = true; // Track if we need negation at the end

      switch (sortBy) {
        case "theme":
          comparison = (a.theme_name || "").localeCompare(b.theme_name || "");
          break;
        case "platform":
          comparison = a.platform.localeCompare(b.platform);
          break;
        case "author":
          comparison = (a.author_name || "").localeCompare(b.author_name || "");
          break;
        case "sentiment":
          // Custom sentiment order
          // Ascending order: POSITIVE → NEGATIVE → MIXED → NEUTRAL → NULL
          // Descending order: NEGATIVE → MIXED → POSITIVE → NEUTRAL → NULL

          const aSentiment = a.sentiment || "";
          const bSentiment = b.sentiment || "";

          // Define custom order for both directions
          if (sortOrder === "asc") {
            // Ascending: POSITIVE(1) → NEGATIVE(2) → MIXED(3) → NEUTRAL(4) → NULL(5)
            const ascOrder: Record<string, number> = {
              POSITIVE: 1,
              NEGATIVE: 2,
              MIXED: 3,
              NEUTRAL: 4,
            };
            const aOrder = ascOrder[aSentiment] ?? 5;
            const bOrder = ascOrder[bSentiment] ?? 5;
            comparison = aOrder - bOrder;
          } else {
            // Descending: NEGATIVE(1) → MIXED(2) → POSITIVE(3) → NEUTRAL(4) → NULL(5)
            const descOrder: Record<string, number> = {
              NEGATIVE: 1,
              MIXED: 2,
              POSITIVE: 3,
              NEUTRAL: 4,
            };
            const aOrder = descOrder[aSentiment] ?? 5;
            const bOrder = descOrder[bSentiment] ?? 5;
            comparison = aOrder - bOrder;
          }
          shouldNegate = false; // Don't negate, already handled
          break;
        case "engagement":
          comparison = (a.total_reactions || 0) - (b.total_reactions || 0);
          break;
        case "date":
          const dateA = a.posted_at ? new Date(a.posted_at).getTime() : 0;
          const dateB = b.posted_at ? new Date(b.posted_at).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case "read": {
          const ar = a.is_read ? 1 : 0;
          const br = b.is_read ? 1 : 0;
          comparison = ar - br;
          break;
        }
        case "response": {
          const rank = (m: ThemeMatch) =>
            m.has_response ? 2 : m.has_response_generation_error ? 1 : 0;
          comparison = rank(a) - rank(b);
          break;
        }
      }

      return shouldNegate && sortOrder === "desc" ? -comparison : comparison;
    });

    // Apply pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sorted.slice(startIndex, endIndex);
  }

  const totalPages = Math.ceil(matches.length / itemsPerPage);

  function buildThemeEngagementOpenHref(m: ThemeMatch): string {
    const dest = getThemeMatchDestinationUrl(m);
    if (!dest) return "";
    return `/api/engagement/open?projectId=${encodeURIComponent(projectId)}&source=themes&sourceId=${encodeURIComponent(m.id)}&postId=${String(m.post_id)}&platform=${encodeURIComponent(m.platform)}&dest=${encodeURIComponent(dest)}`;
  }

  function applyReadToMatchesWithSameDestination(
    matchId: string,
    dest: string | null,
    read: boolean
  ) {
    setMatches((prev) =>
      prev.map((m) => {
        if (dest && getThemeMatchDestinationUrl(m) === dest) {
          return { ...m, is_read: read };
        }
        if (!dest && m.id === matchId) {
          return { ...m, is_read: read };
        }
        return m;
      })
    );
  }

  /** Engagement route marks read server-side; update UI so the Read checkbox updates immediately. */
  function markReadOptimisticForEngagementLink(match: ThemeMatch) {
    const dest = getThemeMatchDestinationUrl(match);
    applyReadToMatchesWithSameDestination(match.id, dest, true);
    setSelectedMatch((prev) => (prev && prev.id === match.id ? { ...prev, is_read: true } : prev));
  }

  const handleMatchClick = async (match: ThemeMatch) => {
    const dest = getThemeMatchDestinationUrl(match);
    const result = await setThemesAnalysisReadState(projectId, match.id, true);
    if (result.success) {
      applyReadToMatchesWithSameDestination(match.id, dest, true);
      setSelectedMatch({ ...match, is_read: true });
    } else {
      toast({
        title: "Could not update read state",
        description: result.error || "Please try again",
        variant: "destructive",
      });
      setSelectedMatch(match);
    }
    setIsDialogOpen(true);
  };

  const handleReadCheckboxChange = async (match: ThemeMatch, checked: boolean) => {
    const dest = getThemeMatchDestinationUrl(match);
    const result = await setThemesAnalysisReadState(projectId, match.id, checked);
    if (result.success) {
      applyReadToMatchesWithSameDestination(match.id, dest, checked);
    } else {
      toast({
        title: "Could not update read state",
        description: result.error || "Please try again",
        variant: "destructive",
      });
    }
  };

  const exportToCSV = async () => {
    try {
      setLoading(true);

      // Fetch all filtered matches (not just paginated ones) with higher limit
      const result = await getStoredThemesAnalysis(projectId, {
        themeId: selectedThemeId !== "all" ? selectedThemeId : undefined,
        platforms: sourceFilter,
        minRelevance: 50,
        limit: 10000, // High limit to get all matches
        dateRange: dateRange || "all",
        language: languageFilter,
      });

      if (!result.success || !result.matches || result.matches.length === 0) {
        toast({
          title: "No Data",
          description: "No theme matches to export",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const allMatches = dedupeThemeMatchesForExport(result.matches);
      const csvContent = buildThemesCsvContent(allMatches);

      // Create blob and download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);

      // Generate filename with timestamp
      const timestamp = formatDate(new Date(), "yyyy-MM-dd_HH-mm-ss");
      const filename = `themes-export-${timestamp}.csv`;

      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up URL
      URL.revokeObjectURL(url);

      toast({
        title: "Export Complete",
        description: `Exported ${allMatches.length} theme matches to CSV`,
      });
    } catch (error) {
      console.error("Error exporting to CSV:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export theme matches to CSV",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Themes Analysis
            </CardTitle>
            <CardDescription>Track user-defined themes in conversations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading themes...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (themes.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              Themes Analysis
            </CardTitle>
            <CardDescription>Track user-defined themes in conversations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <Tags className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Themes Defined</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-4">
                Define themes to track specific topics like &ldquo;cost of service&rdquo;,
                &ldquo;security concerns&rdquo;, or &ldquo;user experience&rdquo;.
              </p>
              <Button asChild>
                <Link href={`/projects/${projectId}/edit`}>
                  <Settings className="mr-2 h-4 w-4" />
                  Manage Themes
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-5 w-5" />
                Themes Analysis ({matches.length})
              </CardTitle>
              <CardDescription>Posts and discussions matching your defined themes</CardDescription>
            </div>
            <div className="flex gap-2">
              {matches.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportToCSV} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download CSV
                    </>
                  )}
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}/edit`}>
                  <Settings className="mr-2 h-4 w-4" />
                  Manage Themes
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Filter by Theme:</label>
            <Select value={selectedThemeId} onValueChange={setSelectedThemeId}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="All themes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All Themes
                  {(() => {
                    const total =
                      filteredTotalMatches ??
                      themes.reduce((sum, theme) => sum + (theme.matchCount || 0), 0);
                    return total > 0 ? ` (${total} matches)` : "";
                  })()}
                </SelectItem>
                {themes.map((theme) => {
                  const displayCount =
                    filteredThemeCounts != null
                      ? (filteredThemeCounts[theme.id] ?? 0)
                      : theme.matchCount !== undefined && theme.matchCount !== null
                        ? theme.matchCount
                        : selectedThemeId === theme.id
                          ? matches.length
                          : 0;

                  return (
                    <SelectItem key={theme.id} value={theme.id}>
                      {theme.theme_name} ({displayCount} matches)
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {matches.length === 0 ? (
            <div className="text-center py-12">
              <Tags className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Matches Found</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                No posts were found matching the selected theme. Try selecting a different theme or
                adjust your filters.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div ref={themesTableContainerRef} className="rounded-md border min-w-0">
                <p className="sr-only">
                  Drag the vertical resize handles between column headers to adjust column widths.
                </p>
                <Table
                  wrapperClassName="overflow-x-hidden"
                  className="table-fixed w-full text-xs [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-1.5"
                >
                  <colgroup>
                    {themesColWidths.map((w, i) => (
                      <col key={i} style={{ width: `${w}%` }} />
                    ))}
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="relative border-r border-border/90">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-start whitespace-normal px-1 py-1 text-xs font-medium"
                          onClick={() => handleSort("theme")}
                        >
                          <span className="min-w-0 break-words text-left">Theme</span>
                          {sortBy === "theme" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(0, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-start whitespace-normal px-1 py-1 text-xs font-medium"
                          onClick={() => handleSort("platform")}
                        >
                          <span className="min-w-0 break-words text-left">Platform</span>
                          {sortBy === "platform" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(1, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-start whitespace-normal px-1 py-1 text-xs font-medium"
                          onClick={() => handleSort("author")}
                        >
                          <span className="min-w-0 break-words text-left">Author</span>
                          {sortBy === "author" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(2, e)}
                        />
                      </TableHead>
                      <TableHead className="relative min-w-0 border-r border-border/90">
                        <span className="block min-w-0 break-words text-xs font-medium leading-snug text-muted-foreground">
                          Content
                        </span>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(3, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-start whitespace-normal px-1 py-1 text-xs font-medium"
                          onClick={() => handleSort("sentiment")}
                        >
                          <span className="min-w-0 break-words text-left">Sentiment</span>
                          {sortBy === "sentiment" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(4, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-end whitespace-normal px-1 py-1 text-xs font-medium"
                          onClick={() => handleSort("engagement")}
                        >
                          <span className="min-w-0 break-words text-right">Engagement</span>
                          {sortBy === "engagement" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(5, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-start justify-start whitespace-normal px-0.5 py-1 text-xs font-medium"
                          onClick={() => handleSort("date")}
                        >
                          <span className="min-w-0 break-words text-left">Posted</span>
                          {sortBy === "date" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(6, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-center justify-center whitespace-normal px-0.5 py-1 text-xs font-medium"
                          onClick={() => handleSort("read")}
                        >
                          <span className="min-w-0 break-words">Read</span>
                          {sortBy === "read" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(7, e)}
                        />
                      </TableHead>
                      <TableHead className="relative border-r border-border/90 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 max-w-full min-w-0 items-center justify-center whitespace-normal px-0.5 py-1 text-xs font-medium"
                          onClick={() => handleSort("response")}
                        >
                          <span className="min-w-0 break-words">Response</span>
                          {sortBy === "response" ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
                          )}
                        </Button>
                        <ThemesColumnResizeHandle
                          onResizeStart={(e) => handleThemesColumnResizeStart(8, e)}
                        />
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="inline-block min-w-0 max-w-full break-words text-xs font-medium leading-snug text-muted-foreground">
                          Story
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getSortedMatches().map((match) => (
                      <TableRow key={match.id}>
                        <TableCell className={cn("align-top border-r border-border/90")}>
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-medium leading-tight line-clamp-2">
                              {match.theme_name}
                            </div>
                            {match.relevance_score != null && match.relevance_score > 0 && (
                              <div
                                className="text-[10px] text-muted-foreground leading-tight"
                                title="Theme match score (how well the post fits this theme). Reply generation is a separate step and may still be skipped or fail."
                              >
                                Theme match {match.relevance_score}%
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={cn("align-top border-r border-border/90")}>
                          <Badge
                            className={`${platformColors[normalizePlatformForDisplay(match.platform)] || "bg-gray-600"} px-1.5 py-0 text-[10px] text-white`}
                          >
                            {platformLabels[normalizePlatformForDisplay(match.platform)] ||
                              match.platform}
                          </Badge>
                        </TableCell>
                        <TableCell className={cn("align-top min-w-0 border-r border-border/90")}>
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-medium leading-tight line-clamp-2 break-words">
                              {match.author_name || "Unknown"}
                            </div>
                            {match.platform.toLowerCase() === "discord" && match.discord_server && (
                              <div className="text-[10px] text-muted-foreground line-clamp-1">
                                {match.discord_server}
                              </div>
                            )}
                            {match.participant_names && match.participant_names.length > 1 && (
                              <div className="text-[10px] text-muted-foreground">
                                +{match.participant_names.length - 1}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={cn("min-w-0 align-top border-r border-border/90")}>
                          <p className="line-clamp-2 min-w-0 break-words leading-snug text-[11px] text-muted-foreground">
                            {match.post_content || "No content available"}
                          </p>
                        </TableCell>
                        <TableCell className={cn("align-top border-r border-border/90")}>
                          {match.sentiment && (
                            <Badge
                              variant="secondary"
                              className={`px-1.5 py-0.5 text-[11px] font-normal ${sentimentColors[match.sentiment]}`}
                            >
                              {sentimentShortLabel[match.sentiment] ?? match.sentiment}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right align-top border-r border-border/90")}>
                          <div className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums leading-tight">
                            <span className="inline-flex items-center gap-0.5">
                              <Heart className="h-3 w-3 shrink-0 text-red-500" />
                              {match.likes}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <MessageCircle className="h-3 w-3 shrink-0 text-blue-500" />
                              {match.comments}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <Share2 className="h-3 w-3 shrink-0 text-green-500" />
                              {match.shares}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "align-top whitespace-nowrap px-1 border-r border-border/90"
                          )}
                        >
                          {match.posted_at && (
                            <div
                              className="text-[9px] text-muted-foreground leading-tight tracking-tight"
                              title={formatDistanceToNow(new Date(match.posted_at), {
                                addSuffix: true,
                              })}
                            >
                              {formatDate(new Date(match.posted_at), "M/d")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn("align-top border-r border-border/90 text-center")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={!!match.is_read}
                            onCheckedChange={(v) => {
                              void handleReadCheckboxChange(match, v === true);
                            }}
                            className="mx-auto"
                            aria-label={match.is_read ? "Mark as unread" : "Mark as read"}
                          />
                        </TableCell>
                        <TableCell className="text-center align-top border-r border-border/90">
                          <div className="mx-auto flex min-h-[1rem] flex-wrap items-center justify-center gap-0.5">
                            {match.has_response ? (
                              <Check
                                className="h-4 w-4 shrink-0 text-green-600"
                                aria-label="At least one generated response stored"
                              />
                            ) : null}
                            {match.has_response_generation_error ? (
                              <span
                                className="inline-flex"
                                title={
                                  match.response_generation_failures
                                    ?.map((f) => `${f.objective_name}: ${f.message}`)
                                    .join("\n\n") ?? "Generation error"
                                }
                              >
                                <AlertTriangle
                                  className="h-4 w-4 shrink-0 text-amber-600"
                                  aria-label="Response generation failed for at least one objective"
                                />
                              </span>
                            ) : null}
                            {!match.has_response && !match.has_response_generation_error ? (
                              <span className="text-muted-foreground text-[10px]">—</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <div className="flex items-center justify-center gap-0.5">
                            {getThemeMatchDestinationUrl(match) ? (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                                <EngagementOpenLink
                                  hrefBase={buildThemeEngagementOpenHref(match)}
                                  platform={match.platform}
                                  onClick={() => markReadOptimisticForEngagementLink(match)}
                                >
                                  <span className="inline-flex items-center">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span className="sr-only">Open original post</span>
                                  </span>
                                </EngagementOpenLink>
                              </Button>
                            ) : (
                              <span
                                className="inline-flex h-7 w-7 items-center justify-center text-[10px] text-muted-foreground"
                                title="No URL stored for this post"
                              >
                                —
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleMatchClick(match)}
                              className="h-7 w-7 p-0 hover:bg-muted"
                              title="Details"
                            >
                              <Info className="h-3.5 w-3.5" />
                              <span className="sr-only">Details</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {(currentPage - 1) * itemsPerPage + 1}-
                    {Math.min(currentPage * itemsPerPage, matches.length)} of {matches.length}{" "}
                    themes
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post Details</DialogTitle>
            {selectedMatch?.platform && (
              <div className="mt-2">
                <Badge
                  className={`${platformColors[normalizePlatformForDisplay(selectedMatch.platform)] || "bg-gray-600"} text-white ml-0`}
                >
                  {platformLabels[normalizePlatformForDisplay(selectedMatch.platform)] ||
                    selectedMatch.platform}
                </Badge>
              </div>
            )}
          </DialogHeader>

          {selectedMatch && (
            <div className="space-y-4 mt-4">
              {getThemeMatchDestinationUrl(selectedMatch) && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    Original story
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <EngagementOpenLink
                      hrefBase={buildThemeEngagementOpenHref(selectedMatch)}
                      platform={selectedMatch.platform}
                      onClick={() => markReadOptimisticForEngagementLink(selectedMatch)}
                    >
                      <span className="inline-flex items-center">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open original{" "}
                        {platformLabels[normalizePlatformForDisplay(selectedMatch.platform)] ||
                          selectedMatch.platform}
                      </span>
                    </EngagementOpenLink>
                  </Button>
                </div>
              )}

              {/* Theme */}
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Theme</div>
                <div className="text-base font-semibold">{selectedMatch.theme_name}</div>
                {selectedMatch.relevance_score != null && selectedMatch.relevance_score > 0 && (
                  <div
                    className="text-xs text-muted-foreground mt-1"
                    title="Theme match score is not a guarantee that a reply was generated."
                  >
                    Theme match: {selectedMatch.relevance_score}% (fits this theme; replies are
                    generated separately)
                  </div>
                )}
              </div>

              {/* Author */}
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Author</div>
                <div className="text-base">{selectedMatch.author_name || "Unknown"}</div>
                {selectedMatch.platform.toLowerCase() === "discord" &&
                  selectedMatch.discord_server && (
                    <div className="text-sm text-muted-foreground mt-1">
                      Server: {selectedMatch.discord_server}
                    </div>
                  )}
                {selectedMatch.participant_names && selectedMatch.participant_names.length > 1 && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Participants: {selectedMatch.participant_names.join(", ")}
                  </div>
                )}
              </div>

              {/* Content */}
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Content</div>
                <div className="text-base whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                  {selectedMatch.post_content || "No content available"}
                </div>
              </div>

              {/* Sentiment */}
              {selectedMatch.sentiment && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Sentiment</div>
                  <Badge variant="secondary" className={sentimentColors[selectedMatch.sentiment]}>
                    {selectedMatch.sentiment}
                  </Badge>
                </div>
              )}

              {selectedMatch.response_generation_failures &&
                selectedMatch.response_generation_failures.length > 0 && (
                  <div className="space-y-2 rounded-md border border-amber-600/40 bg-amber-500/10 p-3">
                    <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
                      Response generation failed
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The reply step errored after relevance passed. Theme match % above is not a
                      promise of a reply.
                    </p>
                    <ul className="list-disc space-y-2 pl-4 text-sm">
                      {selectedMatch.response_generation_failures.map((f) => (
                        <li key={f.objective_id}>
                          <span className="font-medium">{f.objective_name}</span>
                          <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {f.message}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Generated responses (per objective) */}
              {selectedMatch.response_entries && selectedMatch.response_entries.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <div className="text-sm font-medium text-muted-foreground">Responses</div>
                  {selectedMatch.response_entries.map((r) => (
                    <div
                      key={r.objective_id}
                      className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm"
                    >
                      <div className="font-semibold">{r.objective_name}</div>
                      <div className="text-xs text-muted-foreground">
                        Relevance: {Math.round(r.relevance_score * 100)}% · Persona: {r.persona}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Reasoning: </span>
                        {r.reasoning}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Target: </span>
                        {r.target_user}
                      </div>
                      <div className="whitespace-pre-wrap break-words rounded bg-background p-2 border text-sm">
                        {r.response_text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Engagement */}
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">Engagement</div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-red-500" />
                    <span className="text-sm">{selectedMatch.likes}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-blue-500" />
                    <span className="text-sm">{selectedMatch.comments}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Share2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm">{selectedMatch.shares}</span>
                  </div>
                </div>
              </div>

              {/* Date */}
              {selectedMatch.posted_at && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Posted</div>
                  <div className="text-sm">
                    {formatDistanceToNow(new Date(selectedMatch.posted_at), { addSuffix: true })}
                    {selectedMatch.platform.toLowerCase() === "discord" &&
                      " • " + new Date(selectedMatch.posted_at).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Discord-specific information */}
              {selectedMatch.platform.toLowerCase() === "discord" && (
                <>
                  {selectedMatch.discord_server && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-1">Server</div>
                      <div className="text-sm font-semibold">{selectedMatch.discord_server}</div>
                    </div>
                  )}
                  {(selectedMatch.discord_channel_id || selectedMatch.discord_channel) && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-1">Channel</div>
                      <div className="text-sm font-semibold">
                        {selectedMatch.discord_channel?.trim() ||
                          selectedMatch.discord_channel_id ||
                          selectedMatch.discord_channel ||
                          "—"}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-start">
            {selectedMatch && getThemeMatchDestinationUrl(selectedMatch) && (
              <Button asChild variant="secondary" size="sm">
                <EngagementOpenLink
                  hrefBase={buildThemeEngagementOpenHref(selectedMatch)}
                  platform={selectedMatch.platform}
                  onClick={() => markReadOptimisticForEngagementLink(selectedMatch)}
                >
                  <span className="inline-flex items-center">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open original story
                  </span>
                </EngagementOpenLink>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
