import type { CampaignCompanyRoleGroupId } from "./company-role-search-mapping";
import { listCampaignCompanyRoleGroups } from "./company-role-search-mapping";
import type { CampaignExclusionCriterionId } from "./types";

/** Exclusion Set C (from campaign Phase 1 sample permutations). */
export const CAMPAIGN_EXCLUSION_SET_C: readonly CampaignExclusionCriterionId[] = [
  "technical",
  "software_engineer",
  "security_role",
  "devops_platform",
  "engineering_leader",
] as const;

export type Phase2ValidationScenario = {
  id: string;
  slug: string;
  description: string;
  companyUrlsCount: number;
  roleGroups: readonly CampaignCompanyRoleGroupId[];
  maxItems: number;
  loadPostBased: boolean;
  postBasedLimit?: number;
  selectedExclusionIds: readonly CampaignExclusionCriterionId[];
};

const ALL_ROLE_GROUP_IDS = listCampaignCompanyRoleGroups().map((g) => g.id);

export const PHASE2_VALIDATION_SCENARIOS: readonly Phase2ValidationScenario[] = [
  {
    id: "1",
    slug: "one-company-security-practitioners-max10",
    description: "One company + Security practitioners + max 10",
    companyUrlsCount: 1,
    roleGroups: ["security_practitioners"],
    maxItems: 10,
    loadPostBased: false,
    selectedExclusionIds: [],
  },
  {
    id: "2",
    slug: "three-companies-security-leaders-practitioners-max25",
    description: "Three companies + Security leaders & practitioners + max 25",
    companyUrlsCount: 3,
    roleGroups: ["security_leaders", "security_practitioners"],
    maxItems: 25,
    loadPostBased: false,
    selectedExclusionIds: [],
  },
  {
    id: "3",
    slug: "one-company-all-role-groups-max10",
    description: "One company + all role groups + max 10 (small cap)",
    companyUrlsCount: 1,
    roleGroups: ALL_ROLE_GROUP_IDS,
    maxItems: 10,
    loadPostBased: false,
    selectedExclusionIds: [],
  },
  {
    id: "4",
    slug: "mixed-post-based-company-search-dedupe",
    description: "Post-based load + company search (dedupe by profile URL)",
    companyUrlsCount: 1,
    roleGroups: ["security_practitioners"],
    maxItems: 25,
    loadPostBased: true,
    postBasedLimit: 80,
    selectedExclusionIds: [],
  },
  {
    id: "5",
    slug: "company-search-exclusion-set-c",
    description:
      "Company search + Exclusion Set C (technical, software engineer, security role, devops/platform, engineering leader)",
    companyUrlsCount: 1,
    roleGroups: ["security_practitioners", "software_engineers"],
    maxItems: 25,
    loadPostBased: false,
    selectedExclusionIds: CAMPAIGN_EXCLUSION_SET_C,
  },
] as const;
