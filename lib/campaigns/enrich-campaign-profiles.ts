import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { capturePhase1Snapshot } from "./capture-phase1-snapshot";
import { classifyEnrichedCandidateReadOnly } from "./classify-enriched-candidate";
import {
  CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT,
  CAMPAIGN_PHASE3_ENRICHMENT_ACTOR,
  CAMPAIGN_PHASE3_ENRICHMENT_SOURCE,
  CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT,
} from "./constants";
import { normalizeApifyProfileEnrichmentItem } from "./normalize-profile-enrichment";
import { evaluatePostEnrichmentExclusion } from "./evaluate-post-enrichment-exclusion";
import { runProfileEnrichmentBatch } from "./run-profile-enrichment";
import type {
  CampaignCandidatePreviewRow,
  CampaignEnrichedCandidateRow,
  CampaignEnrichmentRunStats,
  CampaignExclusionCriterionId,
} from "./types";

function indexKey(url: string): string {
  return normalizePublicProfileUrl(url) ?? url.trim().toLowerCase().replace(/\/$/, "");
}

export type EnrichCampaignProfilesResult =
  | {
      ok: true;
      enrichedCandidates: CampaignEnrichedCandidateRow[];
      stats: CampaignEnrichmentRunStats;
      warnings: string[];
    }
  | { ok: false; error: string; apifyNotConfigured?: boolean };

function emptyStats(): CampaignEnrichmentRunStats {
  return {
    attempted: 0,
    successful: 0,
    failed: 0,
    notFound: 0,
    skippedPhase1Disqualified: 0,
    withExperienceData: 0,
    withEmail: 0,
    withMobile: 0,
    openToWorkDetected: 0,
    openToWorkStillUnknown: 0,
    postEnrichmentWouldDisqualify: 0,
  };
}

function buildPendingRow(
  candidate: CampaignCandidatePreviewRow,
  status: CampaignEnrichedCandidateRow["enrichment_status"],
  error?: string
): CampaignEnrichedCandidateRow {
  const snapshot = capturePhase1Snapshot(candidate);
  return {
    ...candidate,
    ...snapshot,
    name:
      candidate.display_name?.trim() ||
      `${candidate.first_name} ${candidate.last_name}`.trim(),
    enrichment_status: status,
    enrichment_error: error ?? null,
    enriched_at: null,
    enrichment_actor: CAMPAIGN_PHASE3_ENRICHMENT_ACTOR,
    enrichment_source: CAMPAIGN_PHASE3_ENRICHMENT_SOURCE,
    enriched_employment_source: "unknown",
    enriched_employment_confidence: 0,
    experience_count: 0,
    current_experience_count: 0,
  };
}

export async function enrichCampaignProfiles(args: {
  projectId: string;
  candidates: CampaignCandidatePreviewRow[];
  selectedExclusionIds: readonly CampaignExclusionCriterionId[];
  limit?: number;
  fetchItems?: Parameters<typeof runProfileEnrichmentBatch>[0]["fetchItems"];
}): Promise<EnrichCampaignProfilesResult> {
  const limit = Math.min(
    CAMPAIGN_PHASE3_MAX_ENRICHMENT_LIMIT,
    Math.max(1, args.limit ?? CAMPAIGN_PHASE3_DEFAULT_ENRICHMENT_LIMIT)
  );

  const continuing = args.candidates.filter(
    (c) => c.phase1_decision === "continue_to_enrichment"
  );
  const skippedPhase1Disqualified = args.candidates.filter(
    (c) => c.phase1_decision === "disqualify_phase1"
  ).length;

  const toEnrich = continuing.slice(0, limit);
  const stats = emptyStats();
  stats.skippedPhase1Disqualified = skippedPhase1Disqualified;

  if (toEnrich.length === 0) {
    return { ok: true, enrichedCandidates: [], stats, warnings: [] };
  }

  const profileUrls = toEnrich.map((c) => c.linkedin_url);
  const batch = await runProfileEnrichmentBatch({
    profileUrls,
    fetchItems: args.fetchItems,
  });

  if (!batch.ok) {
    return {
      ok: false,
      error: batch.error,
      apifyNotConfigured: batch.apifyNotConfigured,
    };
  }

  const warnings = [...batch.warnings];
  const enrichedCandidates: CampaignEnrichedCandidateRow[] = [];
  const enrichedAt = new Date().toISOString();

  for (const candidate of toEnrich) {
    stats.attempted += 1;
    const key = indexKey(candidate.linkedin_url);
    const rawItem = batch.itemsByNormalizedUrl.get(key);

    if (!rawItem) {
      stats.notFound += 1;
      enrichedCandidates.push(buildPendingRow(candidate, "not_found", "No profile returned by actor"));
      continue;
    }

    let normalized;
    try {
      normalized = normalizeApifyProfileEnrichmentItem(rawItem, candidate);
    } catch (e) {
      stats.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      enrichedCandidates.push(buildPendingRow(candidate, "parse_error", msg));
      continue;
    }

    if (!normalized) {
      stats.failed += 1;
      enrichedCandidates.push(
        buildPendingRow(candidate, "parse_error", "Could not normalize actor profile payload")
      );
      continue;
    }

    let classification;
    try {
      classification = await classifyEnrichedCandidateReadOnly(
        args.projectId,
        candidate,
        normalized
      );
    } catch (e) {
      stats.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      enrichedCandidates.push(buildPendingRow(candidate, "failed", `Classification failed: ${msg}`));
      continue;
    }

    const postInspection = evaluatePostEnrichmentExclusion({
      classification,
      selectedExclusionIds: args.selectedExclusionIds,
      enrichmentOpenToWorkDetection: normalized.open_to_work_detection,
      enrichmentOpenToWorkSource: normalized.open_to_work_source,
    });

    const snapshot = capturePhase1Snapshot(candidate);
    const wouldDisqualify = postInspection.wouldDisqualify;
    if (wouldDisqualify) stats.postEnrichmentWouldDisqualify += 1;

    if (normalized.experience_count > 0) stats.withExperienceData += 1;
    if (normalized.email) stats.withEmail += 1;
    if (normalized.mobile) stats.withMobile += 1;
    if (normalized.open_to_work_detection === "detected") stats.openToWorkDetected += 1;
    if (normalized.open_to_work_detection === "unknown") stats.openToWorkStillUnknown += 1;

    stats.successful += 1;

    enrichedCandidates.push({
      ...candidate,
      ...snapshot,
      ...normalized,
      headline: normalized.headline ?? candidate.headline,
      location: normalized.location ?? candidate.location,
      enrichment_status: "success",
      enrichment_error: null,
      enriched_at: enrichedAt,
      enrichment_actor: CAMPAIGN_PHASE3_ENRICHMENT_ACTOR,
      enrichment_source: CAMPAIGN_PHASE3_ENRICHMENT_SOURCE,
      open_to_work_detection: normalized.open_to_work_detection,
      open_to_work_source: normalized.open_to_work_source,
      enriched_role_categories: classification.roleCategories.join(";"),
      enriched_function_tags: classification.functionTags.join(";"),
      enriched_profile_flags: classification.profileFlags.join(";"),
      enriched_classification_confidence: classification.confidence,
      enriched_classification_needs_review: classification.classificationNeedsReview,
      post_enrichment_exclusion_matches: postInspection.matchedExclusionCriteria.join(";"),
      post_enrichment_would_disqualify: wouldDisqualify,
      post_enrichment_reason: wouldDisqualify
        ? postInspection.reason
        : null,
    });
  }

  return { ok: true, enrichedCandidates, stats, warnings };
}
