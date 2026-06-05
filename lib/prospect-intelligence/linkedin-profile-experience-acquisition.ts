import type { AppPrismaClient } from "@/lib/prisma";
import { ulid } from "ulid";
import { apifyService } from "@/lib/apify-service";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import type { ProfileExperienceRole } from "./profile-experience-types";
import type { EnrichmentStatusSemantic } from "./enrichment-status";
import { countValidatedExperienceRoles } from "./enrichment-status";
import {
  extractExperienceRolesFromProfileHtml,
  fetchPublicProfileHtmlForProbe,
} from "./probe-profile-experience-sources";
import { buildPersonEmploymentValidationMetadata } from "./load-profile-employment";
import { resolveProspectEmployment } from "./resolve-employment";
import type { ResolvedEmploymentSnapshot } from "./profile-experience-types";
import { validateProfileExperienceRoles } from "./validate-profile-experience";

export type ProfileExperienceAcquisitionSource =
  | "scraper_payload_experience_array"
  | "public_profile_html_experience_section"
  | "validation_profile_experience_text"
  | "none";

export type ProfileExperienceAcquisitionResult = {
  profileUrl: string;
  sourceUsed: ProfileExperienceAcquisitionSource;
  profileFetchStatus: string;
  structuredExperienceArrayFound: boolean;
  rawRoles: ProfileExperienceRole[];
  validRoles: ProfileExperienceRole[];
  rejectedCount: number;
  rejectionReasons: string[];
  analysisMethod: string;
  acquisitionCostEstimateUsd: number | null;
  enrichmentStatus: EnrichmentStatusSemantic;
  resolved: ResolvedEmploymentSnapshot | null;
  error?: string;
  evidenceExcerpt: string | null;
};

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseApifyPosition(o: Record<string, unknown>): ProfileExperienceRole | null {
  const title =
    normStr(o.title) ||
    normStr(o.jobTitle) ||
    normStr(o.position) ||
    normStr(o.role);
  const company =
    normStr(o.company) ||
    normStr(o.companyName) ||
    normStr(o.organization) ||
    normStr(o.employer);
  if (!title && !company) return null;

  const startDate = normStr(o.startDate) || normStr(o.start_date) || normStr(o.startsAt) || null;
  const endDate = normStr(o.endDate) || normStr(o.end_date) || normStr(o.endsAt) || null;
  const dateRange =
    normStr(o.dateRange) ||
    normStr(o.date_range) ||
    normStr(o.duration) ||
    (startDate || endDate ? [startDate, endDate].filter(Boolean).join(" – ") : null);

  const isCurrent =
    o.isCurrent === true ||
    o.current === true ||
    (!endDate && Boolean(title || company));

  const description = normStr(o.description) || normStr(o.summary) || null;
  const excerpt = [
    "Apify profile scrape (Experience section)",
    title && company ? `${title} @ ${company}` : title || company,
    dateRange,
    description?.slice(0, 200),
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    title: title || company,
    company: company || "",
    startDate,
    endDate,
    dateRange,
    isCurrent,
    description,
    experienceItemSource: "scraper_payload_experience_array",
    evidenceExcerpt: excerpt.slice(0, 500),
    itemConfidence: 0.85,
  };
}

