"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Newspaper,
  Calendar,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generatePostLink } from "@/lib/post-links";
import { getSourceFilterDbValues, isFullSourceFilterSelection } from "@/lib/utils/platform";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { formatPostDateTime, getDateRangeFilter } from "@/lib/utils/date-formatter";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  sentiment: string | null;
  importance_score: number | null;
  tags: string[];
  sources: string[];
  post_ids: number[];
  date_range_start: Date | null;
  date_range_end: Date | null;
  created_at: Date;
  source_url?: string | null;
  primary_post?: {
    id: number;
    externalId: string;
    platform: string;
    url?: string | null;
    channelId?: string | null;
    createdAt: string;
  } | null;
}

interface NewsAnalysisProps {
  projectId: string;
  dateRange?: string;
  sourceFilter?: string[];
  languageFilter?: string;
}

export function NewsAnalysis({
  projectId,
  dateRange = "all",
  sourceFilter = [],
  languageFilter,
}: NewsAnalysisProps) {
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupedNews, setGroupedNews] = useState<Map<string, NewsItem[]>>(new Map());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchNews();
    setCurrentPage(1); // Reset to first page when filters change
  }, [projectId, dateRange, sourceFilter, languageFilter]);

  useEffect(() => {
    // Re-group when page changes
    if (newsItems.length > 0) {
      const startIndex = (currentPage - 1) * itemsPerPage;
      const paginatedItems = newsItems.slice(startIndex, startIndex + itemsPerPage);

      const grouped = new Map<string, NewsItem[]>();
      paginatedItems.forEach((item: NewsItem) => {
        const date = item.date_range_start
          ? new Date(item.date_range_start)
          : new Date(item.created_at);
        const dateKey = date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        if (!grouped.has(dateKey)) {
          grouped.set(dateKey, []);
        }
        grouped.get(dateKey)!.push(item);
      });

      grouped.forEach((items) => {
        items.sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0));
      });

      setGroupedNews(grouped);
    }
  }, [newsItems, currentPage, itemsPerPage]);

  const fetchNews = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        projectId,
        limit: "100",
        language: languageFilter || "all",
      });
      params.set("sources", (sourceFilter ?? []).join(","));

      const response = await fetch(`/api/news-analysis?${params}`);
      if (!response.ok) throw new Error("Failed to fetch news");

      const data = await response.json();

      // Filter based on global filters
      let filtered = data.newsItems || [];

      // Apply date range filter (same rules as getDateRangeFilter: days:N, today, week, month, quarter)
      if (dateRange && dateRange !== "all") {
        const filter = getDateRangeFilter(dateRange);
        if (filter) {
          const startDate = filter.gte;
          filtered = filtered.filter((item: NewsItem) => {
            const itemDate = item.date_range_start
              ? new Date(item.date_range_start)
              : new Date(item.created_at);
            return itemDate >= startDate;
          });
        }
      }

      // Apply source filter (aligned with server: full selection = no narrowing)
      if (sourceFilter && sourceFilter.length > 0 && !isFullSourceFilterSelection(sourceFilter)) {
        const allowed = new Set<string>();
        for (const s of sourceFilter) {
          for (const v of getSourceFilterDbValues(s)) {
            allowed.add(v.toLowerCase());
          }
        }
        filtered = filtered.filter((item: NewsItem) =>
          item.sources.some((source) => allowed.has(String(source).toLowerCase()))
        );
      }

      // Set all news items (for total count and pagination)
      setNewsItems(filtered);
    } catch (error) {
      console.error("Error fetching news:", error);
      toast({
        title: "Error",
        description: "Failed to load news items. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment?.toUpperCase()) {
      case "POSITIVE":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "NEGATIVE":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "NEUTRAL":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
      case "MIXED":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const getPlatformColor = (platform: string) => {
    const colors: Record<string, string> = {
      reddit: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
      x: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      linkedin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      facebook: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      discord: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
      blog: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
    };
    return (
      colors[platform.toLowerCase()] ||
      "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
    );
  };

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      blog: "Blogs",
      x: "X (Twitter)",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      reddit: "Reddit",
      discord: "Discord",
      youtube: "YouTube",
    };
    return labels[source.toLowerCase()] ?? source;
  };

  const getImportanceBadge = (score?: number | null) => {
    if (!score) return null;

    if (score >= 80) {
      return <Badge className="bg-red-500 text-white">🔥 Hot</Badge>;
    } else if (score >= 60) {
      return <Badge className="bg-orange-500 text-white">⭐ Trending</Badge>;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (newsItems.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="text-center space-y-4">
            <div className="text-6xl mb-4">📰</div>
            <h3 className="text-lg font-semibold">No News Items Found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              No news items match your current filters. Try adjusting the date range or source
              filters, or run news analysis to generate items.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Newspaper className="h-5 w-5 text-muted-foreground" />
              <div>
                <h3 className="font-semibold">{newsItems.length} News Items</h3>
                <p className="text-sm text-muted-foreground">
                  Grouped by {groupedNews.size} {groupedNews.size === 1 ? "day" : "days"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* News Items Grouped by Day */}
      {Array.from(groupedNews.entries())
        .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
        .map(([date, items]) => (
          <div key={date} className="space-y-4">
            {/* Date Header */}
            <div className="flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-2 z-10">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">{date}</h3>
              <Badge variant="secondary">{items.length}</Badge>
            </div>

            {/* News Items for This Day */}
            <div className="space-y-4">
              {items.map((item) => {
                const primaryLink =
                  item.primary_post && item.primary_post.platform && item.primary_post.externalId
                    ? generatePostLink({
                        url: item.primary_post?.url ?? undefined,
                        platform: item.primary_post.platform,
                        postId: item.primary_post.externalId,
                        channelId: item.primary_post?.channelId ?? undefined,
                      })
                    : null;

                return (
                  <Card key={item.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {getImportanceBadge(item.importance_score)}
                            {item.sources.map((source) => (
                              <Badge
                                key={source}
                                variant="outline"
                                className={getPlatformColor(source)}
                              >
                                {getSourceLabel(source)}
                              </Badge>
                            ))}
                            {item.sentiment && (
                              <Badge className={getSentimentColor(item.sentiment)}>
                                {item.sentiment}
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="text-xl leading-tight">{item.title}</CardTitle>
                        </div>
                        {item.importance_score !== null && (
                          <div className="text-right shrink-0">
                            <div className="text-2xl font-bold text-primary">
                              {item.importance_score}
                            </div>
                            <div className="text-xs text-muted-foreground">importance</div>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm leading-relaxed">{item.summary}</p>

                      {(item.source_url || primaryLink) && (
                        <a
                          href={item.source_url || primaryLink || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Link to Post
                        </a>
                      )}

                      {item.content && (
                        <details className="text-sm text-muted-foreground space-y-2">
                          <summary className="cursor-pointer hover:text-foreground">
                            Read more…
                          </summary>
                          <p className="mt-2 leading-relaxed">{item.content}</p>
                          {(item.source_url || primaryLink) && (
                            <a
                              href={item.source_url || primaryLink || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Link to Post
                            </a>
                          )}
                        </details>
                      )}

                      {item.tags.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                          <Sparkles className="h-3 w-3 text-muted-foreground" />
                          {item.tags.map((tag, index) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                        <span>{item.post_ids.length} related posts</span>
                        {item.date_range_start && item.date_range_end && (
                          <span>
                            {new Date(item.date_range_start).toLocaleDateString()} -{" "}
                            {new Date(item.date_range_end).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}

      {/* Pagination */}
      {Math.ceil(newsItems.length / itemsPerPage) > 1 && (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, newsItems.length)} of {newsItems.length} news
                items
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
                  onClick={() =>
                    setCurrentPage((p) =>
                      Math.min(Math.ceil(newsItems.length / itemsPerPage), p + 1)
                    )
                  }
                  disabled={currentPage === Math.ceil(newsItems.length / itemsPerPage)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
