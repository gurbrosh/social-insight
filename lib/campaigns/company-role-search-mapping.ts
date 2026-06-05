import { APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES } from "./constants";

export type CampaignCompanyRoleGroupId =
  | "security_leaders"
  | "security_practitioners"
  | "engineering_leaders"
  | "software_engineers"
  | "devops_platform"
  | "cloud_infrastructure"
  | "ai_ml"
  | "product"
  | "product_security"
  | "developer_security"
  | "grc_compliance"
  | "risk";

export type CampaignCompanyRoleGroupDefinition = {
  id: CampaignCompanyRoleGroupId;
  label: string;
  jobTitles: readonly string[];
};

export const CAMPAIGN_COMPANY_ROLE_GROUPS: readonly CampaignCompanyRoleGroupDefinition[] = [
  {
    id: "security_leaders",
    label: "Security leaders",
    jobTitles: [
      "CISO",
      "Chief Information Security Officer",
      "VP Security",
      "Head of Security",
      "Director of Security",
      "Security Leader",
    ],
  },
  {
    id: "security_practitioners",
    label: "Security practitioners",
    jobTitles: [
      "Security Engineer",
      "Cybersecurity Engineer",
      "Security Analyst",
      "SOC Analyst",
      "Security Architect",
      "Application Security Engineer",
      "AppSec Engineer",
    ],
  },
  {
    id: "engineering_leaders",
    label: "Engineering leaders",
    jobTitles: [
      "VP Engineering",
      "Head of Engineering",
      "Director of Engineering",
      "Engineering Manager",
      "CTO",
    ],
  },
  {
    id: "software_engineers",
    label: "Software engineers",
    jobTitles: [
      "Software Engineer",
      "Backend Engineer",
      "Full Stack Engineer",
      "Frontend Engineer",
      "Developer",
    ],
  },
  {
    id: "devops_platform",
    label: "DevOps / platform",
    jobTitles: [
      "DevOps Engineer",
      "Platform Engineer",
      "Site Reliability Engineer",
      "SRE",
      "Infrastructure Engineer",
    ],
  },
  {
    id: "cloud_infrastructure",
    label: "Cloud / infrastructure",
    jobTitles: [
      "Cloud Engineer",
      "Cloud Architect",
      "Infrastructure Architect",
      "Cloud Security Engineer",
    ],
  },
  {
    id: "ai_ml",
    label: "AI / ML",
    jobTitles: [
      "AI Engineer",
      "Machine Learning Engineer",
      "ML Engineer",
      "AI Lead",
      "Head of AI",
      "AI Architect",
    ],
  },
  {
    id: "product",
    label: "Product",
    jobTitles: [
      "Product Manager",
      "Senior Product Manager",
      "Director of Product",
      "VP Product",
      "Head of Product",
    ],
  },
  {
    id: "product_security",
    label: "Product security",
    jobTitles: [
      "Product Security Engineer",
      "Product Security Lead",
      "Product Security Manager",
    ],
  },
  {
    id: "developer_security",
    label: "Developer security",
    jobTitles: ["Developer Security", "DevSecOps", "Secure SDLC", "Application Security"],
  },
  {
    id: "grc_compliance",
    label: "GRC / compliance",
    jobTitles: [
      "GRC",
      "Compliance Manager",
      "Security Compliance",
      "Risk and Compliance",
      "Governance Risk Compliance",
    ],
  },
  {
    id: "risk",
    label: "Risk",
    jobTitles: [
      "Risk Manager",
      "Technology Risk",
      "Cyber Risk",
      "Information Risk",
      "Operational Risk",
    ],
  },
] as const;

const GROUP_BY_ID = new Map(CAMPAIGN_COMPANY_ROLE_GROUPS.map((g) => [g.id, g] as const));

const VALID_GROUP_IDS = new Set<CampaignCompanyRoleGroupId>(
  CAMPAIGN_COMPANY_ROLE_GROUPS.map((g) => g.id)
);

export function isCampaignCompanyRoleGroupId(id: string): id is CampaignCompanyRoleGroupId {
  return VALID_GROUP_IDS.has(id as CampaignCompanyRoleGroupId);
}

export function listCampaignCompanyRoleGroups(): CampaignCompanyRoleGroupDefinition[] {
  return [...CAMPAIGN_COMPANY_ROLE_GROUPS];
}

export function getCampaignCompanyRoleGroup(
  id: CampaignCompanyRoleGroupId
): CampaignCompanyRoleGroupDefinition | undefined {
  return GROUP_BY_ID.get(id);
}

export type ExpandRoleGroupsResult = {
  jobTitles: string[];
  allJobTitlesBeforeCap: string[];
  totalBeforeCap: number;
  droppedCount: number;
  capped: boolean;
};

/** Expand selected role groups to deduplicated job titles (case-insensitive). */
export function expandRoleGroupsToJobTitles(
  roleGroupIds: readonly CampaignCompanyRoleGroupId[],
  options?: { maxTitles?: number }
): string[] {
  return expandRoleGroupsToJobTitlesWithMeta(roleGroupIds, options).jobTitles;
}

export function expandRoleGroupsToJobTitlesWithMeta(
  roleGroupIds: readonly CampaignCompanyRoleGroupId[],
  options?: { maxTitles?: number }
): ExpandRoleGroupsResult {
  const seen = new Map<string, string>();
  for (const id of roleGroupIds) {
    const def = GROUP_BY_ID.get(id);
    if (!def) continue;
    for (const title of def.jobTitles) {
      const key = title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, title.trim());
    }
  }
  const all = [...seen.values()];
  const max = options?.maxTitles ?? APIFY_LINKEDIN_COMPANY_EMPLOYEES_MAX_JOB_TITLES;
  const jobTitles = all.slice(0, max);
  const droppedCount = Math.max(0, all.length - jobTitles.length);
  return {
    jobTitles,
    allJobTitlesBeforeCap: all,
    totalBeforeCap: all.length,
    droppedCount,
    capped: droppedCount > 0,
  };
}
