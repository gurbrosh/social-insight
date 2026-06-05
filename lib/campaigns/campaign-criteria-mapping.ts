import type {
  EmploymentRelationship,
  ExclusionFlag,
  FunctionTag,
  OpenToWorkStatus,
  ProfileFlag,
  ProspectClassification,
  RoleCategory,
  Seniority,
} from "@/lib/prospect-intelligence/types";
import type { CampaignExclusionCriterionId } from "./types";
import {
  exclusionTitleBlob,
  isLikelyExecutiveClassification,
  titleMatchesAdvisorBoard,
  titleMatchesAiMlRole,
  titleMatchesCloudInfrastructure,
  titleMatchesContractorNotConsultant,
  titleMatchesDevOpsPlatform,
  titleMatchesFounder,
  titleMatchesProductRole,
  titleMatchesSalesMarketing,
  titleMatchesSecurityRole,
  titleMatchesSoftwareEngineer,
} from "./exclusion-title-patterns";

/** Declarative matcher: any listed field match counts unless requireAllListedFields is set. */
export type CampaignCriterionMatcher = {
  roleCategories?: readonly RoleCategory[];
  profileFlags?: readonly ProfileFlag[];
  excludedRoleFlags?: readonly ExclusionFlag[];
  functionTags?: readonly FunctionTag[];
  seniorityAnyOf?: readonly Seniority[];
  openToWorkStatuses?: readonly OpenToWorkStatus[];
  employmentRelationships?: readonly EmploymentRelationship[];
  /** When true, roleCategories + seniorityAnyOf must both match (e.g. engineering leader). */
  requireAllListedFields?: boolean;
  /** Criterion-specific logic when arrays are insufficient. */
  custom?: (classification: ProspectClassification) => boolean;
};

export type CampaignExclusionCriterionDefinition = {
  id: CampaignExclusionCriterionId;
  label: string;
  group: string;
  matcher: CampaignCriterionMatcher;
};

const OTW_SIGNAL: readonly OpenToWorkStatus[] = ["text_signal_detected", "public_signal_detected"];

