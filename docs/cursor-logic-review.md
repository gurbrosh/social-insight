# Cursor logic and analysis progress

## Where cursors live

All analysis cursors are stored in **one row per project** in `AnalysisProgress`:

| Column | Type | Meaning |
|--------|------|--------|
| `last_sentiment_post_id` | Int | Last Post.id through which sentiment has been run. Next run only processes posts with `id > this`. |
| `last_themes_post_id` | Int | Last Post.id through which theme matching has been run. |
| `last_chatter_post_id` | Int | Last “root” Post.id through which chatter (thread) analysis has been run. |
| `last_network_post_id` | Int | Last Post.id through which network (influencers) analysis has been run. |
| `last_news_post_id` | Int | Last Post.id through which news synthesis has been run. |
| `last_brand_post_id` | Int | Last Post.id through which brand analysis has been run. |
| `last_blog_analysis_post_id` | String (ULID) | Last **BlogPost**.id (not Post.id) through which blog pipeline has run. |
| `last_sanitized_*_at` | DateTime? | When sanitization last ran for chatter/themes/network/news (for de-dupe/off-topic removal). |

**Persistence:** `getOrCreateAnalysisProgress(projectId)` loads this row at the start of comprehensive analysis. Each step calls `updateAnalysisProgress(projectId, { last_*_post_id: value })` after it runs, so the row is updated in the DB after every run.

---

## Shared upper bound (every run)

At the start of `runComprehensiveAnalysis`:

1. **Sentiment** runs first with bounds `id > last_sentiment_post_id` (no upper bound in the sentiment query; it processes in batches and tracks max id processed).
2. Then we compute **sentimentUpperBound**:
   - `maxPostInDb` = max `Post.id` in the project (at that moment).
   - `sentimentUpperBound = Math.max(last_sentiment_post_id, maxPostInDb.id)`.

So **sentimentUpperBound** = “highest Post.id that exists in the project when this run starts.” All downstream steps (Themes, Chatter, Network, News, Brand) use the **same** range for “this run”:

- **Lower bound (minPostIdExclusive):** each step’s own cursor (`last_themes_post_id`, `last_chatter_post_id`, etc.).
- **Upper bound (maxPostIdInclusive):** always **sentimentUpperBound** for that run.

So we only ever consider posts with:

`last_*_post_id < post.id <= sentimentUpperBound`

No step looks at posts with `id > sentimentUpperBound` in that run (new posts added later will be picked up in a future run).

---

## How each step uses and updates its cursor

### 1. Sentiment

- **Reads:** `last_sentiment_post_id`.
- **Range:** Processes posts with `id > last_sentiment_post_id` (in batches; no explicit upper in the initial query, but backfill and “newly created” logic use bounds).
- **Writes:** After processing, sets `last_sentiment_post_id` to the **max Post.id it actually processed** (or one below the first unprocessed if some failed). So the cursor = “we’re done through this id.”

### 2. Themes

- **Reads:** `last_themes_post_id`, **sentimentUpperBound**.
- **Range:** Threads whose posts fall in `(last_themes_post_id, sentimentUpperBound]`. Threads are built once with `threadsLowerBound = min(last_chatter_post_id, last_network_post_id)` and `sentimentUpperBound`.
- **Writes:** `last_themes_post_id = max(processed post ids in theme-matched posts)`, or max thread root id if none processed. So cursor = “we’re done through this id.”

### 3. Chatter

- **Reads:** `last_chatter_post_id`, **sentimentUpperBound**.
- **Range:** Threads filtered to those with root post id in `(last_chatter_post_id, sentimentUpperBound]` (and thread max id in range).
- **Writes:** `last_chatter_post_id = max(root post id of threads we considered)`. So cursor = “we’re done through this root id.”

### 4. Network

- **Reads:** `last_network_post_id`, **sentimentUpperBound**.
- **Range:** Same thread set as Chatter, filtered to `(last_network_post_id, sentimentUpperBound]`.
- **Writes:** `last_network_post_id = max(post id across all posts of people we stored)`, then at end `max(maxIdConsidered from threads)`. So cursor = “we’re done through this id.”

### 5. News

- **Reads:** `last_news_post_id`, **sentimentUpperBound**.
- **Range:** Posts with `id > last_news_post_id` and `id <= sentimentUpperBound`. Then:
  - Take **top 500 by createdAt** from that set.
  - **Plus** all posts in that same id range with `platform = 'blogs'` that aren’t already in the 500 (so blogs are never dropped by the 500 cap).
