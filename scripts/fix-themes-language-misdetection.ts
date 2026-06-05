#!/usr/bin/env npx tsx
/**
 * Fix Themes Analysis records that were misdetected as non-English (nl, sv, es, fr).
 * Franc often misclassifies short English snippets. Setting language to null for these
 * records makes them show when the user filters by "English" (we treat null as "include").
 *
 * Usage: npx tsx scripts/fix-themes-language-misdetection.ts [--dry-run]
 */

import { prisma } from "../lib/prisma";

const MISDETECTED_CODES = ["nl", "sv", "es", "fr"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const records = await prisma.themesAnalysis.findMany({
    where: {
      deleted_at: null,
      language: { in: MISDETECTED_CODES },
    },
    select: { id: true, language: true, post_content: true, theme_name: true },
  });

  if (records.length === 0) {
    console.log("No ThemesAnalysis records with nl/sv/es/fr found.");
    return;
  }

  console.log(
    `Found ${records.length} record(s) with language in [${MISDETECTED_CODES.join(", ")}]:`
  );
  for (const r of records) {
    const len = r.post_content?.length ?? 0;
    console.log(`  id=${r.id} language=${r.language} contentLength=${len} theme=${r.theme_name}`);
  }

  if (dryRun) {
    console.log(
      "\n[DRY RUN] Would set language=null for these records. Run without --dry-run to apply."
    );
    return;
  }

  const result = await prisma.themesAnalysis.updateMany({
    where: {
      deleted_at: null,
      language: { in: MISDETECTED_CODES },
    },
    data: { language: null },
  });

  console.log(`\nUpdated ${result.count} record(s): language set to null.`);
  console.log("They will now appear when filtering by 'English'.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
