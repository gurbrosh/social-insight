import { apifyService } from "@/lib/apify-service";
import {
  APIFY_LINKEDIN_COMPANY_EMPLOYEES_ACTOR_ID,
  APIFY_LINKEDIN_COMPANY_EMPLOYEES_PROFILE_SCRAPER_MODE_SHORT,
  CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL,
} from "./constants";
import type { ApifyCompanyEmployeeRawItem } from "./normalize-company-search-results";
import {
  normalizeApifyCompanyEmployeeResults,
} from "./normalize-company-search-results";
import type { CampaignCandidate } from "./types";

export type CompanyEmployeesApifyInput = {
  companies: string[];
  jobTitles: string[];
  maxItems: number;
  profileScraperMode: string;
  recentlyChangedJobs: boolean;
  companyBatchMode: string;
};

export function buildCompanyEmployeesApifyInput(args: {
  companyUrls: string[];
  jobTitles: string[];
  maxItems: number;
}): CompanyEmployeesApifyInput {
  return {
    companies: args.companyUrls,
    jobTitles: args.jobTitles,
    maxItems: args.maxItems,
    profileScraperMode: APIFY_LINKEDIN_COMPANY_EMPLOYEES_PROFILE_SCRAPER_MODE_SHORT,
    recentlyChangedJobs: false,
    companyBatchMode: "all_at_once",
  };
}

export function isApifyNotConfiguredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("APIFY_API_TOKEN") ||
    msg.includes("Apify API token") ||
    msg.includes("API token")
  );
}

export const APIFY_NOT_CONFIGURED_MESSAGE =
  "Apify is not configured. Add the required Apify token before using Company / role search.";

export type RunCompanyEmployeesSearchResult =
  | {
      ok: true;
      rawCount: number;
      normalizedCount: number;
      cappedCount: number;
      droppedInvalid: number;
      candidates: CampaignCandidate[];
      warnings: string[];
    }
  | { ok: false; error: string; apifyNotConfigured?: boolean };

/**
 * Run Apify company-employees actor synchronously and normalize results.
 * Pass `fetchItems` in tests to inject fixture data without calling Apify.
 */
export async function runCompanyEmployeesSearch(args: {
  companyUrls: string[];
  jobTitles: string[];
  maxItems: number;
  roleGroups?: string[];
  fetchItems?: (input: CompanyEmployeesApifyInput) => Promise<ApifyCompanyEmployeeRawItem[]>;
}): Promise<RunCompanyEmployeesSearchResult> {
  const input = buildCompanyEmployeesApifyInput(args);
  const warnings: string[] = [];

  let rawItems: ApifyCompanyEmployeeRawItem[];

  try {
    if (args.fetchItems) {
      rawItems = await args.fetchItems(input);
    } else {
      const run = await apifyService.runScraperSync(
        APIFY_LINKEDIN_COMPANY_EMPLOYEES_ACTOR_ID,
        input,
        "linkedin"
      );
      const datasetId = run.defaultDatasetId;
      if (!datasetId) {
        return { ok: false, error: "Apify run completed without a dataset ID." };
      }
      rawItems = (await apifyService.getDatasetItems(datasetId)) as ApifyCompanyEmployeeRawItem[];
    }
  } catch (e) {
    if (isApifyNotConfiguredError(e)) {
      return { ok: false, error: APIFY_NOT_CONFIGURED_MESSAGE, apifyNotConfigured: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Company / role search failed." };
  }

  const rawCount = rawItems.length;
  const defaultRoleGroup =
    args.roleGroups?.length === 1
      ? args.roleGroups[0]!
      : args.roleGroups?.length
        ? args.roleGroups.join(";")
        : undefined;

  const { candidates, droppedInvalid } = normalizeApifyCompanyEmployeeResults(rawItems, {
    maxTotal: CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL,
    defaultRoleGroup,
  });

  if (droppedInvalid > 0) {
    warnings.push(`${droppedInvalid} raw result(s) could not be normalized.`);
  }
  if (candidates.length >= CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL) {
    warnings.push(`Results capped at ${CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL} profiles.`);
  }

  return {
    ok: true,
    rawCount,
    normalizedCount: candidates.length,
    cappedCount: candidates.length,
    droppedInvalid,
    candidates,
    warnings,
  };
}
