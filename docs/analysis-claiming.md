# Analysis task claiming and multi-worker semantics

## Atomic claim (implemented)

`claimTasks` in `lib/analysis-worker.ts` uses a **single** `UPDATE … WHERE id IN (SELECT … LIMIT n) AND state = 'PENDING' RETURNING id` so two processes cannot claim the same row: the second updater matches zero rows if the first already moved tasks to `RUNNING`.

## SQLite vs PostgreSQL

- **SQLite** (development): The statement runs as one atomic step; `RETURNING` lists the rows this connection updated.
- **PostgreSQL**: The same pattern is valid; for very high contention you can alternatively use `FOR UPDATE SKIP LOCKED` in a CTE—Prisma does not generate that by default, so raw SQL would be required if you outgrow the current pattern.

## Stale `RUNNING` tasks

If a worker dies after claiming tasks, rows can stay `RUNNING` forever. Set **`ANALYSIS_TASK_LEASE_MS`** (milliseconds) so `reclaimStaleRunningTasks` (called at the start of `runWorkerLoop` and optionally from `scripts/run-analysis-worker.ts`) resets old leases to `PENDING`. Choose a value **longer** than your slowest LLM step to avoid reclaiming work that is still in progress.

## Operational rule

Until you rely on leases and monitoring, run **at most one active worker per orchestration run** (or per project) to avoid duplicate spend if misconfigured.
