import type { ProspectClassification } from "@/lib/prospect-intelligence/types";

/** How a row entered the campaign candidate set. */
export type CampaignCandidateSourceType =
  | "post_based_candidate"
  | "cold_company_search"
  | "uploaded_csv"
  | "uploaded_json";

export type CampaignEmploymentSource = "current_positions" | "headline_fallback" | "unknown";

export type CampaignRawSource = "apify_company_employees" | "themes_analysis" | null;

export type CampaignExclusionCriterionId =
  | "open_to_work"
  | "investor"
  | "consultant"
  | "sales_marketing"
  | "not_working"
  | "recruiter"
  | "contractor"
  | "admin"
  | "finance"
  | "operations"
  | "human_resources"
  | "solo_company"
  | "student_academic"
  | "healthcare"
  | "content_creator"
  | "legal"
  | "customer_success"
  | "business_development_partnerships"
  | "advisor_board_member"
  | "technical"
  | "c_level"
  | "founder"
  | "ciso"
  | "security_role"
  | "engineering_leader"
  | "software_engineer"
  | "ai_ml_role"
  | "product_role"
  | "product_security"
  | "developer_security"
  | "cloud_infrastructure"
  | "devops_platform"
  | "grc_compliance"
  | "risk_leader";

export type Phase1Decision = "continue_to_enrichment" | "disqualify_phase1";

/** Unified campaign candidate (post-based, company search, or merged). */
export type CampaignCandidate = {
  linkedin_url: string;
  linkedin_url_normalized: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  headline: string | null;
  current_title: string | null;
  current_company: string | null;
  location: string | null;
  employment_source: CampaignEmploymentSource;

  source_types: CampaignCandidateSourceType[];
  first_source_type: CampaignCandidateSourceType;
  source_count: number;
  source_notes?: string;

  source_company_url: string | null;
  source_role_group: string | null;
  source_job_title_query: string | null;
  raw_source: CampaignRawSource;

  relevance_score: number | null;
  theme_name: string | null;
  post_url: string | null;
  total_reactions: number | null;
  themes_analysis_id: string | null;
  post_id: number | null;
  platform: string | null;

  /** Set at normalize time when Apify company-search payload had an explicit OTW field or headline text. */
  apify_open_to_work_present?: boolean;
};

/** @deprecated Use CampaignCandidate — kept for post-based collector return shape. */
export type PostBasedCampaignCandidate = {
  linkedin_url: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  headline: string | null;
  candidate_source_type: "post_based_candidate";
  relevance_score: number;
  theme_name: string | null;
  post_url: string | null;
  total_reactions: number;
  themes_analysis_id: string;
  post_id: number;
  platform: string;
};

export type CampaignPostBasedCollectStats = {
  droppedInvalid: number;
  droppedDedup: number;
  droppedCap: number;
  droppedSupportiveOnlyComment: number;
  windowStart: string;
  minRelevancePercent: number;
  rangeAmount: number;
  rangeUnit: string;
};

export type CampaignMergeStats = {
  postBasedCount: number;
  companySearchCount: number;
  duplicatesRemoved: number;
  totalLoaded: number;
};

export type CampaignCompanySearchRunStats = {
  rawCount: number;
  normalizedCount: number;
  cappedCount: number;
};

export type CampaignCandidatePreviewRow = CampaignCandidate & {
  phase1_decision?: Phase1Decision;
  phase1_disqualified_reason?: string | null;
  matched_exclusion_criteria?: CampaignExclusionCriterionId[];
  role_categories?: string;
  function_tags?: string;
  profile_flags?: string;
  classification_confidence?: number;
  employment_confidence?: number;
  classification_needs_review?: boolean;
  non_excluded_signals?: string;
  dominant_exclusion?: string;
  exclusion_reason?: string;
  why_continued_reason?: string;
  open_to_work_detection?: "detected" | "not_detected" | "unknown";
  open_to_work_source?:
    | "company_search"
    | "post_based"
    | "profile_enrichment"
    | "inferred_text_weak"
    | "unavailable";
  open_to_work_status_detail?: string;
  classification?: ProspectClassification;
};

/** @deprecated Use CampaignCandidatePreviewRow */
export type CampaignPostBasedPreviewRow = CampaignCandidatePreviewRow;

export type CampaignEnrichmentStatus =
  | "success"
  | "failed"
  | "not_found"
  | "parse_error"
  | "skipped_phase1_disqualified"
  | "pending";

export type CampaignEnrichedEmploymentSource =
  | "profile_experience_current"
  | "current_positions"
  | "actor_current_fields"
  | "prior_candidate_source"
  | "headline_fallback"
  | "unknown";

/** Phase 1 fields preserved at enrichment time (CSV uses phase1_* column names). */
export type CampaignPhase1Snapshot = {
  phase1_decision?: Phase1Decision;
  phase1_status?: string;
  phase1_role_categories?: string;
  phase1_function_tags?: string;
  phase1_profile_flags?: string;
  phase1_matched_exclusion_criteria?: string;
  phase1_non_excluded_signals?: string;
  phase1_dominant_exclusion?: string;
  phase1_exclusion_reason?: string;
  phase1_why_continued_reason?: string;
  phase1_classification_confidence?: number;
  phase1_classification_needs_review?: boolean;
  phase1_open_to_work_detection?: CampaignCandidatePreviewRow["open_to_work_detection"];
  phase1_open_to_work_source?: CampaignCandidatePreviewRow["open_to_work_source"];
};

export type CampaignEnrichedCandidateRow = CampaignCandidatePreviewRow &
  CampaignPhase1Snapshot & {
    name: string;
    enrichment_status: CampaignEnrichmentStatus;
    enrichment_error?: string | null;
    enriched_at?: string | null;
    enrichment_actor: "full_linkedin_profile";
    enrichment_source: "apify_profile_scraper";
    enriched_current_title?: string | null;
    enriched_current_company?: string | null;
    enriched_current_company_linkedin_url?: string | null;
    enriched_employment_source: CampaignEnrichedEmploymentSource;
    enriched_employment_confidence: number;
    enriched_current_roles?: string;
    enriched_current_roles_json?: string;
    experience_count: number;
    current_experience_count: number;
    past_companies?: string;
    past_titles?: string;
    about?: string | null;
    skills?: string;
    email?: string | null;
    mobile?: string | null;
    contact_source?: string | null;
    open_to_work_raw_value?: string | null;
    enriched_role_categories?: string;
    enriched_function_tags?: string;
    enriched_profile_flags?: string;
    enriched_classification_confidence?: number;
    enriched_classification_needs_review?: boolean;
    post_enrichment_exclusion_matches?: string;
    post_enrichment_would_disqualify?: boolean;
    post_enrichment_reason?: string | null;
  };

export type CampaignEnrichmentRunStats = {
  attempted: number;
  successful: number;
  failed: number;
  notFound: number;
  skippedPhase1Disqualified: number;
  withExperienceData: number;
  withEmail: number;
  withMobile: number;
  openToWorkDetected: number;
  openToWorkStillUnknown: number;
  postEnrichmentWouldDisqualify: number;
};

export type CampaignPrerequisiteResult =
  | { ok: true }
  | { ok: false; code: "missing_product" | "missing_objective"; message: string };
