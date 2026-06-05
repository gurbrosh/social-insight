import type {
  EmploymentRoleRef,
  ProfileExperienceRole,
  ResolvedProspectEmployment,
} from "./profile-experience-types";
import { isFabricatedOrGenericCompany } from "./validate-profile-experience";

/** Template/example strings from enrichment models — never real employers. */
const PLACEHOLDER_LITERALS = [
  "current company name",
  "current company name or null",
  "previous company 1",
  "previous company 2",
  "previous company name",
  "company name 1",
  "company name 2",
  "company a",
  "company b",
  "current job title",
  "previous job title",
  "previous job title 1",
  "previous job title 2",
  "position title",
  "position title or null",
  "job title",
  "job title or null",
  "unknown company",
  "your company",
  "example company",
  "sample company",
];

const PLACEHOLDER_TITLE_PATTERNS = [
  /^current\s+job\s+title$/i,
  /^previous\s+job\s+title(\s+\d+)?$/i,
  /^position\s+title(\s+or\s+null)?$/i,
  /^job\s+title(\s+or\s+null)?$/i,
  /^null$/i,
];

const PLACEHOLDER_COMPANY_PATTERNS = [
  /^current\s+company(\s+name)?(\s+or\s+null)?$/i,
  /^previous\s+company(\s+\d+|\s+name)?$/i,
  /^company\s+name(\s+\d+)?$/i,
  /^company\s+[ab]$/i,
  /^null$/i,
  /^unknown\s+company$/i,
];

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeForPlaceholderCheck(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
}

export function isPlaceholderEmploymentValue(value: string | null | undefined): boolean {
  const v = normalizeForPlaceholderCheck(value ?? "");
  if (!v || v === "null" || v === "n/a" || v === "na" || v === "none" || v === "undefined") {
    return true;
  }
  if (PLACEHOLDER_LITERALS.includes(v)) return true;
  if (PLACEHOLDER_TITLE_PATTERNS.some((p) => p.test(v))) return true;
  if (PLACEHOLDER_COMPANY_PATTERNS.some((p) => p.test(v))) return true;
  if (/^previous\s+company\s*\d*$/i.test(v)) return true;
  if (/^company\s+name\s*\d*$/i.test(v)) return true;
  return false;
}

export function sanitizeEmploymentField(
  value: string | null | undefined,
  opts?: { field?: "title" | "company" }
): string | null {
  const n = norm(value ?? "");
  if (!n || isPlaceholderEmploymentValue(n)) return null;
  if (opts?.field === "company" && isFabricatedOrGenericCompany(n)) return null;
  return n;
}

export function sanitizeProfileExperienceRole(
  role: ProfileExperienceRole
): ProfileExperienceRole | null {
  const title = sanitizeEmploymentField(role.title, { field: "title" });
  const company = sanitizeEmploymentField(role.company, { field: "company" });
  if (!title && !company) return null;
  return {
    ...role,
    title: title ?? company ?? "",
    company: company ?? "",
  };
}

export function sanitizeProfileExperienceRoles(roles: ProfileExperienceRole[]): {
  roles: ProfileExperienceRole[];
  rejectedCount: number;
} {
  const out: ProfileExperienceRole[] = [];
  let rejectedCount = 0;
  for (const role of roles) {
    const cleaned = sanitizeProfileExperienceRole(role);
    if (cleaned) out.push(cleaned);
    else rejectedCount++;
  }
  return { roles: out, rejectedCount };
}

function sanitizeRoleRef(ref: EmploymentRoleRef): EmploymentRoleRef | null {
  const title = sanitizeEmploymentField(ref.title);
  const company = sanitizeEmploymentField(ref.company);
  if (!title && !company) return null;
  return { title: title ?? "", company: company ?? "" };
}

/** CSV-safe role display: never "Title @ null" or "null @ Company". */
export function formatEmploymentRoleForDisplay(ref: EmploymentRoleRef): string | null {
  const title = sanitizeEmploymentField(ref.title);
  const company = sanitizeEmploymentField(ref.company);
  if (title && company) return `${title} @ ${company}`;
  if (title) return title;
  if (company) return company;
  return null;
}

export function formatEmploymentRolesForCsv(roles: EmploymentRoleRef[]): string {
  return roles
    .map((r) => sanitizeRoleRef(r))
    .filter((r): r is EmploymentRoleRef => r != null)
    .map((r) => formatEmploymentRoleForDisplay(r))
    .filter((s): s is string => Boolean(s))
    .join(" | ");
}

