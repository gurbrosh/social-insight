import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectPostBasedCampaignCandidates } from "@/lib/campaigns/collect-post-based";
import { buildCampaignSourceCsvContent } from "@/lib/campaigns/build-source-csv";
import {
  buildCampaignPhase1CsvContent,
  exclusionIdsToLabels,
} from "@/lib/campaigns/build-campaign-phase1-csv";
import { enrichCampaignCandidatesWithPhase1 } from "@/lib/campaigns/build-preview-rows";
import { postBasedListToCampaignCandidates } from "@/lib/campaigns/post-based-to-campaign-candidate";
import { CAMPAIGN_EXCLUSION_CRITERIA } from "@/lib/campaigns/campaign-criteria-mapping";
import type {
  CampaignCandidatePreviewRow,
  CampaignExclusionCriterionId,
} from "@/lib/campaigns/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exclusionIds = new Set(CAMPAIGN_EXCLUSION_CRITERIA.map((c) => c.id));

const querySchema = z.object({
  rangeAmount: z.coerce.number().int().min(1).max(31).default(7),
  rangeUnit: z.enum(["days", "weeks", "months"]).default("days"),
  minRelevancePercent: z.coerce.number().int().min(0).max(100).default(80),
  includePhase1: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  exclusions: z.string().optional(),
});

function utcYmd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

const exportBodySchema = z.object({
  rows: z.array(z.object({}).passthrough()).min(1).max(2000).optional(),
});

async function handleExport(request: Request, projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, user_id: session.user.id, deleted_at: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let bodyRows: z.infer<typeof exportBodySchema>["rows"] | undefined;
  if (request.method === "POST") {
    const json = await request.json().catch(() => null);
    const bodyParsed = exportBodySchema.safeParse(json);
    if (bodyParsed.success && bodyParsed.data.rows?.length) {
      bodyRows = bodyParsed.data.rows;
    }
  }

  const { searchParams } = new URL(request.url);
  const q = querySchema.safeParse({
    rangeAmount: searchParams.get("rangeAmount") ?? undefined,
    rangeUnit: searchParams.get("rangeUnit") ?? undefined,
    minRelevancePercent: searchParams.get("minRelevancePercent") ?? undefined,
    includePhase1: searchParams.get("includePhase1") ?? undefined,
    exclusions: searchParams.get("exclusions") ?? undefined,
  });
  if (!q.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const selectedExclusionIds = (q.data.exclusions ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id): id is CampaignExclusionCriterionId => exclusionIds.has(id as CampaignExclusionCriterionId));

  let rows: CampaignCandidatePreviewRow[];

  if (bodyRows) {
    rows = bodyRows as CampaignCandidatePreviewRow[];
  } else {
    const collected = await collectPostBasedCampaignCandidates({
      projectId,
      rangeAmount: q.data.rangeAmount,
      rangeUnit: q.data.rangeUnit,
      minRelevancePercent: q.data.minRelevancePercent,
    });

    if (!collected.ok) {
      const prereq = collected.prerequisite;
      return NextResponse.json(
        {
          error: prereq.ok ? "Post-based source unavailable" : prereq.message,
          code: prereq.ok ? "missing_product" : prereq.code,
        },
        { status: 422 }
      );
    }

    rows = postBasedListToCampaignCandidates(collected.candidates);
    if (q.data.includePhase1 && rows.length > 0) {
      const enriched = await enrichCampaignCandidatesWithPhase1(
        projectId,
        rows,
        selectedExclusionIds
      );
      rows = enriched.rows;
    }
  }

  const csv = q.data.includePhase1
    ? buildCampaignPhase1CsvContent(rows, {
        exclusionLabels: exclusionIdsToLabels(selectedExclusionIds),
      })
    : buildCampaignSourceCsvContent(rows);
  const filename = `campaign_post_based_${utcYmd()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Campaign-Export-Debug": `rows=${rows.length};phase1=${q.data.includePhase1 ? "1" : "0"}`,
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    return await handleExport(request, projectId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/post-based-export]", e);
    return NextResponse.json({ error: msg || "Export failed" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    return await handleExport(request, projectId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/post-based-export]", e);
    return NextResponse.json({ error: msg || "Export failed" }, { status: 500 });
  }
}
