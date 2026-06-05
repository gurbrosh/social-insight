/**
 * Loads `.env` from the project root and resolves SQLite path via `lib/sqlite-database-path.ts`
 * (same rules as `lib/prisma.ts`). Used by `db:where`, `db:verify`, `db:backup`.
 */
import path from "node:path";
import { config } from "dotenv";
import { resolveSqliteFilePathFromDatabaseUrl } from "../lib/sqlite-database-path";

config({ path: path.join(process.cwd(), ".env") });

export function getResolvedSqliteFilePath(): string | null {
  return resolveSqliteFilePathFromDatabaseUrl(process.env.DATABASE_URL, process.cwd());
}
