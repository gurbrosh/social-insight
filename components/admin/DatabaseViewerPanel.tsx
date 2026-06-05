"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Database,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Trash2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { getDatabaseTables, getTableData } from "@/app/actions/admin";
import type { DatabaseTable, TableData } from "@/app/actions/admin";
import { SourceMentionAdminPanel } from "@/components/admin/SourceMentionAdminPanel";
import { HnBulkTableAdminPanel } from "@/components/admin/HnBulkTableAdminPanel";

export function DatabaseViewerPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const selectedTable = searchParams.get("table");
  const isBlogNewsAnalysis =
    selectedTable === "BlogNewsAnalysis" || selectedTable === "blognewsanalysis";
  const isSourceMentionTable =
    selectedTable === "SourceMention" || selectedTable?.toLowerCase() === "sourcemention";
  const isHnStoryCommentThemeTable =
    selectedTable === "HnStoryCommentTheme" ||
    selectedTable?.toLowerCase() === "hnstorycommenttheme";
  const isHnStoryAnalysisTable =
    selectedTable === "HnStoryAnalysis" || selectedTable?.toLowerCase() === "hnstoryanalysis";
  const currentPage = parseInt(searchParams.get("page") || "1");
  const sortColumn = searchParams.get("sortBy");
  const sortDirection = (searchParams.get("sortDir") || "asc") as "asc" | "desc";
  const itemsPerPage = 100;

  // Load tables on mount
  useEffect(() => {
    loadTables();
  }, []);

  // Load table data when URL params change
  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable, currentPage, sortColumn, sortDirection);
    } else {
      setTableData(null);
    }
  }, [selectedTable, currentPage, sortColumn, sortDirection]);

  const loadTables = async () => {
    try {
      setLoading(true);
      setError(null);
      const tablesData = await getDatabaseTables();
      setTables(tablesData);
    } catch (err) {
      setError("Failed to load database tables");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadTableData = async (
    tableName: string,
    page: number = 1,
    sortCol: string | null,
    sortDir: "asc" | "desc"
  ) => {
    try {
      setTableLoading(true);
      setError(null);
      const data = await getTableData(tableName, page, itemsPerPage, sortCol || undefined, sortDir);
      setTableData(data);
    } catch (err) {
      setError(`Failed to load data from table: ${tableName}`);
      console.error(err);
    } finally {
      setTableLoading(false);
    }
  };

  const handleTableClick = (tableName: string) => {
    router.push(`/admin/database?table=${encodeURIComponent(tableName)}&page=1`);
  };

  const handleBackToTables = () => {
    router.push("/admin/database");
  };

  const handlePreviousPage = () => {
    if (currentPage > 1 && selectedTable) {
      const params = new URLSearchParams();
      params.set("table", selectedTable);
      params.set("page", String(currentPage - 1));
      if (sortColumn) {
        params.set("sortBy", sortColumn);
        params.set("sortDir", sortDirection);
      }
      router.push(`/admin/database?${params.toString()}`);
    }
  };

  const handleNextPage = () => {
    if (
      tableData &&
      currentPage < Math.ceil(Number(tableData.totalCount) / itemsPerPage) &&
      selectedTable
    ) {
      const params = new URLSearchParams();
      params.set("table", selectedTable);
      params.set("page", String(currentPage + 1));
      if (sortColumn) {
        params.set("sortBy", sortColumn);
        params.set("sortDir", sortDirection);
      }
      router.push(`/admin/database?${params.toString()}`);
    }
  };

  const handleSort = (column: string) => {
    if (!selectedTable) return;

    const params = new URLSearchParams();
    params.set("table", selectedTable);
    params.set("page", "1"); // Reset to page 1 when sorting changes

    if (sortColumn === column) {
      // Same column clicked
      if (sortDirection === "asc") {
        params.set("sortBy", column);
        params.set("sortDir", "desc");
      } else {
        // Remove sorting (third click)
        // Don't set sortBy or sortDir to remove them
      }
    } else {
      // Different column clicked
      params.set("sortBy", column);
      params.set("sortDir", "asc");
    }

    router.push(`/admin/database?${params.toString()}`);
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeletePosts = async (deleteType: "test" | "production" | "all") => {
    try {
      setDeleteLoading(true);
      setError(null);

      const response = await fetch("/api/admin/posts/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include cookies for authentication
        body: JSON.stringify({
          deleteType,
          confirmText: "CONFIRMED", // Simple confirmation
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete posts");
      }

      // Refresh table data
      if (selectedTable) {
        await loadTableData(selectedTable, currentPage, sortColumn, sortDirection);
      }

      // Success - posts deleted, no notification needed
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete posts");
      console.error("Delete error:", err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDelete = async (
    currentTable: string | null,
    deleteType: "test" | "production" | "all"
  ) => {
    const isDownstream = currentTable === "DownstreamPost" || currentTable === "downstreampost";
    const endpoint = isDownstream
      ? "/api/admin/downstream-posts/delete"
      : "/api/admin/posts/delete";

    try {
      setDeleteLoading(true);
      setError(null);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deleteType, confirmText: "CONFIRMED" }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Delete failed");
      }

      // Refresh table after deletion
      await loadTableData(selectedTable || "", currentPage, sortColumn, sortDirection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null) return "NULL";
    if (value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const handleExportBlogNewsAnalysisCsv = async () => {
    try {
      setExportLoading(true);
      setError(null);
      const res = await fetch("/api/admin/blog-analysis/export", { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Export failed: ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^";]+)"?/);
      const filename =
        match?.[1] ?? `BlogNewsAnalysis-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading database tables...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // Show table list view
  if (!selectedTable) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Database Tables</h3>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table Name</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((table) => (
                <TableRow
                  key={table.name}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleTableClick(table.name)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <TableIcon className="h-4 w-4 text-muted-foreground" />
                      {table.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{table.rowCount}</TableCell>
                </TableRow>
              ))}
              {tables.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No tables found in the database
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // Show table data view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleBackToTables}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Tables
          </Button>
          <h3 className="text-lg font-semibold">{selectedTable}</h3>
          {tableData && (
            <Badge variant="secondary">{Number(tableData.totalCount)} total rows</Badge>
          )}
        </div>
        {isBlogNewsAnalysis && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportBlogNewsAnalysisCsv}
            disabled={exportLoading}
          >
            {exportLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download CSV
          </Button>
        )}
      </div>

      {isHnStoryCommentThemeTable && (
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">HN comment themes (ingest)</p>
            <p>
              One row per Hacker News story (<span className="font-mono text-xs">hn_story_id</span>
              ). The field <span className="font-mono text-xs">comment_themes_summary</span> is an
              LLM summary of themes in the comment thread (from a Firebase sample), not the story
              body. Filled after keyword ingest (see{" "}
              <span className="font-mono text-xs">HN_COMMENT_THEME_SYNC_MAX</span> to cap or
              disable; <span className="font-mono text-xs">HN_INGEST_ALGOLIA_COMMENTS</span> in{" "}
              <span className="font-mono text-xs">.env.example</span>). Project-scoped analysis may
              also store comment text under{" "}
              <span className="font-mono text-xs">HnStoryAnalysis.comments_summary</span>.
            </p>
          </div>
          <HnBulkTableAdminPanel
            apiBase="/api/admin/hn-story-comment-themes"
            cardTitle="HnStoryCommentTheme"
            cardDescription="Export a backup before deleting. Delete all removes every row permanently."
            confirmTitle="Delete all HnStoryCommentTheme rows?"
            confirmDescription={(rowCount) =>
              `This permanently deletes every row in HnStoryCommentTheme (${rowCount ?? "…"}). Export a CSV first if you need a backup.`
            }
            onAfterMutation={() => {
              void loadTables();
              if (selectedTable) {
                void loadTableData(selectedTable, currentPage, sortColumn, sortDirection);
              }
            }}
          />
        </div>
      )}

      {isHnStoryAnalysisTable && (
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">HN story analysis (project)</p>
            <p>
              One row per project + HN story. Ideas, relevance, and{" "}
              <span className="font-mono text-xs">comments_summary</span> live here. Deleting all
              clears analysis rows and unlinks related{" "}
              <span className="font-mono text-xs">Post.hn_story_analysis_id</span> references; it
              does not delete posts.
            </p>
          </div>
          <HnBulkTableAdminPanel
            apiBase="/api/admin/hn-story-analyses"
            cardTitle="HnStoryAnalysis"
            cardDescription="Export a backup before deleting. Delete all removes every analysis row and clears post links to those rows."
            confirmTitle="Delete all HnStoryAnalysis rows?"
            confirmDescription={(rowCount) =>
              `This permanently deletes every row in HnStoryAnalysis (${rowCount ?? "…"}) and sets hn_story_analysis_id to null on linked posts. Export a CSV first if you need a backup.`
            }
            onAfterMutation={() => {
              void loadTables();
              if (selectedTable) {
                void loadTableData(selectedTable, currentPage, sortColumn, sortDirection);
              }
            }}
          />
        </div>
      )}

      {isSourceMentionTable && (
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-sm text-muted-foreground mb-3">
            Hacker News Algolia ingest rows (same controls as{" "}
            <span className="font-medium text-foreground">Admin → Search Sources</span>).
          </p>
          <SourceMentionAdminPanel
            onAfterMutation={() => {
              void loadTables();
              if (selectedTable) {
                void loadTableData(selectedTable, currentPage, sortColumn, sortDirection);
              }
            }}
          />
        </div>
      )}

      {/* Delete Controls - Only show for Post table */}
      {(selectedTable === "Post" ||
        selectedTable === "post" ||
        selectedTable === "DownstreamPost" ||
        selectedTable === "downstreampost") && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h4 className="text-lg font-semibold text-destructive">
              Delete{" "}
              {selectedTable === "DownstreamPost" || selectedTable === "downstreampost"
                ? "Downstream Posts"
                : "Posts"}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Permanently delete{" "}
            {selectedTable === "DownstreamPost" || selectedTable === "downstreampost"
              ? "downstream posts"
              : "posts"}{" "}
            from the database. This action cannot be undone.
          </p>

          <div className="flex flex-wrap gap-2">
            {/* Delete Test Data */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleteLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Test Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive">Delete Test Data</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all{" "}
                    {selectedTable === "DownstreamPost" || selectedTable === "downstreampost"
                      ? "downstream posts"
                      : "posts"}{" "}
                    marked as test data (isTest = true).
                    <br />
                    <br />
                    <strong>This action cannot be undone!</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete(selectedTable, "test")}
                    disabled={deleteLoading}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {deleteLoading ? "Deleting..." : "Delete Test Data"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete Production Data */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleteLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Production Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive">
                    Delete Production Data
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all{" "}
                    {selectedTable === "DownstreamPost" || selectedTable === "downstreampost"
                      ? "downstream posts"
                      : "posts"}{" "}
                    marked as production data (isTest = false).
                    <br />
                    <br />
                    <strong className="text-destructive">
                      WARNING: This will delete all your real data!
                    </strong>
                    <br />
                    <strong>This action cannot be undone!</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete(selectedTable, "production")}
                    disabled={deleteLoading}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {deleteLoading ? "Deleting..." : "Delete Production Data"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete All Data */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleteLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive">Delete All Data</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete ALL{" "}
                    {selectedTable === "DownstreamPost" || selectedTable === "downstreampost"
                      ? "downstream posts"
                      : "posts"}{" "}
                    from the database, including both test and production data.
                    <br />
                    <br />
                    <strong className="text-destructive">
                      WARNING: This will delete everything!
                    </strong>
                    <br />
                    <strong>This action cannot be undone!</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete(selectedTable, "all")}
                    disabled={deleteLoading}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {deleteLoading ? "Deleting..." : "Delete All Data"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      {tableLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="ml-2">Loading table data...</span>
        </div>
      ) : tableData ? (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {tableData.columns.map((column) => (
                    <TableHead key={column} className="font-semibold">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 p-0 font-semibold hover:bg-transparent"
                        onClick={() => handleSort(column)}
                      >
                        <span className="flex items-center gap-1">
                          {column}
                          {getSortIcon(column)}
                        </span>
                      </Button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.rows.length > 0 ? (
                  tableData.rows.map((row, index) => (
                    <TableRow key={index}>
                      {tableData.columns.map((column) => (
                        <TableCell key={column} className="max-w-xs truncate">
                          <span className="font-mono text-sm">{formatCellValue(row[column])}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={tableData.columns.length}
                      className="text-center text-muted-foreground"
                    >
                      No data found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {Number(tableData.totalCount) > itemsPerPage && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                {Math.min(currentPage * itemsPerPage, Number(tableData.totalCount))} of{" "}
                {Number(tableData.totalCount)} rows
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {Math.ceil(Number(tableData.totalCount) / itemsPerPage)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage >= Math.ceil(Number(tableData.totalCount) / itemsPerPage)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
