#!/usr/bin/env npx tsx
/**
 * Diagnose why Themes Analysis count drops when switching to "English".
 * Prints language value distribution in ThemesAnalysis so we can see exactly
 * which values the 5 excluded records have.
 *
 * Usage: npx tsx scripts/diagnose-themes-language.ts [projectId]
 * If projectId omitted, shows all projects.
 */

import { prisma } from "../lib/prisma";

async function main() {
  const projectId = process.argv[2];

  const where: { deleted_at: null; project_id?: string } = { deleted_at: null };
  if (projectId) where.project_id = projectId;

  const records = await prisma.themesAnalysis.findMany({
    where,
    select: { id: true, project_id: true, language: true, theme_name: true, post_content: true },
  });

  if (records.length === 0) {
    console.log("No ThemesAnalysis records found.");
    return;
  }

  // Group by raw language value (including null, empty string, and exact bytes)
  const byLanguage = new Map<string, number>();
  const byProject = new Map<string, Map<string, number>>();

  for (const r of records) {
    const raw = r.language === null ? "<null>" : r.language === "" ? "<empty>" : r.language;
    byLanguage.set(raw, (byLanguage.get(raw) || 0) + 1);

    if (!byProject.has(r.project_id)) byProject.set(r.project_id, new Map());
    const proj = byProject.get(r.project_id)!;
    proj.set(raw, (proj.get(raw) || 0) + 1);
  }

  console.log("\n=== ThemesAnalysis language distribution ===\n");
  console.log("Total records:", records.length);
  console.log("\nBy language value (raw):");
  const sorted = Array.from(byLanguage.entries()).sort((a, b) => b[1] - a[1]);
  for (const [val, count] of sorted) {
    const repr = val === "<null>" ? "NULL" : val === "<empty>" ? '""' : JSON.stringify(val);
    console.log(`  ${repr}: ${count}`);
  }

  console.log("\nBy project:");
  for (const [pid, projMap] of byProject) {
    const total = Array.from(projMap.values()).reduce((a, b) => a + b, 0);
    console.log(`  ${pid}: ${total} records`);
    const projSorted = Array.from(projMap.entries()).sort((a, b) => b[1] - a[1]);
    for (const [val, count] of projSorted) {
      const repr = val === "<null>" ? "NULL" : val === "<empty>" ? '""' : JSON.stringify(val);
      console.log(`    ${repr}: ${count}`);
    }
  }

  // Simulate "English" filter: same logic as getStoredThemesAnalysis
  const knownNonEnglish = new Set([
    "es",
    "spa",
    "fr",
    "fra",
    "de",
    "deu",
    "it",
    "ita",
    "pt",
    "por",
    "ru",
    "rus",
    "ja",
    "jpn",
    "ko",
    "kor",
    "zh",
    "cmn",
    "ar",
    "ara",
    "hi",
    "hin",
    "nl",
    "nld",
    "pl",
    "pol",
    "tr",
    "tur",
    "vi",
    "vie",
    "th",
    "tha",
    "sv",
    "swe",
    "da",
    "dan",
    "fi",
    "fin",
    "no",
    "nor",
  ]);
  let included = 0;
  let excluded = 0;
  const excludedValues = new Map<string, number>();
  for (const r of records) {
    const val = r.language;
    if (val == null) {
      included++;
      continue;
    }
    const s = String(val).trim().toLowerCase();
    if (s === "" || s === "en") {
      included++;
      continue;
    }
    if (s === "eng" || s === "und") {
      included++;
      continue;
    }
    if (knownNonEnglish.has(s)) {
      excluded++;
      excludedValues.set(s, (excludedValues.get(s) || 0) + 1);
      continue;
    }
    included++;
  }

  console.log("\n=== Simulated 'English' filter (current logic) ===");
  console.log("Included:", included);
  console.log("Excluded:", excluded);
  if (excludedValues.size > 0) {
    console.log("Excluded by value:");
    for (const [val, count] of Array.from(excludedValues.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  "${val}": ${count}`);
    }
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
