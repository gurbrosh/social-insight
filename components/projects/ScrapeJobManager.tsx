"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { configService } from "@/lib/config-service";
import { Play, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ScrapeJobManagerProps {
  projectId: string;
  projectName: string;
  keywords: string[];
  canRunScrape: boolean;
}

interface ScrapeJob {
  id: string;
  status: string;
  created_at: string;
  completed_at?: string;
  posts_count: number;
  error_message?: string;
  scraper: {
    name: string;
  };
}

export function ScrapeJobManager({
  projectId,
  projectName,
  keywords,
  canRunScrape,
}: ScrapeJobManagerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [recentJob, setRecentJob] = useState<ScrapeJob | null>(null);

  const handleStartScrape = async () => {
    if (!canRunScrape) {
      toast({
        title: "No Active Scrapers",
        description: "Please configure active scrapers first.",
        variant: "destructive",
      });
      return;
    }

    setIsRunning(true);
    setRecentJob(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to start scraping job");
      }

      toast({
        title: "Scraping Started",
        description: data.message || "Scraping jobs have been started successfully.",
      });

      // Set a placeholder job to show the status
      setRecentJob({
        id: data.jobIds?.[0] || "unknown",
        status: "RUNNING",
        created_at: new Date().toISOString(),
        posts_count: 0,
        scraper: {
          name: "Multiple Scrapers",
        },
      });

      // Poll for job updates
      pollJobStatus(data.jobIds);
    } catch (error) {
      console.error("Error starting scrape:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start scraping job.",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const pollJobStatus = async (jobIds: string[]) => {
    // Poll for updates every 10 seconds for up to 5 minutes
    const maxAttempts = 30;
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) return;

      try {
        const response = await fetch(`/api/projects/${projectId}/jobs`, {
          credentials: "include",
        });
        const data = await response.json();

        if (response.ok && data.jobs) {
          const latestJob = data.jobs.find((job: ScrapeJob) => jobIds.includes(job.id));

          if (latestJob && latestJob.status !== "RUNNING") {
            setRecentJob(latestJob);
            return; // Stop polling
          }
        }
      } catch (error) {
        console.error("Error polling job status:", error);
      }

      attempts++;
      // Use configurable polling interval, default to 10 seconds
      const pollingInterval = 10000; // This could be made configurable in the future
      setTimeout(poll, pollingInterval);
    };

    poll();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FAILED":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "RUNNING":
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-100 text-green-800";
      case "FAILED":
        return "bg-red-100 text-red-800";
      case "RUNNING":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start New Scraping Job</CardTitle>
        <CardDescription>
          Run all active scrapers to collect new posts for this project
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Job Summary */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="text-center p-4 border rounded-lg">
            <div className="text-2xl font-bold">{keywords.length}</div>
            <div className="text-sm text-muted-foreground">Keywords</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-2xl font-bold">{projectName}</div>
            <div className="text-sm text-muted-foreground">Project</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-2xl font-bold">{canRunScrape ? "Ready" : "0"}</div>
            <div className="text-sm text-muted-foreground">Active Scrapers</div>
          </div>
        </div>

        {/* Start Button */}
        <div className="flex justify-center">
          <Button
            onClick={handleStartScrape}
            disabled={!canRunScrape || isRunning}
            size="lg"
            className="min-w-[200px]"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Scraping
              </>
            )}
          </Button>
        </div>

        {/* Recent Job Status */}
        {recentJob && (
          <div className="border rounded-lg p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Latest Job Status</h3>
              <div className="flex items-center gap-2">
                {getStatusIcon(recentJob.status)}
                <Badge className={getStatusColor(recentJob.status)}>{recentJob.status}</Badge>
              </div>
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Started: {new Date(recentJob.created_at).toLocaleString()}</p>
              {recentJob.completed_at && (
                <p>Completed: {new Date(recentJob.completed_at).toLocaleString()}</p>
              )}
              <p>Posts collected: {recentJob.posts_count}</p>
              {recentJob.error_message && (
                <p className="text-red-600">Error: {recentJob.error_message}</p>
              )}
            </div>
          </div>
        )}

        {!canRunScrape && (
          <div className="text-center p-4 border border-orange-200 rounded-lg bg-orange-50">
            <p className="text-sm text-orange-800">
              Configure active scrapers in the admin dashboard to start scraping.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
