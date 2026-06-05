import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

const timingEnum = z.enum(["LAST_HOUR", "LAST_DAY", "LAST_7_DAYS", "LAST_WEEK"]);
const targetEnum = z.enum([
  "Post",
  "DownstreamPost",
  "BrandBlogNews",
  "Scraper",
  "HackerNews",
  "GithubReader",
]);
const durationUnitEnum = z.enum(["day", "week", "month"]).optional().nullable();

const updateByNameSchema = z.object({
  current_name: z.string().min(1, "current_name is required"),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional().nullable(),
  timing_definition: timingEnum.optional(),
  timing_duration_number: z.number().int().min(1).max(365).optional().nullable(),
  timing_duration_unit: durationUnitEnum,
  openai_prompt_text: z.string().max(50000).optional().nullable(),
  target: targetEnum.optional(),
  is_active: z.boolean().optional(),
  config_json: z.string().optional().nullable(),
});

/**
 * PUT /api/admin/search-source-tasks/by-name
 * Update a task by its current name (for tasks with empty id from before ULID was added).
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }
    const parsed = updateByNameSchema.parse(body);
    const { current_name, ...data } = parsed;

    const task = await prisma.searchSourceTask.findFirst({
      where: { name: current_name.trim(), deleted_at: null },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const newName = data.name?.trim();
    const currentName = task.name?.trim();
    if (newName && newName !== currentName) {
      const existing = await prisma.searchSourceTask.findFirst({
        where: {
          name: data.name,
          deleted_at: null,
          id: { not: task.id },
        },
      });
      if (existing && existing.id !== task.id) {
        return NextResponse.json(
          { error: "A task with this name already exists" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.searchSourceTask.update({
      where: { id: task.id },
      data: {
        ...(data.name != null && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.timing_definition != null && { timing_definition: data.timing_definition }),
        ...(data.timing_duration_number !== undefined && {
          timing_duration_number: data.timing_duration_number,
        }),
        ...(data.timing_duration_unit !== undefined && {
          timing_duration_unit: data.timing_duration_unit,
        }),
        ...(data.openai_prompt_text !== undefined && {
          openai_prompt_text: (data.openai_prompt_text ?? "").trim() || "",
        }),
        ...(data.target != null && { target: data.target }),
        ...(data.is_active !== undefined && { is_active: data.is_active }),
        ...(data.config_json !== undefined && { config_json: data.config_json }),
      },
    });
    return NextResponse.json({ task: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    console.error("Error updating search source task by name:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