- **Writes:** At end of `synthesizeNews`:
  - `maxIdConsidered = max(post.id)` over **all posts that were in the pool** (the 500 + the extra blogs).
  - `last_news_post_id = maxIdConsidered`.
So the News cursor = “max id of any post we put in the News pool this run,” **even if we didn’t create a News item for every one** (e.g. LLM returned 0 for a batch). So if a post was in the pool but didn’t become a News item, we still advance the cursor past it and never consider it again.

### 6. Brand

- **Reads:** `last_brand_post_id`, **sentimentUpperBound**.
- **Range:** Posts with `id` in `(last_brand_post_id, sentimentUpperBound]`.
- **Writes:** Same idea as others: cursor advanced to max id processed.

### 7. Blog pipeline (separate from comprehensive analysis)

- **Reads:** `last_blog_analysis_post_id` (a **BlogPost**.id ULID, not Post.id).
- **Range:** BlogPost rows with `id > cursor` (or from start if null).
- **Writes:** After processing a batch of BlogPosts, updates `last_blog_analysis_post_id` to the last BlogPost.id processed. This is **independent** of Post.id; blog pipeline creates **Post** rows from ideas and then comprehensive analysis (sentiment, then News, etc.) processes those Post rows using the **Post** cursors above.

---

## When orchestration runs

1. Orchestration runs steps (scrapers, optional blog task, etc.). New **Post** rows (and optionally **BlogPost** → **Post** from blog pipeline) get created.
2. When the orchestration **completion hook** runs, it calls `runComprehensiveAnalysis(projectId)`.
3. Comprehensive analysis:
   - Loads **AnalysisProgress** (all cursors).
   - Runs **sentiment** for posts with `id > last_sentiment_post_id`, then updates `last_sentiment_post_id`.
   - Computes **sentimentUpperBound** = current max Post.id in project.
   - For Themes, Chatter, Network, News, Brand:
     - Only runs if `sentimentUpperBound > last_*_post_id`.
     - Passes bounds `(last_*_post_id, sentimentUpperBound]`.
     - Each step updates its own cursor to the max id it “processed” (in that step’s definition).
4. So **every orchestration run** that triggers comprehensive analysis uses the **same** upper bound for all steps and advances each cursor **only** when that step has run and reported its max processed id.

---

## Current values for project Test12

**Project:** `id = 01KEDS2SD1X3MVN76DV58CMNJD`, name = `Test12`

**AnalysisProgress:**

| Cursor | Value | Meaning |
|--------|--------|--------|
| last_sentiment_post_id | 475481 | Sentiment has been run through Post id 475481. Next run will process posts with id > 475481. |
| last_chatter_post_id | 476038 | Chatter has been run through root post id 476038. |
| last_themes_post_id | 476038 | Themes have been run through post id 476038. |
| last_network_post_id | 476038 | Network has been run through post id 476038. |
| last_news_post_id | 476038 | News pool was built from posts up to id 476038; cursor set to 476038. |
| last_brand_post_id | 476038 | Brand analysis has been run through post id 476038. |
| last_blog_analysis_post_id | 01KJ3W0YA2M0K67NWE339YEFEC | Blog pipeline last processed up to this BlogPost.id. |

**Max Post.id in DB:** 476038

So for Test12, **sentiment** is behind the others (475481 vs 476038). Next full run will:

- Run sentiment on posts with id in (475481, 476038].
- Set sentimentUpperBound = 476038.
- Themes/Chatter/Network/News/Brand will see `sentimentUpperBound (476038) <= last_*_post_id (476038)` so they will **skip** (no new posts above their cursor).
- If new posts are added (e.g. id 476039+), then sentimentUpperBound will be higher and all steps will run for the new range.

The blog Post with id **475991** (the Delta/United headline) has `475991 <= last_news_post_id (476038)`, so it is **behind** the News cursor and will never be considered for News again unless the News cursor is reset or logic is changed to include it.

---

## Summary

- **One row per project** in `AnalysisProgress` holds all numeric cursors (and blog ULID + sanitization timestamps).
- **Same upper bound** for a run: `sentimentUpperBound` = current max Post.id when the run starts.
- **Each step** only sees posts in `(last_*_post_id, sentimentUpperBound]` and then sets `last_*_post_id` to the max id it considered/processed.
- **News** is special: it builds a pool (500 by createdAt + all blogs in range), then sets the cursor to the **max id in that pool**, so any post in the pool is never considered again even if it didn’t become a News item.
- **Orchestration** runs comprehensive analysis once per project on completion; that one run reads and updates all these cursors.
