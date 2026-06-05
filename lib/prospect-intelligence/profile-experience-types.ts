/** How a single profile experience row was obtained (provenance). */
export type ExperienceItemSource =
  | "scraper_payload_experience_array"
  | "validation_profile_experience_text"
  | "public_profile_html_experience_section"
  | "structured_profile_metadata"
  | "llm_inferred_from_headline"
  | "model_generated_from_headline"
  | "headline_candidate"
  | "ambiguous_affiliation"
  | "credential_or_community_affiliation"
  | "slogan_or_topic_phrase"
  | "source_unavailable";

/** Normalized LinkedIn profile experience row (scraped or ingested). */
export type ProfileExperienceRole = {
  title: string;
  company: string;
  startDate?: string | null;
  endDate?: string | null;
  dateRange?: string | null;
  location?: string | null;
  description?: string | null;
  isCurrent?: boolean;
  experienceItemSource?: ExperienceItemSource;
  evidenceExcerpt?: string | null;
  itemConfidence?: number;
  rejectionReason?: string | null;
};

export type ProfileExperienceValidationSummary = {
  rawProfileExperienceInputCount: number;
  validProfileExperienceInputCount: number;
  rejectedProfileExperienceInputCount: number;
  rejectionReasons: string[];
  primaryExperienceItemSource?: ExperienceItemSource;
  primaryEvidenceExcerpt?: string | null;
};

export type EmploymentRoleRef = {
  title: string;
  company: string;
};

/** Snake_case employment snapshot persisted on enrichment rows. */
export type ResolvedEmploymentSnapshot = {
  current_title: string | null;
  current_company: string | null;
  past_title: string | null;
  past_company: string | null;
  current_roles: EmploymentRoleRef[];
  past_roles: EmploymentRoleRef[];
  employment_source: string;
  employment_confidence: number;
  employment_reason: string;
};

export type EmploymentSource =
  | "profile_experience"
  | "structured_profile"
  | "headline"
  | "unknown";

export type ResolvedProspectEmployment = {
  currentTitle: string | null;
  currentCompany: string | null;
  pastTitle: string | null;
  pastCompany: string | null;
  currentRoles: EmploymentRoleRef[];
  pastRoles: EmploymentRoleRef[];
  employmentSource: EmploymentSource;
  employmentConfidence: number;
  employmentReason: string;
  educationInstitution: string | null;
  educationArea: string | null;
  profileFlags: Array<"multiple_current_roles" | "past_role_signal">;
  employmentNeedsReview: boolean;
  primaryExperienceItemSource?: ExperienceItemSource;
  primaryEvidenceExcerpt?: string | null;
  headlineEmploymentCandidateTitle?: string | null;
  headlineEmploymentCandidateCompany?: string | null;
};

export const PROFILE_EXPERIENCE_ROLES_METADATA_KEY = "profileExperienceRoles";
export const PROFILE_EXPERIENCE_ANALYSIS_METHOD_METADATA_KEY = "profileExperienceAnalysisMethod";
