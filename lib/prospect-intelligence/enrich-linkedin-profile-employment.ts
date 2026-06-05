import type { AppPrismaClient } from "@/lib/prisma";
import { ulid } from "ulid";
import {
  analyzeLinkedInProfileWithOpenAI,
  extractLinkedInProfileData,
} from "@/lib/linkedin-profile-validator";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { titleAndCompanyFromHeadline } from "@/lib/linkedin-prospects-csv/row-text";
import {
  buildPersonEmploymentValidationMetadata,
  parseExperienceItemsFromMetadata,
} from "./load-profile-employment";
import type {
  ExperienceItemSource,
  ProfileExperienceRole,
  ResolvedEmploymentSnapshot,
} from "./profile-experience-types";
import { resolveProspectEmployment } from "./resolve-employment";
import {
  countValidatedExperienceRoles,
  type EnrichmentStatusSemantic,
} from "./enrichment-status";
import {
  inferExperienceItemSourceFromAnalysisMethod,
  parseAnalysisMethodFromMetadata,
  validateProfileExperienceRoles,
} from "./validate-profile-experience";

export type EnrichmentStatus =
  | "success"
  | "already_enriched"
  | "no_data"
  | "headline_fallback"
  | "blocked"
  | "api_error"
  | "skipped_dry_run";

export type { ResolvedEmploymentSnapshot } from "./profile-experience-types";

export type ProfileEmploymentEnrichmentResult = {
  profileUrl: string;
  status: EnrichmentStatus;
  experienceItemCount: number;
  experienceRoles: ProfileExperienceRole[];
  resolved: ResolvedEmploymentSnapshot | null;
  error?: string;
  analysisMethod?: string;
  /** Set when enrichment used real profile acquisition (Apify/HTML). */
  acquisition?: import("./linkedin-profile-experience-acquisition").ProfileExperienceAcquisitionResult;
};

export type EnrichBatchSummary = {
  total: number;
  alreadyEnriched: number;
  enrichedSuccessfully: number;
  headlineFallback: number;
  noData: number;
  blocked: number;
  apiErrors: number;
  skippedDryRun: number;
  results: ProfileEmploymentEnrichmentResult[];
};

