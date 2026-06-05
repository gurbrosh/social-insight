/** Person Intelligence — canonical types (evidence-first classification + routing). */

/**
 * Classifier output labels: use these tuples as the single source of truth (Zod + TS).
 * Keep sorted alphabetically when adding values.
 */
export const ROLE_CATEGORY_VALUES = [
  "academic",
  "account_management",
  "ai_engineer",
  "ai_creator",
  "ai_leader",
  "ai_ml_practitioner",
  "ai_practitioner",
  "ai_strategy",
  "ai_trainer",
  "advisor",
  "analyst_security",
  "analytics_engineer",
  "automation_specialist",
  "board_member",
  "bi_developer",
  "business_analyst",
  "business_advisor",
  "business_architect",
  "business_development",
  "business_leader",
  "change_management_leader",
  "channel_leader",
  "chief_of_staff",
  "cloud_architect",
  "cloud_engineer",
  "cloud_industry_leader",
  "coach_or_advisor",
  "commercial_leader",
  "communications_leader",
  "competitor",
  "consultant",
  "content_creator",
  "copywriter",
  "customer_experience",
  "customer_success",
  "customer_success_leader",
  "customer_support",
  "customer_support_leader",
  "data_engineer",
  "data_leader",
  "data_platform",
  "data_practitioner",
  "data_scientist",
  "data_security",
  "designer",
  "devops_engineer",
  "early_career",
  "education_leader",
  "educator",
  "engineering_leader",
  "executive_assistant",
  "executive_leader",
  "executive_operations",
  "field_operations",
  "finance_accounting",
  "financial_analyst",
  "founder",
  "founder_or_principal",
  "frontend_engineer",
  "full_stack_engineer",
  "growth_leader",
  "gtm_leader",
  "healthtech",
  "hr_leader",
  "identity_security",
  "infrastructure_engineer",
  "instructional_designer",
  "intern_or_student",
  "investor",
  "it_operations",
  "job_seeker",
  "legal_counsel",
  "legal_services",
  "marketing_leader",
  "marketing_consultant",
  "media_analyst",
  "media_creator",
  "monetization_leader",
  "mlops_engineer",
  "network_engineer",
  "operations_leader",
  "operations_support",
  "owner_operator",
  "partnerships_leader",
  "people_leader",
  "past_founder",
  "personal_brand_consultant",
  "platform_engineer",
  "portfolio_leader",
  "product_builder",
  "product_designer",
  "product_leader",
  "product_manager",
  "product_marketing",
  "product_operations",
  "product_specialist",
  "program_manager",
  "project_manager",
  "quality_engineering",
  "recruiter",
  "regional_leader",
  "research_analyst",
  "revenue_leader",
  "revops",
  "robotics_engineer",
  "sales_account",
  "sales_leader",
  "security_advisor",
  "security_leader",
  "security_practitioner",
  "software_engineer",
  "solutions_engineer",
  "solo_founder",
  "sre_engineer",
  "staffing_leader",
  "startup_business_development",
  "strategy_consultant",
  "strategy_leader",
  "student",
  "supply_chain",
  "systems_architect",
  "target_buyer",
  "technical_architect",
  "technical_enablement",
  "technical_evangelist",
  "technical_influencer",
  "technical_lead",
  "technical_recruiter",
  "technical_support_leader",
  "technical_trainer",
  "technology_executive",
  "technology_leader",
  "technology_strategist",
  "transformation_leader",
  "venture_capital",
  "web3_practitioner",
  "web_developer",
  "unknown",
] as const;

/** Zod `z.enum` expects a non-empty tuple; cast from the stable const array. */
export const ROLE_CATEGORY_ENUM = ROLE_CATEGORY_VALUES as unknown as readonly [
  RoleCategory,
  ...RoleCategory[],
];

export type RoleCategory = (typeof ROLE_CATEGORY_VALUES)[number];

