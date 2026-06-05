/**
 * Soft-delete all blog-sourced News items (PostNews rows whose sources JSON includes "blog" or "blogs").
 *
 * Usage:
 *   npx tsx scripts/delete-blog-news.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  // sources is a JSON string; we match on the serialized form containing "blog" or "blogs"
  const sql =
    "UPDATE PostNews SET deleted_at = ? WHERE deleted_at IS NULL AND (sources LIKE '%\"blog\"%' OR sources LIKE '%\"blogs\"%')";

  const result = await prisma.$executeRawUnsafe(sql, now);

  console.log("Soft-deleted", result, "blog-sourced PostNews rows.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
