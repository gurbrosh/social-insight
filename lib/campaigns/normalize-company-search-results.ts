import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { apifyCompanyItemHasOpenToWorkSignal } from "./open-to-work-export";
import type { CampaignCandidate, CampaignEmploymentSource } from "./types";

export type ApifyCompanyEmployeeRawItem = Record<string, unknown>;

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseCurrentPosition(item: ApifyCompanyEmployeeRawItem): {
  title: string | null;
  company: string | null;
} {
  const positions = item.currentPositions;
  if (!Array.isArray(positions) || positions.length === 0) {
    return { title: null, company: null };
  }
  const first = positions[0];
  if (!first || typeof first !== "object") return { title: null, company: null };
  const pos = first as Record<string, unknown>;
  const title = pickString(pos, ["title", "jobTitle", "positionTitle"]);
  const company = pickString(pos, ["companyName", "company", "company_name"]);
  return { title, company };
}

function parseName(item: ApifyCompanyEmployeeRawItem): {
  first_name: string;
  last_name: string;
  display_name: string | null;
} {
  const first = pickString(item, ["firstName", "first_name"]) ?? "";
  const last = pickString(item, ["lastName", "last_name"]) ?? "";
  const full = pickString(item, ["fullName", "name", "displayName"]);
  if (first || last) {
    return {
      first_name: first || "Unknown",
      last_name: last || "",
      display_name: full ?? (`${first} ${last}`.trim() || null),
    };
  }
  if (full) {
    const parts = full.split(/\s+/);
    return {
      first_name: parts[0] ?? "Unknown",
      last_name: parts.slice(1).join(" ") || "",
      display_name: full,
    };
  }
  return { first_name: "Unknown", last_name: "", display_name: null };
}

function mapQueryRoleGroup(
  query: Record<string, unknown> | null
): { companyUrl: string | null; jobTitleQuery: string | null } {
  if (!query) return { companyUrl: null, jobTitleQuery: null };
  return {
    companyUrl: pickString(query, ["company", "companyUrl", "company_url"]),
    jobTitleQuery: pickString(query, ["jobTitle", "job_title"]),
  };
}

export function normalizeApifyCompanyEmployeeItem(
  item: ApifyCompanyEmployeeRawItem,
  options?: { defaultCompanyUrl?: string; defaultRoleGroup?: string }
): CampaignCandidate | null {
  const profileUrl =
    pickString(item, ["linkedinUrl", "linkedin_url", "profileUrl", "url"]) ??
    pickString(item, ["publicIdentifier"]); // unlikely

  if (!profileUrl) return null;

  const linkedin_url = profileUrl.startsWith("http")
    ? profileUrl
    : `https://www.linkedin.com/in/${profileUrl.replace(/^\/+/, "")}`;

  const linkedin_url_normalized = normalizePublicProfileUrl(linkedin_url);
  if (!linkedin_url_normalized) return null;

  const { first_name, last_name, display_name } = parseName(item);
  const headline = pickString(item, ["headline", "summary", "tagline"]);
  const location = pickString(item, ["location", "geoLocation", "city"]);

  const fromPositions = parseCurrentPosition(item);
  let current_title = fromPositions.title;
  let current_company = fromPositions.company;
  let employment_source: CampaignEmploymentSource = "unknown";

  if (current_title || current_company) {
    employment_source = "current_positions";
  } else if (headline) {
    employment_source = "headline_fallback";
    current_title = headline;
  }

  const query =
    item.query && typeof item.query === "object"
      ? (item.query as Record<string, unknown>)
      : null;
  const { companyUrl: queryCompany, jobTitleQuery } = mapQueryRoleGroup(query);

  return {
    linkedin_url,
    linkedin_url_normalized,
    first_name,
    last_name,
    display_name,
    headline,
    current_title,
    current_company,
    location,
    employment_source,
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: queryCompany ?? options?.defaultCompanyUrl ?? null,
    source_role_group: options?.defaultRoleGroup ?? null,
    source_job_title_query: jobTitleQuery,
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    apify_open_to_work_present: apifyCompanyItemHasOpenToWorkSignal(item),
  };
}

export function normalizeApifyCompanyEmployeeResults(
  items: ApifyCompanyEmployeeRawItem[],
  options?: { maxTotal?: number; defaultCompanyUrl?: string; defaultRoleGroup?: string }
): { candidates: CampaignCandidate[]; droppedInvalid: number } {
  const maxTotal = options?.maxTotal ?? 100;
  const byUrl = new Map<string, CampaignCandidate>();
  let droppedInvalid = 0;

  for (const item of items) {
    const row = normalizeApifyCompanyEmployeeItem(item, {
      defaultCompanyUrl: options?.defaultCompanyUrl,
      defaultRoleGroup: options?.defaultRoleGroup,
    });
    if (!row) {
      droppedInvalid += 1;
      continue;
    }
    if (!byUrl.has(row.linkedin_url_normalized)) {
      byUrl.set(row.linkedin_url_normalized, row);
    }
  }

  const candidates = [...byUrl.values()].slice(0, maxTotal);
  return { candidates, droppedInvalid };
}
