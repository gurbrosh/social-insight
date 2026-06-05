"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ExternalLink,
  Loader2,
  Eye,
  MessageSquare,
  CheckCircle2,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getNormalizedPlatformFilter,
  isFullSourceFilterSelection,
  recordPlatformMatches,
} from "@/lib/utils/platform";
import { formatDistanceToNow, format } from "date-fns";

interface EngagementSession {
  id: string;
  source_type: "themes" | "chatter";
  source_record_id: string;
  platform: string;
  destination_url: string;
  status: "active" | "watching" | "ended";
  started_at: Date | string;
  watch_until: Date | string | null;
  last_check_at: Date | string | null;
  selected_identity?: { id: string; identity: string; platform: string } | null;
  preview: { title?: string; summary?: string; platform?: string } | null;
  has_user_reply: boolean;
  events: Array<{
    id: string;
    type: string;
    payload: any;
    occurred_at: Date | string;
  }>;
  snapshot: any;
}

interface EngagementDashboardProps {
  projectId: string;
  dateRange?: string;
  sourceFilter?: string[];
  languageFilter?: string;
}

const platformLabels: Record<string, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  reddit: "Reddit",
  discord: "Discord",
  hackernews: "Hacker News",
  hacker_news: "Hacker News",
  hn: "Hacker News",
};

const statusLabels: Record<string, string> = {
  active: "Active",
  watching: "Watching",
  ended: "Ended",
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  watching: "bg-blue-100 text-blue-800",
  ended: "bg-gray-100 text-gray-800",
};

