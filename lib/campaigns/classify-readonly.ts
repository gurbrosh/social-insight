import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { tryFetchLinkedInPublicProfileData } from "@/lib/linkedin-prospects-csv/fetch-linkedin-public-profile";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import { gatherEvidenceFromPostRow, mergePublicProfileScrapeEvidence } from "@/lib/prospect-intelligence/gather-evidence";
import { loadPersonEmploymentByLinkedInUrl } from "@/lib/prospect-intelligence/load-profile-employment";
import { loadCompetitorPatternsForProject } from "@/lib/prospect-intelligence/pipeline";
import type { ProspectClassification, ProspectEvidence } from "@/lib/prospect-intelligence/types";
import type { CampaignCandidate, PostBasedCampaignCandidate } from "./types";

function buildCompanySearchEvidence(candidate: CampaignCandidate): ProspectEvidence[] {
  const items: ProspectEvidence[] = [];
  const observedAt = new Date().toISOString();

  if (candidate.current_title || candidate.current_company) {
    const label =
      candidate.employment_source === "current_positions"
        ? "company_search_current_position"
        : candidate.employment_source === "headline_fallback"
          ? "company_search_headline_fallback"
          : "company_search_profile";
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: [candidate.current_title, candidate.current_company].filter(Boolean).join(" @ "),
      extractedSignals: ["profile_title", "profile_company"],
      confidence: candidate.employment_source === "current_positions" ? 0.75 : 0.45,
      observedAt,
      metadata: {
        analysisMethod: label,
        employmentSource: candidate.employment_source,
        unverifiedHeadlineFallback: candidate.employment_source === "headline_fallback",
      },
    });
  }

  if (candidate.headline?.trim()) {
    items.push({
      source: "linkedin_author_headline",
      sourceUrl: candidate.linkedin_url,
      rawText: candidate.headline,
      extractedSignals: ["headline"],
      confidence: 0.5,
      observedAt,
      metadata: { analysisMethod: "company_search_headline" },
    });
  }

  if (candidate.location?.trim()) {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: candidate.location,
      extractedSignals: ["location"],
      confidence: 0.4,
      observedAt,
      metadata: { analysisMethod: "company_search_location" },
    });
  }

  return items;
}

/**
 * Deterministic classification for a unified campaign row — no ProspectIdentity / snapshot writes.
 */
export async function classifyCampaignCandidateReadOnly(
  projectId: string,
  candidate: CampaignCandidate,
  context?: {
    post?: {
      extraJson: Prisma.JsonValue | null;
      authorName: string | null;
      content: string | null;
      url: string | null;
    };
    themePostContent?: string | null;
    skipPublicProfileFetch?: boolean;
  }
): Promise<ProspectClassification> {
  const skipFetch = context?.skipPublicProfileFetch !== false;
  const scraped = skipFetch
    ? null
    : await tryFetchLinkedInPublicProfileData(candidate.linkedin_url);

  let evidence: ProspectEvidence[] = [];

  const isPostBased =
    candidate.source_types.includes("post_based_candidate") &&
    candidate.post_id != null &&
    candidate.themes_analysis_id != null &&
    context?.post;

  if (isPostBased && context?.post) {
    const { headline: ingestHeadline } = getLinkedInAuthorFromExtraJson(context.post.extraJson);
    evidence = gatherEvidenceFromPostRow({
      extraJson: context.post.extraJson,
      authorName: context.post.authorName ?? candidate.display_name,
      content: context.post.content,
      url: context.post.url,
      platform: candidate.platform ?? "linkedin",
      themePostContent: context.themePostContent ?? null,
      postUrlFromTheme: candidate.post_url,
    });
    evidence = mergePublicProfileScrapeEvidence(evidence, scraped);
    if (candidate.headline && !ingestHeadline) {
      evidence.push({
        source: "linkedin_author_headline",
        sourceUrl: candidate.linkedin_url,
        rawText: candidate.headline,
        extractedSignals: ["headline"],
        confidence: 0.45,
        observedAt: new Date().toISOString(),
        metadata: { analysisMethod: "campaign_candidate_headline" },
      });
    }
  } else {
    evidence = buildCompanySearchEvidence(candidate);
    evidence = mergePublicProfileScrapeEvidence(evidence, scraped);
  }

  const pe = await loadPersonEmploymentByLinkedInUrl(prisma, candidate.linkedin_url);
  if (pe?.experienceRoles.length) {
    evidence.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: pe.experienceRoles
        .slice(0, 8)
        .map((r) => `${r.title} @ ${r.company}`)
        .join("; "),
      extractedSignals: ["profile_experience"],
      confidence: 0.8,
      observedAt: new Date().toISOString(),
      metadata: { analysisMethod: "cached_person_employment" },
    });
  }

  const competitorPatterns = await loadCompetitorPatternsForProject(projectId);

  return classifyProspectDeterministic(evidence, {
    linkedinUrl: candidate.linkedin_url,
    name: candidate.display_name ?? undefined,
    competitorPatterns,
  });
}

/** @deprecated Use classifyCampaignCandidateReadOnly */
export async function classifyPostBasedCandidateReadOnly(
  projectId: string,
  candidate: PostBasedCampaignCandidate,
  post: {
    extraJson: Prisma.JsonValue | null;
    authorName: string | null;
    content: string | null;
    url: string | null;
  },
  themePostContent: string | null,
  options?: { skipPublicProfileFetch?: boolean }
): Promise<ProspectClassification> {
  const unified: CampaignCandidate = {
    linkedin_url: candidate.linkedin_url,
    linkedin_url_normalized: candidate.linkedin_url,
    first_name: candidate.first_name,
    last_name: candidate.last_name,
    display_name: candidate.display_name,
    headline: candidate.headline,
    current_title: null,
    current_company: null,
    location: null,
    employment_source: "unknown",
    source_types: ["post_based_candidate"],
    first_source_type: "post_based_candidate",
    source_count: 1,
    source_company_url: null,
    source_role_group: null,
    source_job_title_query: null,
    raw_source: "themes_analysis",
    relevance_score: candidate.relevance_score,
    theme_name: candidate.theme_name,
    post_url: candidate.post_url,
    total_reactions: candidate.total_reactions,
    themes_analysis_id: candidate.themes_analysis_id,
    post_id: candidate.post_id,
    platform: candidate.platform,
  };

  return classifyCampaignCandidateReadOnly(projectId, unified, {
    post,
    themePostContent,
    skipPublicProfileFetch: options?.skipPublicProfileFetch,
  });
}
