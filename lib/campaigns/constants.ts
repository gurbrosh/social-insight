/** Max candidates for full sync enrichment + semantic qualification in V1. */
export const V1_SYNC_ENRICHMENT_CAP = 100;

/** Max company-search profiles returned in one sync Phase 2 run. */
export const CAMPAIGN_COMPANY_SEARCH_MAX_TOTAL = 100;

export const CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS = [10, 25, 50] as const;

export type CampaignCompanySearchMaxItems =
  (typeof CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS)[number];

/**
 * Post-based source collection can use the same cap as LinkedIn prospects CSV
 * unless overridden by env.
 */
export const CAMPAIGN_POST_BASED_MAX_CANDIDATES =
  Number.parseInt(process.env.CAMPAIGN_POST_BASED_MAX_CANDIDATES ?? "", 10) > 0
    ? Number.parseInt(process.env.CAMPAIGN_POST_BASED_MAX_CANDIDATES!, 10)
    : 500;

/** Apify company-employees actor rejects more than 20 job title filters. */
export const APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES = 20;

export const APIFY_LINKEDIN_COMPANY_EMPLOYEES_ACTOR_ID = "Vb6LZkh4EqRlR0Ka9";
export const APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID = "2SyF0bVxmgGr8IVCZ";

/** Apify actor enum labels (not lowercase slugs). */
export const APIFY_LINKEDIN_COMPANY_EMPLOYEES_PROFILE_SCRAPER_MODE_SHORT =
  "Short ($4 per 1k)" as const;
