import type { ProfileExperienceRole } from "./profile-experience-types";
import { validateProfileExperienceRoles } from "./validate-profile-experience";

/** Stored on PersonEmployment.validation_metadata.enrichmentStatus */
export type EnrichmentStatusSemantic =
  | "roles_found"
  | "no_roles_found"
  | "headline_only"
  | "cached_headline_only"
  | "blocked"
  | "unavailable"
  | "failed";

export function countValidatedExperienceRoles(
  roles: ProfileExperienceRole[],
  opts?: { headline?: string | null; analysisMethod?: string }
): {
  rawCount: number;
  validCount: number;
  rejectedCount: number;
  rejectionReasons: string[];
} {
  const rawCount = roles.length;
  const { roles: valid, rejectedCount, rejectionReasons } = validateProfileExperienceRoles(
    roles,
    opts
  );
  return {
    rawCount,
    validCount: valid.length,
    rejectedCount,
    rejectionReasons,
  };
}

/** Map legacy DB values to semantic status for display. */
export function normalizeEnrichmentStatusDisplay(
  stored: string | undefined,
  opts: {
    rawExperienceCount: number;
    validExperienceCount: number;
    analysisMethod?: string;
    blocked?: boolean;
    headlineFallback?: boolean;
  }
): EnrichmentStatusSemantic {
  const s = (stored ?? "").toLowerCase();
  if (opts.blocked) return "blocked";
  if (opts.headlineFallback) return "headline_only";
  if (opts.validExperienceCount > 0) return "roles_found";
  if (opts.rawExperienceCount > 0) {
    if (/openai|url|headline|model/.test(opts.analysisMethod ?? "")) {
      return "cached_headline_only";
    }
    return "no_roles_found";
  }
  if (s === "blocked") return "blocked";
  if (s === "headline_fallback" || s === "headline_only") return "headline_only";
  if (s === "success" || s === "roles_found") {
    return opts.validExperienceCount > 0 ? "roles_found" : "cached_headline_only";
  }
  if (s === "no_data" || s === "no_roles_found") return "no_roles_found";
  if (s === "profile_unavailable" || s === "unavailable") return "unavailable";
  if (s === "failed" || s === "api_error" || s === "error") return "failed";
  if (opts.rawExperienceCount === 0 && !stored) return "unavailable";
  return "no_roles_found";
}

export function enrichmentAttemptedForStatus(status: EnrichmentStatusSemantic): boolean {
  return status !== "unavailable";
}

export function enrichmentSucceededWithRoles(status: EnrichmentStatusSemantic): boolean {
  return status === "roles_found";
}
