import path from "node:path";

/**
 * Resolves the on-disk SQLite path for a Prisma `DATABASE_URL` the same way as
 * `lib/prisma.ts` (relative `file:./...` URLs are resolved from the `prisma/` directory).
 *
 * @param databaseUrl - Typically `process.env.DATABASE_URL`
 * @param cwd - Project root (use `process.cwd()`; must match the running app / Prisma CLI)
 */
export function resolveSqliteFilePathFromDatabaseUrl(
  databaseUrl: string | undefined,
  cwd: string
): string | null {
  if (!databaseUrl?.startsWith("file:")) return null;
  const rest = databaseUrl.slice("file:".length);
  if (path.isAbsolute(rest)) return rest;
  const prismaDir = path.join(cwd, "prisma");
  return path.resolve(prismaDir, rest);
}

/** Normalized `file:` URL string (absolute path) for SQLite, or null if not a local file URL. */
export function normalizeSqliteDatabaseUrlString(
  databaseUrl: string | undefined,
  cwd: string
): string | null {
  const abs = resolveSqliteFilePathFromDatabaseUrl(databaseUrl, cwd);
  if (abs === null) return null;
  return `file:${abs}`;
}
