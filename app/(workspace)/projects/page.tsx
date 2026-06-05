import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Hash, BarChart3, Clock, Play, Settings, Building2 } from "lucide-react";
import Link from "next/link";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";

export const dynamic = "force-dynamic";

async function ProjectsList() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const projects = await prisma.project.findMany({
    where: {
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
    orderBy: { created_at: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage your social listening projects and monitor keyword mentions
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first project to start monitoring social media mentions
            </p>
            <Button asChild>
              <Link href="/projects/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="hover:shadow-md transition-shadow min-w-0 overflow-hidden"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-lg break-words">{project.name}</CardTitle>
                    {project.description && (
                      <CardDescription>{project.description}</CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-1">
                    <Hash className="h-4 w-4" />
                    {project.keywords.length} keywords
                  </div>
                  <div className="flex items-center gap-1">
                    <Building2 className="h-4 w-4" />
                    {project.brands.length} brands
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {project._count.jobs} search jobs
                  </div>
                  {project.schedule_enabled && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Scheduled
                    </div>
                  )}
                </div>

                <div className="text-sm">
                  <span className="font-medium">{project._count.posts}</span> posts collected
                </div>

                <div className="grid grid-cols-2 gap-2 min-w-0">
                  <Button variant="outline" size="sm" asChild className="min-w-0">
                    <Link href={`/projects/${project.id}`} className="truncate">
                      View Results
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="min-w-0">
                    <Link
                      href={`/projects/${project.id}/edit`}
                      className="inline-flex items-center"
                    >
                      <Settings className="mr-1 h-3 w-3 shrink-0" />
                      <span className="truncate">Edit</span>
                    </Link>
                  </Button>
                  <div className="col-span-2 flex min-w-0 items-stretch gap-2">
                    <DeleteProjectButton projectId={project.id} projectName={project.name} />
                    <Button size="sm" asChild className="min-w-0 flex-1">
                      <Link
                        href={`/projects/${project.id}/scrape`}
                        className="inline-flex min-w-0 items-center justify-center gap-1"
                      >
                        <Play className="h-3 w-3 shrink-0" />
                        <span className="truncate">Run Now</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-8 w-48 bg-muted animate-pulse rounded" />
                <div className="h-4 w-96 bg-muted animate-pulse rounded mt-2" />
              </div>
              <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          </div>
        }
      >
        <ProjectsList />
      </Suspense>
    </div>
  );
}
