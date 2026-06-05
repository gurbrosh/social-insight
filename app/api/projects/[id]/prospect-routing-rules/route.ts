import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ulid } from "ulid";
import { prospectRoutingRuleDefinitionSchema } from "@/lib/prospect-intelligence/schemas";

export const dynamic = "force-dynamic";

async function assertProject(sessionUserId: string, projectId: string) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, user_id: sessionUserId, deleted_at: null },
    select: { id: true },
  });
  return p;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId } = await params;
  if (!(await assertProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rules = await prisma.prospectRoutingRule.findMany({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { priority: "asc" },
  });
  return NextResponse.json({ rules });
}

const createSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  notes: z.string().optional(),
  conditionLogic: z.enum(["all", "any"]),
  conditions: z.array(z.unknown()),
  actions: z.array(z.unknown()),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId } = await params;
  if (!(await assertProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = createSchema.parse(await req.json());
  const draft = prospectRoutingRuleDefinitionSchema.parse({
    id: "temp",
    projectId,
    name: body.name,
    enabled: body.enabled ?? true,
    priority: body.priority ?? 100,
    notes: body.notes,
    conditionLogic: body.conditionLogic,
    conditions: body.conditions,
    actions: body.actions,
  });
  const created = await prisma.prospectRoutingRule.create({
    data: {
      id: ulid(),
      project_id: projectId,
      name: draft.name,
      enabled: draft.enabled,
      priority: draft.priority,
      notes: draft.notes ?? null,
      condition_logic: draft.conditionLogic,
      conditions_json: JSON.stringify(draft.conditions),
      actions_json: JSON.stringify(draft.actions),
    },
  });
  return NextResponse.json({ rule: created });
}