export const CAMPAIGN_EXCLUSION_CRITERIA: readonly CampaignExclusionCriterionDefinition[] = [
  {
    id: "open_to_work",
    label: "Open to work",
    group: "Common exclusions",
    matcher: {
      openToWorkStatuses: OTW_SIGNAL,
      profileFlags: ["job_seeker_signal", "job_search_signal", "open_to_work_text_signal", "open_to_work_public_signal"],
      excludedRoleFlags: ["open_to_work"],
      roleCategories: ["job_seeker"],
    },
  },
  {
    id: "investor",
    label: "Investor",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["investor", "venture_capital"],
      profileFlags: ["investor_signal"],
      excludedRoleFlags: ["investor"],
      functionTags: ["investor"],
    },
  },
  {
    id: "consultant",
    label: "Consultant",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["consultant", "strategy_consultant", "marketing_consultant", "personal_brand_consultant"],
      profileFlags: ["consultant_signal"],
      excludedRoleFlags: ["consultant"],
      functionTags: ["consulting"],
    },
  },
  {
    id: "sales_marketing",
    label: "Sales / marketing",
    group: "Common exclusions",
    matcher: {
      roleCategories: [
        "sales_leader",
        "sales_account",
        "revenue_leader",
        "gtm_leader",
        "marketing_leader",
        "product_marketing",
        "growth_leader",
        "channel_leader",
        "commercial_leader",
        "monetization_leader",
      ],
      custom: (c) => titleMatchesSalesMarketing(c),
    },
  },
  {
    id: "not_working",
    label: "Not working",
    group: "Common exclusions",
    matcher: {
      profileFlags: ["retired_signal"],
      roleCategories: ["job_seeker"],
      excludedRoleFlags: ["open_to_work", "insufficient_evidence"],
      custom: (c) => {
        if (isLikelyExecutiveClassification(c)) return false;
        if (c.currentTitle?.trim() && c.currentCompany?.trim()) return false;
        return (
          c.employmentRelationship === "ambiguous" &&
          !c.currentTitle?.trim() &&
          !c.currentCompany?.trim() &&
          (c.roleCategories.length === 0 ||
            (c.roleCategories.length === 1 && c.roleCategories[0] === "unknown"))
        );
      },
    },
  },
  {
    id: "recruiter",
    label: "Recruiter",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["recruiter", "technical_recruiter", "staffing_leader"],
      profileFlags: ["recruiter_signal"],
      excludedRoleFlags: ["recruiter"],
    },
  },
  {
    id: "contractor",
    label: "Contractor",
    group: "Common exclusions",
    matcher: {
      profileFlags: ["freelance_signal"],
      employmentRelationships: ["independent_professional"],
      custom: (c) => titleMatchesContractorNotConsultant(c),
    },
  },
  {
    id: "admin",
    label: "Admin",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["executive_assistant", "executive_operations"],
      functionTags: ["administration", "executive_support"],
    },
  },
  {
    id: "finance",
    label: "Finance",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["finance_accounting", "financial_analyst"],
      functionTags: ["finance", "accounting", "financial_modeling", "financial_services"],
    },
  },
  {
    id: "operations",
    label: "Operations",
    group: "Common exclusions",
    matcher: {
      roleCategories: [
        "operations_leader",
        "operations_support",
        "supply_chain",
        "program_manager",
        "project_manager",
        "field_operations",
        "it_operations",
      ],
      functionTags: ["it_operations", "it_service_management", "supply_chain"],
    },
  },
  {
    id: "human_resources",
    label: "Human Resources",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["hr_leader", "people_leader", "staffing_leader"],
      functionTags: ["hr"],
    },
  },
  {
    id: "solo_company",
    label: "Solo company",
    group: "Common exclusions",
    matcher: {
      profileFlags: ["solo_operator_signal", "possible_small_business", "micro_employer_signal"],
      excludedRoleFlags: ["solo_operator"],
      roleCategories: ["solo_founder", "owner_operator", "founder_or_principal"],
      custom: (c) => c.companySizeSignal === "solo" || c.excludedRoleFlags.includes("solo_operator"),
    },
  },
  {
    id: "student_academic",
    label: "Student / academic",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["student", "intern_or_student", "academic", "educator", "education_leader", "instructional_designer"],
      profileFlags: ["student_signal", "education_signal", "former_intern_signal", "junior_or_intern_signal"],
      excludedRoleFlags: ["student"],
      seniorityAnyOf: ["student"],
      functionTags: ["academic", "education"],
      employmentRelationships: ["education_primary"],
    },
  },
  {
    id: "healthcare",
    label: "Healthcare",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["healthtech"],
      functionTags: ["healthcare", "life_sciences"],
    },
  },
  {
    id: "content_creator",
    label: "Content creator",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["content_creator", "media_creator", "copywriter", "ai_creator"],
      functionTags: ["content", "content_writing", "content_strategy", "copywriting", "media"],
    },
  },
  {
    id: "legal",
    label: "Legal",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["legal_counsel", "legal_services"],
      functionTags: ["legal"],
    },
  },
  {
    id: "customer_success",
    label: "Customer success",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["customer_success", "customer_success_leader", "customer_experience", "customer_support", "customer_support_leader"],
      functionTags: ["customer_success", "customer_experience", "customer_service", "customer_advocacy"],
    },
  },
  {
    id: "business_development_partnerships",
    label: "Business development / partnerships",
    group: "Common exclusions",
    matcher: {
      roleCategories: [
        "business_development",
        "partnerships_leader",
        "startup_business_development",
        "business_leader",
        "channel_leader",
      ],
      functionTags: ["business_development", "partnerships", "channel", "abm"],
    },
  },
  {
    id: "advisor_board_member",
    label: "Advisor / board member",
    group: "Common exclusions",
    matcher: {
      roleCategories: ["advisor", "board_member", "coach_or_advisor", "security_advisor", "business_advisor"],
      profileFlags: ["advisor_signal", "board_member_signal", "coach_signal"],
      custom: (c) => titleMatchesAdvisorBoard(c),
    },
  },
  {
    id: "technical",
    label: "Technical",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "software_engineer",
        "engineering_leader",
        "platform_engineer",
        "cloud_engineer",
        "devops_engineer",
        "ai_practitioner",
        "ai_engineer",
        "ai_ml_practitioner",
        "technical_architect",
        "solutions_engineer",
        "full_stack_engineer",
        "frontend_engineer",
        "infrastructure_engineer",
        "sre_engineer",
        "technical_lead",
        "technology_leader",
      ],
      custom: (c) => {
        if (isLikelyExecutiveClassification(c) && !titleMatchesSoftwareEngineer(c)) return false;
        return (
          titleMatchesSoftwareEngineer(c) ||
          titleMatchesSecurityRole(c) ||
          titleMatchesDevOpsPlatform(c) ||
          titleMatchesCloudInfrastructure(c) ||
          titleMatchesAiMlRole(c)
        );
      },
    },
  },
  {
    id: "c_level",
    label: "C-level",
    group: "Advanced / technical exclusions",
    matcher: {
      seniorityAnyOf: ["c_level"],
      roleCategories: ["executive_leader", "technology_executive"],
      custom: (c) => {
        const blob = exclusionTitleBlob(c);
        return /\b(?:ceo|cto|cfo|coo|chief\s+\w+\s+officer|chief\s+ai\s+evangelist)\b/i.test(blob);
      },
    },
  },
  {
    id: "founder",
    label: "Founder",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: ["founder", "solo_founder", "founder_or_principal", "past_founder"],
      profileFlags: ["founder_signal"],
      seniorityAnyOf: ["founder", "founder_owner", "owner"],
      custom: (c) => titleMatchesFounder(c),
    },
  },
  {
    id: "ciso",
    label: "CISO",
    group: "Advanced / technical exclusions",
    matcher: {
      custom: (c) => {
        const senior = c.seniority === "c_level" || c.seniority === "vp";
        const securityLeader = c.roleCategories.includes("security_leader");
        const title = `${c.currentTitle ?? ""} ${c.safeProfessionalReference ?? ""}`.toLowerCase();
        const cisoTitle = /\bciso\b|chief\s+information\s+security|chief\s+security\s+officer/i.test(title);
        return cisoTitle || (securityLeader && senior);
      },
    },
  },
  {
    id: "security_role",
    label: "Security role",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "security_practitioner",
        "security_leader",
        "analyst_security",
        "data_security",
        "identity_security",
      ],
      custom: (c) => titleMatchesSecurityRole(c),
    },
  },
  {
    id: "engineering_leader",
    label: "Engineering leader",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: ["engineering_leader", "technology_leader", "technical_lead"],
      seniorityAnyOf: ["vp", "director", "manager", "c_level"],
      requireAllListedFields: true,
    },
  },
  {
    id: "software_engineer",
    label: "Software engineer",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "software_engineer",
        "full_stack_engineer",
        "frontend_engineer",
        "web_developer",
        "platform_engineer",
      ],
      custom: (c) => titleMatchesSoftwareEngineer(c),
    },
  },
  {
    id: "ai_ml_role",
    label: "AI / ML role",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "ai_practitioner",
        "ai_engineer",
        "ai_ml_practitioner",
        "ai_leader",
        "ai_strategy",
        "ai_trainer",
        "data_scientist",
        "mlops_engineer",
      ],
      custom: (c) => titleMatchesAiMlRole(c),
    },
  },
  {
    id: "product_role",
    label: "Product role",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "product_leader",
        "product_manager",
        "product_designer",
        "product_builder",
        "product_operations",
        "product_specialist",
      ],
      custom: (c) => titleMatchesProductRole(c),
    },
  },
  {
    id: "product_security",
    label: "Product security",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: ["data_security", "identity_security", "security_practitioner"],
      functionTags: ["application_security", "appsec", "cybersecurity"],
      custom: (c) => {
        const blob = `${c.currentTitle ?? ""} ${c.professionalSummary ?? ""}`.toLowerCase();
        return /\bproduct\s+security\b|\bprodsec\b|\bapplication\s+security\b/.test(blob);
      },
    },
  },
  {
    id: "developer_security",
    label: "Developer security",
    group: "Advanced / technical exclusions",
    matcher: {
      functionTags: ["application_security", "appsec", "offensive_security", "cybersecurity"],
      custom: (c) => {
        const blob = `${c.currentTitle ?? ""} ${c.professionalSummary ?? ""}`.toLowerCase();
        return /\bdevsecops\b|\bdeveloper\s+security\b|\bsecure\s+development\b/.test(blob);
      },
    },
  },
  {
    id: "cloud_infrastructure",
    label: "Cloud / infrastructure",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: [
        "cloud_engineer",
        "cloud_architect",
        "infrastructure_engineer",
        "network_engineer",
        "platform_engineer",
        "systems_architect",
      ],
      custom: (c) => titleMatchesCloudInfrastructure(c),
    },
  },
  {
    id: "devops_platform",
    label: "DevOps / platform",
    group: "Advanced / technical exclusions",
    matcher: {
      roleCategories: ["devops_engineer", "platform_engineer", "sre_engineer", "mlops_engineer"],
      custom: (c) => titleMatchesDevOpsPlatform(c),
    },
  },
  {
    id: "grc_compliance",
    label: "GRC / compliance",
    group: "Advanced / technical exclusions",
    matcher: {
      functionTags: ["compliance", "esg"],
      custom: (c) => {
        const blob = `${c.currentTitle ?? ""} ${c.professionalSummary ?? ""}`.toLowerCase();
        return /\bgrc\b|\bgovernance\b|\bcompliance\b|\brisk\s+and\s+compliance\b/.test(blob);
      },
    },
  },
  {
    id: "risk_leader",
    label: "Risk leader",
    group: "Advanced / technical exclusions",
    matcher: {
      custom: (c) => {
        const blob = `${c.currentTitle ?? ""} ${c.professionalSummary ?? ""}`.toLowerCase();
        return /\brisk\b/.test(blob) && /\b(director|head|vp|chief|leader|manager)\b/.test(blob);
      },
    },
  },
] as const;

