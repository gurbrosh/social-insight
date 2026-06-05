"use client";

import { useState, useEffect, useCallback } from "react";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ScrapeJob {
  id: string;
  status: string;
  created_at: string;
  posts_count: number;
  scraper: {
    name: string;
    platform: string;
    externalName?: string;
    descriptive_name?: string;
  };
}

interface AnalysisLog {
  timestamp: string;
  mode?: string;
  source?: string;
  processed: number;
  analysisBreakdown?: {
    conversations: number;
    sentimentAnalyzed: number;
    influentialPeople: number;
    newsItems: number;
    themesMatched: number;
  };
}

interface RecentScrapesProps {
  projectId: string;
}

export function RecentScrapes({ projectId }: RecentScrapesProps) {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [latestAnalysis, setLatestAnalysis] = useState<AnalysisLog | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);

  const fetchJobs = useCallback(
    async (page: number = 1, options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) {
          setLoading(true);
        }

        const params = new URLSearchParams({
          projectId,
          page: page.toString(),
          limit: "5",
        });

        const response = await fetch(`/api/projects/${projectId}/jobs/recent?${params}`);
        if (!response.ok) throw new Error("Failed to fetch jobs");

        const data = await response.json();
        setJobs(data.jobs || []);
        setCurrentPage(data.pagination.page);
        setTotalPages(data.pagination.totalPages);
        setTotalJobs(data.pagination.totalJobs);
      } catch (error) {
        console.error("Error fetching recent jobs:", error);
        toast({
          title: "Error",
          description: "Failed to load scrape jobs. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [projectId, toast]
  );

  useEffect(() => {
    fetchJobs(currentPage);
  }, [fetchJobs, currentPage]);

  const fetchAnalysisLogs = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) {
          setAnalysisLoading(true);
        }

        const response = await fetch(`/api/projects/${projectId}/analysis/logs?limit=5`);
        if (!response.ok) throw new Error("Failed to fetch analysis logs");

        const data = await response.json();
        setLatestAnalysis(data.logs && data.logs.length > 0 ? data.logs[0] : null);
      } catch (error) {
        console.error("Error fetching analysis logs:", error);
        toast({
          title: "Error",
          description: "Failed to load analysis activity.",
          variant: "destructive",
        });
      } finally {
        setAnalysisLoading(false);
      }
    },
    [projectId, toast]
  );

  useEffect(() => {
    fetchAnalysisLogs();
  }, [fetchAnalysisLogs]);

  const pollJobsAndLogs = useCallback(() => {
    void fetchJobs(currentPage, { silent: true });
    void fetchAnalysisLogs({ silent: true });
  }, [fetchJobs, fetchAnalysisLogs, currentPage]);

  useVisibilityAwarePolling({
    onPoll: pollJobsAndLogs,
    /** Two fetches per tick (jobs + analysis logs); keep slow while analysis runs on SQLite. */
    intervalMs: 120_000,
    hiddenIntervalMs: 180_000,
    enabled: true,
  });

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const formatAnalysisMode = (mode?: string) => {
    switch (mode) {
      case "sentiment-only":
        return "Sentiment analysis";
      case "partial":
        return "Partial pipeline";
      case "full":
        return "Full pipeline";
      default:
        return "Analysis run";
    }
  };

  const formatAnalysisSource = (source?: string) => {
    switch (source) {
      case "manual":
        return "Manual run";
      case "orchestration":
        return "Scheduled orchestration";
      default:
        return source ? source.charAt(0).toUpperCase() + source.slice(1) : "Analysis";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Jobs</CardTitle>
        <CardDescription>
          Latest scraping jobs and analysis activity ({totalJobs} total jobs)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3 bg-muted/40">
          {analysisLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
              <div className="h-3 w-48 rounded bg-muted" />
            </div>
          ) : latestAnalysis ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Latest Analysis Run
                  </p>
                  <p className="text-sm font-medium">{formatAnalysisMode(latestAnalysis.mode)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAnalysisSource(latestAnalysis.source)} •{" "}
                    {new Date(latestAnalysis.timestamp).toLocaleString()}
                  </p>
                </div>
                <Badge variant="outline">
                  {latestAnalysis.analysisBreakdown?.sentimentAnalyzed ?? latestAnalysis.processed}{" "}
                  posts processed
                </Badge>
              </div>

              {latestAnalysis.analysisBreakdown && (
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                  <span>
                    <span className="font-medium text-foreground">
                      {latestAnalysis.analysisBreakdown.sentimentAnalyzed}
                    </span>{" "}
                    sentiment
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {latestAnalysis.analysisBreakdown.conversations}
                    </span>{" "}
                    conversations
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {latestAnalysis.analysisBreakdown.influentialPeople}
                    </span>{" "}
                    influencers
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {latestAnalysis.analysisBreakdown.newsItems}
                    </span>{" "}
                    news items
                  </span>
                  <span>
                    <span className="font-medium text-foreground">
                      {latestAnalysis.analysisBreakdown.themesMatched}
                    </span>{" "}
                    theme matches
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No analysis runs recorded yet.</p>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 border rounded-lg animate-pulse"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-32 bg-muted rounded" />
                    <div className="h-5 w-20 bg-muted rounded" />
                  </div>
                  <div className="h-4 w-40 bg-muted rounded" />
                </div>
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            No scrapes yet. Run your first scrape to start collecting data.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {jobs.map((job) => {
                const displayName =
                  job.scraper.externalName ?? job.scraper.descriptive_name ?? job.scraper.name;

                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{displayName}</span>
                        <Badge
                          variant={
                            job.status === "COMPLETED"
                              ? "default"
                              : job.status === "FAILED"
                                ? "destructive"
                                : job.status === "RUNNING"
                                  ? "secondary"
                                  : "outline"
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{job.posts_count} posts</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