type RawExperienceItem = {
  company?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  dateRange?: string;
  isCurrent?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function applyResultToSummary(
  summary: EnrichBatchSummary,
  result: ProfileEmploymentEnrichmentResult
): void {
  summary.results.push(result);
  switch (result.status) {
    case "already_enriched":
      summary.alreadyEnriched++;
      break;
    case "success":
      summary.enrichedSuccessfully++;
      break;
    case "headline_fallback":
      summary.headlineFallback++;
      break;
    case "no_data":
      summary.noData++;
      break;
    case "blocked":
      summary.blocked++;
      break;
    case "api_error":
      summary.apiErrors++;
      break;
    case "skipped_dry_run":
      summary.skippedDryRun++;
      break;
  }
}

export function mapRawExperienceItemsToRoles(
  items: RawExperienceItem[] | undefined,
  experienceItemSource: ExperienceItemSource,
  opts?: { evidencePrefix?: string }
): ProfileExperienceRole[] {
  if (!items?.length) return [];
  const out: ProfileExperienceRole[] = [];
  for (const item of items) {
    const title = (item.title ?? "").trim();
    const company = (item.company ?? "").trim();
    if (!title && !company) continue;
    const excerptParts = [opts?.evidencePrefix, title, company, item.dateRange].filter(Boolean);
    out.push({
      title: title || company,
      company: company || "",
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      dateRange: item.dateRange ?? null,
      isCurrent: item.isCurrent === true,
      experienceItemSource,
      evidenceExcerpt: excerptParts.join(" — ").slice(0, 500),
      itemConfidence:
        experienceItemSource === "model_generated_from_headline" ||
        experienceItemSource === "llm_inferred_from_headline"
          ? 0.35
          : 0.72,
    });
  }
  return out;
}

/** Headline-only path when OpenAI/profile extraction returns no experience items. */
export function resolveEmploymentFromHeadlineHint(
  headline: string
): ResolvedEmploymentSnapshot | null {
  const h = headline.trim();
  if (!h) return null;
  const { title, company } = titleAndCompanyFromHeadline(h);
  if (!title) return null;

  const resolved = resolveProspectEmployment({
    experienceRoles: [],
    structuredProfile: null,
    headlineEmployment: company
      ? { title, company, confidence: 0.52 }
      : null,
    headlineAmbiguous: !company,
    headlineEmploymentCandidate: !company ? { title, company: "" } : null,
  });

  return {
    current_title: resolved.currentTitle,
    current_company: resolved.currentCompany,
    past_title: resolved.pastTitle,
    past_company: resolved.pastCompany,
    current_roles: resolved.currentRoles,
    past_roles: resolved.pastRoles,
    employment_source: resolved.employmentSource,
    employment_confidence: resolved.employmentConfidence,
    employment_reason: resolved.employmentReason,
  };
}

export function resolveEmploymentFromExperienceRoles(
  roles: ProfileExperienceRole[]
): ResolvedEmploymentSnapshot {
  const resolved = resolveProspectEmployment({
    experienceRoles: roles,
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: true,
    headlineEmploymentCandidate: null,
  });
  return {
    current_title: resolved.currentTitle,
    current_company: resolved.currentCompany,
    past_title: resolved.pastTitle,
    past_company: resolved.pastCompany,
    current_roles: resolved.currentRoles,
    past_roles: resolved.pastRoles,
    employment_source: resolved.employmentSource,
    employment_confidence: resolved.employmentConfidence,
    employment_reason: resolved.employmentReason,
  };
}

export function parseEnrichmentMetadata(raw: string | null | undefined): {
  experienceItems: ProfileExperienceRole[];
  enrichmentStatus?: string;
  resolvedEmployment?: ResolvedEmploymentSnapshot;
  enrichedAt?: string;
} {
  if (!raw?.trim()) {
    return { experienceItems: [] };
  }
  try {
    const j = JSON.parse(raw) as {
      enrichmentStatus?: string;
      resolvedEmployment?: ResolvedEmploymentSnapshot;
      enrichedAt?: string;
    };
    return {
      experienceItems: parseExperienceItemsFromMetadata(raw),
      enrichmentStatus: j.enrichmentStatus,
      resolvedEmployment: j.resolvedEmployment,
      enrichedAt: j.enrichedAt,
    };
  } catch {
    return { experienceItems: [] };
  }
}

export function hasValidStoredExperience(
  validationMetadata: string | null | undefined,
  forceRefresh: boolean,
  headlineHint?: string | null
): boolean {
  if (forceRefresh) return false;
  const parsed = parseEnrichmentMetadata(validationMetadata);
  const analysisMethod = parseAnalysisMethodFromMetadata(validationMetadata);
  const { validCount } = countValidatedExperienceRoles(parsed.experienceItems, {
    headline: headlineHint,
    analysisMethod,
  });
  if (validCount > 0) return true;
  const status = (parsed.enrichmentStatus ?? "").toLowerCase();
  return status === "roles_found";
}

function deriveSemanticEnrichmentStatus(args: {
  blocked?: boolean;
  headlineFallback?: boolean;
  rawRoleCount: number;
  validRoleCount: number;
  profileUnavailable?: boolean;
  failed?: boolean;
}): EnrichmentStatusSemantic {
  if (args.failed) return "failed";
  if (args.blocked) return "blocked";
  if (args.headlineFallback) return "headline_only";
  if (args.profileUnavailable) return "unavailable";
  if (args.validRoleCount > 0) return "roles_found";
  if (args.rawRoleCount > 0) return "cached_headline_only";
  return "no_roles_found";
}

async function fetchPublicProfileHtml(profileUrl: string): Promise<string | null> {
  const u = profileUrl.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  try {
    const res = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 2_000) return null;
    if (/authwall|consent|challenge|login|checkpoint/gi.test(html)) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}

/**
 * OpenAI employment extraction (not org-membership validation).
 * Tries public HTML when enabled; otherwise URL + optional headline hint.
 */
export async function fetchLinkedInEmploymentViaOpenAI(args: {
  profileUrl: string;
  headlineHint?: string | null;
  tryPublicHtml?: boolean;
}): Promise<{
  name?: string;
  experienceItems: ProfileExperienceRole[];
  analysisMethod: string;
  blocked: boolean;
  error?: string;
}> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      experienceItems: [],
      analysisMethod: "error",
      blocked: false,
      error: "OPENAI_API_KEY is not configured",
    };
  }

  let profileHtml: string | undefined;
  if (args.tryPublicHtml !== false) {
    profileHtml = (await fetchPublicProfileHtml(args.profileUrl)) ?? undefined;
    if (!profileHtml) {
      return {
        experienceItems: [],
        analysisMethod: "blocked",
        blocked: true,
        error: "Public profile fetch blocked or unavailable (auth wall); retry with --no-public-html to use OpenAI URL+headline only",
      };
    }
  } else {
    profileHtml = undefined;
  }

  const profileTextParts: string[] = [];
  if (args.headlineHint?.trim()) {
    profileTextParts.push(
      `Headline from post scrape (secondary hint only; prefer Experience section): ${args.headlineHint.trim()}`
    );
  }

  try {
    const analyzed = await analyzeLinkedInProfileWithOpenAI(
      args.profileUrl,
      profileHtml,
      profileTextParts.join("\n") || undefined
    );
    const htmlSource: ExperienceItemSource = "public_profile_html_experience_section";
    const rolesRaw = mapRawExperienceItemsToRoles(analyzed.experienceItems, htmlSource, {
      evidencePrefix: "OpenAI HTML profile parse",
    });
    const { roles } = validateProfileExperienceRoles(rolesRaw, {
      headline: args.headlineHint,
      analysisMethod: "openai_html",
    });
    if (roles.length > 0) {
      return {
        name: analyzed.name,
        experienceItems: roles,
        analysisMethod: "openai_html",
        blocked: false,
      };
    }

    const extracted = await extractLinkedInProfileData(
      args.profileUrl,
      profileTextParts.join("\n") || undefined
    );
    const urlSource: ExperienceItemSource = "model_generated_from_headline";
    const roles2Raw = mapRawExperienceItemsToRoles(extracted.experienceItems, urlSource, {
      evidencePrefix: "OpenAI URL/headline inference (not Experience section)",
    });
    const { roles: roles2 } = validateProfileExperienceRoles(roles2Raw, {
      headline: args.headlineHint,
      analysisMethod: "openai_url",
    });
    return {
      name: extracted.name ?? analyzed.name,
      experienceItems: roles2,
      analysisMethod: roles2.length > 0 ? "openai_url" : "openai_no_experience",
      blocked: false,
      error:
        roles2.length === 0 && roles2Raw.length > 0
          ? "OpenAI returned only placeholder/template experience items"
          : roles2.length === 0
            ? "OpenAI returned no experience items"
            : undefined,
    };
  } catch (e) {
    return {
      experienceItems: [],
      analysisMethod: "error",
      blocked: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function upsertPersonEmploymentEnrichment(
  prisma: AppPrismaClient,
  args: {
    profileUrl: string;
    name?: string | null;
    experienceRoles: ProfileExperienceRole[];
    resolved: ResolvedEmploymentSnapshot;
    analysisMethod: string;
    enrichmentStatus: EnrichmentStatusSemantic;
    error?: string;
  }
): Promise<void> {
  const url = normalizePublicProfileUrl(args.profileUrl) ?? args.profileUrl.trim();
  const existing = await prisma.personEmployment.findUnique({
    where: { linkedin_url: url },
  });

  const metadata = buildPersonEmploymentValidationMetadata({
    analysisMethod: args.analysisMethod,
    confidence:
      args.resolved.employment_confidence >= 0.7
        ? "high"
        : args.resolved.employment_confidence >= 0.4
          ? "medium"
          : "low",
    error: args.error,
    experienceItems: args.experienceRoles,
  });

  const metaObj = JSON.parse(metadata) as Record<string, unknown>;
  metaObj.enrichmentStatus = args.enrichmentStatus;
  metaObj.resolvedEmployment = args.resolved;
  metaObj.enrichedAt = new Date().toISOString();
  const metadataStr = JSON.stringify(metaObj);

  const data = {
    name: args.name ?? existing?.name ?? null,
    current_title: args.resolved.current_title,
    current_company: args.resolved.current_company,
    validation_status:
      args.enrichmentStatus === "roles_found"
        ? "employment_enriched"
        : args.enrichmentStatus === "headline_only"
          ? "headline_fallback"
          : "unknown",
    last_validated_at: new Date(),
    validation_metadata: metadataStr,
  };

  if (existing) {
    await prisma.personEmployment.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.personEmployment.create({
      data: {
        id: ulid(),
        linkedin_url: url,
        ...data,
      },
    });
  }
}

function tryHeadlineFallbackResult(
  profileUrl: string,
  headlineHint: string | null | undefined,
  analysisMethod: string,
  priorError?: string
): ProfileEmploymentEnrichmentResult | null {
  const resolved = headlineHint ? resolveEmploymentFromHeadlineHint(headlineHint) : null;
  if (!resolved) return null;
  const hasEmployer =
    resolved.employment_source === "headline" &&
    Boolean(resolved.current_title?.trim() && resolved.current_company?.trim());
  const hasCandidate =
    Boolean(resolved.current_title?.trim()) &&
    (resolved.employment_source === "unknown" || resolved.employment_source === "headline");
  if (!hasEmployer && !hasCandidate) return null;

  return {
    profileUrl,
    status: "headline_fallback",
    experienceItemCount: 0,
    experienceRoles: [],
    resolved,
    analysisMethod: `${analysisMethod}_headline_fallback`,
    error: priorError,
  };
}

function openAiInferenceAllowed(): boolean {
  return process.env.LINKEDIN_PROFILE_EXPERIENCE_ALLOW_OPENAI_INFERENCE === "1";
}

export async function enrichSingleProfileEmployment(args: {
  profileUrl: string;
  headlineHint?: string | null;
  dryRun?: boolean;
  tryPublicHtml?: boolean;
}): Promise<ProfileEmploymentEnrichmentResult> {
  const url = normalizePublicProfileUrl(args.profileUrl) ?? args.profileUrl.trim();

  if (args.dryRun) {
    return {
      profileUrl: url,
      status: "skipped_dry_run",
      experienceItemCount: 0,
      experienceRoles: [],
      resolved: null,
    };
  }

  if (!openAiInferenceAllowed()) {
    const { acquireLinkedInProfileExperience } = await import(
      "./linkedin-profile-experience-acquisition"
    );
    const providers: Array<"apify" | "html"> | undefined =
      args.tryPublicHtml === false ? ["apify"] : undefined;
    const acquisition = await acquireLinkedInProfileExperience({
      profileUrl: url,
      headline: args.headlineHint,
      providers,
    });

    if (acquisition.validRoles.length > 0 && acquisition.resolved) {
      return {
        profileUrl: url,
        status: "success",
        experienceItemCount: acquisition.validRoles.length,
        experienceRoles: acquisition.validRoles,
        resolved: acquisition.resolved,
        analysisMethod: acquisition.analysisMethod,
        acquisition,
      };
    }

    const headlineFb = tryHeadlineFallbackResult(
      url,
      args.headlineHint,
      acquisition.analysisMethod,
      acquisition.error
    );
    if (headlineFb) return headlineFb;

    const statusMap: Record<string, ProfileEmploymentEnrichmentResult["status"]> = {
      blocked: "blocked",
      failed: "api_error",
      unavailable: "no_data",
      no_roles_found: "no_data",
    };
    return {
      profileUrl: url,
      status: statusMap[acquisition.enrichmentStatus] ?? "no_data",
      experienceItemCount: 0,
      experienceRoles: [],
      resolved: acquisition.resolved,
      error: acquisition.error ?? acquisition.rejectionReasons.slice(0, 2).join("; "),
      analysisMethod: acquisition.analysisMethod,
      acquisition,
    };
  }

  let fetched = await fetchLinkedInEmploymentViaOpenAI({
    profileUrl: url,
    headlineHint: args.headlineHint,
    tryPublicHtml: args.tryPublicHtml,
  });

  if (fetched.blocked && args.tryPublicHtml !== false) {
    fetched = await fetchLinkedInEmploymentViaOpenAI({
      profileUrl: url,
      headlineHint: args.headlineHint,
      tryPublicHtml: false,
    });
    if (!fetched.blocked) {
      fetched.analysisMethod = `${fetched.analysisMethod}_url_fallback`;
    }
  }

  if (fetched.blocked) {
    const headlineFb = tryHeadlineFallbackResult(
      url,
      args.headlineHint,
      fetched.analysisMethod,
      fetched.error
    );
    if (headlineFb) return headlineFb;
    return {
      profileUrl: url,
      status: "blocked",
      experienceItemCount: 0,
      experienceRoles: [],
      resolved: null,
      error: fetched.error,
      analysisMethod: fetched.analysisMethod,
    };
  }

  if (fetched.error && fetched.experienceItems.length === 0) {
    const headlineFb = tryHeadlineFallbackResult(
      url,
      args.headlineHint,
      fetched.analysisMethod,
      fetched.error
    );
    if (headlineFb) return headlineFb;
    return {
      profileUrl: url,
      status: "api_error",
      experienceItemCount: 0,
      experienceRoles: [],
      resolved: null,
      error: fetched.error,
      analysisMethod: fetched.analysisMethod,
    };
  }

  const validated = validateProfileExperienceRoles(fetched.experienceItems, {
    headline: args.headlineHint,
    analysisMethod: fetched.analysisMethod,
  });
  const acceptedRoles = validated.roles;
  const resolved = resolveEmploymentFromExperienceRoles(acceptedRoles);

  if (acceptedRoles.length === 0) {
    const headlineFb = tryHeadlineFallbackResult(
      url,
      args.headlineHint,
      fetched.analysisMethod,
      fetched.error ??
        (fetched.experienceItems.length > 0
          ? validated.rejectionReasons.join("; ")
          : undefined)
    );
    if (headlineFb) return headlineFb;
    return {
      profileUrl: url,
      status: "no_data",
      experienceItemCount: 0,
      experienceRoles: [],
      resolved,
      error:
        fetched.error ??
        (fetched.experienceItems.length > 0
          ? `Raw roles rejected: ${validated.rejectionReasons.slice(0, 2).join("; ")}`
          : undefined),
      analysisMethod: fetched.analysisMethod,
    };
  }

  return {
    profileUrl: url,
    status: "success",
    experienceItemCount: acceptedRoles.length,
    experienceRoles: acceptedRoles,
    resolved,
    analysisMethod: fetched.analysisMethod,
  };
}

async function enrichOneProfileUrl(
  prisma: AppPrismaClient,
  rawUrl: string,
  options: {
    dryRun?: boolean;
    forceRefresh?: boolean;
    tryPublicHtml?: boolean;
    headlineByUrl?: Map<string, string>;
    existingMetadata?: string | null;
  }
): Promise<ProfileEmploymentEnrichmentResult> {
  const url = normalizePublicProfileUrl(rawUrl) ?? rawUrl.trim();
  const headlineHint = options.headlineByUrl?.get(url) ?? options.headlineByUrl?.get(rawUrl);

  if (
    hasValidStoredExperience(
      options.existingMetadata,
      options.forceRefresh ?? false,
      headlineHint
    )
  ) {
    const parsed = parseEnrichmentMetadata(options.existingMetadata);
    return {
      profileUrl: url,
      status: "already_enriched",
      experienceItemCount: parsed.experienceItems.length,
      experienceRoles: parsed.experienceItems,
      resolved: parsed.resolvedEmployment ?? null,
    };
  }
  const result = await enrichSingleProfileEmployment({
    profileUrl: url,
    headlineHint,
    dryRun: options.dryRun,
    tryPublicHtml: options.tryPublicHtml,
  });

  if (!options.dryRun) {
    if (result.acquisition) {
      const { persistProfileExperienceAcquisition } = await import(
        "./linkedin-profile-experience-acquisition"
      );
      await persistProfileExperienceAcquisition(prisma, result.acquisition);
    }
  }

  if (!options.dryRun && result.resolved) {
    const rawRoles =
      result.status === "already_enriched"
        ? parseEnrichmentMetadata(options.existingMetadata).experienceItems
        : result.acquisition?.rawRoles?.length
          ? result.acquisition.rawRoles
          : result.experienceRoles;
    const { validCount, rawCount } = countValidatedExperienceRoles(rawRoles, {
      headline: headlineHint,
      analysisMethod: result.analysisMethod,
    });
    const semanticStatus = deriveSemanticEnrichmentStatus({
      blocked: result.status === "blocked",
      headlineFallback: result.status === "headline_fallback",
      rawRoleCount: rawCount,
      validRoleCount: validCount,
      profileUnavailable: result.status === "no_data",
      failed: result.status === "api_error",
    });

    if (result.acquisition && result.status === "success") {
      // persistProfileExperienceAcquisition already wrote PersonEmployment
    } else if (result.status === "success" || result.status === "already_enriched") {
      await upsertPersonEmploymentEnrichment(prisma, {
        profileUrl: url,
        experienceRoles: result.experienceRoles,
        resolved: result.resolved,
        analysisMethod: result.analysisMethod ?? "openai",
        enrichmentStatus: semanticStatus,
      });
    } else if (result.status === "headline_fallback") {
      await upsertPersonEmploymentEnrichment(prisma, {
        profileUrl: url,
        experienceRoles: [],
        resolved: result.resolved,
        analysisMethod: result.analysisMethod ?? "headline_fallback",
        enrichmentStatus: "headline_only",
        error: result.error,
      });
    } else if (result.resolved) {
      await upsertPersonEmploymentEnrichment(prisma, {
        profileUrl: url,
        experienceRoles: [],
        resolved: result.resolved,
        analysisMethod: result.analysisMethod ?? "unknown",
        enrichmentStatus: semanticStatus,
        error: result.error,
      });
    }
  }

  return result;
}

export async function enrichProfileUrls(
  prisma: AppPrismaClient,
  profileUrls: string[],
  options: {
    dryRun?: boolean;
    forceRefresh?: boolean;
    tryPublicHtml?: boolean;
    /** Parallel OpenAI/profile fetches (default 25). Use 1 for fully sequential. */
    concurrency?: number;
    /** Per-profile delay; defaults to 0 when concurrency > 1, else 600ms. */
    delayMs?: number;
    headlineByUrl?: Map<string, string>;
    onProgress?: (done: number, total: number, last: ProfileEmploymentEnrichmentResult) => void;
  }
): Promise<EnrichBatchSummary> {
  const summary: EnrichBatchSummary = {
    total: profileUrls.length,
    alreadyEnriched: 0,
    enrichedSuccessfully: 0,
    headlineFallback: 0,
    noData: 0,
    blocked: 0,
    apiErrors: 0,
    skippedDryRun: 0,
    results: [],
  };

  if (profileUrls.length === 0) return summary;

  const concurrency = Math.max(1, Math.min(50, options.concurrency ?? 25));
  const delayMs =
    options.delayMs ?? (concurrency > 1 ? 0 : 600);

  const normalizedPairs = profileUrls.map((raw) => ({
    raw,
    url: normalizePublicProfileUrl(raw) ?? raw.trim(),
  }));
  const urlList = normalizedPairs.map((p) => p.url);

  const existingRows = await prisma.personEmployment.findMany({
    where: { linkedin_url: { in: urlList } },
    select: { linkedin_url: true, validation_metadata: true },
  });
  const existingByUrl = new Map(
    existingRows.map((r) => [r.linkedin_url, r.validation_metadata])
  );

  let completed = 0;

  if (concurrency === 1) {
    for (let i = 0; i < normalizedPairs.length; i++) {
      const { raw, url } = normalizedPairs[i]!;
      const result = await enrichOneProfileUrl(prisma, raw, {
        ...options,
        existingMetadata: existingByUrl.get(url) ?? null,
      });
      applyResultToSummary(summary, result);
      completed++;
      options.onProgress?.(completed, profileUrls.length, result);
      if (i < normalizedPairs.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
    return summary;
  }

  const results = await mapWithConcurrency(
    normalizedPairs,
    concurrency,
    async ({ raw, url }) =>
      enrichOneProfileUrl(prisma, raw, {
        ...options,
        existingMetadata: existingByUrl.get(url) ?? null,
      })
  );

  for (const result of results) {
    applyResultToSummary(summary, result);
    completed++;
    options.onProgress?.(completed, profileUrls.length, result);
  }

  return summary;
}