const CRITERION_BY_ID = new Map(
  CAMPAIGN_EXCLUSION_CRITERIA.map((c) => [c.id, c] as const)
);

/**
 * Phase 1 semantic coverage (stable; avoid broad retuning).
 * Used only by roleCategoryCoveredByPhase1SelectedExclusions so mixed-signal checks do not treat
 * adjacent labels (e.g. technical_influencer under Technical) as unrelated non-excluded roles.
 * Does not change which criteria match — only whether a role category counts as "covered".
 */
const PHASE1_EXTRA_ROLE_COVERAGE: Partial<Record<CampaignExclusionCriterionId, readonly RoleCategory[]>> = {
  technical: ["technical_influencer", "technology_executive", "cloud_architect", "systems_architect"],
  software_engineer: ["technical_influencer"],
  engineering_leader: ["technical_influencer"],
  devops_platform: ["technical_influencer"],
  security_role: ["technical_influencer"],
  /** Collateral exec/tech labels when C-level exclusion is selected (mixed-signal tightening). */
  c_level: [
    "business_leader",
    "engineering_leader",
    "technical_influencer",
    "technology_leader",
  ],
  /** Product-adjacent labels that should not block Product role exclusion alone. */
  product_role: ["product_marketing"],
};

/** AI labels that imply architect / solutions roles are implementing AI-related work when AI/ML is excluded. */
const AI_SEMANTIC_ROLES_FOR_ADJACENT_COVERAGE = new Set<RoleCategory>([
  "ai_engineer",
  "ai_leader",
  "ai_ml_practitioner",
  "ai_practitioner",
  "ai_strategy",
  "ai_trainer",
  "data_scientist",
  "mlops_engineer",
]);

