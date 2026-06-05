/**
 * One-time cleanup: soft-delete duplicate TaxonomyOtherSourceLink rows.
 * For each (category, subcategory, sub_subcategory, source_category, url) we keep one row (oldest by created_at) and set deleted_at on the rest.
 *
 * Run this BEFORE applying the migration that adds the unique constraint.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-taxonomy-other-source-links.ts [--dry-run]
 *
 * --dry-run: log what would be deleted without updating the database.
 */

import { prisma } from "../lib/prisma";

function normalizeUrl(url: string): string {
  return url.toLowerCase().trim().replace(/\/+$/, "");
}

function groupKey(
  category: string,
  subcategory: string | null,
  sub_subcategory: string | null,
  source_category: string,
  url: string
): string {
  return [
    category,
    subcategory ?? "",
    sub_subcategory ?? "",
    source_category,
    normalizeUrl(url),
  ].join("\0");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("DRY RUN: no changes will be written.");
  }

  const rows = await prisma.taxonomyOtherSourceLink.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      category: true,
      subcategory: true,
      sub_subcategory: true,
      source_category: true,
      url: true,
      created_at: true,
    },
    orderBy: { created_at: "asc" },
  });

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = groupKey(r.category, r.subcategory, r.sub_subcategory, r.source_category, r.url);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  const toSoftDelete: string[] = [];
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    // Keep first (oldest created_at; we ordered by created_at asc)
    const [keep, ...dupes] = group;
    for (const d of dupes) {
      toSoftDelete.push(d.id);
    }
  }

  console.log(
    `[cleanup] Found ${rows.length} active rows, ${byKey.size} unique (category, subcategory, sub_subcategory, source_category, url).`
  );
  console.log(`[cleanup] Would soft-delete ${toSoftDelete.length} duplicate row(s).`);

  if (toSoftDelete.length === 0) {
    console.log("[cleanup] Nothing to do.");
    return;
  }

  if (!dryRun) {
    const result = await prisma.taxonomyOtherSourceLink.updateMany({
      where: { id: { in: toSoftDelete } },
      data: { deleted_at: new Date() },
    });
    console.log(`[cleanup] Soft-deleted ${result.count} duplicate row(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
