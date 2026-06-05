/**
 * Analysis profile: which pipeline steps to enqueue for a project run.
 * "full" runs the standard task queue; "minimal" skips heavier steps for faster/cheaper passes.
 */

import type { AnalysisProfile, AnalysisStep } from "@prisma/client";

/** POST row steps for a full analysis (subject to per-source policy in enqueue). */
export const FULL_POST_STEPS: AnalysisStep[] = [
  "SENTIMENT",
  "THEMES",
  "CHATTER",
  "NETWORK",
  "BRAND",
];

/** Minimal profile: sentiment, themes, brand only (no chatter, network, batched news, or blog LLM). */
export const MINIMAL_POST_STEPS: AnalysisStep[] = ["SENTIMENT", "THEMES", "BRAND"];

export function getPostStepsForProfile(profile: AnalysisProfile): AnalysisStep[] {
  return profile === "minimal" ? [...MINIMAL_POST_STEPS] : [...FULL_POST_STEPS];
}

/** Whether to enqueue NEWS_BATCH → NEWS and BLOG_POST → BLOG_NEWS_ANALYSIS for this profile. */
export function shouldEnqueueNewsAndBlogSteps(profile: AnalysisProfile): boolean {
  return profile === "full";
}