/** Function tags that count as AI-specific evidence for folding adjacent roles under AI/ML exclusion. */
const AI_FUNCTION_TAGS_FOR_PHASE1_ADJACENT = new Set<FunctionTag>([
  "ai_ml",
  "genai",
  "machine_learning",
  "llmops",
]);

/** Adjacent delivery/visibility roles folded under AI/ML when AI role tags or AI function tags apply. */
const AI_ADJACENT_ARCHITECT_ROLES = new Set<RoleCategory>([
  "technical_architect",
  "solutions_engineer",
  "technical_influencer",
]);

function buildPhase1RoleCoverageByCriterion(): Map<
  CampaignExclusionCriterionId,
  ReadonlySet<RoleCategory>
> {
  const map = new Map<CampaignExclusionCriterionId, ReadonlySet<RoleCategory>>();
  for (const c of CAMPAIGN_EXCLUSION_CRITERIA) {
    const set = new Set<RoleCategory>();
    const listed = c.matcher.roleCategories;
    if (listed) {
      for (const r of listed) {
        set.add(r);
      }
    }
    const extra = PHASE1_EXTRA_ROLE_COVERAGE[c.id];
    if (extra) for (const r of extra) set.add(r);
    map.set(c.id, set);
  }
  return map;
}

const PHASE1_ROLE_COVERAGE_BY_CRITERION = buildPhase1RoleCoverageByCriterion();

