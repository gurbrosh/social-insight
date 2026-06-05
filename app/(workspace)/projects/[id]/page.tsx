import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Settings, Hash, Calendar, BarChart3, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { RecentPosts } from "@/components/projects/RecentPosts";
import { RecentScrapes } from "@/components/projects/RecentScrapes";
import { ProjectAnalysisTabs } from "@/components/projects/ProjectAnalysisTabs";
import { BrandInsight } from "@/components/projects/BrandInsight";
import { ProjectControlPanel } from "@/components/projects/ProjectControlPanel";
import { getSystemActivity } from "@/lib/system-activity";
// import { JobStatusTracker } from "@/components/projects/JobStatusTracker";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{
    id: string;
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatRelativeTime(target: Date) {
  const diffMs = target.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) {
    return rtf.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

async function ProjectDetails({ projectId }: { projectId: string }) {
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
      brands: {
        where: { deleted_at: null },
      },
      _count: {
        select: {
          posts: true,
          jobs: {
            where: { deleted_at: null },
          },
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const projectRecipes = await prisma.orchestrationRecipe.findMany({
    where: {
      deleted_at: null,
      user_id: session.user.id,
      steps: {
        some: {
          deleted_at: null,
          orchestration: {
            deleted_at: null,
            project_ids: {
              contains: `"${projectId}"`,
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      is_active: true,
      timezone: true,
    },
    orderBy: { created_at: "desc" },
  });

  const recipeSummaries = await Promise.all(
    projectRecipes.map(async (recipe) => {
      let nextRunDisplay = "Not scheduled";
      try {
        const nextTask = await prisma.orchestrationTimerTask.findFirst({
          where: {
            status: "PENDING",
            deleted_at: null,
            recipeStep: {
              recipe_id: recipe.id,
              deleted_at: null,
              recipe: {
                deleted_at: null,
              },
            },
          },
          orderBy: { scheduled_at: "asc" },
        });

        if (nextTask) {
          const scheduledDate = nextTask.scheduled_at;
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: recipe.timezone || project.schedule_timezone || "UTC",
            dateStyle: "medium",
            timeStyle: "short",
          });
          nextRunDisplay = formatter.format(scheduledDate);
        }
      } catch (error) {
        console.error("Error looking up next orchestration task:", error);
      }

      return {
        id: recipe.id,
        name: recipe.name,
        isActive: recipe.is_active,
        nextRunDisplay,
      };
    })
  );

  const activity = await getSystemActivity({ projectId });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: "Projects", href: "/projects" }, { label: project.name }]} />

      {/* Project Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-4 mb-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All Projects
              </Link>
            </Button>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Hash className="h-4 w-4" />
              {project.keywords.length} keywords
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {project._count.jobs} scrapes
            </div>
            <div className="flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              {project._count.posts} posts
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <ProjectControlPanel
            recipes={recipeSummaries}
            projectId={project.id}
            initialActivity={activity}
          />
          <Button variant="outline" asChild className="self-start">
            <Link href={`/projects/${project.id}/edit`}>
              <Settings className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* Project Configuration - Compact Row */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Keywords */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {project.keywords.length > 0 ? (
                project.keywords.map((keyword) => (
                  <Badge key={keyword.id} variant="secondary" className="text-xs">
                    {keyword.keyword}
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No keywords</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Brands & Companies */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Brands & Companies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {project.brands.length > 0 ? (
                project.brands.map((brand) => (
                  <Badge key={brand.id} variant="outline" className="text-xs">
                    {brand.brand_name}
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No brands</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Brand Insight */}
      <BrandInsight projectId={projectId} />

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentScrapes projectId={projectId} />
        <RecentPosts projectId={projectId} />
      </div>

      {/* Job Status Section - Temporarily disabled */}
      {/* <JobStatusTracker projectId={projectId} /> */}

      {/* Analysis Tabs Section */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Data Filters</CardTitle>
              <CardDescription>
                Explore and analyze your collected data from multiple perspectives
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={<div className="h-40 animate-pulse rounded-md bg-muted" aria-hidden />}
          >
            <ProjectAnalysisTabs projectId={projectId} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const resolvedParams = await params;

  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-8 w-64 bg-muted animate-pulse rounded" />
                <div className="h-4 w-96 bg-muted animate-pulse rounded" />
                <div className="h-4 w-48 bg-muted animate-pulse rounded" />
              </div>
              <div className="flex gap-2">
                <div className="h-10 w-20 bg-muted animate-pulse rounded" />
                <div className="h-10 w-24 bg-muted animate-pulse rounded" />
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-64 bg-muted animate-pulse rounded-lg" />
              <div className="h-64 bg-muted animate-pulse rounded-lg" />
            </div>
          </div>
        }
      >
        <ProjectDetails projectId={resolvedParams.id} />
      </Suspense>
    </div>
  );
}
