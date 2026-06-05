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
  "source",
  "keyword",
  "source_item_id",
  "item_type",
  "author",
  "title",
  "body",
  "url",
  "published_at",
  "published_at_unix",
  "story_id",
  "parent_id",
  "story_title",
  "story_url",
  "story_score",
  "story_descendants",
  "raw_payload_json",
] as const;

/**
 * GET — CSV export of active SourceMention rows (admin).
 */
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
      const rows = await prisma.sourceMention.findMany({
        where: {},
        select: {
          id: true,
          created_at: true,
          updated_at: true,
          source: true,
          keyword: true,
          source_item_id: true,
          item_type: true,
          author: true,
          title: true,
          body: true,
          url: true,
          published_at: true,
          published_at_unix: true,
          story_id: true,
          parent_id: true,
          story_title: true,
          story_url: true,
          story_score: true,
          story_descendants: true,
          raw_payload: true,
        },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (rows.length === 0) break;

      for (const r of rows) {
        const rawJson =
          r.raw_payload === null || r.raw_payload === undefined
            ? ""
            : JSON.stringify(r.raw_payload);
        lines.push(
          [
            csvCell(r.id),
            csvCell(r.created_at.toISOString()),
            csvCell(r.updated_at.toISOString()),
            csvCell(r.source),
            csvCell(r.keyword),
            csvCell(r.source_item_id),
            csvCell(r.item_type),
            csvCell(r.author),
            csvCell(r.title),
            csvCell(r.body),
            csvCell(r.url),
            csvCell(r.published_at?.toISOString() ?? ""),
            csvCell(r.published_at_unix),
            csvCell(r.story_id),
            csvCell(r.parent_id),
            csvCell(r.story_title),
            csvCell(r.story_url),
            csvCell(r.story_score),
            csvCell(r.story_descendants),
            csvCell(rawJson),
          ].join(",")
        );
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    const csv = lines.join("\r\n");
    const filename = `source-mentions-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[source-mentions export]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }
}
