/**
 * Canonical entry points for post-level analysis categories.
 *
 * Import from `@/lib/analysis/core` in workers, API routes, and pipelines so every
 * execution path uses the same symbols. Implementations live in `comprehensive-analysis.ts`
 * (and `brand-analysis.ts` for brand internals) until further extraction.
 *
 * - **SENTIMENT**: `runSentimentForPostIds` — single OpenAI path; full analysis delegates here when `sentimentOnly`.
 * - **THEMES**: `runThemesForPostIds` → `analyzeThemesFromThreads` (thread-level matching; same as `runThemeAnalysisStep` in full runs).
 * - **CHATTER / NETWORK / NEWS / BRAND**: thin wrappers around the same functions full analysis uses for incremental steps.
 */
export {
  runSentimentForPostIds,
  runThemesForPostIds,
  runChatterForPostIds,
  runNetworkForPostIds,
  runNewsForPostIds,
  runBrandForPostIds,
} from "@/lib/comprehensive-analysis";
