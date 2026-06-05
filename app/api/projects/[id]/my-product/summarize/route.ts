import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectOwner } from "@/lib/my-product/assert-project-owner";
import { summarizeProductFromSources } from "@/lib/my-product/summarize-product";

export const dynamic = "force-dynamic";

export const maxDuration = 120;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let referenceUrls: string[] = [];
    if (project.my_product_reference_urls) {
      try {
        const parsed = JSON.parse(project.my_product_reference_urls) as unknown;
        if (Array.isArray(parsed)) {
          referenceUrls = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        referenceUrls = [];
      }
    }

    const documents = await prisma.projectMyProductDocument.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: {
        storage_key: true,
        original_filename: true,
        content_type: true,
      },
    });

    const result = await summarizeProductFromSources({
      productName: project.my_product_name,
      focusText: project.my_product_focus_text,
      referenceUrls,
      documents,
    });

    await prisma.project.update({
      where: { id: projectId },
      data: {
        my_product_summary_json: result.summaryJson,
        my_product_summary_updated_at: new Date(),
      },
    });

    revalidatePath(`/projects/${projectId}/edit`);

    return NextResponse.json({
      success: true,
      summary: result.summary,
      warnings: result.warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Summarization failed";
    console.error("[my-product/summarize]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
