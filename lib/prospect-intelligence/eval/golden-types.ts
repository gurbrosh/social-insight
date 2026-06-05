import type {
  EmploymentSource,
  OpenToWorkEvidenceSource,
  OpenToWorkStatus,
  Seniority,
} from "../types";
import type { ProfileExperienceRole } from "../profile-experience-types";

/**
 * Partial expectations for classifyProspectDeterministic — partial, not full equality.
 */
export type GoldenExpect = {
  roleCategoriesIncludes?: string[];
  /** At least one of these role categories must be present. */
  roleCategoriesIncludesAnyOf?: string[];
  roleCategoriesExcludes?: string[];
  profileFlagsIncludes?: string[];
  /** At least one of these profile flags must be present. */
  profileFlagsIncludesAnyOf?: string[];
  profileFlagsExcludes?: string[];
  functionTagsIncludes?: string[];
  /** At least one of these function tags must be present. */
  functionTagsIncludesAnyOf?: string[];
  functionTagsExcludes?: string[];
  openToWorkStatus?: OpenToWorkStatus;
  openToWorkEvidenceSource?: OpenToWorkEvidenceSource;
  currentTitleIsNull?: boolean;
  currentTitleEquals?: string | null;
  currentTitleContains?: string;
  /** current_title must not contain these substrings (case-insensitive). */
  currentTitleExcludes?: string | string[];
  currentCompanyIsNull?: boolean;
  currentCompanyEquals?: string | null;
  currentCompanyContains?: string;
  currentCompanyExcludes?: string | string[];
  educationAreaContains?: string;
  educationInstitutionContains?: string;
  pastTitleContains?: string;
  pastCompanyContains?: string;
  /** Every substring must appear in past_company (case-insensitive). */
  pastCompanyContainsAll?: string[];
  safeProfessionalReferenceContains?: string;
  needsReview?: boolean;
  classificationNeedsReview?: boolean;
  employmentNeedsReview?: boolean;
  /** Expected `seniority` on the classification output. */
  seniorityEquals?: Seniority;
  /** Exact inequality for current_title (trimmed) — fails if equal. */
  currentTitleNotEquals?: string;
  employmentSourceEquals?: EmploymentSource;
  currentRolesMinCount?: number;
};

export type GoldenFixture = {
  id: string;
  /** Human-readable label for reports (optional). */
  name?: string;
  headline: string;
  /** Optional post text; defaults to suite default when omitted. */
  postContent?: string | null;
  /** Profile experience rows (primary employment source in classifier). */
  profileExperienceRoles?: ProfileExperienceRole[];
  expect: GoldenExpect;
  /**
   * informational = failures are reported but do not fail the process (classifier backlog).
   * blocking = failures exit non-zero when not in --soft mode.
   */
  tier?: "blocking" | "informational";
};

export type GoldenSuiteFile = {
  version: number;
  neutralPostDefault: string;
  fixtures: GoldenFixture[];
};
