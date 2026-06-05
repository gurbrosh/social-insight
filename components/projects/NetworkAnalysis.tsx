"use client";

import { useEffect, useState } from "react";
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
  Network,
  UserPlus,
  UserMinus,
  Heart,
  MessageCircle,
  Share2,
  ExternalLink,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getStoredNetworkAnalysis,
  followProfile,
  unfollowProfile,
} from "@/app/actions/network-analysis";
import { useToast } from "@/hooks/use-toast";
import type { InfluentialPerson } from "@/lib/network-analysis";

interface NetworkAnalysisProps {
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
  x: "X (Twitter)",
  twitter: "X (Twitter)",
  reddit: "Reddit",
  discord: "Discord",
  hackernews: "Hacker News",
  youtube: "YouTube",
  blog: "Blogs",
  github: "GitHub",
};

export function NetworkAnalysis({
  projectId,
  dateRange,
  sourceFilter,
  languageFilter,
}: NetworkAnalysisProps) {
  const [people, setPeople] = useState<InfluentialPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingStatus, setFollowingStatus] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();

  useEffect(() => {
    loadInfluentialPeople();
    setCurrentPage(1); // Reset to first page when filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, dateRange, sourceFilter, languageFilter]);

  async function loadInfluentialPeople() {
    setLoading(true);
    try {
      const result = await getStoredNetworkAnalysis(projectId, {
        limit: 50,
        platforms: sourceFilter,
        minReactions: 10,
        dateRange: dateRange || "all",
        language: languageFilter,
      });

      if (result.success && result.people) {
        setPeople(result.people);

        // Check which profiles are already being followed
        await checkFollowingStatus(result.people);
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to load influential people",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading influential people:", error);
      toast({
        title: "Error",
        description: "Failed to load network data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function checkFollowingStatus(people: InfluentialPerson[]) {
    try {
      // Get all project profiles
      const response = await fetch(`/api/projects/${projectId}/profiles`);
      if (!response.ok) return;

      const data = await response.json();
      const profiles = data.profiles || [];

      // Normalize URL for comparison (handle twitter.com vs x.com)
      const normalizeUrl = (url: string): string => {
        return url
          .replace(/^https?:\/\/(www\.)?/, "")
          .replace(/^twitter\.com/, "x.com")
          .replace(/^x\.com/, "x.com")
          .toLowerCase()
          .replace(/\/$/, "");
      };

      // Build maps of followed profiles by platform
      const followedUrlMap = new Map<string, Set<string>>();
      const followedNameMap = new Map<string, Set<string>>();

      for (const profile of profiles) {
        const platform = profile.platform.toLowerCase();

        // Track by URL
        if (!followedUrlMap.has(platform)) {
          followedUrlMap.set(platform, new Set());
        }
        const normalizedUrl = normalizeUrl(profile.url);
        followedUrlMap.get(platform)!.add(normalizedUrl);

        // Track by name (case-insensitive)
        if (!followedNameMap.has(platform)) {
          followedNameMap.set(platform, new Set());
        }
        followedNameMap.get(platform)!.add(profile.name.toLowerCase());
      }

      // Check each person
      const newFollowingStatus: Record<string, boolean> = {};
      for (const person of people) {
        const key = `${person.platform}:${person.authorId}`;
        const platform = person.platform.toLowerCase();

        let isFollowed = false;

        // Check by URL first
        const platformUrlSet = followedUrlMap.get(platform);
        if (platformUrlSet && person.profileUrl) {
          const normalizedPersonUrl = normalizeUrl(person.profileUrl);
          isFollowed = platformUrlSet.has(normalizedPersonUrl);
        }

        // Fallback: Check by author name (case-insensitive)
        if (!isFollowed) {
          const platformNameSet = followedNameMap.get(platform);
          if (platformNameSet && person.authorName) {
            isFollowed = platformNameSet.has(person.authorName.toLowerCase());
          }
        }

        newFollowingStatus[key] = isFollowed;
      }

      setFollowingStatus(newFollowingStatus);
    } catch (error) {
      console.error("Error checking following status:", error);
    }
  }

  async function handleFollow(person: InfluentialPerson) {
    const key = `${person.platform}:${person.authorId}`;
    const isCurrentlyFollowing = followingStatus[key];

    if (isCurrentlyFollowing) {
      // Unfollow
      await handleUnfollow(person);
    } else {
      // Follow
      // Optimistic update
      setFollowingStatus((prev) => ({ ...prev, [key]: true }));

      try {
        const result = await followProfile(projectId, {
          platform: person.platform,
          authorName: person.authorName,
          authorId: person.authorId,
          profileUrl: person.profileUrl,
        });

        if (result.success) {
          // Re-check following status to ensure UI is accurate
          await checkFollowingStatus(people);

          toast({
            title: "Success",
            description: `Now following ${person.authorName} on ${platformLabels[person.platform] || person.platform}`,
          });
        } else {
          // Revert on error
          setFollowingStatus((prev) => ({ ...prev, [key]: false }));
          toast({
            title: "Error",
            description: result.error || "Failed to follow profile",
            variant: "destructive",
          });
        }
      } catch (error) {
        // Revert on error
        setFollowingStatus((prev) => ({ ...prev, [key]: false }));
        console.error("Error following profile:", error);
        toast({
          title: "Error",
          description: "Failed to follow profile",
          variant: "destructive",
        });
      }
    }
  }

  async function handleUnfollow(person: InfluentialPerson) {
    const key = `${person.platform}:${person.authorId}`;

    // Optimistic update
    setFollowingStatus((prev) => ({ ...prev, [key]: false }));

    try {
      const result = await unfollowProfile(projectId, {
        platform: person.platform,
        profileUrl: person.profileUrl,
        authorName: person.authorName,
      });

      if (result.success) {
        // Re-check following status to ensure UI is accurate
        await checkFollowingStatus(people);

        toast({
          title: "Success",
          description: `Unfollowed ${person.authorName} on ${platformLabels[person.platform] || person.platform}`,
        });
      } else {
        // Revert on error
        setFollowingStatus((prev) => ({ ...prev, [key]: true }));
        toast({
          title: "Error",
          description: result.error || "Failed to unfollow profile",
          variant: "destructive",
        });
      }
    } catch (error) {
      // Revert on error
      setFollowingStatus((prev) => ({ ...prev, [key]: true }));
      console.error("Error unfollowing profile:", error);
      toast({
        title: "Error",
        description: "Failed to unfollow profile",
        variant: "destructive",
      });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Network Analysis
            </CardTitle>
            <CardDescription>Identifying influential voices and their key ideas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">
                Analyzing network data and summarizing ideas...
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Network Analysis
            </CardTitle>
            <CardDescription>Identifying influential voices and their key ideas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <Network className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Influential People Found</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                No people with significant engagement were found in your data. Try adjusting your
                date range or source filters.
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
            <Network className="h-5 w-5" />
            Influential People ({people.length})
          </CardTitle>
          <CardDescription>
            People who garnered the most reactions, with their key ideas summarized
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Platform</TableHead>
                  <TableHead className="w-[200px]">Person</TableHead>
                  <TableHead>Key Ideas</TableHead>
                  <TableHead
                    className="w-[150px] text-right"
                    title="Total engagement on this person's posts (likes, comments, shares)"
                  >
                    Engagement
                  </TableHead>
                  <TableHead className="w-[120px] text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((person) => {
                    const key = `${person.platform}:${person.authorId}`;
                    const isFollowing = followingStatus[key];

                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Badge
                            className={`${platformColors[person.platform.toLowerCase()] || "bg-gray-600"} text-white`}
                          >
                            {platformLabels[person.platform.toLowerCase()] || person.platform}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {person.profileUrl &&
                            person.profileUrl !== "#" &&
                            person.profileUrl.startsWith("http") ? (
                              <a
                                href={person.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-primary hover:underline flex items-center gap-1"
                              >
                                {person.authorName}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <div className="font-medium">{person.authorName}</div>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {person.platform.toLowerCase() === "discord" &&
                              person.discordServerName ? (
                                <span>Server: {person.discordServerName}</span>
                              ) : (
                                <span>
                                  {person.postCount} {person.postCount === 1 ? "post" : "posts"}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {person.ideas && person.ideas.length > 0 ? (
                            <div className="text-sm line-clamp-2" title={person.ideas.join(" • ")}>
                              {person.ideas.join(" • ")}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground italic">
                              No ideas extracted
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center justify-end gap-1">
                              <Heart className="h-3 w-3 text-red-500" />
                              <span>{person.totalLikes.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <MessageCircle className="h-3 w-3 text-blue-500" />
                              <span>{person.totalComments.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-end gap-1">
                              <Share2 className="h-3 w-3 text-green-500" />
                              <span>{person.totalShares.toLocaleString()}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant={isFollowing ? "outline" : "default"}
                            onClick={() => handleFollow(person)}
                            disabled={person.isFollowable === false}
                            className="w-full"
                            title={
                              person.isFollowable === false
                                ? "Discord users cannot be followed"
                                : isFollowing
                                  ? "Click to unfollow this person"
                                  : "Follow this person to track their posts"
                            }
                          >
                            {person.isFollowable === false ? (
                              <>Not Available</>
                            ) : isFollowing ? (
                              <>
                                <UserMinus className="h-3 w-3 mr-1" />
                                Unfollow
                              </>
                            ) : (
                              <>
                                <UserPlus className="h-3 w-3 mr-1" />
                                Follow
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {Math.ceil(people.length / itemsPerPage) > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, people.length)} of {people.length} influencers
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
                    setCurrentPage((p) => Math.min(Math.ceil(people.length / itemsPerPage), p + 1))
                  }
                  disabled={currentPage === Math.ceil(people.length / itemsPerPage)}
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
