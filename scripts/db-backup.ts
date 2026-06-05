/**
 * Copy the current prod.db to prisma/db/prod.db.backup-<timestamp>.
 * Run before db:reset or any manual replace. Stop dev server for a fully quiet DB if possible.
 */
import fs from "node:fs";
import path from "node:path";
import { getResolvedSqliteFilePath } from "./db-sqlite-path";

const src = getResolvedSqliteFilePath();
if (!src || !fs.existsSync(src)) {
  console.log("db:backup — no SQLite file to copy (missing or non-file DATABASE_URL). Skip.");
  process.exit(0);
}

const dir = path.dirname(src);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = path.join(dir, `prod.db.backup-${stamp}`);

fs.copyFileSync(src, dest);
console.log("db:backup — wrote:", dest);
console.log("         from:", src);
