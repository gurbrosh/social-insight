import type { Prisma } from "@prisma/client";
import { isPlatformAllowedForObjective } from "@/lib/response-generator/platform-allowlist";
import { canonicalSourceKeyForPlatform } from "@/lib/response-objective-sources";

function jsonStringArray(v: Prisma.JsonValue | null | undefined): string[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

export type SourceSkipReason =
  | "platform_unmapped"
  | "include_disabled"
  | "legacy_platform_not_allowed";

export type ResolvedSourceReply = {
  skip: boolean;
  /** Identify as Org — insider voice when true; outsider when false. */
  belongToOrg: boolean;
  /** When skip is true, why (for logs). */
  skipReason?: SourceSkipReason;
  /** Canonical source key when the platform maps (e.g. github); null if unmapped. */
  canonicalSourceKey?: string | null;
};

/**
 * Per-theme-row platform: use source_reply_settings when present; else legacy allowlist + is_org_identified.
 */
export function resolveSourceReplyForThemeRow(
  platform: string,
  objective: {
    source_reply_settings: Prisma.JsonValue | null;
    allowed_sources: Prisma.JsonValue | null;
    excluded_sources: Prisma.JsonValue | null;
    is_org_identified: boolean;
  }
): ResolvedSourceReply {
  const raw = objective.source_reply_settings;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const key = canonicalSourceKeyForPlatform(platform);
    if (!key) {
      return {
        skip: true,
        belongToOrg: false,
        skipReason: "platform_unmapped",
        canonicalSourceKey: null,
      };
    }
    const row = (raw as Record<string, unknown>)[key];
    // Match sourceReplyTableFromObjective: missing per-source keys default to included (not skip).
    // Empty `{}` or partial JSON must not block every platform while the UI shows all sources on.
    const effectiveRow =
      row != null && typeof row === "object" && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : { include: true as const, belongToOrg: true as const };
    const include = Boolean((effectiveRow as { include?: boolean }).include);
    if (!include) {
      return {
        skip: true,
        belongToOrg: false,
        skipReason: "include_disabled",
        canonicalSourceKey: key,
      };
    }
    const legacyOid = Boolean(
      (effectiveRow as { orgIdentifiedInReply?: boolean }).orgIdentifiedInReply
    );
    let b = Boolean((effectiveRow as { belongToOrg?: boolean }).belongToOrg);
    if (legacyOid) {
      b = false;
    } else if (!("belongToOrg" in effectiveRow)) {
      b = true;
    }
    return { skip: false, belongToOrg: b, canonicalSourceKey: key };
  }

  const allowed = jsonStringArray(objective.allowed_sources);
  const excluded = jsonStringArray(objective.excluded_sources);
  const legacyKey = canonicalSourceKeyForPlatform(platform);
  if (!isPlatformAllowedForObjective(platform, allowed, excluded)) {
    return {
      skip: true,
      belongToOrg: false,
      skipReason: "legacy_platform_not_allowed",
      canonicalSourceKey: legacyKey,
    };
  }
  return {
    skip: false,
    belongToOrg: !objective.is_org_identified,
    canonicalSourceKey: legacyKey,
  };
}