function classificationHasAiSemanticRole(classification: ProspectClassification): boolean {
  return classification.roleCategories.some((r) => AI_SEMANTIC_ROLES_FOR_ADJACENT_COVERAGE.has(r));
}

function classificationHasAiSignalsForPhase1Adjacent(classification: ProspectClassification): boolean {
  if (classificationHasAiSemanticRole(classification)) return true;
  return classification.functionTags.some((t) => AI_FUNCTION_TAGS_FOR_PHASE1_ADJACENT.has(t));
}

/**
 * Phase 1 "covered by selected exclusions" for a single role category.
 * Feeds Rule 2 vs Rule 3 in evaluatePhase1Exclusion (mixed-signal vs disqualify).
 */
export function roleCategoryCoveredByPhase1SelectedExclusions(
  role: RoleCategory,
  classification: ProspectClassification,
  selectedIds: readonly CampaignExclusionCriterionId[]
): boolean {
  if (role === "unknown") return false;
  const hasAiForAdjacent = classificationHasAiSignalsForPhase1Adjacent(classification);

  for (const id of selectedIds) {
    const staticSet = PHASE1_ROLE_COVERAGE_BY_CRITERION.get(id);
    if (staticSet?.has(role)) return true;
    if (id === "ai_ml_role" && hasAiForAdjacent && AI_ADJACENT_ARCHITECT_ROLES.has(role)) {
      return true;
    }
  }
  return false;
}

export function getCampaignExclusionCriterion(
  id: CampaignExclusionCriterionId
): CampaignExclusionCriterionDefinition | undefined {
  return CRITERION_BY_ID.get(id);
}

const EXCLUSION_GROUP_ORDER = ["Common exclusions", "Advanced / technical exclusions"] as const;

/** UI presentation: role-type exclusions first, then status / signal exclusions. */
export type CampaignExclusionDisplaySection = "role" | "status";

export const CAMPAIGN_EXCLUSION_SECTION_LABELS: Record<CampaignExclusionDisplaySection, string> = {
  role: "Role types",
  status: "Statuses & signals",
};

const SECTION_SORT: Record<CampaignExclusionDisplaySection, number> = {
  role: 0,
  status: 1,
};

/** Display order within each group + section (lower = earlier). */
const DISPLAY_ORDER: Record<
  CampaignExclusionCriterionId,
  { section: CampaignExclusionDisplaySection; order: number }
