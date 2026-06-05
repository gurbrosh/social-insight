import { getNormalizedPlatformFilter, recordPlatformMatches } from "@/lib/utils/platform";

/**
 * True when the theme row's platform is excluded by objective config.
 */
function matchesExcludedPlatform(
  recordPlatform: string | null | undefined,
  excludedSources: string[] | null | undefined
): boolean {
  if (!excludedSources?.length) return false;
  const excludedSet = getNormalizedPlatformFilter(excludedSources);
  return recordPlatformMatches(recordPlatform, excludedSet);
}

/**
 * Objective allowed/excluded lists:
 * - `allowedSources` null/undefined: no allowlist → all sources (except excluded).
 * - `allowedSources` `[]`: explicit “none” → never allow (e.g. UI unchecked all boxes).
 * - `allowedSources` non-empty: must match allowlist (normalized).
 */
export function isPlatformAllowedForObjective(
  recordPlatform: string | null | undefined,
  allowedSources: string[] | null | undefined,
  excludedSources: string[] | null | undefined
): boolean {
  if (matchesExcludedPlatform(recordPlatform, excludedSources)) {
    return false;
  }
  if (allowedSources === null || allowedSources === undefined) {
    return true;
  }
  if (allowedSources.length === 0) {
    return false;
  }
  const allowed = getNormalizedPlatformFilter(allowedSources);
  return recordPlatformMatches(recordPlatform, allowed);
}
