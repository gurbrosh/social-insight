import type { ProspectEvidence } from "./types";
import type { ProfileExperienceRole } from "./profile-experience-types";
import { PROFILE_EXPERIENCE_ROLES_METADATA_KEY } from "./profile-experience-types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pickRoleFields(o: Record<string, unknown>): ProfileExperienceRole | null {
  const title =
    str(o.title) ||
    str(o.jobTitle) ||
    str(o.position) ||
    str(o.role) ||
    str(o.occupation);
  const company =
    str(o.company) ||
    str(o.companyName) ||
    str(o.organization) ||
    str(o.employer);
  if (!title && !company) return null;
  const dateRange = str(o.dateRange) || str(o.date_range) || str(o.duration) || null;
  const startDate = str(o.startDate) || str(o.start_date) || str(o.startsAt) || null;
  const endDate = str(o.endDate) || str(o.end_date) || str(o.endsAt) || null;
  const isCurrent =
    o.isCurrent === true ||
    o.current === true ||
    o.is_current === true ||
    undefined;
  const rawSource = o.experienceItemSource ?? o.experience_item_source;
  const experienceItemSource =
    typeof rawSource === "string"
      ? (rawSource as ProfileExperienceRole["experienceItemSource"])
      : undefined;

  return {
    title: title || company,
    company: company || "",
    startDate: startDate || null,
    endDate: endDate || null,
    dateRange: dateRange || null,
    location: str(o.location) || str(o.geoLocation) || null,
    description: str(o.description) || str(o.summary) || null,
    isCurrent,
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

function pushRole(out: ProfileExperienceRole[], role: ProfileExperienceRole | null, seen: Set<string>) {
  if (!role) return;
  const title = role.title.trim();
  const company = role.company.trim();
  if (!title && !company) return;
  const key = `${title.toLowerCase()}|${company.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    ...role,
    title: title || company,
    company,
  });
}

function collectRoleArrays(node: unknown, out: ProfileExperienceRole[], seen: Set<string>, depth: number) {
  if (depth > 14 || out.length > 40) return;
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const flat = item as Record<string, unknown>;
        if (Array.isArray(flat.positions)) {
          for (const p of flat.positions) {
            if (p && typeof p === "object") pushRole(out, pickRoleFields(p as Record<string, unknown>), seen);
          }
        }
        pushRole(out, pickRoleFields(flat), seen);
      }
    }
    return;
  }
  const o = node as Record<string, unknown>;
  const arrayKeys = [
    "experience",
    "experiences",
    "positions",
    "profilePositions",
    "profile_positions",
    "workExperience",
    "work_experience",
    "employment",
    "roles",
    "career",
  ];
  for (const k of arrayKeys) {
    const arr = o[k];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === "object") pushRole(out, pickRoleFields(item as Record<string, unknown>), seen);
      }
    }
  }
  if (o.author && typeof o.author === "object") {
    collectRoleArrays(o.author, out, seen, depth + 1);
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") collectRoleArrays(v, out, seen, depth + 1);
  }
}

/** Extract experience roles from LinkedIn post `extraJson` (best-effort; shape varies by scraper). */
export function extractProfileExperienceRolesFromExtraJson(extra: unknown): ProfileExperienceRole[] {
  const out: ProfileExperienceRole[] = [];
  const seen = new Set<string>();
  collectRoleArrays(extra, out, seen, 0);
  return out;
}

export function collectProfileExperienceRolesFromEvidence(
  evidence: ProspectEvidence[]
): ProfileExperienceRole[] {
  const out: ProfileExperienceRole[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    const meta = e.metadata?.[PROFILE_EXPERIENCE_ROLES_METADATA_KEY];
    if (Array.isArray(meta)) {
      for (const item of meta) {
        if (item && typeof item === "object") {
          pushRole(out, pickRoleFields(item as Record<string, unknown>), seen);
        }
      }
    }
    if (e.source === "linkedin_profile_experience" && e.rawText) {
      try {
        const parsed = JSON.parse(e.rawText) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object") {
              pushRole(out, pickRoleFields(item as Record<string, unknown>), seen);
            }
          }
        }
      } catch {
        /* rawText may be human summary */
      }
    }
  }
  return out;
}

export type StructuredProfileEmployment = {
  title: string;
  company: string;
};

/** Title/company from public profile scrape or structured metadata (not headline marketing copy). */
export function extractStructuredProfileEmploymentFromEvidence(
  evidence: ProspectEvidence[]
): StructuredProfileEmployment | null {
  for (const e of evidence) {
    const meta = e.metadata;
    if (meta && typeof meta === "object") {
      const t = str(meta.currentTitle) || str(meta.title);
      const c = str(meta.currentCompany) || str(meta.company);
      if (t && c && !looksLikeHeadlineMarketingLine(`${t} · ${c}`)) {
        return { title: t, company: c };
      }
    }
    if (e.source === "public_profile_fetch" && e.rawText.includes("·")) {
      const parts = e.rawText.split("·").map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return { title: parts[0]!, company: parts[1]! };
      }
    }
  }
  return null;
}

function looksLikeHeadlineMarketingLine(line: string): boolean {
  return line.length > 160 || (line.match(/\|/g) ?? []).length >= 2;
}