> = {
  // Common — role types (GTM → people → professional services → functions → specialty)
  sales_marketing: { section: "role", order: 10 },
  business_development_partnerships: { section: "role", order: 20 },
  customer_success: { section: "role", order: 30 },
  recruiter: { section: "role", order: 40 },
  human_resources: { section: "role", order: 50 },
  consultant: { section: "role", order: 60 },
  advisor_board_member: { section: "role", order: 70 },
  investor: { section: "role", order: 80 },
  admin: { section: "role", order: 90 },
  finance: { section: "role", order: 100 },
  operations: { section: "role", order: 110 },
  legal: { section: "role", order: 120 },
  healthcare: { section: "role", order: 130 },
  content_creator: { section: "role", order: 140 },
  student_academic: { section: "role", order: 150 },
  // Common — statuses & signals
  open_to_work: { section: "status", order: 10 },
  not_working: { section: "status", order: 20 },
  contractor: { section: "status", order: 30 },
  solo_company: { section: "status", order: 40 },
  // Advanced — role types (founder → engineering → security → product / GRC)
  founder: { section: "role", order: 10 },
  technical: { section: "role", order: 20 },
  engineering_leader: { section: "role", order: 30 },
  software_engineer: { section: "role", order: 40 },
  ai_ml_role: { section: "role", order: 50 },
  devops_platform: { section: "role", order: 60 },
  cloud_infrastructure: { section: "role", order: 70 },
  security_role: { section: "role", order: 80 },
  ciso: { section: "role", order: 90 },
  product_security: { section: "role", order: 100 },
  developer_security: { section: "role", order: 110 },
  product_role: { section: "role", order: 120 },
  grc_compliance: { section: "role", order: 130 },
  risk_leader: { section: "role", order: 140 },
  // Advanced — statuses & signals
  c_level: { section: "status", order: 10 },
};

function compareCriteriaForDisplay(
  a: CampaignExclusionCriterionDefinition,
  b: CampaignExclusionCriterionDefinition
): number {
  const ma = DISPLAY_ORDER[a.id] ?? { section: "role" as const, order: 999 };
  const mb = DISPLAY_ORDER[b.id] ?? { section: "role" as const, order: 999 };
  const sectionDiff = SECTION_SORT[ma.section] - SECTION_SORT[mb.section];
  if (sectionDiff !== 0) return sectionDiff;
  if (ma.order !== mb.order) return ma.order - mb.order;
  return a.label.localeCompare(b.label);
}

function sortCriteriaForDisplay(
  criteria: CampaignExclusionCriterionDefinition[]
): CampaignExclusionCriterionDefinition[] {
  return [...criteria].sort(compareCriteriaForDisplay);
}

function criteriaIntoDisplaySections(
  criteria: CampaignExclusionCriterionDefinition[]
): {
  section: CampaignExclusionDisplaySection;
  sectionLabel: string;
  criteria: CampaignExclusionCriterionDefinition[];
}[] {
  const sorted = sortCriteriaForDisplay(criteria);
  const sections: {
    section: CampaignExclusionDisplaySection;
    sectionLabel: string;
    criteria: CampaignExclusionCriterionDefinition[];
  }[] = [];

  for (const c of sorted) {
    const section = DISPLAY_ORDER[c.id]?.section ?? "role";
    const last = sections[sections.length - 1];
    if (!last || last.section !== section) {
      sections.push({
        section,
        sectionLabel: CAMPAIGN_EXCLUSION_SECTION_LABELS[section],
        criteria: [c],
      });
    } else {
      last.criteria.push(c);
    }
  }
  return sections;
}

export type CampaignExclusionGroupListItem = {
  group: string;
  sections: {
    section: CampaignExclusionDisplaySection;
    sectionLabel: string;
    criteria: CampaignExclusionCriterionDefinition[];
  }[];
};

/** Legacy shape before sectioned UI (criteria at group root). */
type LegacyExclusionGroupListItem = {
  group: string;
  criteria?: CampaignExclusionCriterionDefinition[];
  sections?: CampaignExclusionGroupListItem["sections"];
};

function normalizeExclusionGroupListItem(
  item: LegacyExclusionGroupListItem
): CampaignExclusionGroupListItem {
  if (Array.isArray(item.sections) && item.sections.length > 0) {
    return {
      group: item.group,
      sections: item.sections.map((s) => ({
        section: s.section,
        sectionLabel: s.sectionLabel,
        criteria: s.criteria ?? [],
      })),
    };
  }
  return {
    group: item.group,
    sections: criteriaIntoDisplaySections(item.criteria ?? []),
  };
}

