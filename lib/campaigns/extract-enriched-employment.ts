import type { CampaignCandidate } from "./types";
import type { CampaignEnrichedEmploymentSource } from "./types";

export type ParsedExperienceRow = {
  title: string;
  company: string;
  companyLinkedinUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dateRange?: string | null;
  isCurrent?: boolean;
};

export type EnrichedEmploymentResult = {
  enriched_current_title: string | null;
  enriched_current_company: string | null;
  enriched_current_company_linkedin_url: string | null;
  enriched_employment_source: CampaignEnrichedEmploymentSource;
  enriched_employment_confidence: number;
  enriched_current_roles: string;
  enriched_current_roles_json: string;
  experience_count: number;
  current_experience_count: number;
  past_companies: string;
  past_titles: string;
};

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function dateRangeIsActive(dateRange: string | null | undefined): boolean {
  if (!dateRange?.trim()) return false;
  return /\b(present|current)\b/i.test(dateRange);
}

function roleIsActive(role: ParsedExperienceRow): boolean {
  if (role.isCurrent === true) return true;
  if (role.isCurrent === false) return false;
  const end = (role.endDate ?? "").trim();
  if (end && !/^(present|current)$/i.test(end)) return false;
  if (dateRangeIsActive(role.dateRange)) return true;
  const dr = (role.dateRange ?? "").trim();
  if (dr && !/\b(present|current)\b/i.test(dr) && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(dr)) {
    return false;
  }
  if (!end && !dr) return true;
  return !end;
}

function parseExperienceObject(o: Record<string, unknown>): ParsedExperienceRow | null {
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

  const startDate = normStr(o.startDate) || normStr(o.start_date) || null;
  const endDate = normStr(o.endDate) || normStr(o.end_date) || null;
  const dateRange =
    normStr(o.dateRange) ||
    normStr(o.date_range) ||
    normStr(o.duration) ||
    (startDate || endDate ? [startDate, endDate].filter(Boolean).join(" – ") : null);

  const isCurrent =
    o.isCurrent === true ||
    o.current === true ||
    (!endDate && Boolean(title || company));

  const companyLinkedinUrl =
    normStr(o.companyLinkedin) ||
    normStr(o.companyLinkedinUrl) ||
    normStr(o.companyUrl) ||
    null;

  return {
    title: title || company,
    company: company || "",
    companyLinkedinUrl,
    startDate,
    endDate,
    dateRange,
    isCurrent,
  };
}

export function parseExperienceArrays(item: Record<string, unknown>): ParsedExperienceRow[] {
  const keys = [
    "experiences",
    "experience",
    "positions",
    "workExperience",
    "work_experience",
    "currentPositions",
    "current_positions",
  ];
  const out: ParsedExperienceRow[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const v = item[key];
    if (!Array.isArray(v)) continue;
    for (const raw of v) {
      if (!raw || typeof raw !== "object") continue;
      const row = parseExperienceObject(raw as Record<string, unknown>);
      if (!row) continue;
      const dedupe = `${row.title}|${row.company}`.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(row);
    }
  }

  const nested = item.profile;
  if (nested && typeof nested === "object") {
    for (const key of keys) {
      const v = (nested as Record<string, unknown>)[key];
      if (!Array.isArray(v)) continue;
      for (const raw of v) {
        if (!raw || typeof raw !== "object") continue;
        const row = parseExperienceObject(raw as Record<string, unknown>);
        if (!row) continue;
        const dedupe = `${row.title}|${row.company}`.toLowerCase();
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push(row);
      }
    }
  }

  return out;
}

function operatorRoleScore(title: string): number {
  const t = title.toLowerCase();
  let score = 0;
  if (/\b(founder|ceo|cto|ciso|vp|director|head)\b/.test(t)) score += 30;
  if (/\b(engineer|manager|lead|architect)\b/.test(t)) score += 15;
  return score;
}

function rankCurrentRoles(roles: ParsedExperienceRow[]): ParsedExperienceRow[] {
  return [...roles].sort((a, b) => operatorRoleScore(b.title) - operatorRoleScore(a.title));
}

