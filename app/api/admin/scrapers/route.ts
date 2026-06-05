import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { validateScraperConfigJson } from "@/lib/scraper-config-validator";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Map Zod issues to messages users can act on (e.g. "Please select a platform"). */
function friendlyScraperValidationErrors(issues: z.ZodIssue[]): {
  friendlyError: string;
  friendlyDetails: Array<{ path: (string | number)[]; message: string }>;
} {
  const friendlyDetails = issues.map((issue) => {
    const field = issue.path[0];
    const raw = issue.message ?? "Invalid value";
    let message = raw;
    if (
      field === "platform" &&
      (raw.includes("enum") || raw.includes("received ''") || raw.includes("Required"))
    ) {
      message = "Please select a platform (e.g. YouTube, Website).";
    } else if (field === "name" && raw.toLowerCase().includes("required")) {
      message = "Please enter a name for the scraper.";
    } else if (field === "actor_id" && raw.toLowerCase().includes("required")) {
      message = "Please enter the Actor ID.";
    } else if (field === "config_json" && raw.toLowerCase().includes("required")) {
      message = "Please add JSON configuration.";
    } else if (field === "readme_url" && raw.toLowerCase().includes("url")) {
      message = "Please enter a valid URL or leave blank.";
    }
    const path = issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)) as (
      | string
      | number
    )[];
    return { path, message };
  });
  const first = friendlyDetails[0];
  const friendlyError = first ? first.message : "Please fix the form and try again.";
  return { friendlyError, friendlyDetails };
}

const readmeUrlSchema = z.preprocess(
  (val) => (val == null || val === "" ? "" : typeof val === "string" ? val.trim() : val),
  z.union([z.literal(""), z.string().url("Must be a valid URL")])
);

const createScraperSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  actor_id: z.string().min(1, "Actor ID is required"),
  descriptive_name: z.string().max(150).default(""),
  readme_url: readmeUrlSchema.optional().default(""),
  platform: z.enum(["facebook", "linkedin", "x", "X", "reddit", "discord", "website", "youtube"]),
  config_json: z.string().min(1, "Configuration is required"),
  is_active: z.boolean().default(true),
  save_to_db: z.boolean().default(true),
  input_type: z.enum(["array", "single"]).default("array"),
  run_iteratively: z.boolean().default(true),
  url_input_field_name: z.string().optional().or(z.literal("")),
  url_input_source_scraper: z.string().optional().or(z.literal("")),
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

    const scrapers = await prisma.scraper.findMany({
      where: { deleted_at: null },
      include: {
        _count: {
          select: {
            jobs: {
              where: { deleted_at: null },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({ scrapers });
  } catch (_error) {
    console.error("Error fetching scrapers:", _error);
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

    const body = await request.json();
    const validatedData = createScraperSchema.parse(body);

    const configValidation = validateScraperConfigJson(validatedData.config_json);
    if (!configValidation.ok) {
      return NextResponse.json({ error: configValidation.error }, { status: 400 });
    }

    // Check if name already exists
    const existingScraper = await prisma.scraper.findFirst({
      where: {
        name: validatedData.name,
        deleted_at: null,
      },
    });

    if (existingScraper) {
      return NextResponse.json(
        { error: "A scraper with this name already exists" },
        { status: 400 }
      );
    }

    const scraper = await prisma.scraper.create({
      data: {
        ...validatedData,
        readme_url: validatedData.readme_url || null,
        url_input_field_name: validatedData.url_input_field_name || null,
        url_input_source_scraper: validatedData.url_input_source_scraper || null,
      },
    });

    return NextResponse.json(scraper);
  } catch (error) {
    console.error("Error creating scraper:", error);

    if (error instanceof z.ZodError) {
      const { friendlyError, friendlyDetails } = friendlyScraperValidationErrors(error.issues);
      return NextResponse.json({ error: friendlyError, details: friendlyDetails }, { status: 400 });
    }

    // Return the actual error message to aid debugging in development
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
