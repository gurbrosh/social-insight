"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProjectProspectsPageClient } from "@/components/projects/ProjectProspectsPageClient";
import type { ProspectIntelligenceWorkspacePayload } from "@/lib/prospect-intelligence/load-workspace";

type Props = {
  projectId: string;
};

export function ProspectIntelligenceTab({ projectId }: Props) {
  const [workspace, setWorkspace] = useState<ProspectIntelligenceWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setWorkspace(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/prospect-intelligence/workspace`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load prospect intelligence");
        return r.json();
      })
      .then((data: ProspectIntelligenceWorkspacePayload) => setWorkspace(data))
      .catch((e) => {
        setWorkspace(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!projectId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a project above to manage prospect intelligence.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading prospect intelligence…</p>;
  }

  if (error || !workspace) {
    return (
      <p className="text-sm text-destructive">
        {error ?? "Could not load prospect intelligence for this project."}
      </p>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <Alert>
        <AlertDescription>
          Prospect Intelligence is a separate routing and template system. It is not used by
          Campaigns Phase 1.
        </AlertDescription>
      </Alert>
      <ProjectProspectsPageClient
        projectId={workspace.projectId}
        projectName={workspace.projectName}
        initialSettings={workspace.initialSettings}
        initialRules={workspace.initialRules}
        initialTemplates={workspace.initialTemplates}
        initialCandidates={workspace.initialCandidates}
        fixtureOptions={workspace.fixtureOptions}
        embedded
      />
    </div>
  );
}
