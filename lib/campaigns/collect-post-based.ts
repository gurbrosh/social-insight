import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { linkedInMatchedPostPassesProspectSubstanceGate } from "@/lib/linkedin-outreach/evaluate-linkedin-comment-for-prospect";
import { DEFAULT_MAX_ROWS } from "@/lib/linkedin-prospects-csv/constants";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import {
  firstLastFromInSlugPath,
  singleLineText,
  splitDisplayNameToParts,
} from "@/lib/linkedin-prospects-csv/row-text";
import { LINKEDIN_DB_PLATFORM_IN, isLinkedInPlatform } from "@/lib/utils/platform";
import { getRollingWindowStart, type ReportRangeUnit } from "@/lib/report-window";
import { CAMPAIGN_POST_BASED_MAX_CANDIDATES } from "./constants";
import { checkCampaignPostBasedPrerequisites } from "./check-prerequisites";
import type {
  CampaignPostBasedCollectStats,
  CampaignPrerequisiteResult,
  PostBasedCampaignCandidate,
} from "./types";

export type CollectPostBasedCampaignParams = {
  projectId: string;
  rangeAmount: number;
  rangeUnit: ReportRangeUnit;
  minRelevancePercent: number;
  now?: Date;
  maxCandidates?: number;
};

export type CollectPostBasedCampaignResult =
  | {
      ok: true;
      candidates: PostBasedCampaignCandidate[];
      stats: CampaignPostBasedCollectStats;
    }
  | { ok: false; prerequisite: CampaignPrerequisiteResult };

type InternalCandidate = PostBasedCampaignCandidate & {
  total_reactions: number;
  theme_item_response_id: string;
};

const LOG = "[campaigns:collect-post-based]";

