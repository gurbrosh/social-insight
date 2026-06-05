/**
 * List all Post records with platform=blogs as raw table rows (full record).
 * Usage: npx tsx scripts/list-blog-posts-for-theme-review.ts [--project-id <id>] [--out <file.json>]
 * With --out, writes a single JSON array of all raw records to the file (no console truncation).
 */
import { prisma } from "../lib/prisma";

function toRawRecord(row: Record<string, unknown>): Record<string, unknown> {
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

  const posts = await prisma.post.findMany({
    where,
    orderBy: { id: "asc" },
  });

  const rawRecords = posts.map((p) => toRawRecord(p as unknown as Record<string, unknown>));

  const outFile = process.argv.includes("--out") && process.argv[process.argv.indexOf("--out") + 1];
  if (outFile) {
    const fs = await import("fs");
    fs.writeFileSync(outFile, JSON.stringify(rawRecords, null, 2), "utf8");
    console.log(`Wrote ${posts.length} raw Post record(s) to ${outFile}`);
    return;
  }

  console.log(
    `\n=== Post table raw records (platform=blogs)${projectId ? ` project=${projectId}` : ""} ===`
  );
  console.log(`Total: ${posts.length} record(s)\n`);

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    console.log(`--- Record ${i + 1} (id=${raw.id}) ---`);
    console.log(JSON.stringify(raw, null, 2));
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
