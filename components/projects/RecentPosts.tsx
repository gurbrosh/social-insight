"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
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
  url?: string;
  channelId?: string;
  job?: {
    scraper: {
      name: string;
    };
  };
}

interface RecentPostsProps {
  projectId: string;
}

export function RecentPosts({ projectId }: RecentPostsProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPosts, setTotalPosts] = useState(0);

  const fetchPosts = async (page: number = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        projectId,
        page: page.toString(),
        limit: "4",
      });

      const response = await fetch(`/api/posts/recent?${params}`);
      if (!response.ok) throw new Error("Failed to fetch posts");

      const data = await response.json();
      setPosts(data.posts || []);
      setCurrentPage(data.pagination.page);
      setTotalPages(data.pagination.totalPages);
      setTotalPosts(data.pagination.totalPosts);
    } catch (error) {
      console.error("Error fetching recent posts:", error);
      toast({
        title: "Error",
        description: "Failed to load posts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts(currentPage);
  }, [projectId, currentPage]);

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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Posts</CardTitle>
          <CardDescription>Latest posts collected for this project</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 border rounded-lg animate-pulse">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 bg-muted rounded" />
                    <div className="h-4 w-20 bg-muted rounded" />
                  </div>
                  <div className="h-4 w-full bg-muted rounded" />
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-24 bg-muted rounded" />
                    <div className="h-3 w-16 bg-muted rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Posts</CardTitle>
        <CardDescription>
          Latest posts collected for this project ({totalPosts} total)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No posts collected yet.</p>
        ) : (
          <>
            <div className="space-y-3">
              {posts.map((post) => {
                const postLink = generatePostLink({
                  url: post.url,
                  channelId: post.channelId,
                  platform: post.platform,
                  postId: post.postId,
                });

                return (
                  <div
                    key={post.id}
                    className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              {post.platform}
                            </Badge>
                            {postLink && (
                              <a
                                href={postLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-800 underline"
                              >
                                Link
                              </a>
                            )}
                          </div>
                          <p className="text-sm font-medium line-clamp-2">
                            {post.content?.substring(0, 100)}...
                          </p>
                        </div>
                        {postLink && (
                          <ExternalLink className="h-4 w-4 ml-2 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {post.authorName && <span>@{post.authorName}</span>}
                        {post.createdAt && <span>{formatPostDateTime(post.createdAt)}</span>}
                      </div>
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
