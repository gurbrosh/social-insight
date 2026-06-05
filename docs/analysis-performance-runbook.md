# Analysis performance runbook

This document describes environment variables for the task-based analysis worker, a safe tuning order, and operational notes. It complements `docs/analysis-claiming.md` (multi-worker semantics).

## HTTP admin worker vs standalone (critical for large runs)

`POST /api/admin/run-analysis/worker` uses `after()` so the HTTP response returns immediately, but on **serverless** (e.g. Vercel) the **entire invocation** is still limited by `maxDuration` on that route (currently 900 seconds). When the platform kills the function, **in-progress `after()` work stops**—there is no multi-hour background job. Large backfills (thousands of tasks) will **not** reliably complete through this endpoint.

**Use a long-lived process instead:** `npm run analysis:worker -- --projectId=<ulid>` or `--runId=<ulid>` (see `Dockerfile.analysis-worker`). Local `next dev` is somewhat more forgiving but still tied to the dev server process.

If a run “never finishes,” check logs for: (1) process exit right around `maxDuration`, (2) `[AnalysisWorker] not complete but no tasks claimed` (stuck `RUNNING` / dependency deadlock), (3) SQLite `database is locked`.

## Environment matrix

| Variable | Default | Role |
|----------|---------|------|
| `ANALYSIS_CONCURRENCY` | `3` | Parallel **non-batched** tasks (e.g. CHATTER, NETWORK) per poll round |
| `ANALYSIS_SENTIMENT_BATCH_SIZE` | `20` | Posts per OpenAI call for sentiment batches |
| `ANALYSIS_SENTIMENT_CONCURRENCY` | `5` | Parallel sentiment **batches** (≈ `batch_size × concurrency` posts in flight) |
| `ANALYSIS_THEMES_CONCURRENCY` | `5` | Parallel THEMES **batches** (each batch is 20 posts per internal grouping) |
| `ANALYSIS_THEMES_THREAD_CONCURRENCY` | `5` | Parallel per-conversation theme LLM calls (`comprehensive-analysis`) |
| `ANALYSIS_BRAND_BATCH_SIZE` | `100` | Posts grouped per BRAND step execution |
| `ANALYSIS_TASK_LEASE_MS` | `0` (off) | If &gt; `0`, `RUNNING` tasks older than this lease are reset to `PENDING` (stuck-worker recovery). Start with **30–60 minutes** if you enable it |
| `ANALYSIS_METRICS_JSON` | unset | If `true`, emits one JSON log line per idle poll (`type: analysis_worker_poll_idle`) for log aggregation |
| `OPENAI_MODEL` / `OPENAI_DEFAULT_MODEL` | `gpt-4o-mini` | Default chat model for analysis (see `lib/openai-chat-model.ts`) |
| `OPENAI_SENTIMENT_MODEL`, `OPENAI_THEMES_MODEL`, `OPENAI_CHATTER_MODEL`, `OPENAI_NETWORK_MODEL`, `OPENAI_NEWS_MODEL`, `OPENAI_BRAND_MODEL`, `OPENAI_RELEVANCE_MODEL`, `OPENAI_SUMMARIZE_MODEL` | unset | Per-step overrides; fall back to `OPENAI_MODEL` |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings API model |

## Recommended tuning order

1. Raise **`ANALYSIS_SENTIMENT_CONCURRENCY`** and **`ANALYSIS_THEMES_CONCURRENCY`** first (largest throughput gains after batching is already in place).
2. Then **`ANALYSIS_THEMES_THREAD_CONCURRENCY`** (parallel per-thread theme calls).
3. Finally **`ANALYSIS_CONCURRENCY`** for CHATTER/NETWORK.

Raise one knob at a time in staging; watch logs for `[OpenAI] Throttled (429)` and wall-clock time per step (`[AnalysisWorker]` idle lines when a step finishes).

## Ceilings and provider tier

OpenAI **rate limits** depend on account **usage tier** (RPM/TPM). High `ANALYSIS_*_CONCURRENCY` values multiply in-flight requests; without **Tier 2+**-style limits you will see 429 bursts. Prefer raising tier or lowering concurrency before chasing code changes.

SQLite can show `database is locked` under heavy parallel writes; if that appears, reduce concurrency or move to PostgreSQL for production-scale workers.

## Metrics and 429 visibility

- **429**: Already logged as `[OpenAI] Throttled (429) operation=...` in `lib/comprehensive-analysis.ts` and related callers. Search logs for `Throttled (429)` to correlate with concurrency changes.
- **Idle polls**: Set `ANALYSIS_METRICS_JSON=true` for structured `analysis_worker_poll_idle` events (useful to detect “worker starved” vs “too much concurrency”).

## CHATTER / NETWORK batching (audit)

Sentiment and themes use explicit batching in the worker. **CHATTER** and **NETWORK** still do **per-thread** or **per-batch** work in places; further batching would need correctness review (thread boundaries, duplicate detection). Treat this as a future optimization after profiles and worker deployment stabilize.

## Standalone worker

Long runs should use `scripts/run-analysis-worker.ts` (see `Dockerfile.analysis-worker`) instead of relying only on the HTTP route’s `after()` callback, which is tied to server lifecycle and platform timeouts.

```bash
npx tsx scripts/run-analysis-worker.ts --projectId=<projectUlid>
# or
npx tsx scripts/run-analysis-worker.ts --runId=<runUlid>
```

Do **not** run this and the admin HTTP worker on the **same** run at the same time unless `ANALYSIS_TASK_LEASE_MS` and operational discipline prevent double work.

## Analysis profile and sampling

Project fields **`analysis_profile`** (`full` | `minimal`) and optional **`analysis_sample_post_limit`** control what gets enqueued and how ad-hoc runs sample posts. See project **Edit** page. Minimal profile skips CHATTER, NETWORK, and batched NEWS/blog LLM steps for faster passes.
