import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  manual_classification_locked: z.boolean().optional(),
  manual_routing_locked: z.boolean().optional(),
  locked_fields_json: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; identityId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId, identityId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, user_id: session.user.id, deleted_at: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const identity = await prisma.prospectIdentity.findFirst({
    where: { id: identityId, project_id: projectId, deleted_at: null },
  });
  if (!identity) {
    return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  }
  const body = patchSchema.parse(await req.json());
  const updated = await prisma.prospectIdentity.update({
    where: { id: identityId },
    data: {
      manual_classification_locked:
        body.manual_classification_locked ?? identity.manual_classification_locked,
      manual_routing_locked: body.manual_routing_locked ?? identity.manual_routing_locked,
      locked_fields_json:
        body.locked_fields_json === undefined
          ? identity.locked_fields_json
          : body.locked_fields_json,
    },
  });
  return NextResponse.json({ identity: updated });
}
