"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const PERSONAS = ["Founder", "CTO", "Engineering", "Marketing", "Sales"] as const;

const exampleResponsesSchema = z.array(
  z.object({
    platform: z.string().min(1),
    examples: z.array(z.string()),
  })
);

const sourceRowSchema = z.object({
  include: z.boolean(),
  belongToOrg: z.boolean(),
});

const sourceReplySettingsSchema = z.record(z.string(), sourceRowSchema);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  source_reply_settings: sourceReplySettingsSchema,
  persona: z.enum(PERSONAS),
  relevance_guidelines: z.string().max(8000).optional().default(""),
  style_guidelines: z.string().max(8000).optional().default(""),
  example_responses: z.union([exampleResponsesSchema, z.null()]).optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().min(1),
});

function toSourceReplySettingsJson(
  val: z.infer<typeof sourceReplySettingsSchema>
): Prisma.InputJsonValue {
  return val as unknown as Prisma.InputJsonValue;
}

function toExampleJson(
  val: z.infer<typeof exampleResponsesSchema> | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (val == null || val.length === 0) return Prisma.JsonNull;
  return val as unknown as Prisma.InputJsonValue;
}

async function assertProjectOwner(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, user_id: userId, deleted_at: null },
    select: { id: true },
  });
  return project != null;
}

function dbErrorMessage(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.message;
  }
  if (e instanceof Error) {
    const m = e.message;
    if (/Unknown argument/i.test(m)) {
      return `${m}\n\nThe Prisma client is out of sync with schema.prisma. Run: npx prisma generate\nThen restart the dev server (stop and npm run dev again).`;
    }
    if (/no such column|does not exist/i.test(m)) {
      return `${m} If the schema was updated recently, run: npx prisma migrate deploy`;
    }
    return m;
  }
  return "Database error";
}

export async function listResponseObjectives(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized" };
  }
  const ok = await assertProjectOwner(projectId, session.user.id);
  if (!ok) {
    return { success: false as const, error: "Project not found" };
  }

  try {
    const rows = await prisma.responseObjective.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { created_at: "asc" },
    });

    return { success: true as const, objectives: rows };
  } catch (e) {
    console.error("[response-objectives] listResponseObjectives", e);
    return {
      success: false as const,
      error: `Could not load objectives: ${dbErrorMessage(e)}`,
    };
  }
}

export async function createResponseObjective(
  projectId: string,
  raw: z.infer<typeof createSchema>
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized" };
  }
  const ok = await assertProjectOwner(projectId, session.user.id);
  if (!ok) {
    return { success: false as const, error: "Project not found" };
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const d = parsed.data;
  try {
    await prisma.responseObjective.create({
      data: {
        project_id: projectId,
        name: d.name,
        description: d.description ?? "",
        source_reply_settings: toSourceReplySettingsJson(d.source_reply_settings),
        allowed_sources: Prisma.JsonNull,
        excluded_sources: Prisma.JsonNull,
        is_org_identified: false,
        persona: d.persona,
        relevance_guidelines: d.relevance_guidelines ?? "",
        style_guidelines: d.style_guidelines ?? "",
        example_responses: toExampleJson(d.example_responses ?? null),
      },
    });
  } catch (e) {
    console.error("[response-objectives] createResponseObjective", e);
    return {
      success: false as const,
      error: `Could not save objective: ${dbErrorMessage(e)}`,
    };
  }

  revalidatePath(`/projects/${projectId}/edit`);
  return { success: true as const };
}

export async function updateResponseObjective(
  projectId: string,
  raw: z.infer<typeof updateSchema>
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized" };
  }
  const ok = await assertProjectOwner(projectId, session.user.id);
  if (!ok) {
    return { success: false as const, error: "Project not found" };
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const d = parsed.data;
  const existing = await prisma.responseObjective.findFirst({
    where: { id: d.id, project_id: projectId, deleted_at: null },
  });
  if (!existing) {
    return { success: false as const, error: "Objective not found" };
  }

  try {
    await prisma.responseObjective.update({
      where: { id: d.id },
      data: {
        name: d.name,
        description: d.description ?? "",
        source_reply_settings: toSourceReplySettingsJson(d.source_reply_settings),
        allowed_sources: Prisma.JsonNull,
        excluded_sources: Prisma.JsonNull,
        is_org_identified: false,
        persona: d.persona,
        relevance_guidelines: d.relevance_guidelines ?? "",
        style_guidelines: d.style_guidelines ?? "",
        example_responses: toExampleJson(d.example_responses ?? null),
      },
    });
  } catch (e) {
    console.error("[response-objectives] updateResponseObjective", e);
    return {
      success: false as const,
      error: `Could not save objective: ${dbErrorMessage(e)}`,
    };
  }

  revalidatePath(`/projects/${projectId}/edit`);
  return { success: true as const };
}

export async function deleteResponseObjective(projectId: string, objectiveId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized" };
  }
  const ok = await assertProjectOwner(projectId, session.user.id);
  if (!ok) {
    return { success: false as const, error: "Project not found" };
  }

  const existing = await prisma.responseObjective.findFirst({
    where: { id: objectiveId, project_id: projectId, deleted_at: null },
  });
  if (!existing) {
    return { success: false as const, error: "Objective not found" };
  }

  try {
    await prisma.responseObjective.update({
      where: { id: objectiveId },
      data: { deleted_at: new Date() },
    });
  } catch (e) {
    console.error("[response-objectives] deleteResponseObjective", e);
    return {
      success: false as const,
      error: `Could not delete objective: ${dbErrorMessage(e)}`,
    };
  }

  revalidatePath(`/projects/${projectId}/edit`);
  return { success: true as const };
}
