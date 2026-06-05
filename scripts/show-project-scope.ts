#!/usr/bin/env npx tsx
/**
 * Show how project scope is defined for a given project (by name).
 * Usage: npx tsx scripts/show-project-scope.ts "Test12"
 */

import { prisma } from "../lib/prisma";
import { buildProjectContextsForRelevance } from "../lib/comprehensive-analysis";

async function main() {
  const name = process.argv[2] || "Test12";
  const project = await prisma.project.findFirst({
    where: { deleted_at: null, OR: [{ name }, { name: { contains: name } }] },
    select: {
      id: true,
      name: true,
      description: true,
      monitoring_focus: true,
      require_keywords_with_brands: true,
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });

  if (!project) {
    console.error(`Project "${name}" not found.`);
    process.exit(1);
  }

  const keywords = project.keywords.map((k) => k.keyword);
  const brands = project.brands.map((b) => b.brand_name);

  console.log("=== RAW PROJECT CONFIG ===\n");
  console.log("Project:", project.name, `(id: ${project.id})`);
  console.log("Description:", project.description ?? "(none)");
  console.log("Monitoring focus:", project.monitoring_focus ?? "(none)");
  console.log("Require keywords WITH brands (AND mode):", project.require_keywords_with_brands);
  console.log("Keywords:", keywords.length ? keywords.join(", ") : "(none)");
  console.log("Brands:", brands.length ? brands.join(", ") : "(none)");

  // One batch: avoids duplicate OpenAI calls (same lines as relevance pipeline).
  const ctx = await buildProjectContextsForRelevance(project.id);

  console.log("\n=== SEMANTIC PARAGRAPH (AND / fallback – buildSemanticProjectScope) ===\n");
  console.log(ctx.semanticScopeLine || "(empty – no scope or LLM failed)");

  console.log("\n=== BROADER KEYWORD LINE (OR topic sentence – buildKeywordBroaderDefinition) ===\n");
  console.log(ctx.keywordBroaderLine || "(empty – no keywords or LLM failed)");

  console.log("\n=== FULL SCOPE SENT TO MODEL (selected by project mode) ===\n");
  console.log(ctx.selected);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
