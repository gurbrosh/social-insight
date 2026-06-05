/**
 * Run: npx tsx lib/campaigns/company-role-search-mapping.test.ts
 */
import assert from "node:assert/strict";
import { APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES } from "./constants";
import {
  CAMPAIGN_COMPANY_ROLE_GROUPS,
  expandRoleGroupsToJobTitles,
  expandRoleGroupsToJobTitlesWithMeta,
  listCampaignCompanyRoleGroups,
} from "./company-role-search-mapping";

function run() {
  assert.equal(CAMPAIGN_COMPANY_ROLE_GROUPS.length, 12);
  assert.equal(listCampaignCompanyRoleGroups().length, 12);

  const titles = expandRoleGroupsToJobTitles(["security_leaders", "security_practitioners"]);
  assert.ok(titles.includes("CISO"));
  assert.ok(titles.includes("Security Engineer"));
  assert.equal(titles.length, new Set(titles.map((t) => t.toLowerCase())).size, "no duplicate titles");

  const deduped = expandRoleGroupsToJobTitles([
    "software_engineers",
    "devops_platform",
  ]);
  assert.ok(deduped.includes("Software Engineer"));
  assert.ok(deduped.includes("DevOps Engineer"));

  const allGroups = listCampaignCompanyRoleGroups().map((g) => g.id);
  const expanded = expandRoleGroupsToJobTitlesWithMeta(allGroups);
  assert.ok(expanded.totalBeforeCap > APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES);
  assert.equal(expanded.jobTitles.length, APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES);
  assert.equal(expanded.droppedCount, expanded.totalBeforeCap - expanded.jobTitles.length);
  assert.equal(expanded.capped, true);

  console.log("company-role-search-mapping.test.ts: ok");
}

run();
