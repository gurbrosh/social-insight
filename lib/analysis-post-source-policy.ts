/**
 * Per-post analysis pipeline rules by ingest source (GitHub vs Hacker News vs default).
 */

import type { AnalysisStep } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { isGithubPlatform, isHackerNewsPlatform } from "@/lib/utils/platform";

/**
 * Merge into Post `where` clauses that use `sentiment: null` as “needs LLM sentiment”.
 * GitHub repo-ingest posts never get sentiment LLM; `platform` is always `github` (see `GITHUB_POST_PLATFORM`).
 */
export const postWhereExcludeGithubFromLegacySentimentPipeline: Prisma.PostWhereInput = {
  platform: { not: "github" },
};

export interface PostSourceAnalysisPolicy {
  skipSentiment: boolean;
  skipNetwork: boolean;
  skipChatter: boolean;
  /** Exclude post ids from NEWS batch LLM (still covered by batch task completion). */
  excludeFromNewsBatch: boolean;
}

export function getPostSourceAnalysisPolicy(
  platform: string | null | undefined,
  hnStoryAnalysisId: string | null | undefined
): PostSourceAnalysisPolicy {
  if (isGithubPlatform(platform)) {
    return {
      skipSentiment: true,
      skipNetwork: true,
      skipChatter: true,
      /** NEWS_BATCH tasks are still created; worker filters GitHub ids out of LLM input. */
      excludeFromNewsBatch: true,
    };
  }
  if (isHackerNewsPlatform(platform, hnStoryAnalysisId)) {
    return {
      skipSentiment: false,
      skipNetwork: true,
      skipChatter: false,
      excludeFromNewsBatch: false,
    };
  }
  return {
    skipSentiment: false,
    skipNetwork: false,
    skipChatter: false,
    excludeFromNewsBatch: false,
  };
}

/**
 * Whether to enqueue a POST step for this record, after applying source rules and conversation role rules.
 */
export function shouldEnqueuePostAnalysisStep(
  step: AnalysisStep,
  roleInfo: { role: string | null; conversationId: string | null } | undefined,
  policy: PostSourceAnalysisPolicy
): boolean {
  if (policy.skipSentiment && step === "SENTIMENT") return false;
  if (policy.skipNetwork && step === "NETWORK") return false;
  if (policy.skipChatter && step === "CHATTER") return false;

  // Theme matching is per-post. After materialization, thread replies are often RESPONSE;
  // excluding them left Discord (and similar) runs with ~0 theme tasks.
  if (step === "THEMES") return true;

  if (!roleInfo) return true;
  if (roleInfo.role == null) return true;
  if (step === "CHATTER") {
    return roleInfo.role === "ROOT" && roleInfo.conversationId != null;
  }
  return true;
}
