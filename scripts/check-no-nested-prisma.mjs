/**
 * Fails if prisma/prisma/ exists — that path appears when Prisma CLI is run from
 * inside prisma/ (wrong cwd). The app uses prisma/db/prod.db from the repo root only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nested = path.join(root, "prisma", "prisma");

if (fs.existsSync(nested)) {
  console.error(
    "\n[db:guard] Found prisma/prisma/ — this usually means Prisma was run with cwd inside prisma/.\n" +
      "  Remove it: rm -rf prisma/prisma\n" +
      "  Always run: npx prisma … from the project root (same folder as package.json).\n" +
      "  See: .cursor/rules/12-CRITICAL-database-paths.md\n"
  );
  process.exit(1);
}
