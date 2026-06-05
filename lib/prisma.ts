import { createPrismaClient } from "./utils/ulid";
import { normalizeSqliteDatabaseUrlString } from "./sqlite-database-path";

/**
 * SQLite `file:./...` URLs: Prisma CLI resolves relative paths from the directory
 * that contains `schema.prisma` (the `prisma/` folder), not the project root.
 * Match that here and force an absolute `file:` URL so Next.js / Turbopack cwd
 * quirks do not open a different database than `prisma migrate`.
 */
function normalizeSqliteDatabaseUrl(): void {
  const normalized = normalizeSqliteDatabaseUrlString(process.env.DATABASE_URL, process.cwd());
  if (normalized !== null) {
    process.env.DATABASE_URL = normalized;
  }
}

normalizeSqliteDatabaseUrl();

// Create a single instance of Prisma Client with ULID extension
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

export type AppPrismaClient = typeof prisma;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * SQLite (file:): one writer at a time — bulk scrapes block other requests unless readers can overlap.
 * WAL lets reads proceed during writes; busy_timeout makes waiters retry instead of failing fast.
 * Safe for local dev / single-node; skip for Turso/Postgres/MySQL.
 */
const sqlitePragmaUrl = process.env.DATABASE_URL ?? "";
if (sqlitePragmaUrl.startsWith("file:")) {
  void (async () => {
    try {
      // PRAGMA … returns rows; SQLite requires $queryRawUnsafe, not $executeRawUnsafe.
      await prisma.$queryRawUnsafe(`PRAGMA journal_mode=WAL;`);
      await prisma.$queryRawUnsafe(`PRAGMA synchronous=NORMAL;`);
      await prisma.$queryRawUnsafe(`PRAGMA busy_timeout=30000;`);
    } catch (e) {
      console.warn("[prisma] SQLite PRAGMA (WAL/busy_timeout) setup failed:", e);
    }
  })();
}
