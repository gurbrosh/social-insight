import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_EXCLUSION_CRITERIA } from "@/lib/campaigns/campaign-criteria-mapping";
import {
  CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT,
  CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT,
} from "@/lib/campaigns/constants";
import { enrichCampaignProfiles } from "@/lib/campaigns/enrich-campaign-profiles";
import type {
  CampaignCandidatePreviewRow,
  CampaignExclusionCriterionId,
} from "@/lib/campaigns/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exclusionIds = new Set(CAMPAIGN_EXCLUSION_CRITERIA.map((c) => c.id));

const bodySchema = z.object({
  candidates: z.array(z.object({}).passthrough()).min(1),
  selectedExclusionIds: z.array(z.string()).default([]),
  exclusionsApplied: z.array(z.string()).optional(),
  limit: z.number().int().positive().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const project = await prisma.project.findFirst({
      where: { id: projectId, user_id: session.user.id, deleted_at: null },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const selectedExclusionIds = (
      parsed.data.selectedExclusionIds.length
        ? parsed.data.selectedExclusionIds
        : (parsed.data.exclusionsApplied ?? [])
    ).filter((id): id is CampaignExclusionCriterionId =>
      exclusionIds.has(id as CampaignExclusionCriterionId)
    );

    const limit = parsed.data.limit ?? CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT;
    if (limit > CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT) {
      return NextResponse.json(
        {
          error: `Phase 3 supports up to ${CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT} profile enrichments at a time. Reduce the candidate list or run a smaller batch.`,
        },
        { status: 400 }
      );
    }

    const candidates = parsed.data.candidates as CampaignCandidatePreviewRow[];
    const continuingCount = candidates.filter(
      (c) => c.phase1_decision === "continue_to_enrichment"
    ).length;

    if (continuingCount > CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT) {
      return NextResponse.json(
        {
          error: `Phase 3 supports up to ${CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT} profile enrichments at a time. Reduce the candidate list or run a smaller batch.`,
        },
        { status: 400 }
      );
    }

    const result = await enrichCampaignProfiles({
      projectId,
      candidates,
      selectedExclusionIds,
      limit,
    });

    if (!result.ok) {
      const status = result.apifyNotConfigured ? 503 : 500;
      return NextResponse.json({ error: result.error, ok: false }, { status });
    }

    const { stats } = result;
    return NextResponse.json({
      ok: true,
      attempted: stats.attempted,
      successful: stats.successful,
      failed: stats.failed,
      notFound: stats.notFound,
      enrichedCandidates: result.enrichedCandidates,
      stats: result.stats,
      warnings: result.warnings,
      errors: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/enrich-profiles]", e);
    return NextResponse.json({ error: msg || "Profile enrichment failed" }, { status: 500 });
  }
}
