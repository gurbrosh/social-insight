import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { detectProfileOpenToWork } from "./detect-profile-open-to-work";
import {
  extractEnrichedEmployment,
  parseExperienceArrays,
  type ParsedExperienceRow,
} from "./extract-enriched-employment";
import type { CampaignCandidate } from "./types";

export type NormalizedProfileEnrichment = {
  linkedin_url: string;
  linkedin_url_normalized: string;
  name: string;
  headline: string | null;
  location: string | null;
  about: string | null;
  skills: string;
  email: string | null;
  mobile: string | null;
  contact_source: string | null;
  enriched_current_title: string | null;
  enriched_current_company: string | null;
  enriched_current_company_linkedin_url: string | null;
  enriched_employment_source: ReturnType<typeof extractEnrichedEmployment>["enriched_employment_source"];
  enriched_employment_confidence: number;
  enriched_current_roles: string;
  enriched_current_roles_json: string;
  experience_count: number;
  current_experience_count: number;
  past_companies: string;
  past_titles: string;
  open_to_work_detection: ReturnType<typeof detectProfileOpenToWork>["open_to_work_detection"];
  open_to_work_source: ReturnType<typeof detectProfileOpenToWork>["open_to_work_source"];
  open_to_work_raw_value: string | null;
};

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function readProfileUrl(item: Record<string, unknown>): string | null {
  const candidates = [
    item.linkedinUrl,
    item.linkedin_url,
    item.profileUrl,
    item.profile_url,
    item.url,
  ];
  for (const c of candidates) {
    const s = normStr(c);
    if (s) return s;
  }
  return null;
}

function readName(item: Record<string, unknown>): string {
  return (
    normStr(item.fullName) ||
    normStr(item.name) ||
    [normStr(item.firstName), normStr(item.lastName)].filter(Boolean).join(" ")
  );
}

function readLocation(item: Record<string, unknown>): string | null {
  return (
    normStr(item.location) ||
    [normStr(item.city), normStr(item.country)].filter(Boolean).join(", ") ||
    null
  );
}

function readSkills(item: Record<string, unknown>): string {
  const skills = item.skills;
  if (Array.isArray(skills)) {
    return skills
      .map((s) => (typeof s === "string" ? s : normStr((s as Record<string, unknown>).name)))
      .filter(Boolean)
      .join("; ");
  }
  return normStr(skills);
}

function readContact(item: Record<string, unknown>): {
  email: string | null;
  mobile: string | null;
  contact_source: string | null;
} {
  const email = normStr(item.email) || normStr(item.emailAddress) || null;
  const mobile =
    normStr(item.mobile) ||
    normStr(item.mobileNumber) ||
    normStr(item.phone) ||
    normStr(item.phoneNumber) ||
    null;
  const contact_source = email || mobile ? "apify_profile_scraper" : null;
  return { email, mobile, contact_source };
}

function splitExperienceSources(all: ParsedExperienceRow[], item: Record<string, unknown>): {
  experiences: ParsedExperienceRow[];
  currentPositions: ParsedExperienceRow[];
} {
  const experiences: ParsedExperienceRow[] = [];
  const currentPositions: ParsedExperienceRow[] = [];

  const expKeys = ["experiences", "experience", "positions", "workExperience", "work_experience"];
  const curKeys = ["currentPositions", "current_positions"];

  for (const key of expKeys) {
    const v = item[key];
    if (!Array.isArray(v)) continue;
    for (const raw of v) {
      if (!raw || typeof raw !== "object") continue;
      const parsed = parseExperienceArrays({ [key]: [raw] });
      experiences.push(...parsed);
    }
  }

  for (const key of curKeys) {
    const v = item[key];
    if (!Array.isArray(v)) continue;
    for (const raw of v) {
      if (!raw || typeof raw !== "object") continue;
      const parsed = parseExperienceArrays({ [key]: [raw] });
      currentPositions.push(...parsed);
    }
  }

  if (experiences.length === 0 && currentPositions.length === 0) {
    return { experiences: all, currentPositions: [] };
  }

  return { experiences, currentPositions };
}

export function normalizeApifyProfileEnrichmentItem(
  item: Record<string, unknown>,
  priorCandidate?: CampaignCandidate
): NormalizedProfileEnrichment | null {
  const rawUrl = readProfileUrl(item);
  if (!rawUrl) return null;

  const linkedin_url = rawUrl;
  const linkedin_url_normalized = normalizePublicProfileUrl(rawUrl) ?? rawUrl.replace(/\/$/, "");
  const name = readName(item) || priorCandidate?.display_name || "";
  const headline = normStr(item.headline) || priorCandidate?.headline || null;

  const allExperiences = parseExperienceArrays(item);
  const { experiences, currentPositions } = splitExperienceSources(allExperiences, item);

  let employment = extractEnrichedEmployment({
    experiences,
    actorTitle: normStr(item.jobTitle) || normStr(item.title) || null,
    actorCompany: normStr(item.companyName) || normStr(item.company) || null,
    actorCompanyLinkedinUrl:
      normStr(item.companyLinkedin) || normStr(item.companyLinkedinUrl) || null,
    priorCandidate,
    headline,
    experienceSourceKey: "experiences",
  });

  if (
    employment.enriched_employment_source === "unknown" ||
    employment.enriched_employment_source === "actor_current_fields" ||
    (employment.enriched_employment_source === "prior_candidate_source" && currentPositions.length > 0)
  ) {
    const fromCurrent = extractEnrichedEmployment({
      experiences: currentPositions,
      priorCandidate,
      headline,
      experienceSourceKey: "currentPositions",
    });
    if (
      fromCurrent.enriched_employment_source === "current_positions" ||
      fromCurrent.enriched_employment_source === "profile_experience_current"
    ) {
      employment = fromCurrent;
    }
  }

  const otw = detectProfileOpenToWork(item);
  const contact = readContact(item);

  return {
    linkedin_url,
    linkedin_url_normalized,
    name,
    headline,
    location: readLocation(item) || priorCandidate?.location || null,
    about: normStr(item.about) || normStr(item.summary) || null,
    skills: readSkills(item),
    ...contact,
    ...employment,
    open_to_work_detection: otw.open_to_work_detection,
    open_to_work_source: otw.open_to_work_source,
    open_to_work_raw_value: otw.open_to_work_raw_value,
  };
}