export function roleStringHasPlaceholderLeakage(s: string): boolean {
  const t = norm(s);
  if (!t) return false;
  if (/\bnull\s*@\s*null\b/i.test(t)) return true;
  if (/\b@\s*null\b/i.test(t)) return true;
  if (/\bnull\s*@/i.test(t)) return true;
  const parts = t.split(/\s*@\s*/);
  for (const part of parts) {
    if (isPlaceholderEmploymentValue(part)) return true;
  }
  if (isPlaceholderEmploymentValue(t)) return true;
  return false;
}

export function fieldHasPlaceholderLeakage(value: string | null | undefined): boolean {
  const v = norm(value ?? "");
  if (!v) return false;
  if (isPlaceholderEmploymentValue(v)) return true;
  if (roleStringHasPlaceholderLeakage(v)) return true;
  return false;
}

/** Placeholder or fabricated/generic company leakage in export fields. */
export function fieldHasInvalidEmploymentLeakage(value: string | null | undefined): boolean {
  if (fieldHasPlaceholderLeakage(value)) return true;
  const v = norm(value ?? "");
  if (!v) return false;
  if (isFabricatedOrGenericCompany(v)) return true;
  const parts = v.split(/\s*@\s*|\s*\|\s*/);
  for (const part of parts) {
    if (isFabricatedOrGenericCompany(part.trim())) return true;
  }
  return false;
}

export type SanitizeResolvedOptions = {
  validProfileExperienceInputCount: number;
  rawProfileExperienceInputCount: number;
  rejectedPlaceholderItemCount: number;
  rejectedSyntheticItemCount?: number;
};

/**
 * Strip placeholder employment values and downgrade confidence/source when enrichment leaked templates.
 */
export function sanitizeResolvedProspectEmployment(
  resolved: ResolvedProspectEmployment,
  opts: SanitizeResolvedOptions
): ResolvedProspectEmployment {
  const placeholderNote =
    "Profile experience enrichment returned placeholder/template or fabricated/generic company values; fields cleared.";

  let currentTitle = sanitizeEmploymentField(resolved.currentTitle);
  let currentCompany = sanitizeEmploymentField(resolved.currentCompany);
  let pastTitle = sanitizeEmploymentField(resolved.pastTitle);
  let pastCompany = sanitizeEmploymentField(resolved.pastCompany);

  const currentRoles = resolved.currentRoles
    .map(sanitizeRoleRef)
    .filter((r): r is EmploymentRoleRef => r != null);
  const pastRoles = resolved.pastRoles
    .map(sanitizeRoleRef)
    .filter((r): r is EmploymentRoleRef => r != null);

  const hadPlaceholderInResolved =
    (resolved.currentTitle && !currentTitle) ||
    (resolved.currentCompany && !currentCompany) ||
    (resolved.pastTitle && !pastTitle) ||
    (resolved.pastCompany && !pastCompany) ||
    resolved.currentRoles.length !== currentRoles.length ||
    resolved.pastRoles.length !== pastRoles.length;

  const allExperienceRejected =
    opts.rawProfileExperienceInputCount > 0 && opts.validProfileExperienceInputCount === 0;

  let employmentSource = resolved.employmentSource;
  let employmentConfidence = resolved.employmentConfidence;
  let employmentNeedsReview = resolved.employmentNeedsReview;
  let employmentReason = resolved.employmentReason;

  if (allExperienceRejected && employmentSource === "profile_experience") {
    employmentSource = "unknown";
    currentTitle = null;
    currentCompany = null;
    employmentConfidence = 0;
    employmentNeedsReview = true;
    employmentReason = placeholderNote;
  } else if (
    hadPlaceholderInResolved ||
    opts.rejectedPlaceholderItemCount > 0 ||
    (opts.rejectedSyntheticItemCount ?? 0) > 0
  ) {
    if (!currentTitle && !currentCompany && employmentSource === "profile_experience") {
      employmentSource = "unknown";
      employmentConfidence = Math.min(employmentConfidence, 0.2);
    } else if (employmentSource === "profile_experience") {
      employmentConfidence = Math.min(employmentConfidence, 0.35);
    }
    employmentNeedsReview = true;
    if (!employmentReason.includes("placeholder") && !employmentReason.includes("template")) {
      employmentReason = `${employmentReason} ${placeholderNote}`.trim();
    }
  }

  if (currentTitle && !currentCompany && employmentSource === "profile_experience") {
    employmentNeedsReview = true;
    if (employmentConfidence > 0.5) employmentConfidence = 0.45;
  }

  return {
    ...resolved,
    currentTitle,
    currentCompany,
    pastTitle,
    pastCompany,
    currentRoles,
    pastRoles,
    employmentSource,
    employmentConfidence,
    employmentReason,
    employmentNeedsReview,
  };
}
