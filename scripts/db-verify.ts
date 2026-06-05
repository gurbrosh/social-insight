/**
 * npm run db:verify — proves which SQLite file `.env` points at and reads Project rows from THAT file only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { getResolvedSqliteFilePath } from "./db-sqlite-path";

const abs = getResolvedSqliteFilePath();
if (!abs) {
  console.log("DATABASE_URL is not a local file: URL — verify path manually for Turso/Postgres.");
  process.exit(0);
}

console.log("Resolved SQLite file (same rules as lib/prisma.ts):");
console.log(" ", abs);
console.log("Exists:", fs.existsSync(abs));
if (!fs.existsSync(abs)) {
  process.exit(1);
}

const st = fs.statSync(abs);
console.log("Size (bytes):", st.size, "mtime:", st.mtime.toISOString());

try {
  const n = execFileSync(
    "sqlite3",
    [abs, "SELECT COUNT(*) FROM Project WHERE deleted_at IS NULL;"],
    {
      encoding: "utf8",
    }
  ).trim();
  console.log("Active projects in THIS file (COUNT):", n);

  const latest = execFileSync(
    "sqlite3",
    [abs, "SELECT name FROM Project WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 3;"],
    { encoding: "utf8" }
  ).trim();
  console.log("Latest project names (up to 3):\n", latest || "(none)");
} catch (e) {
  console.error("sqlite3 failed — install SQLite CLI or run: npx prisma studio");
  console.error(e);
  process.exit(1);
}