export function listCampaignExclusionGroups(): CampaignExclusionGroupListItem[] {
  const byGroup = new Map<string, CampaignExclusionCriterionDefinition[]>();
  for (const c of CAMPAIGN_EXCLUSION_CRITERIA) {
    const list = byGroup.get(c.group) ?? [];
    list.push(c);
    byGroup.set(c.group, list);
  }
  const ordered: CampaignExclusionGroupListItem[] = EXCLUSION_GROUP_ORDER.map((group) => ({
    group,
    sections: criteriaIntoDisplaySections(byGroup.get(group) ?? []),
  })).filter((g) => g.sections.some((s) => s.criteria.length > 0));
  for (const [group, criteria] of byGroup.entries()) {
    if (!EXCLUSION_GROUP_ORDER.includes(group as (typeof EXCLUSION_GROUP_ORDER)[number])) {
      ordered.push({ group, sections: criteriaIntoDisplaySections(criteria) });
    }
  }
  return ordered
    .map((g) => normalizeExclusionGroupListItem(g))
    .filter((g) => g.sections.length > 0);
}

/** True when a role category appears in any selected criterion's roleCategories list (literal only). */
export function isRoleCategoryListedInSelectedExclusions(
  role: RoleCategory,
  selectedIds: readonly CampaignExclusionCriterionId[]
): boolean {
  for (const id of selectedIds) {
    const def = CRITERION_BY_ID.get(id);
    if (!def?.matcher.roleCategories?.includes(role)) continue;
    return true;
  }
  return false;
}

export function matchCampaignExclusionCriteria(
  classification: ProspectClassification,
  selectedIds: readonly CampaignExclusionCriterionId[]
): CampaignExclusionCriterionId[] {
  const matched: CampaignExclusionCriterionId[] = [];
  for (const id of selectedIds) {
    const def = CRITERION_BY_ID.get(id);
    if (!def) continue;
    if (classificationMatchesCriterion(classification, def.matcher)) {
      matched.push(id);
    }
  }
  return matched;
}

/** Stable “primary” exclusion for debug CSV: role-type rows before status rows, then DISPLAY_ORDER. */
function phase1DominantExclusionUiPriority(id: CampaignExclusionCriterionId): number {
  const d = DISPLAY_ORDER[id];
  if (!d) return 100_000;
  return SECTION_SORT[d.section] * 10_000 + d.order;
}

export function pickDominantMatchedCampaignExclusion(
  matched: readonly CampaignExclusionCriterionId[]
): CampaignExclusionCriterionId | null {
  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0] ?? null;
  return (
    [...matched].sort((a, b) => {
      const pa = phase1DominantExclusionUiPriority(a);
      const pb = phase1DominantExclusionUiPriority(b);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    })[0] ?? null
  );
}

function classificationMatchesCriterion(
  classification: ProspectClassification,
  matcher: CampaignCriterionMatcher
): boolean {
  if (matcher.custom?.(classification)) return true;

  const roleHit =
    Boolean(matcher.roleCategories?.length) &&
    (matcher.roleCategories ?? []).some((r) => classification.roleCategories.includes(r));

  const seniorityHit =
    Boolean(matcher.seniorityAnyOf?.length) &&
    (matcher.seniorityAnyOf ?? []).includes(classification.seniority);

  /** When both role list and seniority list exist with requireAllListedFields, require both. */
  if (
    matcher.requireAllListedFields &&
    matcher.roleCategories?.length &&
    matcher.seniorityAnyOf?.length
  ) {
    if (roleHit && seniorityHit) return true;
  } else {
    if (seniorityHit) return true;
    if (roleHit) return true;
  }

  if (matcher.openToWorkStatuses?.length) {
    const status = classification.openToWorkDetection?.status;
    if (status && matcher.openToWorkStatuses.includes(status)) return true;
  }

  if (
    matcher.employmentRelationships?.length &&
    matcher.employmentRelationships.includes(classification.employmentRelationship)
  ) {
    return true;
  }

  if (
    matcher.profileFlags?.length &&
    matcher.profileFlags.some((f) => classification.profileFlags.includes(f))
  ) {
    return true;
  }

  if (
    matcher.excludedRoleFlags?.length &&
    matcher.excludedRoleFlags.some((f) => classification.excludedRoleFlags.includes(f))
  ) {
    return true;
  }

  /** Function tags only count when this criterion has no role category list. */
  if (
    matcher.functionTags?.length &&
    !matcher.roleCategories?.length &&
    matcher.functionTags.some((t) => classification.functionTags.includes(t))
  ) {
    return true;
  }

  return false;
}
