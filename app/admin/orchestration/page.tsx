import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { OrchestrationPageClient } from "@/components/admin/OrchestrationPageClient";
import { getSystemActivity } from "@/lib/system-activity";

export const dynamic = "force-dynamic";

async function OrchestrationPageContent() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      redirect("/auth/signin");
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      redirect("/");
    }

    // Fetch projects and scrapers for the orchestrator
    const projects = await prisma.project
      .findMany({
        where: { deleted_at: null },
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
        orderBy: { created_at: "desc" },
      })
      .then((projects) =>
        projects.map((project) => ({
          ...project,
          description: project.description ?? undefined,
        }))
      );

    const projectsForReset = projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      keywordCount: project.keywords.length,
      scrapeCount: project._count.jobs,
    }));

    const scrapers = await prisma.scraper.findMany({
      where: {
        deleted_at: null,
        is_active: true,
      },
      orderBy: { name: "asc" },
    });

    // Custom search-source tasks for orchestration steps (Brand Blog, etc.)
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

    // Fetch orchestrations from database
    const orchestrationsRaw = await prisma.orchestration.findMany({
      where: { deleted_at: null },
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

    // Transform orchestrations for OrchestrationRecipeManager (only needs id and name)
    const orchestrationsForRecipeManager = orchestrationsRaw.map((orch) => ({
      id: orch.id,
      name: orch.name,
    }));

    // Transform orchestrations for ScraperOrchestrator (needs OrchestrationConfig format)
    // Note: ScraperOrchestrator fetches from API, but we need to pass the correct type
    const orchestrations = orchestrationsRaw.map((orch) => {
      try {
        return {
          id: orch.id,
          name: orch.name,
          description: orch.description ?? undefined,
          projectIds: JSON.parse(orch.project_ids || "[]"),
          threads: JSON.parse(orch.threads || "[]"),
          isRunning: orch.is_running,
          createdAt: orch.created_at.toISOString(),
        };
      } catch {
        return {
          id: orch.id,
          name: orch.name,
          description: orch.description ?? undefined,
          projectIds: [],
          threads: [],
          isRunning: false,
          createdAt: orch.created_at.toISOString(),
        };
      }
    });

    const systemActivity = await getSystemActivity();

    return (
      <OrchestrationPageClient
        projects={projects}
        projectsForReset={projectsForReset}
        scrapers={scrapers}
        searchSourceTasks={searchSourceTasks}
        orchestrations={orchestrations}
        orchestrationsForRecipeManager={orchestrationsForRecipeManager}
        systemActivity={systemActivity}
      />
    );
  } catch (error) {
    console.error("Error rendering OrchestrationPageContent:", error);
    // Fail soft: show a minimal error state instead of a 500 page
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Scraper Orchestration</h1>
        <p className="text-red-600">
          There was a problem loading the orchestration dashboard. Check the server logs for
          details.
        </p>
      </div>
    );
  }
}

export default function OrchestrationPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-8 w-64 bg-muted animate-pulse rounded" />
                <div className="h-4 w-96 bg-muted animate-pulse rounded mt-2" />
              </div>
              <div className="h-10 w-40 bg-muted animate-pulse rounded" />
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
            <div className="h-96 bg-muted animate-pulse rounded-lg" />
          </div>
        }
      >
        <OrchestrationPageContent />
      </Suspense>
    </div>
  );
}
