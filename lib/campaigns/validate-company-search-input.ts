import type { CampaignCompanyRoleGroupId } from "./company-role-search-mapping";
import {
  CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS,
  CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL,
} from "./constants";
import { isCampaignCompanyRoleGroupId } from "./company-role-search-mapping";

export type ValidateCompanySearchInputResult =
  | {
      ok: true;
      companyUrls: string[];
      roleGroups: CampaignCompanyRoleGroupId[];
      maxItems: (typeof CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS)[number];
      jobTitles: string[];
    }
  | { ok: false; error: string };

const LINKEDIN_COMPANY_URL =
  /^https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+\/?(\?.*)?$/i;

export function normalizeLinkedInCompanyUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!LINKEDIN_COMPANY_URL.test(u.origin + u.pathname)) return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path}/`;
  } catch {
    return null;
  }
}

export function validateCompanySearchInput(args: {
  companyUrls: string[];
  roleGroups: string[];
  maxItems: number;
  expandJobTitles: (ids: CampaignCompanyRoleGroupId[]) => string[];
}): ValidateCompanySearchInputResult {
  const normalizedUrls: string[] = [];
  const seenUrl = new Set<string>();

  for (const raw of args.companyUrls) {
    const line = raw.trim();
    if (!line) continue;
    const url = normalizeLinkedInCompanyUrl(line);
    if (!url) {
      return {
        ok: false,
        error: `Invalid LinkedIn company URL: ${line.slice(0, 80)}`,
      };
    }
    if (seenUrl.has(url.toLowerCase())) continue;
    seenUrl.add(url.toLowerCase());
    normalizedUrls.push(url);
  }

  if (normalizedUrls.length === 0) {
    return { ok: false, error: "Enter at least one LinkedIn company URL." };
  }

  const roleGroups: CampaignCompanyRoleGroupId[] = [];
  for (const id of args.roleGroups) {
    if (!isCampaignCompanyRoleGroupId(id)) continue;
    if (!roleGroups.includes(id)) roleGroups.push(id);
  }

  if (roleGroups.length === 0) {
    return { ok: false, error: "Select at least one role group." };
  }

  if (
    !CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS.includes(
      args.maxItems as (typeof CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS)[number]
    )
  ) {
    return { ok: false, error: "Max items must be 10, 25, or 50." };
  }

  const maxItems = args.maxItems as (typeof CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS)[number];

  if (normalizedUrls.length * maxItems > CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL) {
    return {
      ok: false,
      error:
        "Phase 2 supports up to 100 company-search results at a time. Reduce companies, role groups, or max items.",
    };
  }

  const jobTitles = args.expandJobTitles(roleGroups);
  if (jobTitles.length === 0) {
    return { ok: false, error: "No job titles resolved from selected role groups." };
  }

  return { ok: true, companyUrls: normalizedUrls, roleGroups, maxItems, jobTitles };
}
