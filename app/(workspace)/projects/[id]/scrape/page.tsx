import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ArrowLeft, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { ScrapeJobManager } from "@/components/projects/ScrapeJobManager";

export const dynamic = "force-dynamic";

interface ScrapePageProps {
  params: Promise<{
    id: string;
  }>;
}

async function ScrapePageContent({ projectId }: { projectId: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user_id: session.user.id,
      deleted_at: null,
    },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
      jobs: {
        where: { deleted_at: null },
        include: {
          scraper: true,
        },
        orderBy: { created_at: "desc" },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const activeScrapers = await prisma.scraper.findMany({
    where: {
      is_active: true,
      deleted_at: null,
    },
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Run Scrape" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All Projects
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${projectId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Project
              </Link>
            </Button>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Run Scrape</h1>
            <p className="text-muted-foreground">
              Start a new scraping job for &quot;{project.name}&quot;
            </p>
          </div>
        </div>
      </div>

      {/* Project Keywords */}
      <Card>
        <CardHeader>
          <CardTitle>Keywords to Monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {project.keywords.map((keyword) => (
              <Badge key={keyword.id} variant="secondary">
                {keyword.keyword}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Available Scrapers */}
      <Card>
        <CardHeader>
          <CardTitle>Available Scrapers</CardTitle>
          <CardDescription>
            {activeScrapers.length} active scraper(s) will be used for this job
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeScrapers.length === 0 ? (
            <div className="text-center py-8">
              <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Active Scrapers</h3>
              <p className="text-muted-foreground mb-4">
                You need to configure active scrapers before running a scrape job.
              </p>
              <Button asChild>
                <Link href="/admin/scrapers">Configure Scrapers</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeScrapers.map((scraper) => (
                <div
                  key={scraper.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <h3 className="font-medium">{scraper.name}</h3>
                    <p className="text-sm text-muted-foreground">Actor ID: {scraper.actor_id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {scraper.save_to_db ? "Save to DB" : "Downstream"}
                    </Badge>
                    <Badge variant="default">Active</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scrape Job Manager */}
      <ScrapeJobManager
        projectId={projectId}
        projectName={project.name}
        keywords={project.keywords.map((k) => k.keyword)}
        canRunScrape={activeScrapers.length > 0}
      />

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Scraping Jobs</CardTitle>
          <CardDescription>History of scraping jobs for this project</CardDescription>
        </CardHeader>
        <CardContent>
          {project.jobs.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Jobs Yet</h3>
              <p className="text-muted-foreground">
                Start your first scraping job to begin collecting data.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {project.jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{job.scraper.name}</span>
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
                    <p className="text-sm text-muted-foreground">
                      {new Date(job.created_at).toLocaleString()}
                      {job.completed_at && (
                        <span> • Completed {new Date(job.completed_at).toLocaleString()}</span>
                      )}
                    </p>
                    {job.error_message && (
                      <p className="text-sm text-red-600">Error: {job.error_message}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{job.posts_count} posts</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ScrapePage({ params }: ScrapePageProps) {
  const resolvedParams = await params;

  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              <div>
                <div className="h-8 w-48 bg-muted animate-pulse rounded mb-2" />
                <div className="h-4 w-64 bg-muted animate-pulse rounded" />
              </div>
            </div>
            <div className="grid gap-6">
              <div className="h-32 bg-muted animate-pulse rounded-lg" />
              <div className="h-32 bg-muted animate-pulse rounded-lg" />
              <div className="h-32 bg-muted animate-pulse rounded-lg" />
            </div>
          </div>
        }
      >
        <ScrapePageContent projectId={resolvedParams.id} />
      </Suspense>
    </div>
  );
}
