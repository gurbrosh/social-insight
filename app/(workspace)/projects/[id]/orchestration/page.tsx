import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { OrchestrationPageClient } from "@/components/admin/OrchestrationPageClient";
import type { OrchestrationConfig } from "@/components/admin/ScraperOrchestrator";
import { getSystemActivity } from "@/lib/system-activity";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface ProjectOrchestrationPageProps {
  params: Promise<{ id: string }>;
}

async function ProjectOrchestrationContent({ projectId }: { projectId: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    redirect("/");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deleted_at: null,
    },
    include: {
      keywords: {
        where: { deleted_at: null },
      },
      _count: {
        select: {
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

  const projects = [
    {
      ...project,
      description: project.description ?? undefined,
      _count: { jobs: project._count.jobs },
    },
  ];

  const projectsForReset = [
    {
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      keywordCount: project.keywords.length,
      scrapeCount: project._count.jobs,
    },
  ];

  const scrapers = await prisma.scraper.findMany({
    where: {
      deleted_at: null,
      is_active: true,
    },
    orderBy: { name: "asc" },
  });

  const searchSourceTasksRaw = await (
    prisma as unknown as {
      searchSourceTask: {
        findMany: (args: unknown) => Promise<{ id: string; name: string; target: string }[]>;
      };
    }
  ).searchSourceTask.findMany({
    where: {
      deleted_at: null,
      is_active: true,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, target: true },
  });
  const searchSourceTasks = searchSourceTasksRaw.map((t) => ({
    id: t.id,
    name: t.name,
    target: t.target,
  }));

  const orchestrationsRaw = await prisma.orchestration.findMany({
    where: {
      deleted_at: null,
      project_ids: { contains: `"${projectId}"` },
    },
    select: {
      id: true,
      name: true,
      description: true,
      project_ids: true,
      threads: true,
      is_running: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" },
  });

  const orchestrationsForRecipeManager = orchestrationsRaw.map((orch) => ({
    id: orch.id,
    name: orch.name,
  }));

  const orchestrations: OrchestrationConfig[] = orchestrationsRaw.map((orch) => {
    try {
      return {
        id: orch.id,
        name: orch.name,
        description: orch.description ?? undefined,
        projectIds: JSON.parse(orch.project_ids || "[]"),
        threads: JSON.parse(orch.threads || "[]"),
        isRunning: orch.is_running,
        createdAt: orch.created_at.toISOString(),
      } as OrchestrationConfig;
    } catch {
      return {
        id: orch.id,
        name: orch.name,
        description: orch.description ?? undefined,
        projectIds: [],
        threads: [],
        isRunning: false,
        createdAt: orch.created_at.toISOString(),
      } as OrchestrationConfig;
    }
  });

  const systemActivity = await getSystemActivity({ projectId });

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Orchestration" },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${project.id}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Link>
        </Button>
      </div>

      <OrchestrationPageClient
        projects={projects}
        projectsForReset={projectsForReset}
        scrapers={scrapers}
        searchSourceTasks={searchSourceTasks}
        orchestrations={orchestrations}
        orchestrationsForRecipeManager={orchestrationsForRecipeManager}
        systemActivity={systemActivity}
        initialSelectedProjectIds={[projectId]}
        hideProjectPicker
        systemActivityPollProjectId={projectId}
      />
    </div>
  );
}

export default async function ProjectOrchestrationPage({ params }: ProjectOrchestrationPageProps) {
  const resolvedParams = await params;

  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="h-6 w-48 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            <div className="h-96 bg-muted animate-pulse rounded-lg" />
          </div>
        }
      >
        <ProjectOrchestrationContent projectId={resolvedParams.id} />
      </Suspense>
    </div>
  );
}
