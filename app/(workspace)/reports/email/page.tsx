import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEmailReportSettings } from "@/app/actions/email-report-settings";
import { EmailReportsWorkspace } from "@/components/reports/EmailReportsWorkspace";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string; project?: string }>;
};

export default async function EmailReportsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { tab, project: projectQuery } = await searchParams;

  const [projects, settingsResult] = await Promise.all([
    prisma.project.findMany({
      where: { user_id: session.user.id, deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { id: true, name: true },
    }),
    getEmailReportSettings(),
  ]);

  const initialSettings = settingsResult.ok ? settingsResult.settings : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Email reports</h1>
        <p className="text-muted-foreground max-w-2xl">
          Choose a project, then configure scheduled email reports, LinkedIn prospect exports, and{" "}
          <strong>Campaigns</strong> (CSV-first qualification: sources, exclusions, Phase 1, export).
          Prospect Intelligence routing lives under Automation — separate from Campaigns.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <EmailReportsWorkspace
          projects={projects}
          initialSettings={initialSettings}
          userEmail={session.user.email ?? null}
          defaultTab={tab}
          initialProjectId={projectQuery}
        />
      </Suspense>
    </div>
  );
}