function formatRole(r: ParsedExperienceRow): string {
  if (r.title && r.company) return `${r.title} @ ${r.company}`;
  return r.title || r.company;
}

function parseHeadlineEmployment(headline: string | null): { title: string | null; company: string | null } {
  if (!headline?.trim()) return { title: null, company: null };
  const at = headline.match(/^(.+?)\s+at\s+(.+?)(?:\s*[|•·-]|$)/i);
  if (at) return { title: at[1]!.trim(), company: at[2]!.trim() };
  return { title: headline.trim(), company: null };
}

export function extractEnrichedEmployment(args: {
  experiences: ParsedExperienceRow[];
  actorTitle?: string | null;
  actorCompany?: string | null;
  actorCompanyLinkedinUrl?: string | null;
  priorCandidate?: Pick<CampaignCandidate, "current_title" | "current_company">;
  headline?: string | null;
  experienceSourceKey?: "experiences" | "currentPositions";
}): EnrichedEmploymentResult {
  const fromExperiences = args.experiences.filter((r) => {
    const fromCurrentPositions = args.experienceSourceKey === "currentPositions";
    if (fromCurrentPositions) return roleIsActive(r);
    return roleIsActive(r);
  });

  const experienceOnly = args.experiences.filter((r) => {
    const key = args.experienceSourceKey ?? "experiences";
    if (key === "currentPositions") return false;
    return true;
  });
  const currentFromExperience = experienceOnly.filter(roleIsActive);
  const pastFromExperience = experienceOnly.filter((r) => !roleIsActive(r));

  let source: CampaignEnrichedEmploymentSource = "unknown";
  let title: string | null = null;
  let company: string | null = null;
  let companyLinkedin: string | null = null;
  let confidence = 0;
  let currentRoles: ParsedExperienceRow[] = [];

  if (currentFromExperience.length > 0) {
    currentRoles = rankCurrentRoles(currentFromExperience);
    const primary = currentRoles[0]!;
    title = primary.title;
    company = primary.company || null;
    companyLinkedin = primary.companyLinkedinUrl ?? null;
    source = "profile_experience_current";
    confidence = currentRoles.length === 1 ? 0.9 : currentRoles.length === 2 ? 0.65 : 0.5;
  } else if (fromExperiences.length > 0 && args.experienceSourceKey === "currentPositions") {
    currentRoles = rankCurrentRoles(fromExperiences);
    const primary = currentRoles[0]!;
    title = primary.title;
    company = primary.company || null;
    companyLinkedin = primary.companyLinkedinUrl ?? null;
    source = "current_positions";
    confidence = currentRoles.length === 1 ? 0.85 : 0.6;
  } else if (args.actorTitle || args.actorCompany) {
    title = args.actorTitle ?? null;
    company = args.actorCompany ?? null;
    companyLinkedin = args.actorCompanyLinkedinUrl ?? null;
    source = "actor_current_fields";
    confidence = 0.7;
  } else if (args.priorCandidate?.current_title || args.priorCandidate?.current_company) {
    title = args.priorCandidate.current_title;
    company = args.priorCandidate.current_company;
    source = "prior_candidate_source";
    confidence = 0.55;
  } else {
    const parsed = parseHeadlineEmployment(args.headline ?? null);
    if (parsed.title || parsed.company) {
      title = parsed.title;
      company = parsed.company;
      source = "headline_fallback";
      confidence = 0.35;
    }
  }

  const pastCompanies = [
    ...new Set(pastFromExperience.map((r) => r.company).filter(Boolean)),
  ];
  const pastTitles = [...new Set(pastFromExperience.map((r) => r.title).filter(Boolean))];

  return {
    enriched_current_title: title,
    enriched_current_company: company,
    enriched_current_company_linkedin_url: companyLinkedin,
    enriched_employment_source: source,
    enriched_employment_confidence: confidence,
    enriched_current_roles: currentRoles.map(formatRole).join("; "),
    enriched_current_roles_json: JSON.stringify(currentRoles),
    experience_count: args.experiences.length,
    current_experience_count: currentRoles.length,
    past_companies: pastCompanies.join("; "),
    past_titles: pastTitles.join("; "),
  };
}