export function EngagementDashboard({
  projectId,
  dateRange: _dateRange,
  sourceFilter,
  languageFilter: _languageFilter,
}: EngagementDashboardProps) {
  const [sessions, setSessions] = useState<EngagementSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [selectedSession, setSelectedSession] = useState<EngagementSession | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [markingInProgress, setMarkingInProgress] = useState<string | null>(null);
  const [refreshingSessions, setRefreshingSessions] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const displaySessions = useMemo(() => {
    if (!sourceFilter?.length || isFullSourceFilterSelection(sourceFilter)) {
      return sessions;
    }
    const allowed = getNormalizedPlatformFilter(sourceFilter);
    return sessions.filter((s) => recordPlatformMatches(s.platform, allowed));
  }, [sessions, sourceFilter]);

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, statusFilter, platformFilter]);

  async function loadSessions() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (platformFilter !== "all") params.set("platform", platformFilter);

      const response = await fetch(`/api/projects/${projectId}/engagements?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch engagements");
      }

      const data = await response.json();
      if (data.success) {
        // Convert date strings to Date objects
        const converted = data.sessions.map((s: any) => ({
          ...s,
          started_at: new Date(s.started_at),
          watch_until: s.watch_until ? new Date(s.watch_until) : null,
          last_check_at: s.last_check_at ? new Date(s.last_check_at) : null,
          events: s.events.map((e: any) => ({
            ...e,
            occurred_at: new Date(e.occurred_at),
          })),
        }));
        setSessions(converted);
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to load engagements",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading engagements:", error);
      toast({
        title: "Error",
        description: "Failed to load engagement data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleViewDetails(session: EngagementSession) {
    setSelectedSession(session);
    setIsDetailOpen(true);
    // Auto-refresh when opening details
    handleRefresh(session.id);
  }

  async function handleRefresh(engagementId: string, silent: boolean = false) {
    if (refreshingSessions.has(engagementId)) return; // Already refreshing

    setRefreshingSessions((prev) => new Set(prev).add(engagementId));
    try {
      const response = await fetch("/api/engagement/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.detected && !silent) {
          let description = "";
          if (data.moderationDetected) {
            description = "Your comment appears to have been removed by moderation";
          } else if (data.userReplies > 0) {
            description = `Found ${data.userReplies} new reply(ies) from you`;
          } else if (data.metricsChanged) {
            description = "Thread metrics updated";
          } else if (data.eventsCreated?.includes("reply_metrics_update")) {
            description = "Your reply got more engagement!";
          }

          if (description) {
            toast({
              title: "Activity Detected",
              description: description,
              variant: data.moderationDetected ? "destructive" : "default",
            });
          }
        } else if (!silent && !data.detected) {
          // Only show "checked" toast on manual refresh, not auto-refresh
          // toast({
          //   title: "Checked",
          //   description: data.message || "No new activity detected",
          // });
        }
        // Reload sessions to show updated data
        await loadSessions();
        // Update selected session if it's the one we refreshed
        if (selectedSession?.id === engagementId) {
          const updated = sessions.find((s) => s.id === engagementId);
          if (updated) setSelectedSession(updated);
        }
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to refresh engagement",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error refreshing engagement:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred while refreshing",
        variant: "destructive",
      });
    } finally {
      setRefreshingSessions((prev) => {
        const next = new Set(prev);
        next.delete(engagementId);
        return next;
      });
    }
  }

  // Auto-refresh active sessions every 2 minutes (10 min when tab hidden) — same visibility rules as useVisibilityAwarePolling
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const activeSessions = sessions.filter(
        (s) => s.status === "active" || s.status === "watching"
      );
      activeSessions.forEach((session) => {
        void handleRefresh(session.id, true);
      });
    };

    const schedule = () => {
      if (timer) clearInterval(timer);
      const ms =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? 10 * 60 * 1000
          : 2 * 60 * 1000;
      timer = setInterval(tick, ms);
    };

    schedule();
    const onVis = () => {
      tick();
      schedule();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleMarkAsReplied(engagementId: string) {
    setMarkingInProgress(engagementId);
    try {
      const response = await fetch("/api/engagement/mark-replied", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Engagement marked as replied",
        });
        // Reload sessions to show updated status
        await loadSessions();
        // Update selected session if it's the one we just marked
        if (selectedSession?.id === engagementId) {
          const updated = sessions.find((s) => s.id === engagementId);
          if (updated) setSelectedSession(updated);
        }
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.error || "Failed to mark engagement",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error marking engagement:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setMarkingInProgress(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Engagements Yet</h3>
            <p className="text-sm text-muted-foreground">
              Start engaging with conversations from Themes or Chatter to track them here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="watching">Watching</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Platform</label>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="x">X (Twitter)</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="reddit">Reddit</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="hackernews">Hacker News</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Engagement Sessions</CardTitle>
          <CardDescription>
            Track conversations you&apos;ve engaged with and monitor their activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Conversation</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displaySessions.length === 0 && sessions.length > 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No sessions match the current filters (global source selection may hide rows).
                  </TableCell>
                </TableRow>
              ) : null}
              {displaySessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>
                    <Badge variant="outline">
                      {session.source_type === "themes" ? "Theme" : "Chatter"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-md">
                      <div className="font-medium truncate">
                        {session.preview?.title || "Untitled"}
                      </div>
                      {session.preview?.summary && (
                        <div className="text-sm text-muted-foreground truncate">
                          {session.preview.summary}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {platformLabels[session.platform.toLowerCase()] || session.platform}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[session.status] || statusColors.ended}>
                      {statusLabels[session.status] || session.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(session.started_at, { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {session.has_user_reply && (
                        <div title="You replied">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </div>
                      )}
                      {session.snapshot && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="h-3 w-3" />
                          <span>
                            {session.snapshot.reactions || 0} reactions,{" "}
                            {session.snapshot.replies || 0} replies
                          </span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleViewDetails(session)}>
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRefresh(session.id)}
                        disabled={refreshingSessions.has(session.id)}
                        title="Check for replies and updates"
                      >
                        {refreshingSessions.has(session.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={session.destination_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedSession && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedSession.preview?.title || "Engagement Details"}</DialogTitle>
                <DialogDescription>
                  {selectedSession.preview?.summary || "No summary available"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* Session Info */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Platform</label>
                    <div className="mt-1">
                      <Badge variant="secondary">
                        {platformLabels[selectedSession.platform.toLowerCase()] ||
                          selectedSession.platform}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <div className="mt-1">
                      <Badge className={statusColors[selectedSession.status] || statusColors.ended}>
                        {statusLabels[selectedSession.status] || selectedSession.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Started</label>
                    <div className="mt-1 text-sm">
                      {format(selectedSession.started_at, "PPP 'at' p")}
                    </div>
                  </div>
                  {selectedSession.watch_until && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Watch Until
                      </label>
                      <div className="mt-1 text-sm">
                        {format(selectedSession.watch_until, "PPP 'at' p")}
                      </div>
                    </div>
                  )}
                  {selectedSession.selected_identity && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Your Identity
                      </label>
                      <div className="mt-1">
                        <Badge variant="outline" className="font-mono">
                          {selectedSession.selected_identity.identity}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          Replies are detected for this identity
                        </p>
                      </div>
                    </div>
                  )}
                  {!selectedSession.selected_identity && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Identity</label>
                      <div className="mt-1">
                        <Badge
                          variant="outline"
                          className="border-yellow-500 text-yellow-700 dark:text-yellow-500"
                        >
                          Not configured
                        </Badge>
                        <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1 font-medium">
                          ⚠️ Reply detection will not work - no identity configured
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Configure your {selectedSession.platform} identity in Profile settings to
                          enable automatic reply detection.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Engagement Stats */}
                {selectedSession.snapshot && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Latest Metrics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">
                            Reactions
                          </label>
                          <div className="mt-1 text-2xl font-semibold">
                            {selectedSession.snapshot.reactions || 0}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">
                            Replies
                          </label>
                          <div className="mt-1 text-2xl font-semibold">
                            {selectedSession.snapshot.replies || 0}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">
                            Shares
                          </label>
                          <div className="mt-1 text-2xl font-semibold">
                            {selectedSession.snapshot.shares || 0}
                          </div>
                        </div>
                      </div>
                      {selectedSession.has_user_reply && (
                        <div className="mt-4 flex items-center gap-2 text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            You have replied to this conversation
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Events Timeline */}
                {selectedSession.events.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Activity Timeline</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {selectedSession.events.map((event) => {
                          const isModeration = event.type === "moderation_removed";
                          const isUserReply = event.type === "detected_user_reply";
                          const isMetricsUpdate = event.type === "reply_metrics_update";
                          return (
                            <div key={event.id} className="flex gap-4">
                              <div className="flex flex-col items-center">
                                <div
                                  className={`w-2 h-2 rounded-full mt-1 ${isModeration ? "bg-red-500" : isUserReply || isMetricsUpdate ? "bg-green-500" : "bg-primary"}`}
                                />
                                {event !==
                                  selectedSession.events[selectedSession.events.length - 1] && (
                                  <div className="w-px h-full bg-border mt-1" />
                                )}
                              </div>
                              <div className="flex-1 pb-4">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge
                                    variant={
                                      isModeration
                                        ? "destructive"
                                        : isUserReply || isMetricsUpdate
                                          ? "default"
                                          : "outline"
                                    }
                                    className="text-xs"
                                  >
                                    {event.type.replace(/_/g, " ")}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(event.occurred_at, { addSuffix: true })}
                                  </span>
                                </div>

                                {/* Moderation message */}
                                {isModeration &&
                                  event.payload &&
                                  typeof event.payload === "object" && (
                                    <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded mt-2">
                                      {(event.payload as any).reason ||
                                        "Comment removed by moderation"}
                                    </div>
                                  )}

                                {/* User reply detected - show per-reply metrics */}
                                {isUserReply &&
                                  event.payload &&
                                  typeof event.payload === "object" && (
                                    <div className="space-y-2 mt-2">
                                      <div className="text-xs text-muted-foreground">
                                        {(event.payload as any).reply_count || 0} reply(ies)
                                        detected
                                      </div>
                                      {Array.isArray((event.payload as any).replies) && (
                                        <div className="space-y-3">
                                          {(event.payload as any).replies.map(
                                            (reply: any, idx: number) => (
                                              <div
                                                key={reply.postId || idx}
                                                className="bg-muted p-3 rounded-md"
                                              >
                                                <div className="text-xs font-medium mb-2">
                                                  Reply {idx + 1}
                                                  {reply.content && (
                                                    <span className="text-muted-foreground ml-2">
                                                      &quot;{reply.content.substring(0, 50)}
                                                      {reply.content.length > 50 ? "..." : ""}&quot;
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                  <div>
                                                    <span className="text-muted-foreground">
                                                      Upvotes:
                                                    </span>
                                                    <span className="ml-1 font-semibold">
                                                      {reply.metrics?.upvotes || 0}
                                                    </span>
                                                  </div>
                                                  <div>
                                                    <span className="text-muted-foreground">
                                                      Replies:
                                                    </span>
                                                    <span className="ml-1 font-semibold">
                                                      {reply.metrics?.replies || 0}
                                                    </span>
                                                  </div>
                                                  <div>
                                                    <span className="text-muted-foreground">
                                                      Shares:
                                                    </span>
                                                    <span className="ml-1 font-semibold">
                                                      {reply.metrics?.shares || 0}
                                                    </span>
                                                  </div>
                                                </div>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                {/* Metrics update - show what changed */}
                                {isMetricsUpdate &&
                                  event.payload &&
                                  typeof event.payload === "object" && (
                                    <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-2">
                                      <div className="text-xs font-medium mb-2">
                                        Your reply got more engagement!
                                      </div>
                                      <div className="grid grid-cols-3 gap-2 text-xs">
                                        {(event.payload as any).changed && (
                                          <>
                                            {(event.payload as any).changed.upvotes !== 0 && (
                                              <div className="text-green-600 dark:text-green-400">
                                                <span>↑ Upvotes:</span>
                                                <span className="ml-1 font-semibold">
                                                  +{(event.payload as any).changed.upvotes}
                                                </span>
                                              </div>
                                            )}
                                            {(event.payload as any).changed.replies !== 0 && (
                                              <div className="text-green-600 dark:text-green-400">
                                                <span>↑ Replies:</span>
                                                <span className="ml-1 font-semibold">
                                                  +{(event.payload as any).changed.replies}
                                                </span>
                                              </div>
                                            )}
                                            {(event.payload as any).changed.shares !== 0 && (
                                              <div className="text-green-600 dark:text-green-400">
                                                <span>↑ Shares:</span>
                                                <span className="ml-1 font-semibold">
                                                  +{(event.payload as any).changed.shares}
                                                </span>
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-2">
                                        Current: {(event.payload as any).current?.upvotes || 0}{" "}
                                        upvotes, {(event.payload as any).current?.replies || 0}{" "}
                                        replies
                                      </div>
                                    </div>
                                  )}

                                {/* Other events - show raw payload */}
                                {!isModeration &&
                                  !isUserReply &&
                                  !isMetricsUpdate &&
                                  event.payload &&
                                  typeof event.payload === "object" && (
                                    <pre className="text-xs text-muted-foreground bg-muted p-2 rounded mt-2 overflow-auto">
                                      {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button asChild>
                    <a
                      href={selectedSession.destination_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open Conversation
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleRefresh(selectedSession.id)}
                    disabled={refreshingSessions.has(selectedSession.id)}
                  >
                    {refreshingSessions.has(selectedSession.id) ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Check for Updates
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
