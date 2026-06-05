import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enrichCampaignCandidatesWithPhase1 } from "@/lib/campaigns/build-preview-rows";
import { CAMPAIGN_EXCLUSION_CRITERIA } from "@/lib/campaigns/campaign-criteria-mapping";
import type { CampaignCandidate, CampaignExclusionCriterionId } from "@/lib/campaigns/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exclusionIds = new Set(CAMPAIGN_EXCLUSION_CRITERIA.map((c) => c.id));

const bodySchema = z.object({
  candidates: z.array(z.object({}).passthrough()).min(1),
  selectedExclusionIds: z.array(z.string()).default([]),
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

    const selectedExclusionIds = parsed.data.selectedExclusionIds.filter(
      (id): id is CampaignExclusionCriterionId => exclusionIds.has(id as CampaignExclusionCriterionId)
    );

    const candidates = parsed.data.candidates as CampaignCandidate[];
    const { rows, phase1Limited } = await enrichCampaignCandidatesWithPhase1(
      projectId,
      candidates,
      selectedExclusionIds
    );

    return NextResponse.json({
      ok: true,
      candidates: rows,
      phase1Limited,
      sourceCount: candidates.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/phase1-apply]", e);
    return NextResponse.json({ error: msg || "Phase 1 failed" }, { status: 500 });
  }
}
