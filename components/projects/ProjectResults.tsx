"use client";

import { useState, useEffect, useCallback } from "react";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ExternalLink,
  Calendar,
  User,
  Globe,
  Filter,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generatePostLink } from "@/lib/post-links";
import { formatPostDateTime } from "@/lib/utils/date-formatter";

interface Post {
  id: number;
  platform: string;
  postId: string;
  authorId?: string;
  authorName?: string;
  content?: string;
  createdAt: string;
  editedAt?: string;
  url?: string;
  channelId?: string;
  threadRefId?: string;
  media?: any;
  metricsLikes?: number;
  metricsComments?: number;
  metricsShares?: number;
  extraJson?: any;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
  summary?: string;
  job?: {
    scraper: {
      name: string;
    };
  };
}

interface ProjectResultsProps {
  projectId: string;
  globalDateRange?: string;
  globalSourceFilter?: string[];
  languageFilter?: string;
}

export function ProjectResults({
  projectId,
  globalDateRange = "all",
  globalSourceFilter = [
    "facebook",
    "linkedin",
    "x",
    "reddit",
    "discord",
    "youtube",
    "blog",
    "hackernews",
    "github",
  ],
  languageFilter = "all",
}: ProjectResultsProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(""); // What user types
  const [searchTerm, setSearchTerm] = useState(""); // What we actually search for
  const [sentimentFilter, setSentimentFilter] = useState<string[]>([
    "POSITIVE",
    "NEGATIVE",
    "NEUTRAL",
    "MIXED",
  ]);
  const [authorFilter, setAuthorFilter] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPosts, setTotalPosts] = useState(0);

  const fetchPosts = useCallback(
    async (page: number = 1, options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) {
          setLoading(true);
        }

        const params = new URLSearchParams({
          projectId,
          search: searchTerm,
          dateRange: globalDateRange === "all" ? "" : globalDateRange,
          sentiment: sentimentFilter.join(","),
          author: authorFilter,
          sources: globalSourceFilter.join(","),
          language: languageFilter,
          sortBy,
          page: page.toString(),
          limit: "10",
        });

        const response = await fetch(`/api/posts?${params}`);
        if (!response.ok) throw new Error("Failed to fetch posts");

        const data = await response.json();
        setPosts(data.posts || []);
        setCurrentPage(data.pagination.page);
        setTotalPages(data.pagination.totalPages);
        setTotalPosts(data.pagination.totalPosts);
      } catch (error) {
        console.error("Error fetching posts:", error);
        toast({
          title: "Error",
          description: "Failed to load posts. Please try again.",
          variant: "destructive",
        });
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [
      projectId,
      searchTerm,
      globalDateRange,
      sentimentFilter,
      authorFilter,
      globalSourceFilter,
      languageFilter,
      sortBy,
      toast,
    ]
  );

  useEffect(() => {
    fetchPosts(currentPage);
  }, [fetchPosts, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    projectId,
    searchTerm,
    globalDateRange,
    sentimentFilter,
    authorFilter,
    globalSourceFilter,
    languageFilter,
    sortBy,
  ]);

  const pollPostsSilent = useCallback(() => {
    void fetchPosts(currentPage, { silent: true });
  }, [fetchPosts, currentPage]);

  useVisibilityAwarePolling({
    onPoll: pollPostsSilent,
    intervalMs: 120_000,
    hiddenIntervalMs: 180_000,
    enabled: true,
  });

  const handleSentimentToggle = (sentiment: string) => {
    setSentimentFilter((prev) =>
      prev.includes(sentiment) ? prev.filter((s) => s !== sentiment) : [...prev, sentiment]
    );
  };

  const handleSearch = () => {
    setSearchTerm(searchInput);
    setCurrentPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchTerm("");
    setSentimentFilter(["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"]);
    setAuthorFilter("");
    setSortBy("recent");
    setCurrentPage(1);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      fetchPosts(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      fetchPosts(currentPage + 1);
    }
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "POSITIVE":
        return "bg-green-100 text-green-800";
      case "NEGATIVE":
        return "bg-red-100 text-red-800";
      case "NEUTRAL":
        return "bg-gray-100 text-gray-800";
      case "MIXED":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Search Content</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="Search posts... (e.g., vibe coding, Lovable)"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Tip: Use commas to search for multiple phrases (posts must contain all)
                  </p>
                </div>
                <Button onClick={handleSearch} size="default" className="shrink-0">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Sort By</label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="sentiment">Sentiment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Author</label>
              <Input
                placeholder="Filter by author..."
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Sentiment</label>
            <div className="flex gap-4 mt-2">
              {["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"].map((sentiment) => (
                <div key={sentiment} className="flex items-center space-x-2">
                  <Checkbox
                    id={sentiment}
                    checked={sentimentFilter.includes(sentiment)}
                    onCheckedChange={() => handleSentimentToggle(sentiment)}
                  />
                  <label htmlFor={sentiment} className="text-sm">
                    {sentiment}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <Button variant="outline" onClick={clearFilters}>
            Clear All Filters
          </Button>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {!loading && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-wrap">
                <h3 className="text-lg font-semibold">Results</h3>
                <Badge variant="secondary" className="text-sm">
                  {totalPosts.toLocaleString()} posts found
                </Badge>
                {searchTerm && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">Searching for:</span>
                    {searchTerm.split(",").map((phrase, index) => (
                      <Badge key={index} variant="outline" className="text-sm">
                        &quot;{phrase.trim()}&quot;
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : posts.filter((post) => post.content && post.content.trim().length > 0).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="text-center space-y-4">
                <div className="text-6xl">📭</div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">No Posts With Content</h3>
                  <p className="text-muted-foreground mb-4">
                    No posts with content found. This could be due to filters or posts without text
                    content.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          posts
            .filter((post) => post.content && post.content.trim().length > 0)
            .map((post) => {
              const postLink = generatePostLink({
                url: post.url,
                channelId: post.channelId,
                platform: post.platform,
                postId: post.postId,
              });

              return (
                <Card key={post.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{post.platform}</Badge>
                            {postLink && (
                              <a
                                href={postLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 underline"
                              >
                                Link
                              </a>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {post.content}
                          </p>
                          {post.summary && (
                            <div className="p-2 bg-muted rounded text-sm">
                              <strong>AI Summary:</strong> {post.summary}
                            </div>
                          )}
                        </div>
                        {postLink && (
                          <ExternalLink className="h-4 w-4 ml-4 text-muted-foreground" />
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {post.authorName && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {post.authorName}
                            {post.authorId && (
                              <span className="text-muted-foreground">({post.authorId})</span>
                            )}
                          </div>
                        )}
                        {post.channelId && (
                          <div className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {post.channelId}
                          </div>
                        )}
                        {post.createdAt && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatPostDateTime(post.createdAt)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {post.sentiment && (
                            <Badge className={getSentimentColor(post.sentiment)}>
                              {post.sentiment}
                            </Badge>
                          )}
                        </div>

                        {(post.metricsLikes || post.metricsComments || post.metricsShares) && (
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {post.metricsLikes && <span>👍 {post.metricsLikes}</span>}
                            {post.metricsComments && <span>💬 {post.metricsComments}</span>}
                            {post.metricsShares && <span>🔄 {post.metricsShares}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * 10 + 1}-{Math.min(currentPage * 10, totalPosts)} of{" "}
            {totalPosts} posts
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
    </div>
  );
}
