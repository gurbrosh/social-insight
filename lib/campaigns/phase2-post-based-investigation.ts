import { prisma } from "@/lib/prisma";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { getRollingWindowStart } from "@/lib/report-window";
import { checkCampaignPostBasedPrerequisites } from "./check-prerequisites";
import { collectPostBasedCampaignCandidates } from "./collect-post-based";

export type Phase2PostBasedInvestigation = {
  prerequisitesOk: boolean;
  prerequisiteCode?: string;
  prerequisiteMessage?: string;
  lookbackDays: number;
  minRelevancePercent: number;
  windowStart: string;
  linkedInThemeRowsInWindow: number;
  linkedInThemeRowsMeetingRelevanceFilter: number;
  collectOk: boolean;
  candidatesReturned: number;
  collectStats?: {
    droppedInvalid: number;
    droppedDedup: number;
    droppedCap: number;
    droppedSupportiveOnlyComment: number;
  };
  likelyReason: string;
};

/**
 * Lightweight diagnosis when live post-based collect returns 0 rows.
 */
export async function investigatePostBasedZero(
  projectId: string,
  options?: { rangeAmount?: number; minRelevancePercent?: number }
): Promise<Phase2PostBasedInvestigation> {
  const rangeAmount = options?.rangeAmount ?? 7;
  const minRelevancePercent = options?.minRelevancePercent ?? 70;
  const windowStart = getRollingWindowStart(rangeAmount, "days");

  const prerequisite = await checkCampaignPostBasedPrerequisites(projectId);

  const inWindow = [
    { posted_at: { gte: windowStart } },
    { AND: [{ posted_at: null }, { created_at: { gte: windowStart } }] },
  ];
  const relevanceOr =
    minRelevancePercent > 0
      ? [{ relevance_score: null }, { relevance_score: { gte: minRelevancePercent } }]
      : null;

  const linkedInThemeRowsInWindow = await prisma.themesAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      AND: [{ OR: inWindow }, ...(relevanceOr ? [{ OR: relevanceOr }] : [])],
    },
  });

  const linkedInThemeRowsMeetingRelevanceFilter = await prisma.themesAnalysis.count({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      relevance_score: { gte: minRelevancePercent },
      AND: [{ OR: inWindow }],
    },
  });

  let collectOk = false;
  let candidatesReturned = 0;
  let collectStats: Phase2PostBasedInvestigation["collectStats"];

  if (prerequisite.ok) {
    const collected = await collectPostBasedCampaignCandidates({
      projectId,
      rangeAmount,
      rangeUnit: "days",
      minRelevancePercent,
      maxCandidates: 80,
    });
    if (collected.ok) {
      collectOk = true;
      candidatesReturned = collected.candidates.length;
      collectStats = {
        droppedInvalid: collected.stats.droppedInvalid,
        droppedDedup: collected.stats.droppedDedup,
        droppedCap: collected.stats.droppedCap,
        droppedSupportiveOnlyComment: collected.stats.droppedSupportiveOnlyComment,
      };
    }
  }

  let likelyReason: string;
  if (!prerequisite.ok) {
    likelyReason = `Missing prerequisites (${prerequisite.code}): ${prerequisite.message}`;
  } else if (linkedInThemeRowsInWindow === 0) {
    likelyReason =
      "No LinkedIn theme rows in the selected lookback window (7 days). Post-based source data absent for this window.";
  } else if (candidatesReturned === 0 && (collectStats?.droppedSupportiveOnlyComment ?? 0) > 0) {
    likelyReason =
      "Theme rows exist but rows were dropped by prospect substance gate (supportive-only comments) or invalid profile URLs.";
  } else if (candidatesReturned === 0 && (collectStats?.droppedInvalid ?? 0) > 0) {
    likelyReason =
      "Theme rows exist but candidates dropped as invalid (missing profile URL or incomplete name).";
  } else if (
    linkedInThemeRowsInWindow > 0 &&
    linkedInThemeRowsMeetingRelevanceFilter === 0 &&
    minRelevancePercent > 0
  ) {
    likelyReason = `Theme rows in window lack relevance_score >= ${minRelevancePercent}; item-level filter may also exclude rows.`;
  } else if (candidatesReturned === 0) {
    likelyReason =
      "Prerequisites met and some theme rows in window, but no rows passed collect filters (relevance, substance gate, or author metadata).";
  } else {
    likelyReason = "Post-based collect returned candidates.";
  }

  return {
    prerequisitesOk: prerequisite.ok,
    prerequisiteCode: prerequisite.ok ? undefined : prerequisite.code,
    prerequisiteMessage: prerequisite.ok ? undefined : prerequisite.message,
    lookbackDays: rangeAmount,
    minRelevancePercent,
    windowStart: windowStart.toISOString(),
    linkedInThemeRowsInWindow,
    linkedInThemeRowsMeetingRelevanceFilter,
    collectOk,
    candidatesReturned,
    collectStats,
    likelyReason,
  };
}
