#!/usr/bin/env tsx

/**
 * Export all BlogNewsAnalysis records (deleted_at = null) to a CSV file.
 *
 * Usage:
 *   npx tsx scripts/export-blog-news-analysis-csv.ts
 *   npx tsx scripts/export-blog-news-analysis-csv.ts [output-path]
 *
 * Default output: BlogNewsAnalysis-export.csv in project root.
 */

import { prisma } from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

function escapeCsvValue(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const outPath = process.argv[2] ?? path.join(process.cwd(), "BlogNewsAnalysis-export.csv");

  const rows = await prisma.blogNewsAnalysis.findMany({
    where: { deleted_at: null },
    orderBy: [{ project_id: "asc" }, { article_date: "desc" }, { created_at: "asc" }],
  });

  const headers = [
    "id",
    "created_at",
    "updated_at",
    "project_id",
    "analysis_run_id",
    "source_url",
    "article_url",
    "article_title",
    "article_date",
    "summary",
    "idea_1",
    "idea_2",
    "idea_3",
    "idea_4",
    "idea_5",
    "idea_6",
    "idea_7",
    "primary_persona",
    "secondary_personas",
    "seniority_level",
    "audience_domain",
    "audience_targeting",
    "offering_content_type",
    "lifecycle_stage",
    "offering_notes",
    "primary_intent",
    "secondary_intents",
    "evidence_types_used",
    "evidence_strength",
    "specificity_level",
    "actionability_level",
    "competitive_posture",
    "competitive_direction",
    "explicit_competitors",
    "category_framing",
    "sensitivity_level",
    "sensitivity_tone",
    "trust_building_elements",
    "timing_nature",
    "urgency_level",
    "implied_strategic_direction",
    "confidence_posture",
    "explicit_cta",
    "implicit_cta",
    "content_archetype",
    "signal_strength_score",
    "affiliation",
    "relevance_score",
    "is_ad",
    "mention_count",
    "theme_matches_json",
    "raw_extraction_json",
  ];

  const lines: string[] = [headers.join(",")];

  for (const r of rows) {
    const cells = [
      escapeCsvValue(r.id),
      escapeCsvValue(r.created_at?.toISOString?.() ?? r.created_at),
      escapeCsvValue(r.updated_at?.toISOString?.() ?? r.updated_at),
      escapeCsvValue(r.project_id),
      escapeCsvValue(r.analysis_run_id),
      escapeCsvValue(r.source_url),
      escapeCsvValue(r.article_url),
      escapeCsvValue(r.article_title),
      escapeCsvValue(r.article_date?.toISOString?.() ?? r.article_date),
      escapeCsvValue(r.summary),
      escapeCsvValue(r.idea_1),
      escapeCsvValue(r.idea_2),
      escapeCsvValue(r.idea_3),
      escapeCsvValue(r.idea_4),
      escapeCsvValue(r.idea_5),
      escapeCsvValue(r.idea_6),
      escapeCsvValue(r.idea_7),
      escapeCsvValue(r.primary_persona),
      escapeCsvValue(r.secondary_personas),
      escapeCsvValue(r.seniority_level),
      escapeCsvValue(r.audience_domain),
      escapeCsvValue(r.audience_targeting),
      escapeCsvValue(r.offering_content_type),
      escapeCsvValue(r.lifecycle_stage),
      escapeCsvValue(r.offering_notes),
      escapeCsvValue(r.primary_intent),
      escapeCsvValue(r.secondary_intents),
      escapeCsvValue(r.evidence_types_used),
      escapeCsvValue(r.evidence_strength),
      escapeCsvValue(r.specificity_level),
      escapeCsvValue(r.actionability_level),
      escapeCsvValue(r.competitive_posture),
      escapeCsvValue(r.competitive_direction),
      escapeCsvValue(r.explicit_competitors),
      escapeCsvValue(r.category_framing),
      escapeCsvValue(r.sensitivity_level),
      escapeCsvValue(r.sensitivity_tone),
      escapeCsvValue(r.trust_building_elements),
      escapeCsvValue(r.timing_nature),
      escapeCsvValue(r.urgency_level),
      escapeCsvValue(r.implied_strategic_direction),
      escapeCsvValue(r.confidence_posture),
      escapeCsvValue(r.explicit_cta),
      escapeCsvValue(r.implicit_cta),
      escapeCsvValue(r.content_archetype),
      escapeCsvValue(r.signal_strength_score),
      escapeCsvValue(r.affiliation),
      escapeCsvValue(r.relevance_score),
      escapeCsvValue(r.is_ad),
      escapeCsvValue(r.mention_count),
      escapeCsvValue(r.theme_matches_json),
      escapeCsvValue(r.raw_extraction_json),
    ];
    lines.push(cells.join(","));
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Exported ${rows.length} BlogNewsAnalysis record(s) to ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
