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
    | "unavailable";
  open_to_work_status_detail?: string;
  classification?: ProspectClassification;
};

/** @deprecated Use CampaignCandidatePreviewRow */
export type CampaignPostBasedPreviewRow = CampaignCandidatePreviewRow;

export type CampaignPrerequisiteResult =
  | { ok: true }
  | { ok: false; code: "missing_product" | "missing_objective"; message: string };
