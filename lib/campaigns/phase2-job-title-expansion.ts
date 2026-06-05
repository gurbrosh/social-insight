import {
  APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES,
} from "./constants";
import {
  expandRoleGroupsToJobTitlesWithMeta,
  type CampaignCompanyRoleGroupId,
} from "./company-role-search-mapping";
import type { Phase2ValidationJobTitleMeta } from "./build-phase2-validation-csv";

export const APIFY_JOB_TITLE_CAP_WARNING = `Job titles capped at ${APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES} due to Apify limit`;

export function buildJobTitleExpansionMeta(
  roleGroups: readonly CampaignCompanyRoleGroupId[]
): Phase2ValidationJobTitleMeta {
  const expanded = expandRoleGroupsToJobTitlesWithMeta(roleGroups);
  const warning = expanded.capped
    ? APIFY_JOB_TITLE_CAP_WARNING
    : "Job titles within Apify limit (no cap applied)";

  return {
    roleGroupsSelected: [...roleGroups],
    jobTitlesBeforeCap: expanded.totalBeforeCap,
    allJobTitlesBeforeCap: expanded.allJobTitlesBeforeCap,
    jobTitlesSentToApify: expanded.jobTitles,
    droppedJobTitlesCount: expanded.droppedCount,
    warning,
  };
}
