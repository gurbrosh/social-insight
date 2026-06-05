"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Users,
  Clock,
  Flame,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getStoredChatterAnalysis, type ChatterConversation } from "@/app/actions/chatter-analysis";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { EngagementOpenLink } from "@/components/projects/EngagementOpenLink";

interface ChatterAnalysisProps {
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
  hackernews: "bg-amber-600",
  youtube: "bg-red-600",
  blog: "bg-emerald-600",
  github: "bg-slate-800",
};

const platformLabels: Record<string, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  reddit: "Reddit",
  discord: "Discord",
  hackernews: "Hacker News",
  youtube: "YouTube",
  blog: "Blogs",
  github: "GitHub",
};

const sentimentColors: Record<string, string> = {
  POSITIVE: "text-green-600",
  NEGATIVE: "text-red-600",
  NEUTRAL: "text-gray-600",
  MIXED: "text-yellow-600",
};

export function ChatterAnalysis({
  projectId,
  dateRange,
  sourceFilter,
  languageFilter,
}: ChatterAnalysisProps) {
  const [conversations, setConversations] = useState<ChatterConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();

  useEffect(() => {
    loadConversations();
    setCurrentPage(1); // Reset to first page when filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, dateRange, sourceFilter, languageFilter]);

  async function loadConversations() {
    setLoading(true);
    try {
      const result = await getStoredChatterAnalysis(projectId, {
        limit: 50,
        platforms: sourceFilter,
        // Match calculateImportanceScore * relevance: small threads often land 5–15
        minImportance: 5,
        dateRange: dateRange || "all",
        language: languageFilter,
      });

      if (result.success && result.conversations) {
        // Deduplicate by discussion_title (keep highest importance)
        const deduped = new Map<string, (typeof result.conversations)[0]>();
        for (const conv of result.conversations) {
          const existing = deduped.get(conv.discussion_title);
          if (!existing || (conv.importance_score || 0) > (existing.importance_score || 0)) {
            deduped.set(conv.discussion_title, conv);
          }
        }
        setConversations(Array.from(deduped.values()));
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to load conversations",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
      toast({
        title: "Error",
        description: "Failed to load chatter data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Chatter Analysis
            </CardTitle>
            <CardDescription>Trending discussions and conversation patterns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading conversations...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Chatter Analysis
            </CardTitle>
            <CardDescription>Trending discussions and conversation patterns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <MessageSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Conversations Found</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                No meaningful conversations were detected. Conversations need at least 2
                participants and 10 messages. Try running a scrape to gather more data.
              </p>
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
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Trending Conversations ({conversations.length})
          </CardTitle>
          <CardDescription>
            Meaningful discussions with 2+ participants and 10+ messages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {conversations
              .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
              .map((conv) => (
                <Card key={conv.id} className="border-l-4 border-l-primary">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {conv.discussion_title}
                          {conv.importance_score && conv.importance_score >= 70 && (
                            <span title="Hot Discussion">
                              <Flame className="h-4 w-4 text-orange-500" />
                            </span>
                          )}
                        </CardTitle>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {conv.topic_category && (
                            <Badge variant="outline">{conv.topic_category}</Badge>
                          )}
                          {conv.sentiment && (
                            <Badge variant="secondary" className={sentimentColors[conv.sentiment]}>
                              {conv.sentiment}
                            </Badge>
                          )}
                          {conv.platforms?.map((platform) => (
                            <Badge
                              key={platform}
                              className={`${platformColors[platform.toLowerCase()] || "bg-gray-600"} text-white`}
                            >
                              {platformLabels[platform.toLowerCase()] || platform}
                              {platform.toLowerCase() === "discord" && conv.discord_server && (
                                <span className="ml-1 opacity-80">({conv.discord_server})</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      {conv.importance_score && (
                        <div className="text-right ml-4">
                          <div className="text-2xl font-bold text-primary">
                            {conv.importance_score}
                          </div>
                          <div className="text-xs text-muted-foreground">Importance</div>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {conv.summary && (
                      <p className="text-sm text-muted-foreground">{conv.summary}</p>
                    )}

                    {conv.key_points && conv.key_points.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Key Points:</h4>
                        <ul className="space-y-1">
                          {conv.key_points.map((point, index) => (
                            <li key={index} className="text-sm flex items-start gap-2">
                              <span className="text-muted-foreground mt-1">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-2 border-t">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        <span>{conv.participant_count} participants</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-4 w-4" />
                        <span>{conv.total_messages} messages</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">
                          {conv.total_engagement.toLocaleString()} reactions
                        </span>
                      </div>
                      {conv.first_post_at && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            {formatDistanceToNow(new Date(conv.first_post_at), { addSuffix: true })}
                          </span>
                          <span className="mx-1">·</span>
                          <span>{new Date(conv.first_post_at).toLocaleString()}</span>
                        </div>
                      )}

                      {/* Link / Discord info */}
                      {(() => {
                        const isDiscord = (conv.platforms?.[0] || "").toLowerCase() === "discord";
                        if (isDiscord) {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="font-medium">Discord:</span>
                              <span>{conv.discord_server || "Unknown server"}</span>
                              {conv.link_url && (
                                <EngagementOpenLink
                                  hrefBase={`/api/engagement/open?projectId=${projectId}&source=chatter&sourceId=${encodeURIComponent(conv.id)}&platform=discord&dest=${encodeURIComponent(conv.link_url)}`}
                                  platform="discord"
                                  className="underline underline-offset-2 text-primary"
                                >
                                  Open conversation
                                </EngagementOpenLink>
                              )}
                            </div>
                          );
                        }
                        if (conv.link_url) {
                          return (
                            <EngagementOpenLink
                              hrefBase={`/api/engagement/open?projectId=${projectId}&source=chatter&sourceId=${encodeURIComponent(conv.id)}&platform=${encodeURIComponent((conv.platforms?.[0] || "").toLowerCase())}&dest=${encodeURIComponent(conv.link_url)}`}
                              platform={(conv.platforms?.[0] || "").toLowerCase()}
                              className="underline underline-offset-2 text-primary"
                            >
                              Open conversation
                            </EngagementOpenLink>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>

          {/* Pagination */}
          {Math.ceil(conversations.length / itemsPerPage) > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, conversations.length)} of{" "}
                {conversations.length} conversations
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
                      Math.min(Math.ceil(conversations.length / itemsPerPage), p + 1)
                    )
                  }
                  disabled={currentPage === Math.ceil(conversations.length / itemsPerPage)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