export const FUNCTION_TAG_VALUES = [
  "abm",
  "academic",
  "account_management",
  "accounting",
  "administration",
  "advisory",
  "agentic_ai",
  "agile",
  "ai_ml",
  "analysis",
  "analytics",
  "analytics_engineering",
  "angular",
  "application_security",
  "appsec",
  "automation",
  "aws",
  "bioinformatics",
  "blockchain",
  "brand",
  "business_analysis",
  "business_development",
  "business_intelligence",
  "business_transformation",
  "change_management",
  "channel",
  "ci_cd",
  "cloud",
  "cloud_enablement",
  "commercial_enablement",
  "communications",
  "commercial",
  "compliance",
  "computer_science",
  "consulting",
  "content",
  "content_writing",
  "content_strategy",
  "copywriting",
  "continuous_improvement",
  "conversion",
  "crm",
  "cybersecurity",
  "customer_experience",
  "customer_service",
  "customer_success",
  "customer_advocacy",
  "data",
  "data_analytics",
  "data_analysis",
  "data_ops",
  "data_platform",
  "data_science",
  "design",
  "devops",
  "devtools",
  "digital_transformation",
  "distributed_systems",
  "dotnet",
  "education",
  "enablement",
  "engineering",
  "enterprise_architecture",
  "enterprise_ai",
  "enterprise_sales",
  "enterprise_software",
  "enterprise_transformation",
  "erp",
  "esg",
  "etl",
  "evangelism",
  "executive_support",
  "finance",
  "financial_modeling",
  "financial_services",
  "founder",
  "founder_support",
  "frontend",
  "full_stack",
  "genai",
  "golang",
  "go_to_market",
  "growth",
  "growth_marketing",
  "hackathons",
  "high_stakes_ai",
  "healthcare",
  "hr",
  "identity_access",
  "innovation",
  "instructional_design",
  "investor",
  "it_service_management",
  "it_operations",
  "it_services",
  "java",
  "kubernetes",
  "landing_pages",
  "lead_generation",
  "leadership",
  "legal",
  "life_sciences",
  "linux",
  "llmops",
  "linkedin_growth",
  "market_research",
  "machine_learning",
  "marketing",
  "media",
  "microsoft_dynamics",
  "microservices",
  "mlops",
  "modernization",
  "monetization",
  "network_programming",
  "network_security",
  "nextjs",
  "offensive_security",
  "oil_and_gas",
  "okta",
  "operations",
  "organizational_change",
  "partnerships",
  "people_transformation",
  "personal_branding",
  "penetration_testing",
  "php",
  "platform",
  "podcasting",
  "portfolio_management",
  "power_bi",
  "power_platform",
  "procurement",
  "private_equity",
  "product",
  "product_engineering",
  "product_marketing",
  "process_improvement",
  "program_management",
  "project_management",
  "public_safety",
  "python",
  "qa",
  "rag",
  "react",
  "recruiting",
  "red_team",
  "regulated_industries",
  "regional_leadership",
  "reliability",
  "research",
  "revenue_operations",
  "revenue",
  "robotics",
  "risk_operations",
  "sales",
  "sales_engineering",
  "sase",
  "screening",
  "scrum",
  "secops",
  "security",
  "social_media",
  "software_development",
  "spring",
  "spring_boot",
  "sql",
  "sre",
  "staffing",
  "startups",
  "statistics",
  "strategy",
  "strategic_sourcing",
  "supply_chain",
  "talent_mapping",
  "tcp_ip",
  "technical_architecture",
  "technical_search",
  "technical_training",
  "technology",
  "telecom",
  "typescript",
  "vector_databases",
  "venture_capital",
  "video",
  "web3",
  "web_development",
  "unknown",
] as const;

export const FUNCTION_TAG_ENUM = FUNCTION_TAG_VALUES as unknown as readonly [
  FunctionTag,
  ...FunctionTag[],
];

export type FunctionTag = (typeof FUNCTION_TAG_VALUES)[number];

/** What kind of organization the primary employer is (if any). Not the same as employment relationship. */
export const ORGANIZATION_TYPE_VALUES = [
  "unknown",
  "commercial_employer",
  "small_business",
  "consultancy_or_independent",
] as const;

export const ORGANIZATION_TYPE_ENUM = ORGANIZATION_TYPE_VALUES as unknown as readonly [
  OrganizationType,
  ...OrganizationType[],
];

export type OrganizationType = (typeof ORGANIZATION_TYPE_VALUES)[number];

/** How the person relates to work / income — separate from organization taxonomy. */
export const EMPLOYMENT_RELATIONSHIP_VALUES = [
  "unknown",
  "education_primary",
  "named_employer",
  "founder_owner",
  "independent_professional",
  "ambiguous",
] as const;

export type EmploymentRelationship = (typeof EMPLOYMENT_RELATIONSHIP_VALUES)[number];

