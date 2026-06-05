import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { prospectRoutingRuleDefinitionSchema } from "@/lib/prospect-intelligence/schemas";

export const dynamic = "force-dynamic";

async function assertProject(sessionUserId: string, projectId: string) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, user_id: sessionUserId, deleted_at: null },
    select: { id: true },
  });
  return p;
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  notes: z.string().nullable().optional(),
  conditionLogic: z.enum(["all", "any"]).optional(),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId, ruleId } = await params;
  if (!(await assertProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const existing = await prisma.prospectRoutingRule.findFirst({
    where: { id: ruleId, project_id: projectId, deleted_at: null },
    select: {
      id: true,
      name: true,
      enabled: true,
      priority: true,
      notes: true,
      condition_logic: true,
      conditions_json: true,
      actions_json: true,
      rule_version: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  const body = patchSchema.parse(await req.json());
  const merged = prospectRoutingRuleDefinitionSchema.parse({
    id: ruleId,
    projectId,
    name: body.name ?? existing.name,
    enabled: body.enabled ?? existing.enabled,
    priority: body.priority ?? existing.priority,
    notes: body.notes === null ? undefined : (body.notes ?? existing.notes ?? undefined),
    conditionLogic: (body.conditionLogic ?? existing.condition_logic) as "all" | "any",
    conditions: body.conditions ?? JSON.parse(existing.conditions_json),
    actions: body.actions ?? JSON.parse(existing.actions_json),
  });
  const updated = await prisma.prospectRoutingRule.update({
    where: { id: ruleId },
    data: {
      name: merged.name,
      enabled: merged.enabled,
      priority: merged.priority,
      notes: merged.notes ?? null,
      condition_logic: merged.conditionLogic,
      conditions_json: JSON.stringify(merged.conditions),
      actions_json: JSON.stringify(merged.actions),
      rule_version: existing.rule_version + 1,
    },
  });
  return NextResponse.json({ rule: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId, ruleId } = await params;
  if (!(await assertProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.prospectRoutingRule.updateMany({
    where: { id: ruleId, project_id: projectId, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  return NextResponse.json({ ok: true });
}