function readMaxRows(override?: number): number {
  if (override != null && override > 0) return override;
  const raw = process.env.CAMPAIGN_POST_BASED_MAX_CANDIDATES;
  if (raw != null && raw.trim() !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return CAMPAIGN_POST_BASED_MAX_CANDIDATES > 0 ? CAMPAIGN_POST_BASED_MAX_CANDIDATES : DEFAULT_MAX_ROWS;
}

/**
 * Gathers post-based LinkedIn candidates using the same theme window / relevance filters as
 * linkedin-prospects-csv, without outreach email generation or prospect intelligence DB writes.
 */
export async function collectPostBasedCampaignCandidates(
  params: CollectPostBasedCampaignParams
): Promise<CollectPostBasedCampaignResult> {
  const prerequisite = await checkCampaignPostBasedPrerequisites(params.projectId);
  if (!prerequisite.ok) {
    return { ok: false, prerequisite };
  }

  const { projectId, rangeAmount, rangeUnit, minRelevancePercent, now = new Date() } = params;
  const windowStart = getRollingWindowStart(rangeAmount, rangeUnit, now);
  const maxRows = readMaxRows(params.maxCandidates);
  const minP = Math.min(100, Math.max(0, minRelevancePercent));

  const inWindow: Prisma.Enumerable<Prisma.ThemesAnalysisWhereInput> = [
    { posted_at: { gte: windowStart } },
    { AND: [{ posted_at: null }, { created_at: { gte: windowStart } }] },
  ];
  const relevanceOr: Prisma.Enumerable<Prisma.ThemesAnalysisWhereInput> | null =
    minP > 0 ? [{ relevance_score: null }, { relevance_score: { gte: minP } }] : null;

  const themeRows = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      AND: [{ OR: inWindow }, ...(relevanceOr ? [{ OR: relevanceOr }] : [])],
    },
    orderBy: [{ posted_at: "desc" }, { created_at: "desc" }],
    take: 5_000,
    include: {
      themeItemResponses: {
        where: { deleted_at: null },
        orderBy: { relevance_score: "desc" },
        include: {
          responseObjective: { select: { id: true, deleted_at: true } },
        },
      },
    },
  });

  const emptyStats = (): CampaignPostBasedCollectStats => ({
    droppedInvalid: 0,
    droppedDedup: 0,
    droppedCap: 0,
    droppedSupportiveOnlyComment: 0,
    windowStart: windowStart.toISOString(),
    minRelevancePercent: minP,
    rangeAmount,
    rangeUnit,
  });

  if (themeRows.length === 0) {
    return { ok: true, candidates: [], stats: emptyStats() };
  }

  const postIds = [...new Set(themeRows.map((r) => r.post_id))];
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true,
      extraJson: true,
      authorName: true,
      url: true,
      threadRefId: true,
      content: true,
    },
  });
  const postById = new Map(posts.map((p) => [p.id, p]));

  let droppedInvalid = 0;
  let droppedSupportiveOnlyComment = 0;
  const byUrl = new Map<string, InternalCandidate>();
  let validRowCount = 0;

  for (const ta of themeRows) {
    if (!isLinkedInPlatform(ta.platform)) continue;

    const post = postById.get(ta.post_id);
    const { profileUrl, headline: ingestHeadline } = getLinkedInAuthorFromExtraJson(post?.extraJson);
    if (!profileUrl?.trim()) {
      droppedInvalid += 1;
      continue;
    }
    const canonical = normalizePublicProfileUrl(String(profileUrl));
    if (canonical == null) {
      droppedInvalid += 1;
      continue;
    }

    let items = ta.themeItemResponses;
    if (minP > 0 && items.length > 0) {
      const filtered = items.filter((i) => (i.relevance_score ?? 0) >= minP / 100);
      if (filtered.length > 0) items = filtered;
      else continue;
    }
    const bestItem = items[0] ?? null;
    const ro = bestItem?.responseObjective;
    if (ro?.deleted_at) continue;

    const passesProspectSubstance = await linkedInMatchedPostPassesProspectSubstanceGate({
      projectId,
      matchedPostDbId: ta.post_id,
      threadRefId: post?.threadRefId,
      matchedPostContent: post?.content,
      themePostContentFallback: ta.post_content,
    });
    if (!passesProspectSubstance) {
      droppedSupportiveOnlyComment += 1;
      continue;
    }

    /** Source list only — no per-row public profile HTTP fetch (export uses in-memory rows). */
    const displayName = (
      ta.author_name?.trim() ||
      post?.authorName?.trim() ||
      null
    ) as string | null;
    let { first_name, last_name } = splitDisplayNameToParts(displayName);
    if (!first_name.trim() && !last_name.trim()) {
      const fromSlug = firstLastFromInSlugPath(canonical);
      first_name = fromSlug.first_name;
      last_name = fromSlug.last_name;
    }
    if (!first_name.trim() || !last_name.trim()) {
      droppedInvalid += 1;
      continue;
    }

    const headline = singleLineText(ingestHeadline) || null;

    validRowCount += 1;
    const total_reactions = ta.total_reactions ?? 0;
    const rel = ta.relevance_score ?? (bestItem?.relevance_score != null ? bestItem.relevance_score * 100 : 80);
    const internal: InternalCandidate = {
      linkedin_url: canonical,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      display_name: displayName,
      headline,
      candidate_source_type: "post_based_candidate",
      relevance_score: rel,
      theme_name: ta.theme_name,
      post_url: ta.post_url,
      total_reactions,
      themes_analysis_id: ta.id,
      post_id: ta.post_id,
      platform: ta.platform,
      theme_item_response_id: bestItem?.id ?? ta.id,
    };

    const prev = byUrl.get(canonical);
    if (!prev) {
      byUrl.set(canonical, internal);
      continue;
    }
    const sameEngagement = prev.total_reactions === total_reactions;
    const relImproved = rel > prev.relevance_score;
    const relTie = rel === prev.relevance_score;
    const preferThis =
      total_reactions > prev.total_reactions ||
      (sameEngagement && relImproved) ||
      (sameEngagement && relTie && internal.theme_item_response_id < prev.theme_item_response_id);
    if (preferThis) byUrl.set(canonical, internal);
  }

  const droppedDedup = Math.max(0, validRowCount - byUrl.size);
  const list = Array.from(byUrl.values());
  list.sort((a, b) => {
    if (b.total_reactions !== a.total_reactions) return b.total_reactions - a.total_reactions;
    return a.linkedin_url < b.linkedin_url ? -1 : 1;
  });

  const droppedCap = list.length > maxRows ? list.length - maxRows : 0;
  const candidates = list.slice(0, maxRows).map(({ theme_item_response_id: _tid, ...row }) => row);

  console.log(
    `${LOG} project=${projectId} candidates=${candidates.length} droppedInvalid=${droppedInvalid} ` +
      `droppedDedup=${droppedDedup} droppedSupportive=${droppedSupportiveOnlyComment} droppedCap=${droppedCap}`
  );

  return {
    ok: true,
    candidates,
    stats: {
      droppedInvalid,
      droppedDedup,
      droppedCap,
      droppedSupportiveOnlyComment,
      windowStart: windowStart.toISOString(),
      minRelevancePercent: minP,
      rangeAmount,
      rangeUnit,
    },
  };
}
