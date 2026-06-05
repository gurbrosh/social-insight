import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectOwner } from "@/lib/my-product/assert-project-owner";
import {
  parseMyProductSummaryJson,
  stringifyMyProductSummaryJson,
} from "@/lib/my-product/summary-types";
import type { MyProductSummaryJson } from "@/lib/my-product/summary-types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  my_product_name: z.string().max(4000).nullable().optional(),
  my_product_focus_text: z.string().nullable().optional(),
  /** Validated URLs only; invalid entries are dropped server-side */
  my_product_reference_urls: z.array(z.string()).max(50).optional(),
  /** Full summary replacement when editing sections in the UI */
  my_product_summary: z
    .object({
      highLevelDescription: z.string(),
      keyInnovativeIdeas: z.array(z.string()),
      differentiators: z.string().nullable(),
      intendedClients: z.string().nullable(),
    })
    .optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const ok = await assertProjectOwner(projectId, session.user.id);
    if (!ok) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: {
        my_product_name: true,
        my_product_focus_text: true,
        my_product_reference_urls: true,
        my_product_summary_json: true,
        my_product_summary_updated_at: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let urls: string[] = [];
    if (project.my_product_reference_urls) {
      try {
        const parsed = JSON.parse(project.my_product_reference_urls) as unknown;
        if (Array.isArray(parsed)) {
          urls = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        urls = [];
      }
    }

    const documents = await prisma.projectMyProductDocument.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        original_filename: true,
        byte_size: true,
        content_type: true,
        created_at: true,
      },
    });

    const summary = parseMyProductSummaryJson(project.my_product_summary_json);

    return NextResponse.json({
      my_product_name: project.my_product_name ?? "",
      my_product_focus_text: project.my_product_focus_text ?? "",
      my_product_reference_urls: urls,
      my_product_summary: summary,
      my_product_summary_updated_at: project.my_product_summary_updated_at?.toISOString() ?? null,
      documents,
    });
  } catch (e) {
    console.error("[my-product] GET", e);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const ok = await assertProjectOwner(projectId, session.user.id);
    if (!ok) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const data: {
      my_product_name?: string | null;
      my_product_focus_text?: string | null;
      my_product_reference_urls?: string | null;
      my_product_summary_json?: string | null;
      my_product_summary_updated_at?: Date;
    } = {};

    if (parsed.data.my_product_name !== undefined) {
      data.my_product_name = parsed.data.my_product_name;
    }
    if (parsed.data.my_product_focus_text !== undefined) {
      data.my_product_focus_text = parsed.data.my_product_focus_text;
    }
    if (parsed.data.my_product_reference_urls !== undefined) {
      const urls = parsed.data.my_product_reference_urls
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => {
          try {
            const u = new URL(s);
            return u.protocol === "http:" || u.protocol === "https:";
          } catch {
            return false;
          }
        });
      data.my_product_reference_urls = JSON.stringify(urls);
    }
    if (parsed.data.my_product_summary !== undefined) {
      const s: MyProductSummaryJson = {
        highLevelDescription: parsed.data.my_product_summary.highLevelDescription,
        keyInnovativeIdeas: parsed.data.my_product_summary.keyInnovativeIdeas,
        differentiators: parsed.data.my_product_summary.differentiators,
        intendedClients: parsed.data.my_product_summary.intendedClients,
      };
      data.my_product_summary_json = stringifyMyProductSummaryJson(s);
      data.my_product_summary_updated_at = new Date();
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await prisma.project.update({
      where: { id: projectId },
      data,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[my-product] PATCH", e);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
