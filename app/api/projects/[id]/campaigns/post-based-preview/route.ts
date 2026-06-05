import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectPostBasedCampaignCandidates } from "@/lib/campaigns/collect-post-based";
import { enrichCampaignCandidatesWithPhase1 } from "@/lib/campaigns/build-preview-rows";
import { postBasedListToCampaignCandidates } from "@/lib/campaigns/post-based-to-campaign-candidate";
import { CAMPAIGN_EXCLUSION_CRITERIA } from "@/lib/campaigns/campaign-criteria-mapping";
import type { CampaignCandidatePreviewRow, CampaignExclusionCriterionId } from "@/lib/campaigns/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exclusionIds = new Set(
  CAMPAIGN_EXCLUSION_CRITERIA.map((c) => c.id)
);

const bodySchema = z.object({
  rangeAmount: z.number().int().min(1).max(31).default(7),
  rangeUnit: z.enum(["days", "weeks", "months"]).default("days"),
  minRelevancePercent: z.number().int().min(0).max(100).default(80),
  selectedExclusionIds: z.array(z.string()).default([]),
  includePhase1: z.boolean().default(false),
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
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const selectedExclusionIds = parsed.data.selectedExclusionIds.filter((id): id is CampaignExclusionCriterionId =>
      exclusionIds.has(id as CampaignExclusionCriterionId)
    );

    const collected = await collectPostBasedCampaignCandidates({
      projectId,
      rangeAmount: parsed.data.rangeAmount,
      rangeUnit: parsed.data.rangeUnit,
      minRelevancePercent: parsed.data.minRelevancePercent,
    });

    if (!collected.ok) {
      return NextResponse.json(
        {
          ok: false,
          prerequisite: collected.prerequisite,
          candidates: [],
          stats: null,
        },
        { status: 422 }
      );
    }

    let candidates: CampaignCandidatePreviewRow[] = postBasedListToCampaignCandidates(
      collected.candidates
    );
    let phase1Limited = false;

    if (parsed.data.includePhase1 && candidates.length > 0) {
      const enriched = await enrichCampaignCandidatesWithPhase1(
        projectId,
        candidates,
        selectedExclusionIds
      );
      candidates = enriched.rows;
      phase1Limited = enriched.phase1Limited;
    }

    return NextResponse.json({
      ok: true,
      projectName: project.name,
      candidates,
      stats: collected.stats,
      phase1Limited,
      includePhase1: parsed.data.includePhase1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/post-based-preview]", e);
    return NextResponse.json({ error: msg || "Preview failed" }, { status: 500 });
  }
}
