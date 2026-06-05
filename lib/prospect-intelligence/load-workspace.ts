import { prisma } from "@/lib/prisma";
import { HEADLINE_FIXTURES } from "@/lib/prospect-intelligence/__fixtures__/headlines";
import { ensureProspectIntelligenceSettings } from "@/lib/prospect-intelligence/pipeline";
import type {
  ProspectCandidateRow,
  ProspectRuleRow,
  ProspectSettingsPayload,
  ProspectTemplateRow,
} from "@/components/projects/ProjectProspectsPageClient";

function mapCandidate(row: {
  id: string;
  platform: string;
  relevance_score_cached: number | null;
  headline_snapshot: string | null;
  prospectIdentity: {
    id: string;
    display_name: string | null;
    linkedin_url_normalized: string;
    manual_classification_locked: boolean;
    manual_routing_locked: boolean;
    snapshots: Array<{
      routing_recommendation: string;
      needs_review: boolean;
      overall_confidence: number;
      employment_confidence: number;
    }>;
  };
  bucketAssignments: Array<{ bucket: string; reason: string | null; status: string }>;
}): ProspectCandidateRow {
  const snap = row.prospectIdentity.snapshots[0] ?? null;
  const asg = row.bucketAssignments[0] ?? null;
  return {
    id: row.id,
    platform: row.platform,
    relevance_score_cached: row.relevance_score_cached,
    headline_snapshot: row.headline_snapshot,
    identity: {
      id: row.prospectIdentity.id,
      display_name: row.prospectIdentity.display_name,
      linkedin_url_normalized: row.prospectIdentity.linkedin_url_normalized,
      manual_classification_locked: row.prospectIdentity.manual_classification_locked,
      manual_routing_locked: row.prospectIdentity.manual_routing_locked,
    },
    snapshot: snap,
    assignment: asg ? { bucket: asg.bucket, reason: asg.reason, status: asg.status } : null,
  };
}

export type ProspectIntelligenceWorkspacePayload = {
  projectId: string;
  projectName: string;
  initialSettings: ProspectSettingsPayload | null;
  initialRules: ProspectRuleRow[];
  initialTemplates: ProspectTemplateRow[];
  initialCandidates: ProspectCandidateRow[];
  fixtureOptions: { id: string; label: string }[];
};

export async function loadProspectIntelligenceWorkspace(
  projectId: string,
  userId: string
): Promise<ProspectIntelligenceWorkspacePayload | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, user_id: userId, deleted_at: null },
    select: { id: true, name: true },
  });
  if (!project) return null;

  await ensureProspectIntelligenceSettings(projectId);

  const [settingsRow, rules, templates, candidatesRaw] = await Promise.all([
    prisma.prospectIntelligenceSettings.findFirst({
      where: { project_id: projectId, deleted_at: null },
    }),
    prisma.prospectRoutingRule.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { priority: "asc" },
    }),
    prisma.outreachTemplate.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: [{ channel: "asc" }, { priority: "asc" }],
    }),
    prisma.prospectCandidate.findMany({
      where: { project_id: projectId, deleted_at: null },
      take: 80,
      orderBy: { updated_at: "desc" },
      include: {
        prospectIdentity: {
          select: {
            id: true,
            linkedin_url_normalized: true,
            display_name: true,
            manual_classification_locked: true,
            manual_routing_locked: true,
            snapshots: {
              where: { deleted_at: null, superseded_at: null },
              take: 1,
              orderBy: { computed_at: "desc" },
              select: {
                routing_recommendation: true,
                needs_review: true,
                overall_confidence: true,
                employment_confidence: true,
              },
            },
          },
        },
        bucketAssignments: {
          where: { deleted_at: null },
          take: 1,
          orderBy: { created_at: "desc" },
        },
      },
    }),
  ]);

  return {
    projectId: project.id,
    projectName: project.name,
    initialSettings: settingsRow
      ? {
          employment_confidence_for_title_company_in_copy:
            settingsRow.employment_confidence_for_title_company_in_copy,
          minimum_evidence_for_auto_route: settingsRow.minimum_evidence_for_auto_route,
          default_competitor_list_id: settingsRow.default_competitor_list_id,
        }
      : null,
    initialRules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      notes: r.notes,
      condition_logic: r.condition_logic,
      conditions_json: r.conditions_json,
      actions_json: r.actions_json,
    })),
    initialTemplates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      channel: t.channel,
      template_type: t.template_type,
      enabled: t.enabled,
      priority: t.priority,
    })),
    initialCandidates: candidatesRaw.map(mapCandidate),
    fixtureOptions: HEADLINE_FIXTURES.map((f) => ({
      id: f.id,
      label: f.headline.length > 72 ? `${f.headline.slice(0, 72)}…` : f.headline,
    })),
  };
}