export const EMPLOYMENT_RELATIONSHIP_ENUM = EMPLOYMENT_RELATIONSHIP_VALUES as unknown as readonly [
  EmploymentRelationship,
  ...EmploymentRelationship[],
];

export type EvidenceSource =
  | "linkedin_author_headline"
  | "linkedin_author_metadata"
  | "linkedin_extra_json"
  | "linkedin_profile_experience"
  | "source_post_text"
  | "source_comment_text"
  | "existing_db_record"
  | "manual_override"
  | "search_snippet"
  | "public_profile_fetch"
  | "enrichment_vendor"
  | "llm_reconciler";

export type EmploymentSource =
  | "profile_experience"
  | "structured_profile"
  | "headline"
  | "unknown";

export type EmploymentRoleRef = {
  title: string;
  company: string;
};

/** Open to Work visibility from public/observable evidence only (not recruiters-only mode). */
export type OpenToWorkStatus =
  | "public_signal_detected"
  | "text_signal_detected"
  | "not_observed"
  | "unknown";

/** Where the primary Open-to-Work / job-search signal was observed (debugging / exports). */
export type OpenToWorkEvidenceSource =
  | "headline"
  | "profile_metadata"
  | "image_alt_text"
  | "badge_metadata"
  | "author_metadata"
  | "source_post_text"
  | "source_comment_text";

export type OpenToWorkDetection = {
  status: OpenToWorkStatus;
  confidence: number;
  source?: string;
  evidence?: string;
  reason?: string;
  /** Primary field that triggered detection (clearest signal). */
  evidenceSource?: OpenToWorkEvidenceSource;
  /** Headline/context when `public_signal_detected` and headline also matched. */
  evidenceSupporting?: string;
};

/** Neutral labels derived from evidence (not outreach policy). */
export type ProfileFlag =
  | "advisor_signal"
  | "affiliation_signal"
  | "ambiguous_employment"
  | "ambiguous_professional_identity"
  | "board_member_signal"
  | "career_transition_signal"
  | "coach_signal"
  | "commercial_non_core_signal"
  | "competitor_signal"
  | "consultant_signal"
  | "early_career_signal"
  | "early_team_signal"
  | "education_signal"
  | "ex_company_signal"
  | "former_intern_signal"
  | "founding_engineer_signal"
  | "founder_signal"
  | "freelance_signal"
  | "informal_title_signal"
  | "investor_signal"
  | "job_search_signal"
  | "job_seeker_signal"
  | "junior_or_intern_signal"
  | "micro_employer_signal"
  | "multiple_roles_signal"
  | "multiple_current_roles"
  | "non_target_function_signal"
  | "open_to_work_public_signal"
  | "open_to_work_text_signal"
  | "past_founder_signal"
  | "past_role_signal"
  | "platform_manager_signal"
  | "possible_small_business"
  | "recruiter_signal"
  | "retired_signal"
  | "solo_operator_signal"
  | "student_signal"
  | "typo_signal"
  | "url_or_handle_signal"
  | "weak_evidence"
  | "weak_post_context_signal";

export type ExclusionFlag =
  | "solo_operator"
  | "consultant"
  | "recruiter"
  | "competitor"
  | "open_to_work"
  | "investor"
  | "student"
  | "low_seniority"
  | "wrong_function"
  | "company_too_small"
  | "insufficient_evidence"
  | "non_buyer"
  | "low_relevance";

export type Seniority =
  | "c_level"
  | "vp"
  | "director"
  | "manager"
  | "principal"
  | "ic"
  | "senior_ic"
  | "staff"
  | "founder"
  | "owner"
  | "founder_owner"
  | "investor"
  | "student"
  | "unknown";

export type CompanySizeSignal =
  | "solo"
  | "tiny"
  | "startup"
  | "mid_market"
  | "enterprise"
  | "unknown";

export type RoutingRecommendation =
  | "unrouted"
  | "email_outreach"
  | "linkedin_outreach"
  | "both"
  | "exclude"
  | "manual_review"
  | "investor_nurture"
  | "competitor_watch";

export type ProspectOutreachBucket =
  | "email"
  | "linkedin"
  | "both"
  | "investor_nurture"
  | "competitor_watch"
  | "excluded"
  | "manual_review";

