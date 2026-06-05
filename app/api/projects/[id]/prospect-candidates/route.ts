import type { ProspectOutreachBucket } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket");
  const candidates = await prisma.prospectCandidate.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      ...(bucket && bucket !== "all"
        ? {
            bucketAssignments: {
              some: { bucket: bucket as ProspectOutreachBucket, deleted_at: null },
            },
          }
        : {}),
    },
    take: 100,
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
  });
  return NextResponse.json({ candidates });
}
