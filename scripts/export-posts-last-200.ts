/**
 * Export the last N Post records (by id) to a CSV with all columns.
 * Usage: npx tsx scripts/export-posts-last-200.ts [--out <file.csv>] [--limit N]
 * Default: 200 records, posts-last-200.csv. With --limit 300: posts-last-300.csv (or --out to override).
 */
import { prisma } from "../lib/prisma";
import * as fs from "fs";

const COLUMNS = [
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
] as const;

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s =
    typeof value === "object"
      ? JSON.stringify(value)
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

async function main() {
  const limitIdx = process.argv.indexOf("--limit");
  const limit =
    limitIdx !== -1 && process.argv[limitIdx + 1]
      ? Math.max(1, parseInt(process.argv[limitIdx + 1], 10) || 200)
      : 200;

  const posts = await prisma.post.findMany({
    orderBy: { id: "desc" },
    take: limit,
  });

  const header = COLUMNS.join(",");
  const rows = posts.map((p) => {
    const record = p as unknown as Record<string, unknown>;
    return COLUMNS.map((col) => escapeCsv(record[col])).join(",");
  });

  const csv = [header, ...rows].join("\n");

  const outIdx = process.argv.indexOf("--out");
  const defaultName = `posts-last-${limit}.csv`;
  const outFile =
    outIdx !== -1 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : defaultName;

  fs.writeFileSync(outFile, csv, "utf8");
  console.log(`Wrote ${posts.length} Post records to ${outFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
