import type { AppPrismaClient } from "@/lib/prisma";
import type { ProfileExperienceRole } from "./profile-experience-types";
import { extractProfileExperienceRolesFromExtraJson } from "./extract-profile-experience";
import { isPlaceholderEmploymentValue } from "./sanitize-employment-placeholders";
import {
  inferExperienceItemSourceFromAnalysisMethod,
  parseAnalysisMethodFromMetadata,
  validateProfileExperienceRoles,
} from "./validate-profile-experience";

/** Persist OpenAI/browser extraction roles on PersonEmployment.validation_metadata. */
export function buildPersonEmploymentValidationMetadata(args: {
  analysisMethod?: string;
  confidence?: string;
  error?: string;
  previousTitle?: string | null;
  previousCompany?: string | null;
  experienceItems?: ProfileExperienceRole[] | Array<Record<string, unknown>>;
}): string {
  return JSON.stringify({
    analysisMethod: args.analysisMethod,
    confidence: args.confidence,
    error: args.error,
    previousTitle: args.previousTitle ?? null,
    previousCompany: args.previousCompany ?? null,
    experienceItems: args.experienceItems ?? [],
  });
}

function mapRawExperienceItem(o: Record<string, unknown>): ProfileExperienceRole | null {
  const title =
    (typeof o.title === "string" ? o.title : "") ||
    (typeof o.jobTitle === "string" ? o.jobTitle : "");
  const company =
    (typeof o.company === "string" ? o.company : "") ||
    (typeof o.companyName === "string" ? o.companyName : "");
  if (!title && !company) return null;
  if (isPlaceholderEmploymentValue(title) && isPlaceholderEmploymentValue(company)) {
    return null;
  }
  const rawSource = o.experienceItemSource ?? o.experience_item_source;
  const experienceItemSource =
    typeof rawSource === "string"
      ? (rawSource as ProfileExperienceRole["experienceItemSource"])
      : undefined;

  return {
    title: title || company,
    company: company || "",
    startDate: typeof o.startDate === "string" ? o.startDate : null,
    endDate: typeof o.endDate === "string" ? o.endDate : null,
    dateRange: typeof o.dateRange === "string" ? o.dateRange : null,
    isCurrent: o.isCurrent === true,
    experienceItemSource,
    evidenceExcerpt:
      typeof o.evidenceExcerpt === "string"
        ? o.evidenceExcerpt
        : typeof o.evidence_excerpt === "string"
          ? o.evidence_excerpt
          : null,
    itemConfidence:
      typeof o.itemConfidence === "number"
        ? o.itemConfidence
        : typeof o.confidence === "number"
          ? o.confidence
          : undefined,
  };
}

export function parseExperienceItemsFromMetadata(
  raw: string | null | undefined
): ProfileExperienceRole[] {
  if (!raw?.trim()) return [];
  try {
    const j = JSON.parse(raw) as { experienceItems?: unknown[] };
    const items = j.experienceItems;
    if (!Array.isArray(items)) return [];
    const out: ProfileExperienceRole[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const role = mapRawExperienceItem(item as Record<string, unknown>);
      if (role) out.push(role);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge profile experience from post extraJson, PersonEmployment validation metadata,
 * and validated current title/company on the employment record.
 */
export function mergeProfileExperienceRoles(sources: {
  fromExtraJson?: unknown;
  validationMetadata?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  headline?: string | null;
}): ProfileExperienceRole[] {
  const analysisMethod = parseAnalysisMethodFromMetadata(sources.validationMetadata);
  const raw: ProfileExperienceRole[] = [];

  for (const r of extractProfileExperienceRolesFromExtraJson(sources.fromExtraJson)) {
    raw.push({
      ...r,
      experienceItemSource: r.experienceItemSource ?? "scraper_payload_experience_array",
    });
  }
  for (const r of parseExperienceItemsFromMetadata(sources.validationMetadata)) {
    raw.push({
      ...r,
      experienceItemSource:
        r.experienceItemSource ?? inferExperienceItemSourceFromAnalysisMethod(analysisMethod),
    });
  }

  const { roles } = validateProfileExperienceRoles(raw, {
    headline: sources.headline,
    analysisMethod,
  });

  return roles;
}

export async function loadPersonEmploymentByLinkedInUrl(
  prisma: AppPrismaClient,
  profileUrl: string
): Promise<{
  currentTitle: string | null;
  currentCompany: string | null;
  experienceRoles: ProfileExperienceRole[];
} | null> {
  const url = profileUrl.trim();
  if (!url) return null;
  const row = await prisma.personEmployment.findUnique({
    where: { linkedin_url: url },
    select: {
      current_title: true,
      current_company: true,
      validation_metadata: true,
    },
  });
  if (!row) return null;
  return {
    currentTitle: row.current_title,
    currentCompany: row.current_company,
    experienceRoles: mergeProfileExperienceRoles({
      validationMetadata: row.validation_metadata,
      currentTitle: row.current_title,
      currentCompany: row.current_company,
    }),
  };
}
