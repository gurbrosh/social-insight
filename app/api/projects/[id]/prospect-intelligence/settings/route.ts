import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureProspectIntelligenceSettings } from "@/lib/prospect-intelligence/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await ensureProspectIntelligenceSettings(projectId);
  const settings = await prisma.prospectIntelligenceSettings.findFirst({
    where: { project_id: projectId, deleted_at: null },
  });
  return NextResponse.json({ settings });
}

const patchSchema = z.object({
  employment_confidence_for_title_company_in_copy: z.number().min(0).max(1).optional(),
  minimum_evidence_for_auto_route: z.number().min(0).max(1).optional(),
  default_competitor_list_id: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = patchSchema.parse(await req.json());
  let existing = await prisma.prospectIntelligenceSettings.findFirst({
    where: { project_id: projectId, deleted_at: null },
  });
  if (!existing) {
    await ensureProspectIntelligenceSettings(projectId);
    existing = await prisma.prospectIntelligenceSettings.findFirst({
      where: { project_id: projectId, deleted_at: null },
    });
  }
  if (!existing) {
    return NextResponse.json({ error: "Failed to initialize settings" }, { status: 500 });
  }
  const updated = await prisma.prospectIntelligenceSettings.update({
    where: { id: existing.id },
    data: {
      employment_confidence_for_title_company_in_copy:
        body.employment_confidence_for_title_company_in_copy ??
        existing.employment_confidence_for_title_company_in_copy,
      minimum_evidence_for_auto_route:
        body.minimum_evidence_for_auto_route ?? existing.minimum_evidence_for_auto_route,
      default_competitor_list_id:
        body.default_competitor_list_id === undefined
          ? existing.default_competitor_list_id
          : body.default_competitor_list_id,
    },
  });
  return NextResponse.json({ settings: updated });
}
