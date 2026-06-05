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

const createTaskSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100)
    .transform((s) => s.trim()),
  description: z.string().max(2000).optional().nullable(),
  timing_definition: timingEnum,
  timing_duration_number: z.number().int().min(1).max(365).optional().nullable(),
  timing_duration_unit: durationUnitEnum,
  openai_prompt_text: z.string().max(50000).optional().nullable(),
  target: targetEnum,
  is_active: z.boolean().default(true),
  config_json: z.string().optional().nullable(),
});

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const tasks = await prisma.searchSourceTask.findMany({
      where: { deleted_at: null },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("Error fetching search source tasks:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const data = createTaskSchema.parse(body);

    const existingByName = await prisma.searchSourceTask.findFirst({
      where: { name: data.name },
    });
    // Use === null only: `undefined == null` is true and would fire when no row exists.
    if (existingByName != null && existingByName.deleted_at === null) {
      return NextResponse.json({ error: "A task with this name already exists" }, { status: 400 });
    }

    const payload = {
      description: data.description ?? undefined,
      timing_definition: data.timing_definition,
      timing_duration_number: data.timing_duration_number ?? undefined,
      timing_duration_unit: data.timing_duration_unit ?? undefined,
      openai_prompt_text: (data.openai_prompt_text ?? "").trim() || "",
      target: data.target,
      is_active: data.is_active,
      config_json: data.config_json ?? undefined,
    };

    const task =
      existingByName != null
        ? await prisma.searchSourceTask.update({
            where: { id: existingByName.id },
            data: {
              ...payload,
              deleted_at: null,
            },
          })
        : await prisma.searchSourceTask.create({
            data: {
              name: data.name,
              ...payload,
            },
          });
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "A task with this name already exists. If you deleted it recently, try again or pick another name.",
        },
        { status: 409 }
      );
    }
    console.error("Error creating search source task:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
