import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkScrapers() {
  const scrapers = await prisma.scraper.findMany({
    where: { platform: { in: ["x", "X", "twitter"] } },
    select: { id: true, name: true, platform: true, created_at: true },
  });

  console.log(`📊 Scraper platform values:`);
  scrapers.forEach((s) => {
    console.log(`  Scraper: "${s.name}" - platform: "${s.platform}", created: ${s.created_at}`);
  });

  await prisma.$disconnect();
}

checkScrapers().catch(console.error);
