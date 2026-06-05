import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildLinkedInProspectsCsvContent,
  collectLinkedInProspectRowsForExport,
  yyyymmddUtc,
} from "@/lib/linkedin-prospects-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exportQuerySchema = z.object({
  rangeAmount: z.coerce.number().int().min(1).max(31).default(7),
  rangeUnit: z.enum(["days", "weeks", "months"]).default("days"),
  minRelevancePercent: z.coerce.number().int().min(0).max(100).default(80),
});

function utcYmd(d: Date): { year: number; month: number; day: number } {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

async function handleExport(request: Request, projectId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = exportQuerySchema.safeParse({
      rangeAmount: searchParams.get("rangeAmount") ?? undefined,
      rangeUnit: searchParams.get("rangeUnit") ?? undefined,
      minRelevancePercent: searchParams.get("minRelevancePercent") ?? undefined,
    });
    if (!q.success) {
      return NextResponse.json(
        {
          error:
            "Invalid query. Use rangeAmount=1–31, rangeUnit=days|weeks|months, minRelevancePercent=0–100.",
        },
        { status: 400 }
      );
    }
    const { rangeAmount, rangeUnit, minRelevancePercent } = q.data;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const result = await collectLinkedInProspectRowsForExport({
      projectId,
      rangeAmount,
      rangeUnit,
      minRelevancePercent,
    });

    const csv = buildLinkedInProspectsCsvContent(result.rows);
    const stamp = yyyymmddUtc(utcYmd(new Date()));
    const filename = `linkedin_prospects_${stamp}.csv`;

    const outDir = process.env.LINKEDIN_PROSPECTS_CSV_OUTPUT_DIR?.trim();
    if (outDir) {
      try {
        const dir = resolve(outDir);
        await mkdir(dir, { recursive: true });
        const path = join(dir, filename);
        await writeFile(path, csv, { encoding: "utf8" });
        console.log(
          `[linkedin-prospects-export] Wrote ${path} rows=${result.rows.length} ` +
            `window=${result.rangeAmount}${result.rangeUnit[0]} minRel=${result.minRelevancePercent}% ` +
            `droppedInvalid=${result.droppedInvalid} droppedDedup=${result.droppedDedup} ` +
            `droppedSupportiveOnlyComment=${result.droppedSupportiveOnlyComment} ` +
            `droppedExcluded=${result.droppedExcluded} droppedCap=${result.droppedCap}`
        );
      } catch (e) {
        console.error(
          "[linkedin-prospects-export] Failed to write LINKEDIN_PROSPECTS_CSV_OUTPUT_DIR",
          e
        );
        return NextResponse.json(
          { error: "Failed to write CSV to configured output directory" },
          { status: 500 }
        );
      }
    } else {
      console.log(
        `[linkedin-prospects-export] project=${projectId} file=${filename} rows=${result.rows.length} ` +
          `minRel=${minRelevancePercent}% droppedInvalid=${result.droppedInvalid} ` +
          `droppedDedup=${result.droppedDedup} ` +
          `droppedSupportiveOnlyComment=${result.droppedSupportiveOnlyComment} ` +
          `droppedExcluded=${result.droppedExcluded} droppedCap=${result.droppedCap}`
      );
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-LinkedIn-Export-Debug": `rows=${result.rows.length};droppedInvalid=${result.droppedInvalid};droppedDedup=${result.droppedDedup};droppedSupportiveOnlyComment=${result.droppedSupportiveOnlyComment};droppedExcluded=${result.droppedExcluded};droppedCap=${result.droppedCap}`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[linkedin-prospects-export]", e);
    return NextResponse.json({ error: msg || "Export failed" }, { status: 500 });
  }
}

/**
 * GET/POST: `linkedin_prospects_YYYYMMDD.csv` (export run date UTC). Rolling window: same idea as the email report.
 * Query: `rangeAmount=1..31`, `rangeUnit=days|weeks|months`, `minRelevancePercent=0..100` (0 = no threshold).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  return handleExport(request, projectId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  return handleExport(request, projectId);
}
