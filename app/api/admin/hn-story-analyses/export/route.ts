import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BATCH = 2000;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const HEADERS = [
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "project_id",
  "hn_story_id",
  "story_url",
  "title",
  "story_text",
  "story_posted_at",
  "summary",
  "idea_1",
  "idea_2",
  "idea_3",
  "idea_4",
  "idea_5",
  "idea_6",
  "idea_7",
  "relevance_score",
  "is_ad",
  "comments_summary",
  "comments_engagement_meta_json",
  "ingested_run_id",
] as const;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const lines: string[] = [HEADERS.join(",")];
    let cursor: string | undefined;

    for (;;) {
      const rows = await prisma.hnStoryAnalysis.findMany({
        where: {},
        select: {
          id: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          project_id: true,
          hn_story_id: true,
          story_url: true,
          title: true,
          story_text: true,
          story_posted_at: true,
          summary: true,
          idea_1: true,
          idea_2: true,
          idea_3: true,
          idea_4: true,
          idea_5: true,
          idea_6: true,
          idea_7: true,
          relevance_score: true,
          is_ad: true,
          comments_summary: true,
          comments_engagement_meta: true,
          ingested_run_id: true,
        },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (rows.length === 0) break;

      for (const r of rows) {
        const metaJson =
          r.comments_engagement_meta === null || r.comments_engagement_meta === undefined
            ? ""
            : JSON.stringify(r.comments_engagement_meta);
        lines.push(
          [
            csvCell(r.id),
            csvCell(r.created_at.toISOString()),
            csvCell(r.updated_at.toISOString()),
            csvCell(r.deleted_at?.toISOString() ?? ""),
            csvCell(r.project_id),
            csvCell(r.hn_story_id),
            csvCell(r.story_url),
            csvCell(r.title),
            csvCell(r.story_text),
            csvCell(r.story_posted_at?.toISOString() ?? ""),
            csvCell(r.summary),
            csvCell(r.idea_1),
            csvCell(r.idea_2),
            csvCell(r.idea_3),
            csvCell(r.idea_4),
            csvCell(r.idea_5),
            csvCell(r.idea_6),
            csvCell(r.idea_7),
            csvCell(r.relevance_score),
            csvCell(r.is_ad),
            csvCell(r.comments_summary),
            csvCell(metaJson),
            csvCell(r.ingested_run_id),
          ].join(",")
        );
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    const csv = lines.join("\r\n");
    const filename = `hn-story-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[hn-story-analyses export]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }
}
