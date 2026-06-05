"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { configService } from "@/lib/config-service";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  // Play,
  AlertCircle,
  Calendar,
  User,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Job {
  id: string;
  status: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  posts_count: number;
  error_message?: string;
  scraper: {
    name: string;
  };
}

interface JobStatusTrackerProps {
  projectId: string;
  onJobUpdate?: () => void;
}

export function JobStatusTracker({ projectId, onJobUpdate }: JobStatusTrackerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);

  const fetchJobs = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        if (!options?.silent) {
          setLoading(true);
        }
        const response = await fetch(`/api/projects/${projectId}/jobs`);
        if (!response.ok) throw new Error("Failed to fetch jobs");

        const data = await response.json();
        setJobs(data.jobs || []);
      } catch (error) {
        console.error("Error fetching jobs:", error);
        if (!options?.silent) {
          toast({
            title: "Error",
            description: "Failed to load job status. Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [projectId]
  );

  const hasRunningJobs = useMemo(
    () => jobs.some((job) => job.status === "RUNNING" || job.status === "PENDING"),
    [jobs]
  );

  useEffect(() => {
    void fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only when project changes
  }, [projectId]);

  useVisibilityAwarePolling({
    onPoll: () => void fetchJobs({ silent: true }),
    intervalMs: 10_000,
    hiddenIntervalMs: 60_000,
    enabled: hasRunningJobs,
  });

  const retryJob = async (jobId: string) => {
    setRetryingJob(jobId);
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to retry job");
      }

      toast({
        title: "Job Retried",
        description: "The job has been restarted successfully.",
      });

      fetchJobs();
      onJobUpdate?.();
    } catch (error) {
      console.error("Error retrying job:", error);
      toast({
        title: "Error",
        description: "Failed to retry job. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRetryingJob(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FAILED":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "RUNNING":
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case "PENDING":
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case "CANCELLED":
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-100 text-green-800 border-green-200";
      case "FAILED":
        return "bg-red-100 text-red-800 border-red-200";
      case "RUNNING":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "PENDING":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "CANCELLED":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getProgressPercentage = (job: Job) => {
    if (job.status === "COMPLETED") return 100;
    if (job.status === "FAILED" || job.status === "CANCELLED") return 0;
    if (job.status === "PENDING") return 10;
    if (job.status === "RUNNING") return 50;
    return 0;
  };

  const getDuration = (job: Job) => {
    const start = job.started_at ? new Date(job.started_at) : new Date(job.created_at);
    const end = job.completed_at ? new Date(job.completed_at) : new Date();
    const duration = end.getTime() - start.getTime();

    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Status</CardTitle>
          <CardDescription>Loading job information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Status</CardTitle>
          <CardDescription>No scraping jobs yet</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-8">
          <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Jobs Yet</h3>
          <p className="text-muted-foreground">
            Start your first scraping job to see status updates here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Job Status</CardTitle>
            <CardDescription>Real-time status of scraping jobs</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchJobs()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {jobs.map((job) => (
            <div key={job.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {getStatusIcon(job.status)}
                  <div>
                    <h3 className="font-medium">{job.scraper.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {new Date(job.created_at).toLocaleString()}
                      {job.started_at && (
                        <>
                          <span>•</span>
                          <span>Duration: {getDuration(job)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={getStatusColor(job.status)}>{job.status}</Badge>
                  {job.status === "FAILED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryJob(job.id)}
                      disabled={retryingJob === job.id}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-1 ${retryingJob === job.id ? "animate-spin" : ""}`}
                      />
                      Retry
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-sm text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span>{getProgressPercentage(job)}%</span>
                </div>
                <Progress value={getProgressPercentage(job)} className="h-2" />
              </div>

              {/* Job Details */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4 text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {job.posts_count} posts
                  </div>
                  {job.completed_at && (
                    <div>Completed: {new Date(job.completed_at).toLocaleString()}</div>
                  )}
                </div>
              </div>

              {/* Error Message */}
              {job.error_message && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-red-800">Error</h4>
                      <p className="text-sm text-red-700 mt-1">{job.error_message}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
