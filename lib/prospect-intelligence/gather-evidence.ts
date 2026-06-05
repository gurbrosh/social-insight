import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { LinkedInPublicProfileScrape } from "@/lib/linkedin-prospects-csv/fetch-linkedin-public-profile";
import type { EvidenceSource, ProspectEvidence } from "./types";
import { extractProfileExperienceRolesFromExtraJson } from "./extract-profile-experience";
import {
  PROFILE_EXPERIENCE_ANALYSIS_METHOD_METADATA_KEY,
  PROFILE_EXPERIENCE_ROLES_METADATA_KEY,
  type ProfileExperienceRole,
} from "./profile-experience-types";
import {
  extractLinkedInBadgeUiStrings,
  extractLinkedInSupplementaryEvidenceText,
  getLinkedInAuthorFromExtraJson,
} from "@/lib/linkedin-prospects-csv/extra-json";

export function evidenceContentHash(source: EvidenceSource, rawText: string, sourceUrl?: string): string {
  const h = createHash("sha256");
  h.update(source);
  h.update("\0");
  h.update(sourceUrl ?? "");
  h.update("\0");
  h.update(rawText);
  return h.digest("hex").slice(0, 32);
}

export type GatherEvidenceParams = {
  headline: string | null | undefined;
  authorDisplayName: string | null | undefined;
  postContent: string | null | undefined;
  postUrl: string | null | undefined;
  platform: string;
  /** PersonEmployment or similar — stored as weak DB evidence */
  existingDbLine?: string | null;
  publicProfileFetchText?: string | null;
  /** Pre-parsed profile experience rows (e.g. golden eval or enrichment). */
  profileExperienceRoles?: ProfileExperienceRole[];
  /** PersonEmployment.validation_metadata.analysisMethod for provenance validation. */
  profileExperienceAnalysisMethod?: string | null;
};

/**
 * Build in-memory evidence items (no DB). Timestamps use ISO "now" unless overridden.
 */
export function gatherProspectEvidence(params: GatherEvidenceParams, observedAt = new Date()): ProspectEvidence[] {
  const iso = observedAt.toISOString();
  const out: ProspectEvidence[] = [];

  if (params.headline?.trim()) {
    out.push({
      source: "linkedin_author_headline",
      sourceUrl: params.postUrl ?? undefined,
      rawText: params.headline.trim(),
      extractedSignals: [],
      confidence: 0.85,
      observedAt: iso,
    });
  }

  if (params.authorDisplayName?.trim()) {
    out.push({
      source: "linkedin_author_metadata",
      sourceUrl: params.postUrl ?? undefined,
      rawText: params.authorDisplayName.trim(),
      extractedSignals: ["display_name"],
      confidence: 0.8,
      observedAt: iso,
    });
  }

  if (params.postContent?.trim()) {
    const isComment = Boolean(params.postUrl?.includes("/comments/") || params.postUrl?.includes("comment"));
    out.push({
      source: isComment ? "source_comment_text" : "source_post_text",
      sourceUrl: params.postUrl ?? undefined,
      rawText: params.postContent.trim().slice(0, 8000),
      extractedSignals: [],
      confidence: 0.75,
      observedAt: iso,
    });
  }

  if (params.existingDbLine?.trim()) {
    out.push({
      source: "existing_db_record",
      rawText: params.existingDbLine.trim(),
      extractedSignals: ["legacy_employment_record"],
      confidence: 0.45,
      observedAt: iso,
      metadata: { note: "Treat as hint only; verify with stronger evidence." },
    });
  }

  if (params.publicProfileFetchText?.trim()) {
    out.push({
      source: "public_profile_fetch",
      rawText: params.publicProfileFetchText.trim().slice(0, 6000),
      extractedSignals: [],
      confidence: 0.55,
      observedAt: iso,
    });
  }

  if (params.profileExperienceRoles?.length) {
    out.push({
      source: "linkedin_profile_experience",
      rawText: JSON.stringify(params.profileExperienceRoles).slice(0, 8000),
      extractedSignals: ["profile_experience_roles"],
      confidence: 0.9,
      observedAt: iso,
      metadata: {
        [PROFILE_EXPERIENCE_ROLES_METADATA_KEY]: params.profileExperienceRoles,
        ...(params.profileExperienceAnalysisMethod?.trim()
          ? {
              [PROFILE_EXPERIENCE_ANALYSIS_METHOD_METADATA_KEY]:
                params.profileExperienceAnalysisMethod.trim(),
            }
          : {}),
      },
    });
  }

  return out;
}

/** From Post row + ThemesAnalysis row fields. */
export function gatherEvidenceFromPostRow(params: {
  extraJson: Prisma.JsonValue | null;
  authorName: string | null;
  content: string | null;
  url: string | null;
  platform: string;
  themePostContent: string | null;
  postUrlFromTheme: string | null;
  /** Merged experience roles (extraJson + PersonEmployment / enrichment). */
  profileExperienceRoles?: ProfileExperienceRole[];
  profileExperienceAnalysisMethod?: string | null;
}): ProspectEvidence[] {
  const { profileUrl, headline } = getLinkedInAuthorFromExtraJson(params.extraJson);
  const head = headline ?? "";
  const postText = (params.content ?? params.themePostContent ?? "").trim();
  const url = params.url ?? params.postUrlFromTheme ?? profileUrl ?? null;
  const fromExtra = extractProfileExperienceRolesFromExtraJson(params.extraJson);
  const mergedRoles = params.profileExperienceRoles?.length
    ? params.profileExperienceRoles
    : fromExtra;
  const base = gatherProspectEvidence({
    headline: head || null,
    authorDisplayName: params.authorName,
    postContent: postText || null,
    postUrl: url,
    platform: params.platform,
    profileExperienceRoles: mergedRoles.length ? mergedRoles : undefined,
    profileExperienceAnalysisMethod: params.profileExperienceAnalysisMethod,
  });
  const supplement = extractLinkedInSupplementaryEvidenceText(params.extraJson).trim();
  if (!supplement) return base;
  const iso = new Date().toISOString();
  return [
    ...base,
    {
      source: "linkedin_extra_json" as const,
      sourceUrl: url ?? undefined,
      rawText: supplement.slice(0, 8000),
      extractedSignals: ["linkedin_extra_json_strings"],
      confidence: 0.5,
      observedAt: iso,
      metadata: {
        linkedinBadgeUiStrings: extractLinkedInBadgeUiStrings(params.extraJson),
      },
    },
  ];
}

export function mergePublicProfileScrapeEvidence(
  base: ProspectEvidence[],
  scraped: LinkedInPublicProfileScrape | null,
  observedAt = new Date()
): ProspectEvidence[] {
  if (!scraped || (!scraped.title && !scraped.company)) return base;
  const iso = observedAt.toISOString();
  const line = [scraped.title, scraped.company].filter(Boolean).join(" · ");
  if (!line.trim()) return base;
  return [
    ...base,
    {
      source: "public_profile_fetch" as const,
      rawText: line.slice(0, 2000),
      extractedSignals: ["public_profile_scrape"],
      confidence: 0.45,
      observedAt: iso,
      metadata: {
        currentTitle: scraped.title?.trim() || undefined,
        currentCompany: scraped.company?.trim() || undefined,
      },
    },
  ];
}
