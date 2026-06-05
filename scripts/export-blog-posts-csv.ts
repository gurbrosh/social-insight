/**
 * Export blog Post records to CSV. For the first 10 records, includes the 10 previous
 * non-blog Post records (by id) in the same project.
 * Usage: npx tsx scripts/export-blog-posts-csv.ts [--project-id <id>] [--out <file.csv>]
 */
import { prisma } from "../lib/prisma";

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value).replace(/"/g, '""');
  return `"${s}"`;
}

function toRawRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function main() {
  const projectIdArg = process.argv.indexOf("--project-id");
  const projectId =
    projectIdArg !== -1 && process.argv[projectIdArg + 1]
      ? process.argv[projectIdArg + 1]
      : undefined;

  const where = {
    platform: "blogs",
    ...(projectId ? { project_id: projectId } : {}),
  };

  const blogPosts = await prisma.post.findMany({
    where,
    orderBy: { id: "asc" },
  });

  const PREV_COUNT = 10;
  const first10Ids = blogPosts.slice(0, 10).map((p) => p.id);
  const prevByBlogId = new Map<number, Array<Record<string, unknown>>>();

  for (const blogId of first10Ids) {
    const prev = await prisma.post.findMany({
      where: {
        project_id: blogPosts[0].project_id ?? undefined,
        id: { lt: blogId },
        NOT: { platform: "blogs" },
      },
      orderBy: { id: "desc" },
      take: PREV_COUNT,
    });
    prevByBlogId.set(
      blogId,
      prev.map((p) => toRawRow(p as unknown as Record<string, unknown>))
    );
  }

  const allKeys = [
    "id",
    "platform",
    "postId",
    "authorId",
    "authorName",
    "content",
    "createdAt",
    "editedAt",
    "url",
    "channelId",
    "threadRefId",
    "media",
    "metricsLikes",
    "metricsComments",
    "metricsShares",
    "extraJson",
    "isTest",
    "language",
    "project_id",
    "job_id",
    "sentiment",
    "summary",
    "ai_processed_at",
  ];
  const prevKeys = ["id", "platform", "authorName", "content", "sentiment", "createdAt"];

  const headerRow: string[] = [...allKeys];
  for (let i = 1; i <= PREV_COUNT; i++) {
    for (const k of prevKeys) {
      headerRow.push(`prev_${i}_${k}`);
    }
  }

  const rows: string[][] = [headerRow];

  for (let i = 0; i < blogPosts.length; i++) {
    const raw = toRawRow(blogPosts[i] as unknown as Record<string, unknown>);
    const row: string[] = allKeys.map((k) => escapeCsv(raw[k]));

    if (i < 10) {
      const prevList = prevByBlogId.get(blogPosts[i].id) ?? [];
      for (let j = 0; j < PREV_COUNT; j++) {
        const p = prevList[j];
        for (const k of prevKeys) {
          row.push(escapeCsv(p?.[k]));
        }
      }
    } else {
      for (let j = 0; j < PREV_COUNT * prevKeys.length; j++) {
        row.push("");
      }
    }
    rows.push(row);
  }

  const csv = rows.map((r) => r.join(",")).join("\n");
  const outFile = process.argv.includes("--out") && process.argv[process.argv.indexOf("--out") + 1];
  const path = outFile || "blog-posts-with-prev.csv";
  const fs = await import("fs");
  fs.writeFileSync(path, csv, "utf8");
  console.log(`Wrote ${blogPosts.length} blog Post record(s) to ${path}`);
  if (first10Ids.length > 0) {
    console.log(
      `First 10 rows include the 10 previous non-blog Post records each (columns prev_1_id through prev_10_createdAt).`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