export type ProspectEvidence = {
  id?: string;
  source: EvidenceSource;
  sourceUrl?: string;
  rawText: string;
  extractedSignals: string[];
  confidence: number;
  observedAt: string;
  metadata?: Record<string, unknown>;
};

export type ProspectClassification = {
  personId?: string;
  linkedinUrl?: string;
  name?: string;

  currentTitle?: string | null;
  currentCompany?: string | null;
  /** Prior role from ex-/former headline segments when not treated as current employment. */
  pastTitle?: string | null;
  pastCompany?: string | null;
  /** Alias for most recent ended role (same as pastTitle when sourced from profile experience). */
  lastTitle?: string | null;
  lastCompany?: string | null;
  /** All active roles when profile experience lists multiple current positions. */
  currentRoles?: EmploymentRoleRef[];
  /** Ended roles from profile experience (most recent first when available). */
  pastRoles?: EmploymentRoleRef[];
  employmentSource?: EmploymentSource;
  employmentReason?: string | null;
  employmentConfidence: number;
  /** Validated experience rows used for profile_experience resolution. */
  profileExperienceInputCount?: number;
  rawProfileExperienceInputCount?: number;
  validProfileExperienceInputCount?: number;
  rejectedProfileExperienceInputCount?: number;
  primaryExperienceItemSource?: string;
  experienceEvidenceExcerpt?: string | null;
  profileExperienceRejectionReason?: string | null;
  employmentEnrichmentAttempted?: "yes" | "no";
  employmentEnrichmentSource?: "cached_db" | "in_run" | "none";
  employmentEnrichmentStatus?: string;
  /** Where current_title was derived (profile_experience | headline | unknown). */
  currentTitleSource?: EmploymentSource;
  /** Where current_company was derived (profile_experience | headline | unknown). */
  currentCompanySource?: EmploymentSource;
  /** Confidence for current_company specifically (mirrors employment when sourced together). */
  currentCompanyConfidence?: number;
  /** yes when valid_profile_experience_input_count > 0. */
  profileExperienceDataAvailableValid?: "yes" | "no";
  /** Last known acquisition/enrichment status for profile experience (roles_found, unavailable, etc.). */
  profileExperienceAcquisitionStatus?: string | null;
  /** Headline parse retained when profile experience exists; not used for current_* . */
  headlineEmploymentCandidateTitle?: string | null;
  headlineEmploymentCandidateCompany?: string | null;

  /** School or program focus when primary context is education, not employment. */
  educationInstitution?: string | null;
  educationArea?: string | null;
  /** Secondary academic orgs (e.g. adjunct role) — not primary employer. */
  affiliations?: string[];

  professionalSummary: string | null;
  safeProfessionalReference: string | null;

  roleCategories: RoleCategory[];
  /** Neutral signal labels (preferred over excludedRoleFlags for display). */
  profileFlags: ProfileFlag[];
  /**
   * Legacy field kept for routing rules / DB conditions; mirrors policy-oriented
   * signals. Prefer profileFlags for new UI.
   */
  excludedRoleFlags: ExclusionFlag[];
  outreachTags: string[];

  seniority: Seniority;
  functionTags: FunctionTag[];
  companySizeSignal: CompanySizeSignal;
  /** Domain/market phrases in headline (e.g. enterprise_software); not employer size. */
  marketSegmentTerms?: string[];
  /**
   * Kind of organization associated with the primary employer name (when present).
   * Does not encode whether the person is a student vs employee — use `employmentRelationship`.
   */
  companyType?: OrganizationType | null;
  /**
   * Relationship to primary work context (employee at named org, founder, student, independent, etc.).
   * Orthogonal to `companyType` (organization shape).
   */
  employmentRelationship: EmploymentRelationship;

  routingRecommendation: RoutingRecommendation;
  confidence: number;
  /**
   * Classification/title-company ambiguity only (legacy `needsReview` mirrors this).
   * Use `outreachNeedsReview` for weak source-post or non-target-role context.
   */
  classificationNeedsReview: boolean;
  /** Ambiguous or missing title/company extraction (orthogonal to role label quality). */
  employmentNeedsReview?: boolean;
  /** Weak post text, generic engagement, or similar — orthogonal to label extraction quality. */
  outreachNeedsReview?: boolean;
  /** @deprecated alias for `classificationNeedsReview`; retained for rules and snapshots. */
  needsReview: boolean;
  reason: string;

  evidence: ProspectEvidence[];

  classifierVersion?: string;

  /** Observable Open-to-Work / job-search signals; recruiters-only mode is not inferred. */
  openToWorkDetection?: OpenToWorkDetection;
};

