/**
 * Backfill Person Intelligence for existing LinkedIn theme rows (batched).
 * Run: npx tsx scripts/backfill-prospect-intelligence.ts <projectId>
 */
import { prisma } from "@/lib/prisma";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import {
  ensureProspectIntelligenceSettings,
  syncProspectCandidateForThemeRow,
} from "@/lib/prospect-intelligence/pipeline";

const projectId = process.argv[2];
if (!projectId?.trim()) {
  console.error("Usage: npx tsx scripts/backfill-prospect-intelligence.ts <projectId>");
  process.exit(1);
}

async function main() {
  await ensureProspectIntelligenceSettings(projectId);
  const rows = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
    },
    select: {
      id: true,
      post_id: true,
      platform: true,
      relevance_score: true,
      author_name: true,
    },
    take: 2000,
  });
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await syncProspectCandidateForThemeRow({
        projectId,
        themesAnalysisId: r.id,
        postId: r.post_id,
        themeItemResponseId: null,
        platform: r.platform,
        themeRelevancePercent: r.relevance_score ?? null,
        authorName: r.author_name,
        headlineFallback: null,
        publicProfileScrape: null,
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  console.log(`backfill project=${projectId} ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
