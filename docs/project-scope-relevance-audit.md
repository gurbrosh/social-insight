# Project scope / relevance check – where it’s used

This lists every place that checks a post or content against the project (keywords, brands, monitoring focus) for relevance. Goal: use **semantic project scope** (“what is this user curious about?”) for all of these, not raw keyword/brand lists.

---

## 1. Blog pipeline – title-only pre-check ✅ DONE

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/blog-post-analysis-pipeline.ts` | Decides if a blog post title is relevant before full analysis | Uses `buildSemanticProjectScope(projectId)` and passes `semanticScope` to title-only pre-check | ✅ Semantic scope |

---

## 2. Blog – full pre-check (title + article text)

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/blog-news-analysis-service.ts` → `analyzeArticlePreCheck` | Pre-check with article body; returns `is_ad`, `relevance_score` | Uses raw `projectContext` (brands, keywords, focus) in `buildBlogAnalysisPreCheckPrompt` | ⚠️ Still raw lists |
| `lib/blog-news-analysis-prompts.ts` → `buildBlogAnalysisPreCheckPrompt` | Builds prompt for that pre-check | Injects “Brands: …, Focus: …, Keywords: …” | ⚠️ Add optional `semanticScope` like title-only |

**Note:** Main blog pipeline uses **title-only** pre-check only; this full pre-check path exists but may be used elsewhere.

---

## 3. Blog – full article analysis (OpenAI extraction)

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/blog-news-analysis-service.ts` → `analyzeArticleWithOpenAI` | Full article extraction including `relevance_score` | Takes optional `projectContext` (raw); caller `analyzeBlogNewsFromUrls` does not pass it | ⚠️ Raw when used |
| `lib/blog-news-analysis-prompts.ts` → `buildBlogAnalysisUserPrompt` | Prompt for full analysis | Injects “Brands: …, Monitoring focus: …, Keywords: …” when `projectContext` provided | ⚠️ Add optional `semanticScope` for consistency |

---

## 4. Apify / DownstreamPost – single post relevance ✅ DONE

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/apify-service.ts` (≈2365) | Before saving a scraped post to DownstreamPost, checks if it’s relevant | `projectContextForRelevance = await getProjectContextForRelevance(projectId)` then `isPostRelevantToProjectContext(projectContextForRelevance, text, …)` | ✅ Semantic scope |
| `lib/comprehensive-analysis.ts` → `isPostRelevantToProjectContext` | Single-post relevance: “Is this post relevant to the project?” | Receives semantic scope (or fallback essence) from callers | ✅ Callers use getProjectContextForRelevance |

---

## 5. Comprehensive analysis – batch relevance (chatter / social) ✅ DONE

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/comprehensive-analysis.ts` → `checkRelevanceBatch` | Marks off-topic items in a batch (e.g. chatter) | Gets `projectContext` from `getProjectContextForRelevance(projectId)` at sanitization entry | ✅ Semantic scope |
| `sanitizeAnalysisResults` (and influencer scoring) | Sanitization + influencer relevance | Pass `projectContext = await getProjectContextForRelevance(projectId)` | ✅ Semantic scope |

---

## 6. Admin – theme sanitization ✅ DONE

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `app/api/admin/test-theme-sanitization/route.ts` | Sanitize themes: drop items not relevant to project | `projectContext = await getProjectContextForRelevance(projectId)` then local `checkRelevanceBatch(projectContext, items)` | ✅ Semantic scope |

---

## 7. News analysis – relevance filter ✅ DONE

| Location | What it does | Current | Status |
|----------|--------------|---------|--------|
| `lib/news-analysis.ts` → `filterByProjectRelevance` | Filter news items by project keywords/brands | **Literal string matching**: `textToCheck.includes(keyword)`, brand match, require 2 keywords, etc. No LLM | ⚠️ Pure keyword/brand matching; different from “semantic scope” |

**Note:** This is a fast, non-LLM filter. Aligning with “semantic scope” would require an LLM-based relevance step (e.g. reusing a single-post relevance check with semantic scope) or leaving as a first pass and adding an optional semantic filter.

---

## 8. Other uses of `buildProjectEssence` (not relevance-only)

| Location | What it does | Use semantic scope? |
|----------|--------------|----------------------|
| `lib/comprehensive-analysis.ts` | Theme matching, influencer scoring, merge prompts, news extraction prompts | Theme/relevance: yes. Merge/summarization: structured context (essence) can stay. |
| `lib/blog-post-analysis-pipeline.ts` (≈756) | Theme assignment for blog analyses | Currently uses `buildProjectEssence`; could use semantic scope for “is this post about what the user cares about?” when matching themes. |
| `scripts/reevaluate-blog-themes.ts` | Re-evaluate blog themes | Could use semantic scope when relevance is involved. |
| `scripts/diagnose-chatter-post.ts` | Build “essence” for diagnostics | Can use semantic scope for consistency. |

---

## Summary

- **Using semantic scope for relevance:**  
  Blog pipeline title-only pre-check; reevaluate script with `--rescore-relevance`; Apify DownstreamPost filter (`getProjectContextForRelevance`); comprehensive-analysis sanitization (chatter/network/themes/news) and influencer relevance (`getProjectContextForRelevance`); admin test-theme-sanitization; news analysis `filterByProjectRelevance` (semantic batch via `checkRelevanceBatch`).
- **Helper:** `getProjectContextForRelevance(projectId)` in `lib/comprehensive-analysis.ts` returns `buildSemanticProjectScope(projectId)` when non-empty, else `buildProjectEssence(projectId)`.
- **Still raw / optional follow-ups:**  
  Blog full pre-check and full-analysis prompts (add optional `semanticScope` for consistency).  
  Other `buildProjectEssence` uses (theme matching, sentiment batch, news extraction, merge prompts) keep full structured context unless we explicitly switch them.