/** Normalize common Apify LinkedIn profile actor output shapes to experience roles. */
export function normalizeApifyProfileItemToExperienceRoles(
  item: Record<string, unknown>
): ProfileExperienceRole[] {
  const candidates: unknown[] = [];
  const keys = [
    "experience",
    "experiences",
    "positions",
    "workExperience",
    "work_experience",
    "employment",
    "jobs",
  ];
  for (const k of keys) {
    const v = item[k];
    if (Array.isArray(v)) candidates.push(...v);
  }
  const nested = item.profile;
  if (nested && typeof nested === "object") {
    for (const k of keys) {
      const v = (nested as Record<string, unknown>)[k];
      if (Array.isArray(v)) candidates.push(...v);
    }
  }

  const out: ProfileExperienceRole[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const role = parseApifyPosition(c as Record<string, unknown>);
    if (!role) continue;
    const key = `${role.title}|${role.company}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out;
}

function apifyActorConfigured(): boolean {
  return Boolean(
    process.env.APIFY_API_TOKEN?.trim() && process.env.LINKEDIN_PROFILE_EXPERIENCE_APIFY_ACTOR_ID?.trim()
  );
}

function costPerProfileUsd(): number | null {
  const raw = process.env.LINKEDIN_PROFILE_EXPERIENCE_COST_PER_PROFILE_USD?.trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

async function acquireViaApify(profileUrl: string): Promise<{
  roles: ProfileExperienceRole[];
  profileFetchStatus: string;
  structuredFound: boolean;
  analysisMethod: string;
  costUsd: number | null;
  error?: string;
}> {
  const actorId = process.env.LINKEDIN_PROFILE_EXPERIENCE_APIFY_ACTOR_ID!.trim();
  const urlVariants = [profileUrl];
  const normalized = normalizePublicProfileUrl(profileUrl);
  if (normalized && normalized !== profileUrl) urlVariants.push(normalized);

  const inputAttempts: Record<string, unknown>[] = [
    { profileUrls: urlVariants },
    { urls: urlVariants },
    { startUrls: urlVariants.map((url) => ({ url })) },
  ];

  let lastError: string | undefined;
  for (const input of inputAttempts) {
    try {
      const run = await apifyService.runScraperSync(actorId, input, "linkedin");
      const datasetId = run.defaultDatasetId;
      if (!datasetId) {
        lastError = "Apify run completed without dataset";
        continue;
      }
      const items = await apifyService.getDatasetItems(datasetId);
      if (!items.length) {
        lastError = "Apify dataset empty";
        continue;
      }
      const first = items[0] as Record<string, unknown>;
      const roles = normalizeApifyProfileItemToExperienceRoles(first);
      return {
        roles,
        profileFetchStatus: run.status === "SUCCEEDED" ? "apify_ok" : String(run.status ?? "unknown"),
        structuredFound: roles.length > 0,
        analysisMethod: "apify_profile_scraper",
        costUsd: costPerProfileUsd(),
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    roles: [],
    profileFetchStatus: "apify_failed",
    structuredFound: false,
    analysisMethod: "apify_profile_scraper",
    costUsd: costPerProfileUsd(),
    error: lastError,
  };
}

async function acquireViaPublicHtml(profileUrl: string): Promise<{
  roles: ProfileExperienceRole[];
  profileFetchStatus: string;
  structuredFound: boolean;
  analysisMethod: string;
}> {
  const { html, status } = await fetchPublicProfileHtmlForProbe(profileUrl);
  if (!html) {
    return {
      roles: [],
      profileFetchStatus: status,
      structuredFound: false,
      analysisMethod: "public_profile_html",
    };
  }
  const roles = extractExperienceRolesFromProfileHtml(html);
  return {
    roles,
    profileFetchStatus: status === "ok" ? "html_ok" : status,
    structuredFound: roles.length > 0,
    analysisMethod: "public_profile_html_embed",
  };
}

export function parseAcquisitionProviders(): Array<"apify" | "html"> {
  const raw = (process.env.LINKEDIN_PROFILE_EXPERIENCE_PROVIDER ?? "apify,html")
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Array<"apify" | "html"> = [];
  for (const p of raw) {
    if (p === "apify" && apifyActorConfigured() && !out.includes("apify")) out.push("apify");
    if ((p === "html" || p === "public_html") && !out.includes("html")) out.push("html");
  }
  if (out.length === 0 && apifyActorConfigured()) out.push("apify");
  if (out.length === 0) out.push("html");
  return out;
}

/**
 * Acquire experience roles from real profile sources only (no OpenAI/headline inference).
 */
export async function acquireLinkedInProfileExperience(args: {
  profileUrl: string;
  headline?: string | null;
  providers?: Array<"apify" | "html">;
}): Promise<ProfileExperienceAcquisitionResult> {
  const profileUrl = normalizePublicProfileUrl(args.profileUrl) ?? args.profileUrl.trim();
  const providers = args.providers ?? parseAcquisitionProviders();

  let rawRoles: ProfileExperienceRole[] = [];
  let sourceUsed: ProfileExperienceAcquisitionSource = "none";
  let profileFetchStatus = "not_attempted";
  let structuredFound = false;
  let analysisMethod = "none";
  let costUsd: number | null = null;
  let error: string | undefined;

  for (const provider of providers) {
    if (provider === "apify") {
      const apify = await acquireViaApify(profileUrl);
      profileFetchStatus = apify.profileFetchStatus;
      analysisMethod = apify.analysisMethod;
      costUsd = apify.costUsd;
      error = apify.error;
      if (apify.roles.length > 0) {
        rawRoles = apify.roles;
        sourceUsed = "scraper_payload_experience_array";
        structuredFound = apify.structuredFound;
        break;
      }
    } else if (provider === "html") {
      const html = await acquireViaPublicHtml(profileUrl);
      profileFetchStatus = html.profileFetchStatus;
      analysisMethod = html.analysisMethod;
      if (html.roles.length > 0) {
        rawRoles = html.roles;
        sourceUsed = "public_profile_html_experience_section";
        structuredFound = html.structuredFound;
        break;
      }
    }
  }

  const validated = validateProfileExperienceRoles(rawRoles, {
    headline: args.headline,
    analysisMethod,
  });

  let enrichmentStatus: EnrichmentStatusSemantic;
  if (validated.roles.length > 0) {
    enrichmentStatus = "roles_found";
  } else if (rawRoles.length > 0) {
    enrichmentStatus = "no_roles_found";
  } else if (profileFetchStatus === "auth_wall" || profileFetchStatus === "blocked") {
    enrichmentStatus = "blocked";
  } else if (profileFetchStatus === "apify_failed" || profileFetchStatus === "timeout") {
    enrichmentStatus = "failed";
  } else {
    enrichmentStatus = "unavailable";
  }

  const resolved =
    validated.roles.length > 0
      ? resolveProspectEmployment({
          experienceRoles: validated.roles,
          structuredProfile: null,
          headlineEmployment: null,
          headlineAmbiguous: true,
        })
      : null;

  return {
    profileUrl,
    sourceUsed,
    profileFetchStatus,
    structuredExperienceArrayFound: structuredFound,
    rawRoles,
    validRoles: validated.roles,
    rejectedCount: validated.rejectedCount,
    rejectionReasons: validated.rejectionReasons,
    analysisMethod,
    acquisitionCostEstimateUsd: costUsd,
    enrichmentStatus,
    resolved: resolved
      ? {
          current_title: resolved.currentTitle,
          current_company: resolved.currentCompany,
          past_title: resolved.pastTitle,
          past_company: resolved.pastCompany,
          current_roles: resolved.currentRoles,
          past_roles: resolved.pastRoles,
          employment_source: resolved.employmentSource,
          employment_confidence: resolved.employmentConfidence,
          employment_reason: resolved.employmentReason,
        }
      : null,
    error,
    evidenceExcerpt: validated.roles[0]?.evidenceExcerpt ?? null,
  };
}

export async function persistProfileExperienceAcquisition(
  prisma: AppPrismaClient,
  acquisition: ProfileExperienceAcquisitionResult,
  opts?: { name?: string | null }
): Promise<void> {
  const url = acquisition.profileUrl;
  const existing = await prisma.personEmployment.findUnique({ where: { linkedin_url: url } });

  const metadata = buildPersonEmploymentValidationMetadata({
    analysisMethod: acquisition.analysisMethod,
    confidence:
      acquisition.resolved && acquisition.resolved.employment_confidence >= 0.7
        ? "high"
        : acquisition.resolved && acquisition.resolved.employment_confidence >= 0.4
          ? "medium"
          : "low",
    error: acquisition.error,
    experienceItems: acquisition.rawRoles,
  });

  const metaObj = JSON.parse(metadata) as Record<string, unknown>;
  metaObj.enrichmentStatus = acquisition.enrichmentStatus;
  metaObj.acquisitionSource = acquisition.sourceUsed;
  metaObj.fetchedAt = new Date().toISOString();
  metaObj.acquisitionCostEstimateUsd = acquisition.acquisitionCostEstimateUsd;
  metaObj.profileFetchStatus = acquisition.profileFetchStatus;
  if (acquisition.resolved) {
    metaObj.resolvedEmployment = acquisition.resolved;
  }

  const data = {
    name: opts?.name ?? existing?.name ?? null,
    current_title: acquisition.resolved?.current_title ?? null,
    current_company: acquisition.resolved?.current_company ?? null,
    validation_status:
      acquisition.enrichmentStatus === "roles_found" ? "employment_enriched" : "unknown",
    last_validated_at: new Date(),
    validation_metadata: JSON.stringify(metaObj),
  };

  if (existing) {
    await prisma.personEmployment.update({ where: { id: existing.id }, data });
  } else {
    await prisma.personEmployment.create({
      data: { id: ulid(), linkedin_url: url, ...data },
    });
  }
}
