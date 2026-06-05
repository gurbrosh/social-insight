/**
 * npm run db:where — print DATABASE_URL from `.env` and the absolute SQLite file path
 * (same resolution as `lib/prisma.ts` / Prisma CLI).
 */
import fs from "node:fs";
import { normalizeSqliteDatabaseUrlString } from "../lib/sqlite-database-path";
import { getResolvedSqliteFilePath } from "./db-sqlite-path";

const raw = process.env.DATABASE_URL;
const abs = getResolvedSqliteFilePath();
const normalizedUrl = normalizeSqliteDatabaseUrlString(raw, process.cwd());

console.log("DATABASE_URL (from .env):", raw ?? "(unset)");
if (normalizedUrl && normalizedUrl !== raw) {
  console.log("Normalized DATABASE_URL (what the app applies):", normalizedUrl);
}

if (abs === null) {
  console.log("Not a local file: URL (e.g. libsql/postgres) — no single SQLite path.");
  process.exit(0);
}

console.log("Resolved SQLite file (same as app + prisma migrate):");
console.log(" ", abs);
console.log("Exists:", fs.existsSync(abs));
if (fs.existsSync(abs)) {
  console.log("Size:", fs.statSync(abs).size, "bytes");
}