export type TemplateVariableName =
  | "firstName"
  | "currentCompany"
  | "currentTitle"
  | "professionalSummary"
  | "safeProfessionalReference"
  | "sourcePostTopic"
  | "sourcePostUrl"
  | "detectedPain"
  | "productAngle";

export type OutreachTemplateType =
  | "connection_request"
  | "linkedin_dm"
  | "linkedin_comment"
  | "email_initial"
  | "email_followup"
  | "investor_note"
  | "manual_review_note";

export type OutreachTemplateDefinition = {
  id: string;
  projectId: string;
  name: string;
  channel: "email" | "linkedin";
  templateType: OutreachTemplateType;
  appliesToRoleCategories: RoleCategory[];
  appliesToFunctionTags: string[];
  appliesToSeniority?: Seniority[];
  employmentConfidenceThreshold: number;
  requiresHighConfidenceEmployment: boolean;
  requiresSourcePostContext: boolean;
  subjectTemplate?: string;
  bodyTemplate: string;
  variables: TemplateVariableName[];
  fallbackBehavior: {
    ifNoCompany: "omit" | "useSafeReference" | "manualReview";
    ifNoTitle: "omit" | "useRoleCategory" | "manualReview";
    ifLowConfidence: "manualReview" | "useGenericTemplate" | "exclude";
  };
  priority: number;
  enabled: boolean;
};

export type RuleCondition =
  | { field: "roleCategory"; op: "in" | "notIn"; values: RoleCategory[] }
  | { field: "excludedRoleFlags"; op: "in" | "notIn"; values: ExclusionFlag[] }
  | { field: "functionTags"; op: "in" | "notIn"; values: FunctionTag[] }
  | { field: "seniority"; op: "eq" | "in"; values: Seniority[] }
  | { field: "companySizeSignal"; op: "eq" | "in"; values: CompanySizeSignal[] }
  | { field: "currentCompany"; op: "matchesAny"; patterns: string[] }
  | { field: "currentTitle"; op: "containsAny"; keywords: string[] }
  | { field: "headline"; op: "containsAny"; keywords: string[] }
  | { field: "platform"; op: "eq"; value: string }
  | { field: "themeRelevance"; op: "gte" | "lte"; value: number }
  | {
      field: "classificationConfidence";
      op: "gte" | "lte" | "between";
      value?: number;
      max?: number;
    }
  | { field: "employmentConfidence"; op: "gte" | "lte"; value: number }
  | { field: "competitorList"; op: "matched" }
  | { field: "investorFlag"; op: "isTrue" | "isFalse" }
  | { field: "openToWorkFlag"; op: "isTrue" | "isFalse" }
  | { field: "needsReview"; op: "isTrue" | "isFalse" };

export type RuleAction =
  | { type: "exclude_from_outreach" }
  | { type: "manual_review" }
  | { type: "route"; target: RoutingRecommendation }
  | { type: "set_bucket"; bucket: ProspectOutreachBucket }
  | { type: "add_tag"; tags: string[] }
  | { type: "assign_template"; templateId: string }
  | { type: "assign_sequence"; sequenceId: string }
  | { type: "suppress_title_company_personalization" }
  | { type: "require_manual_approval" };

export type ProspectRoutingRuleDefinition = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  priority: number;
  notes?: string;
  conditionLogic: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
};

/** Context passed to the rule engine (classification + per-candidate facts). */
export type RuleEngineInput = {
  classification: ProspectClassification;
  platform: string;
  /** ThemesAnalysis.relevance_score 0–100 when available */
  themeRelevancePercent: number | null;
  /** Concatenated headline evidence for headline conditions */
  headlineText: string;
  competitorMatched: boolean;
};

export type RuleEngineResult = {
  bucket: ProspectOutreachBucket | null;
  routingRecommendation: RoutingRecommendation;
  outreachTags: string[];
  templateId: string | null;
  suppressTitleCompanyPersonalization: boolean;
  requireManualApproval: boolean;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  reason: string;
  stoppedEarly: boolean;
};

export const PROSPECT_CLASSIFIER_VERSION = "1.10.8";
