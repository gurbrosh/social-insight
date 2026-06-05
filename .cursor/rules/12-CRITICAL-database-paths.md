# Database Path - CRITICAL

## One canonical database only

**The project uses a single SQLite database file:**

- **Path:** `prisma/db/prod.db` (relative to project root)
- **DATABASE_URL:** `file:./db/prod.db` (in `.env`)

Prisma resolves relative SQLite URLs from the directory that contains `schema.prisma` (the `prisma/` folder). So `file:./db/prod.db` → `prisma/db/prod.db`. The old value `file:./prisma/db/prod.db` incorrectly resolved to `prisma/prisma/db/prod.db` and triggered **P1003** from the CLI.

`lib/prisma.ts` uses `lib/sqlite-database-path.ts` so relative `file:` URLs match Prisma CLI (relative to `prisma/`). **`npm run db:where`** prints the resolved absolute path using that same module—use it before manual `sqlite3` or file copies.

### Agent rules

1. Use `prisma/db/prod.db` for any reference to the database file on disk.
2. In `.env`, set `DATABASE_URL` to `file:./db/prod.db` or an absolute `file:` URL to `prisma/db/prod.db`.
3. Do not use `file:./prisma/db/prod.db` in `.env` — it points Prisma at a non-existent nested path.

### If you see another database file

A stray `prisma/prisma/` can appear from older misconfigured URLs. Remove it after confirming data lives under `prisma/db/prod.db`.

## Prevention (do this every time)

1. **Run Prisma from the project root** (the directory that contains `package.json`).  
   Good: `cd …/project && npx prisma migrate dev`  
   Bad: `cd prisma && npx prisma migrate dev` (different cwd can confuse tooling).

2. **Prefer npm scripts** — they run from root: `npm run db:push`, `npm run db:seed`, `npm run db:reset`.

3. **`npm run dev` runs `predev`** — if `prisma/prisma/` exists, the dev server may refuse to start until you remove it (`rm -rf prisma/prisma`). Run `npm run db:guard` anytime to check.

4. **Keep one `DATABASE_URL`** in `.env`: `file:./db/prod.db`. The app normalizes to an absolute path in `lib/prisma.ts`.

5. **IDE terminals** — open the terminal at the repo root before running `npx prisma …`.

## SQLite `attempt to write a readonly database` (1032)

If Prisma reports **readonly database** but the file looks writable:

1. Ensure **`prisma/db/`** is writable (SQLite needs the directory for `-wal` / `-shm` sidecars): `chmod -R u+rwX prisma/db`.
2. Close other handles (Prisma Studio, DB Browser, backup tools) that might lock the file.
3. Projects under **Downloads** with **iCloud** “optimize storage” can intermittently block writes — move the repo to a non-synced folder if this persists.
4. Confirm **one** `DATABASE_URL` points at `prisma/db/prod.db` on disk (see above); stray copies opened read-only cause confusing errors.
