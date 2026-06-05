/**
 * Align stored Post.createdAt for YouTube rows with publish time from extraJson when the row
 * was saved with ingest time (common when the scraper omitted `date` or used a field we did not map).
 *
 * Run: npx tsx scripts/backfill-youtube-post-dates.ts
 */

import { extractYouTubePublishTimestamp } from "../lib/data-transformer";
import { prisma } from "../lib/prisma";

const MIN_DELTA_MS = 6 * 60 * 60 * 1000; // only adjust when publish is clearly older than stored time

async function main() {
  console.log("Backfilling YouTube Post.createdAt from extraJson publish fields…\n");

  const pageSize = 500;
  let skip = 0;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const batch = await prisma.post.findMany({
      where: { platform: "youtube" },
      select: { id: true, createdAt: true, extraJson: true },
      orderBy: { id: "asc" },
      take: pageSize,
      skip,
    });
    if (batch.length === 0) break;
    skip += batch.length;
    scanned += batch.length;

    for (const p of batch) {
      const publish = extractYouTubePublishTimestamp(p.extraJson);
      if (!publish) continue;
      const stored = p.createdAt.getTime();
      const pub = publish.getTime();
      if (pub >= stored - MIN_DELTA_MS) continue;
      await prisma.post.update({
        where: { id: p.id },
        data: { createdAt: publish },
      });
      updated++;
    }
  }

  console.log(`Scanned ${scanned} youtube posts; updated ${updated} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
