#!/usr/bin/env tsx

/**
 * One-time cleanup: strip "The article discusses...", "This post covers...", etc.
 * from summary and idea_1..idea_7 on all BlogNewsAnalysis rows.
 *
 * Usage: npx tsx scripts/sanitize-blog-analysis-framing.ts
 */

import { sanitizeArticleFraming } from "../lib/blog-news-analysis-service";
import { prisma } from "../lib/prisma";

async function main() {
  const rows = await prisma.blogNewsAnalysis.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      summary: true,
      idea_1: true,
      idea_2: true,
      idea_3: true,
      idea_4: true,
      idea_5: true,
      idea_6: true,
      idea_7: true,
    },
  });

  let updated = 0;
  for (const r of rows) {
    const summary = r.summary != null ? sanitizeArticleFraming(r.summary) : null;
    const idea_1 = r.idea_1 != null ? sanitizeArticleFraming(r.idea_1) : null;
    const idea_2 = r.idea_2 != null ? sanitizeArticleFraming(r.idea_2) : null;
    const idea_3 = r.idea_3 != null ? sanitizeArticleFraming(r.idea_3) : null;
    const idea_4 = r.idea_4 != null ? sanitizeArticleFraming(r.idea_4) : null;
    const idea_5 = r.idea_5 != null ? sanitizeArticleFraming(r.idea_5) : null;
    const idea_6 = r.idea_6 != null ? sanitizeArticleFraming(r.idea_6) : null;
    const idea_7 = r.idea_7 != null ? sanitizeArticleFraming(r.idea_7) : null;

    const changed =
      summary !== r.summary ||
      idea_1 !== r.idea_1 ||
      idea_2 !== r.idea_2 ||
      idea_3 !== r.idea_3 ||
      idea_4 !== r.idea_4 ||
      idea_5 !== r.idea_5 ||
      idea_6 !== r.idea_6 ||
      idea_7 !== r.idea_7;

    if (changed) {
      await prisma.blogNewsAnalysis.update({
        where: { id: r.id },
        data: {
          summary: summary ?? undefined,
          idea_1: idea_1 ?? undefined,
          idea_2: idea_2 ?? undefined,
          idea_3: idea_3 ?? undefined,
          idea_4: idea_4 ?? undefined,
          idea_5: idea_5 ?? undefined,
          idea_6: idea_6 ?? undefined,
          idea_7: idea_7 ?? undefined,
        },
      });
      updated++;
    }
  }

  console.log(`Sanitized ${updated} of ${rows.length} BlogNewsAnalysis row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
