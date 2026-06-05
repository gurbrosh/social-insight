import { prisma } from "@/lib/prisma";
import { classifyCampaignCandidateReadOnly } from "./classify-readonly";
import { deriveCampaignOpenToWorkFields } from "./open-to-work-export";
import { evaluatePhase1Exclusion } from "./phase1-exclusion";
import { loadPersonEmploymentByLinkedInUrl } from "@/lib/prospect-intelligence/load-profile-employment";
import { postBasedListToCampaignCandidates } from "./post-based-to-campaign-candidate";
import type {
  CampaignCandidate,
  CampaignCandidatePreviewRow,
  CampaignExclusionCriterionId,
  PostBasedCampaignCandidate,
} from "./types";

export const DEFAULT_PHASE1_PREVIEW_LIMIT = 50;

export async function enrichCampaignCandidatesWithPhase1(
  projectId: string,
  candidates: CampaignCandidate[],
  selectedExclusionIds: readonly CampaignExclusionCriterionId[],
  options?: { phase1Limit?: number }
): Promise<{ rows: CampaignCandidatePreviewRow[]; phase1Limited: boolean }> {
  const limit = options?.phase1Limit ?? DEFAULT_PHASE1_PREVIEW_LIMIT;
  const phase1Limited = candidates.length > limit;

  const slice = candidates.slice(0, limit);
  const themeIds = [
    ...new Set(slice.map((c) => c.themes_analysis_id).filter(Boolean) as string[]),
  ];
  const themes =
    themeIds.length > 0
      ? await prisma.themesAnalysis.findMany({
          where: { id: { in: themeIds }, project_id: projectId, deleted_at: null },
          select: { id: true, post_content: true },
        })
      : [];
  const themeContentById = new Map(themes.map((t) => [t.id, t.post_content]));

  const postIds = [...new Set(slice.map((c) => c.post_id).filter((id): id is number => id != null))];
  const posts =
    postIds.length > 0
      ? await prisma.post.findMany({
          where: { id: { in: postIds } },
          select: { id: true, extraJson: true, authorName: true, content: true, url: true },
        })
      : [];
  const postById = new Map(posts.map((p) => [p.id, p]));

  const rows: CampaignCandidatePreviewRow[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    if (i >= limit) {
      rows.push({ ...candidate });
      continue;
    }

    const post =
      candidate.post_id != null ? postById.get(candidate.post_id) : undefined;
    const themeContent =
      candidate.themes_analysis_id != null
        ? themeContentById.get(candidate.themes_analysis_id) ?? null
        : null;

    const peBefore = await loadPersonEmploymentByLinkedInUrl(prisma, candidate.linkedin_url);
    const hadCachedEmployment = Boolean(peBefore?.experienceRoles.length);

    const classification = await classifyCampaignCandidateReadOnly(projectId, candidate, {
      post: post ?? undefined,
      themePostContent: themeContent,
      skipPublicProfileFetch: true,
    });

    const phase1 = evaluatePhase1Exclusion({
      classification,
      selectedExclusionIds,
    });

    const otwFields = deriveCampaignOpenToWorkFields({
      candidate,
      classification,
      hadCachedEmployment,
      apifyHadOpenToWork: candidate.apify_open_to_work_present,
    });

    rows.push({
      ...candidate,
      ...otwFields,
      phase1_decision: phase1.decision,
      phase1_disqualified_reason: phase1.reason,
      matched_exclusion_criteria: phase1.matchedExclusionCriteria,
      role_categories: classification.roleCategories.join(";"),
      function_tags: classification.functionTags.join(";"),
      profile_flags: classification.profileFlags.join(";"),
      classification_confidence: classification.confidence,
      employment_confidence: classification.employmentConfidence,
      classification_needs_review: classification.classificationNeedsReview,
      non_excluded_signals: phase1.nonExcludedSignals.join(";"),
      dominant_exclusion: phase1.dominantExclusion ?? "",
      exclusion_reason: phase1.exclusionReason ?? "",
      why_continued_reason: phase1.whyContinuedReason ?? "",
      classification,
    });
  }

  return { rows, phase1Limited };
}

/** @deprecated Use enrichCampaignCandidatesWithPhase1 */
export async function enrichPostBasedCandidatesWithPhase1(
  projectId: string,
  candidates: PostBasedCampaignCandidate[],
  selectedExclusionIds: readonly CampaignExclusionCriterionId[],
  options?: { phase1Limit?: number }
): Promise<{ rows: CampaignCandidatePreviewRow[]; phase1Limited: boolean }> {
  return enrichCampaignCandidatesWithPhase1(
    projectId,
    postBasedListToCampaignCandidates(candidates),
    selectedExclusionIds,
    options
  );
}
