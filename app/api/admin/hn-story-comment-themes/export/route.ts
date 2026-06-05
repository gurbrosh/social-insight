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
  "hn_story_id",
  "story_url",
  "story_title",
  "story_posted_at",
  "comment_themes_summary",
  "meta_json",
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
      const rows = await prisma.hnStoryCommentTheme.findMany({
        where: {},
        select: {
          id: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          hn_story_id: true,
          story_url: true,
          story_title: true,
          story_posted_at: true,
          comment_themes_summary: true,
          meta: true,
        },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (rows.length === 0) break;

      for (const r of rows) {
        const metaJson =
          r.meta === null || r.meta === undefined ? "" : JSON.stringify(r.meta);
        lines.push(
          [
            csvCell(r.id),
            csvCell(r.created_at.toISOString()),
            csvCell(r.updated_at.toISOString()),
            csvCell(r.deleted_at?.toISOString() ?? ""),
            csvCell(r.hn_story_id),
            csvCell(r.story_url),
            csvCell(r.story_title),
            csvCell(r.story_posted_at?.toISOString() ?? ""),
            csvCell(r.comment_themes_summary),
            csvCell(metaJson),
          ].join(",")
        );
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    const csv = lines.join("\r\n");
    const filename = `hn-story-comment-themes-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[hn-story-comment-themes export]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }
}
