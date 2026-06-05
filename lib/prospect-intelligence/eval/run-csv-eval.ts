import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hardSuspiciousCompany, looksLikeEducationTitle } from "../employment-guardrails";
import { fieldHasInvalidEmploymentLeakage } from "../sanitize-employment-placeholders";
import {
  ACCEPTED_PROFILE_EXPERIENCE_SOURCES,
  isFabricatedOrGenericCompany,
  isSparseNonEmploymentHeadline,
} from "../validate-profile-experience";
import { parseCsv, rowGet } from "./parse-csv";

export { hardSuspiciousCompany, looksLikeEducationTitle } from "../employment-guardrails";

const THRESHOLD_MIN = 280;
const THRESHOLD_MAX = 300;

const GENERIC_PHRASES = [
  "your perspective shared on the thread",
  "your professional background",
  "your technical and infrastructure work",
] as const;

/** Headline cues for explicit founder / owner / co-founder phrasing. */
export const FOUNDER_HEADLINE_HINT =
  /\bco[- ]?founder\b|\bcofounder\b|\bfounder\b(?:\s*@|\s+at\s+|\s+of\s+|\s*,|\s*[-–—/]|\s*&|\s*\|)|\bowner\s+(?:@|at)\b|(?:^|[|])\s*founder\b/i;

export type BaselineMetricsFile = {
  version?: number;
  generic_safe_reference_counts?: Record<string, number>;
  /** 0–100 */
  needs_review_rate_pct?: number;
  unknown_only_pct?: number;
};

function parseSemilist(s: string): string[] {
  return s
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function isUnknownOnly(cats: string[]): boolean {
  return cats.length === 1 && cats[0] === "unknown";
}

/** Tags that suggest real function signal (exclude unknown-only buckets). */
export function meaningfulFunctionTags(tags: string[]): string[] {
  const t = tags.map((x) => x.trim()).filter(Boolean);
  if (t.length === 0) return [];
  if (t.every((x) => x === "unknown")) return [];
  return t.filter((x) => x !== "unknown");
}

export function hasMeaningfulFunctionTags(tags: string[]): boolean {
  return meaningfulFunctionTags(tags).length > 0;
}

function headlineIsVentureInvestorOnly(headline: string): boolean {
  const h = headline.trim().toLowerCase();
  return h === "venture investor" || /^venture investor\s*[|]/.test(h);
}

/** Softer audit list (reported separately). */
function softSuspiciousCompany(company: string): boolean {
  if (!company.trim()) return false;
  const lc = company.toLowerCase();
  return (
    lc.includes("former") ||
    lc.includes("formerly") ||
    lc.includes("previously") ||
    lc.includes("ex-") ||
    lc.includes(" at scale")
  );
}

export type SuspiciousCsvRow = {
  rowNumber: number;
  displayName: string;
  headline: string;
  roleCategories: string;
  functionTags: string;
  currentTitle: string;
  currentCompany: string;
  profileFlags: string;
  safeProfessionalReference: string;
  score: number;
  reasons: string[];
};

/** Aggregate metrics for one row set (either every CSV row or unique `profile_url`). */
export type ClassificationCsvTierMetrics = {
  totalRows: number;
  openToWorkHistogram: Record<string, number>;
  unknownOnlyCount: number;
  unknownOnlyPct: number;
  unknownNeedsReviewNoCount: number;
  unknownWithTitleAndCompanyCount: number;
  unknownOnlyWithAnyFunctionTagsCount: number;
  unknownOnlyWithMeaningfulFunctionTagsCount: number;
  founderRoleCount: number;
  founderSignalCount: number;
  founderRoleWithoutSignalCount: number;
  likelyFounderFalsePositiveCount: number;
  investorCount: number;
  founderInvestorOverlapCount: number;
  ventureInvestorHeadlineWithFounderRoleCount: number;
  studentRoleCount: number;
  studentWithCompanyCount: number;
  genericPhraseCounts: Record<string, number>;
  softSuspiciousCompanyCount: number;
  hardSuspiciousCompanyCount: number;
  educationTitleLikelyCount: number;
  needsReviewYesCount: number;
  needsReviewRatePct: number;
  employmentSourceProfileExperienceCount: number;
  employmentSourceHeadlineCount: number;
  employmentSourceStructuredProfileCount: number;
  employmentSourceUnknownCount: number;
  multipleCurrentRolesFlagCount: number;
  educationAsEmploymentFailureCount: number;
  pastRoleAsCurrentFailureCount: number;
  employmentTitleFromExperienceCount: number;
  employmentTitleFromHeadlineCount: number;
  employmentCompanyFromExperienceCount: number;
  employmentCompanyFromHeadlineCount: number;
  profileExperienceInputRowsWithRolesCount: number;
  profileExperienceInputRolesTotal: number;
  profileExperienceDataAvailableCount: number;
  headlineEmploymentDespiteExperienceCount: number;
  headlineFallbackNoExperienceCount: number;
  openToWorkWithoutJobSeekerRoleCount: number;
  profileExperienceDataAvailableYes: boolean;
  profileExperienceInputCountAllZero: boolean;
  currentCompanyUnknownCount: number;
  currentCompanyHeadlineOnlyCount: number;
  lastCompanyPopulatedCount: number;
  lastCompanyHeadlineFallbackCount: number;
  lastCompanyFromProfileExperienceCount: number;
  lastCompanyFromHeadlineCount: number;
  pastCompanyPopulatedCount: number;
  profilesEnrichedBeforeClassificationCount: number;
  placeholderCurrentCompanyCount: number;
  placeholderLastCompanyCount: number;
  placeholderPastCompanyCount: number;
  placeholderCurrentRolesCount: number;
  placeholderPastRolesCount: number;
  placeholderEmploymentRowCount: number;
  profileExperienceWithPlaceholderCount: number;
  highConfidenceWithPlaceholderCount: number;
  needsReviewNoWithPlaceholderCount: number;
  nullAtRoleStringCount: number;
  validCurrentCompanyCount: number;
  validLastCompanyCount: number;
  syntheticCurrentCompanyCount: number;
  syntheticLastCompanyCount: number;
  syntheticPastCompanyCount: number;
  syntheticCurrentRolesCount: number;
  syntheticPastRolesCount: number;
  syntheticEmploymentRowCount: number;
  profileExperienceWithSyntheticCount: number;
  highConfidenceWithSyntheticCount: number;
  needsReviewNoWithSyntheticCount: number;
  sparseHeadlineSyntheticProfileExperienceCount: number;
  profileExperienceWithoutAcceptedSourceCount: number;
  highConfidenceProfileExperienceWithoutExcerptCount: number;
  profileExperienceWithoutEnrichmentProvenanceCount: number;
  profileExperienceInputCountHistogram: Record<string, number>;
  classificationNeedsReviewYesCount: number;
  employmentNeedsReviewYesCount: number;
  hardSuspiciousCompanySamples: string[];
  founderWithoutSignalSamples: string[];
  likelyFounderFalsePositiveSamples: string[];
  topSuspiciousRows: SuspiciousCsvRow[];
};

export type CsvEvalResult = {
  openToWorkColumnPresent: boolean;
  profileUrlColumnPresent: boolean;
  profileExperienceInputColumnPresent: boolean;
  csvInputRows: number;
  duplicateProfileExtraRows: number;
  /** Every row in file order */
  allRows: ClassificationCsvTierMetrics;
  /** First row per normalized `profile_url`; rows with empty URLs are not collapsed together */
  uniqueProfiles: ClassificationCsvTierMetrics;
};

function pushSuspicious(
  acc: { row: SuspiciousCsvRow }[],
  args: Omit<SuspiciousCsvRow, "score" | "reasons"> & { score: number; reasons: string[] }
): void {
  acc.push({ row: { ...args } });
}

function dedupeRowsByProfileUrl(rows: Record<string, string>[]): {
  uniqueFirstPerUrl: Record<string, string>[];
  duplicateSkipCount: number;
} {
  const seen = new Set<string>();
  const uniqueFirstPerUrl: Record<string, string>[] = [];
  const n = rows.length;
  let duplicateSkipCount = 0;

  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    const urlRaw = rowGet(row, "profile_url").trim().toLowerCase();
    const key = urlRaw.length > 0 ? urlRaw : `__missing_profile_url__:${i}`;
    if (seen.has(key)) {
      duplicateSkipCount++;
      continue;
    }
    seen.add(key);
    uniqueFirstPerUrl.push(row);
  }
  return { uniqueFirstPerUrl, duplicateSkipCount };
}

function evaluateCsvRows(
  rows: Record<string, string>[],
  openToWorkColumnPresent: boolean
): ClassificationCsvTierMetrics {
  const openToWorkHistogram: Record<string, number> = {};
  const genericPhraseCounts: Record<string, number> = Object.fromEntries(
    GENERIC_PHRASES.map((p) => [p, 0])
  ) as Record<string, number>;

  let unknownOnlyCount = 0;
  let unknownNeedsReviewNoCount = 0;
  let unknownWithTitleAndCompanyCount = 0;
  let unknownOnlyWithAnyFunctionTagsCount = 0;
  let unknownOnlyWithMeaningfulFunctionTagsCount = 0;
  let founderRoleCount = 0;
  let founderSignalCount = 0;
  let founderRoleWithoutSignalCount = 0;
  let likelyFounderFalsePositiveCount = 0;
  let investorCount = 0;
  let founderInvestorOverlapCount = 0;
  let ventureInvestorHeadlineWithFounderRoleCount = 0;
  let studentRoleCount = 0;
  let studentWithCompanyCount = 0;
  let softSuspiciousCompanyCount = 0;
  let hardSuspiciousCompanyCount = 0;
  let educationTitleLikelyCount = 0;
  let needsReviewYesCount = 0;
  let employmentSourceProfileExperienceCount = 0;
  let employmentSourceHeadlineCount = 0;
  let employmentSourceStructuredProfileCount = 0;
  let employmentSourceUnknownCount = 0;
  let multipleCurrentRolesFlagCount = 0;
  let educationAsEmploymentFailureCount = 0;
  let pastRoleAsCurrentFailureCount = 0;
  let employmentTitleFromExperienceCount = 0;
  let employmentTitleFromHeadlineCount = 0;
  let employmentCompanyFromExperienceCount = 0;
  let employmentCompanyFromHeadlineCount = 0;
  let profileExperienceInputRowsWithRolesCount = 0;
  let profileExperienceInputRolesTotal = 0;
  let profileExperienceDataAvailableCount = 0;
  let headlineEmploymentDespiteExperienceCount = 0;
  let headlineFallbackNoExperienceCount = 0;
  let openToWorkWithoutJobSeekerRoleCount = 0;
  let profileExperienceInputCountAllZero = true;
  let currentCompanyUnknownCount = 0;
  let currentCompanyHeadlineOnlyCount = 0;
  let lastCompanyPopulatedCount = 0;
  let lastCompanyHeadlineFallbackCount = 0;
  let lastCompanyFromProfileExperienceCount = 0;
  let lastCompanyFromHeadlineCount = 0;
  let pastCompanyPopulatedCount = 0;
  let profilesEnrichedBeforeClassificationCount = 0;
  let placeholderCurrentCompanyCount = 0;
  let placeholderLastCompanyCount = 0;
  let placeholderPastCompanyCount = 0;
  let placeholderCurrentRolesCount = 0;
  let placeholderPastRolesCount = 0;
  let placeholderEmploymentRowCount = 0;
  let profileExperienceWithPlaceholderCount = 0;
  let highConfidenceWithPlaceholderCount = 0;
  let needsReviewNoWithPlaceholderCount = 0;
  let nullAtRoleStringCount = 0;
  let validCurrentCompanyCount = 0;
  let validLastCompanyCount = 0;
  let syntheticCurrentCompanyCount = 0;
  let syntheticLastCompanyCount = 0;
  let syntheticPastCompanyCount = 0;
  let syntheticCurrentRolesCount = 0;
  let syntheticPastRolesCount = 0;
  let syntheticEmploymentRowCount = 0;
  let profileExperienceWithSyntheticCount = 0;
  let highConfidenceWithSyntheticCount = 0;
  let needsReviewNoWithSyntheticCount = 0;
  let sparseHeadlineSyntheticProfileExperienceCount = 0;
  let profileExperienceWithoutAcceptedSourceCount = 0;
  let highConfidenceProfileExperienceWithoutExcerptCount = 0;
  let profileExperienceWithoutEnrichmentProvenanceCount = 0;
  const profileExperienceInputCountHistogram: Record<string, number> = {};
  const acceptedSourceSet = ACCEPTED_PROFILE_EXPERIENCE_SOURCES as Set<string>;
  let classificationNeedsReviewYesCount = 0;
  let employmentNeedsReviewYesCount = 0;

  const hardSuspiciousCompanySamples: string[] = [];
  const founderWithoutSignalSamples: string[] = [];
  const likelyFounderFalsePositiveSamples: string[] = [];
  const suspiciousScratch: { row: SuspiciousCsvRow }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const headline = rowGet(row, "headline");
    const display = rowGet(row, "display_name");
    const rolesStr = rowGet(row, "role_categories");
    const cats = parseSemilist(rolesStr);
    const flags = parseSemilist(rowGet(row, "profile_flags"));
    const otw =
      (openToWorkColumnPresent ? rowGet(row, "open_to_work_status").trim() : "(column absent)") ||
      "not_observed";
    openToWorkHistogram[otw] = (openToWorkHistogram[otw] ?? 0) + 1;

    if (isUnknownOnly(cats)) unknownOnlyCount++;

    const needsReview = rowGet(row, "needs_review").toLowerCase();
    if (isUnknownOnly(cats) && needsReview === "no") unknownNeedsReviewNoCount++;

    const ct = rowGet(row, "current_title");
    const co = rowGet(row, "current_company");
    const fnTagsRaw = parseSemilist(rowGet(row, "function_tags"));
    const rolesDisplay = rowGet(row, "role_categories");
    const flagsDisplay = rowGet(row, "profile_flags");
    const fnTagsDisplay = rowGet(row, "function_tags");
    const safeRefDisplay = rowGet(row, "safe_professional_reference");

    if (cats.includes("unknown") && ct.trim() && co.trim()) unknownWithTitleAndCompanyCount++;

    if (cats.includes("founder")) founderRoleCount++;
    if (flags.includes("founder_signal")) founderSignalCount++;
    if (cats.includes("founder") && !flags.includes("founder_signal")) {
      founderRoleWithoutSignalCount++;
      if (founderWithoutSignalSamples.length < 15) {
        founderWithoutSignalSamples.push(`${i + 2}: ${display || headline || "(row)"}`);
      }
    }

    const founderFp = cats.includes("founder") && !FOUNDER_HEADLINE_HINT.test(headline);
    if (founderFp) {
      likelyFounderFalsePositiveCount++;
      if (likelyFounderFalsePositiveSamples.length < 15) {
        likelyFounderFalsePositiveSamples.push(`${i + 2}: ${display || headline.slice(0, 100)}`);
      }
    }

    if (cats.includes("investor")) investorCount++;
    if (cats.includes("founder") && cats.includes("investor")) founderInvestorOverlapCount++;

    if (headlineIsVentureInvestorOnly(headline) && cats.includes("founder")) {
      ventureInvestorHeadlineWithFounderRoleCount++;
    }

    const isStudent = cats.includes("student");
    if (isStudent) studentRoleCount++;
    if (isStudent && co.trim()) studentWithCompanyCount++;

    const safeRef = rowGet(row, "safe_professional_reference").toLowerCase();
    for (const phrase of GENERIC_PHRASES) {
      if (safeRef.includes(phrase)) genericPhraseCounts[phrase]++;
    }

    if (isUnknownOnly(cats) && fnTagsRaw.length > 0) unknownOnlyWithAnyFunctionTagsCount++;
    if (isUnknownOnly(cats) && hasMeaningfulFunctionTags(fnTagsRaw))
      unknownOnlyWithMeaningfulFunctionTagsCount++;

    if (co && softSuspiciousCompany(co)) softSuspiciousCompanyCount++;
    if (co && hardSuspiciousCompany(co)) {
      hardSuspiciousCompanyCount++;
      if (hardSuspiciousCompanySamples.length < 15) {
        hardSuspiciousCompanySamples.push(`${i + 2}: company="${co}" | ${headline.slice(0, 80)}`);
      }
    }

    if (looksLikeEducationTitle(ct)) educationTitleLikelyCount++;

    if (needsReview === "yes") needsReviewYesCount++;
    if (rowGet(row, "classification_needs_review").toLowerCase() === "yes") {
      classificationNeedsReviewYesCount++;
    }
    if (rowGet(row, "employment_needs_review").toLowerCase() === "yes") {
      employmentNeedsReviewYesCount++;
    }

    const empSource = rowGet(row, "employment_source").trim().toLowerCase();
    if (empSource === "profile_experience") {
      employmentSourceProfileExperienceCount++;
      if (ct.trim()) employmentTitleFromExperienceCount++;
      if (co.trim()) employmentCompanyFromExperienceCount++;
    } else if (empSource === "headline") {
      employmentSourceHeadlineCount++;
      if (ct.trim()) employmentTitleFromHeadlineCount++;
      if (co.trim()) employmentCompanyFromHeadlineCount++;
    } else if (empSource === "structured_profile") employmentSourceStructuredProfileCount++;
    else employmentSourceUnknownCount++;

    if (flags.includes("multiple_current_roles")) multipleCurrentRolesFlagCount++;

    const peInputRaw =
      rowGet(row, "valid_profile_experience_input_count").trim() ||
      rowGet(row, "profile_experience_input_count").trim();
    let peCount = 0;
    if (peInputRaw) {
      peCount = parseInt(peInputRaw, 10);
      if (!Number.isNaN(peCount) && peCount > 0) {
        profileExperienceInputRowsWithRolesCount++;
        profileExperienceInputRolesTotal += peCount;
      }
    }
    if (peCount > 0) {
      profileExperienceDataAvailableCount++;
      profileExperienceInputCountAllZero = false;
    }
    const peHistKey = String(peCount);
    profileExperienceInputCountHistogram[peHistKey] =
      (profileExperienceInputCountHistogram[peHistKey] ?? 0) + 1;

    const lastCoField = rowGet(row, "last_company").trim();
    const pastCoField = rowGet(row, "past_company").trim();

    if (!co.trim()) {
      currentCompanyUnknownCount++;
    } else if (empSource === "profile_experience") {
      /* counted in employmentCompanyFromExperienceCount */
    } else if (empSource === "headline" || (peCount === 0 && co.trim())) {
      currentCompanyHeadlineOnlyCount++;
    }

    const lastCo = lastCoField;
    const pastCo = pastCoField;
    if (lastCo) {
      lastCompanyPopulatedCount++;
      if (peCount === 0) lastCompanyHeadlineFallbackCount++;
      if (empSource === "profile_experience") lastCompanyFromProfileExperienceCount++;
      else if (empSource === "headline") lastCompanyFromHeadlineCount++;
    }
    if (pastCo) pastCompanyPopulatedCount++;

    if (rowGet(row, "employment_enriched_before_classification").toLowerCase() === "yes") {
      profilesEnrichedBeforeClassificationCount++;
    }
    const currentRolesField = rowGet(row, "current_roles").trim();
    const pastRolesField = rowGet(row, "past_roles").trim();
    const empConfNum = parseFloat(rowGet(row, "employment_confidence").trim());
    const empNeedsReview = rowGet(row, "employment_needs_review").toLowerCase();

    let rowHasPlaceholder = false;
    let rowHasSynthetic = false;
    if (fieldHasInvalidEmploymentLeakage(co)) {
      placeholderCurrentCompanyCount++;
      if (isFabricatedOrGenericCompany(co)) syntheticCurrentCompanyCount++;
      rowHasPlaceholder = true;
      rowHasSynthetic = true;
    }
    if (fieldHasInvalidEmploymentLeakage(lastCoField)) {
      placeholderLastCompanyCount++;
      if (isFabricatedOrGenericCompany(lastCoField)) syntheticLastCompanyCount++;
      rowHasPlaceholder = true;
      rowHasSynthetic = true;
    }
    if (fieldHasInvalidEmploymentLeakage(pastCoField)) {
      placeholderPastCompanyCount++;
      if (isFabricatedOrGenericCompany(pastCoField)) syntheticPastCompanyCount++;
      rowHasPlaceholder = true;
      rowHasSynthetic = true;
    }
    if (fieldHasInvalidEmploymentLeakage(currentRolesField)) {
      placeholderCurrentRolesCount++;
      if (fieldHasInvalidEmploymentLeakage(currentRolesField)) syntheticCurrentRolesCount++;
      rowHasPlaceholder = true;
      rowHasSynthetic = true;
    }
    if (fieldHasInvalidEmploymentLeakage(pastRolesField)) {
      placeholderPastRolesCount++;
      if (fieldHasInvalidEmploymentLeakage(pastRolesField)) syntheticPastRolesCount++;
      rowHasPlaceholder = true;
      rowHasSynthetic = true;
    }
    if (/\bnull\s*@\s*null\b/i.test(currentRolesField) || /\bnull\s*@\s*null\b/i.test(pastRolesField)) {
      nullAtRoleStringCount++;
      rowHasPlaceholder = true;
    }
    if (/\b@\s*null\b/i.test(currentRolesField) || /\b@\s*null\b/i.test(pastRolesField)) {
      nullAtRoleStringCount++;
      rowHasPlaceholder = true;
    }
    if (rowHasPlaceholder) placeholderEmploymentRowCount++;
    if (rowHasSynthetic) syntheticEmploymentRowCount++;
    if (empSource === "profile_experience" && rowHasPlaceholder) {
      profileExperienceWithPlaceholderCount++;
    }
    if (empSource === "profile_experience" && rowHasSynthetic) {
      profileExperienceWithSyntheticCount++;
    }
    if (rowHasPlaceholder && !Number.isNaN(empConfNum) && empConfNum >= 0.8) {
      highConfidenceWithPlaceholderCount++;
    }
    if (rowHasSynthetic && !Number.isNaN(empConfNum) && empConfNum >= 0.8) {
      highConfidenceWithSyntheticCount++;
    }
    if (rowHasPlaceholder && empNeedsReview === "no") {
      needsReviewNoWithPlaceholderCount++;
    }
    if (rowHasSynthetic && empNeedsReview === "no") {
      needsReviewNoWithSyntheticCount++;
    }
    if (co.trim() && !fieldHasInvalidEmploymentLeakage(co)) validCurrentCompanyCount++;
    if (lastCoField && !fieldHasInvalidEmploymentLeakage(lastCoField)) validLastCompanyCount++;

    const headlineField = rowGet(row, "headline");
    if (
      isSparseNonEmploymentHeadline(headlineField) &&
      peCount >= 2 &&
      empSource === "profile_experience" &&
      rowHasSynthetic
    ) {
      sparseHeadlineSyntheticProfileExperienceCount++;
    }

    const empReason = rowGet(row, "employment_reason").toLowerCase();
    const rolesLackEmployer =
      peCount > 0 &&
      (empReason.includes("missing title or company") ||
        empReason.includes("no resolvable current or past") ||
        empReason.includes("only education entries") ||
        (!rowGet(row, "current_roles").trim() &&
          !rowGet(row, "past_roles").trim() &&
          !ct.trim() &&
          !co.trim()));

    const experienceItemSource = rowGet(row, "experience_item_source").trim();
    const evidenceExcerpt = rowGet(row, "evidence_excerpt").trim();
    const enrichmentAttempted = rowGet(row, "employment_enrichment_attempted").toLowerCase();
    const enrichmentSource = rowGet(row, "employment_enrichment_source").trim();

    if (empSource === "profile_experience") {
      if (!experienceItemSource || !acceptedSourceSet.has(experienceItemSource)) {
        profileExperienceWithoutAcceptedSourceCount++;
      }
      if (
        !evidenceExcerpt &&
        !Number.isNaN(empConfNum) &&
        empConfNum >= 0.8 &&
        experienceItemSource !== "scraper_payload_experience_array"
      ) {
        highConfidenceProfileExperienceWithoutExcerptCount++;
      }
      if (
        peCount > 0 &&
        enrichmentSource === "none" &&
        (experienceItemSource === "validation_profile_experience_text" ||
          experienceItemSource === "public_profile_html_experience_section" ||
          experienceItemSource === "structured_profile_metadata")
      ) {
        profileExperienceWithoutEnrichmentProvenanceCount++;
      }
    }

    if (peCount > 0 && empSource === "headline" && !rolesLackEmployer) {
      headlineEmploymentDespiteExperienceCount++;
    }
    if (peCount === 0 && empSource === "headline") {
      headlineFallbackNoExperienceCount++;
    }

    const otwActive =
      otw === "text_signal_detected" || otw === "public_signal_detected";
    if (otwActive && !cats.includes("job_seeker") && !cats.includes("recruiter")) {
      openToWorkWithoutJobSeekerRoleCount++;
    }

    if (ct.trim() && co.trim() && looksLikeEducationTitle(ct)) {
      educationAsEmploymentFailureCount++;
    }
    if (
      ct.trim() &&
      (/^(?:ex-?|former|formerly|previously)\s+/i.test(ct) || hardSuspiciousCompany(co))
    ) {
      pastRoleAsCurrentFailureCount++;
    }

    let sScore = 0;
    const sReasons: string[] = [];
    if (hardSuspiciousCompany(co)) {
      sScore += 5;
      sReasons.push("hard_suspicious_company");
    }
    if (founderFp) {
      sScore += 4;
      sReasons.push("likely_founder_false_positive");
    }
    if (headlineIsVentureInvestorOnly(headline) && cats.includes("founder")) {
      sScore += 5;
      sReasons.push("venture_investor_plus_founder_role");
    }
    if (isUnknownOnly(cats) && hasMeaningfulFunctionTags(fnTagsRaw)) {
      sScore += 3;
      sReasons.push("unknown_only_meaningful_function_tags");
    }
    if (cats.includes("unknown") && ct.trim() && co.trim()) {
      sScore += 2;
      sReasons.push("unknown_with_title_and_company");
    }
    if (looksLikeEducationTitle(ct)) {
      sScore += 3;
      sReasons.push("education_like_current_title");
    }
    if (sScore > 0) {
      pushSuspicious(suspiciousScratch, {
        rowNumber: i + 2,
        displayName: display,
        headline,
        roleCategories: rolesDisplay,
        functionTags: fnTagsDisplay,
        currentTitle: ct,
        currentCompany: co,
        profileFlags: flagsDisplay,
        safeProfessionalReference: safeRefDisplay,
        score: sScore,
        reasons: sReasons,
      });
    }
  }

  const n = rows.length;
  const unknownOnlyPct = n > 0 ? (unknownOnlyCount / n) * 100 : 0;
  const needsReviewRatePct = n > 0 ? (needsReviewYesCount / n) * 100 : 0;

  suspiciousScratch.sort((a, b) => b.row.score - a.row.score);
  const topSuspiciousRows = suspiciousScratch.slice(0, 20).map((x) => x.row);

  return {
    totalRows: n,
    openToWorkHistogram,
    unknownOnlyCount,
    unknownOnlyPct,
    unknownNeedsReviewNoCount,
    unknownWithTitleAndCompanyCount,
    unknownOnlyWithAnyFunctionTagsCount,
    unknownOnlyWithMeaningfulFunctionTagsCount,
    founderRoleCount,
    founderSignalCount,
    founderRoleWithoutSignalCount,
    likelyFounderFalsePositiveCount,
    investorCount,
    founderInvestorOverlapCount,
    ventureInvestorHeadlineWithFounderRoleCount,
    studentRoleCount,
    studentWithCompanyCount,
    genericPhraseCounts,
    softSuspiciousCompanyCount,
    hardSuspiciousCompanyCount,
    educationTitleLikelyCount,
    needsReviewYesCount,
    needsReviewRatePct,
    employmentSourceProfileExperienceCount,
    employmentSourceHeadlineCount,
    employmentSourceStructuredProfileCount,
    employmentSourceUnknownCount,
    multipleCurrentRolesFlagCount,
    educationAsEmploymentFailureCount,
    pastRoleAsCurrentFailureCount,
    employmentTitleFromExperienceCount,
    employmentTitleFromHeadlineCount,
    employmentCompanyFromExperienceCount,
    employmentCompanyFromHeadlineCount,
    profileExperienceInputRowsWithRolesCount,
    profileExperienceInputRolesTotal,
    profileExperienceDataAvailableCount,
    headlineEmploymentDespiteExperienceCount,
    headlineFallbackNoExperienceCount,
    openToWorkWithoutJobSeekerRoleCount,
    profileExperienceDataAvailableYes: !profileExperienceInputCountAllZero,
    profileExperienceInputCountAllZero,
    currentCompanyUnknownCount,
    currentCompanyHeadlineOnlyCount,
    lastCompanyPopulatedCount,
    lastCompanyHeadlineFallbackCount,
    lastCompanyFromProfileExperienceCount,
    lastCompanyFromHeadlineCount,
    pastCompanyPopulatedCount,
    profilesEnrichedBeforeClassificationCount,
    placeholderCurrentCompanyCount,
    placeholderLastCompanyCount,
    placeholderPastCompanyCount,
    placeholderCurrentRolesCount,
    placeholderPastRolesCount,
    placeholderEmploymentRowCount,
    profileExperienceWithPlaceholderCount,
    highConfidenceWithPlaceholderCount,
    needsReviewNoWithPlaceholderCount,
    nullAtRoleStringCount,
    validCurrentCompanyCount,
    validLastCompanyCount,
    syntheticCurrentCompanyCount,
    syntheticLastCompanyCount,
    syntheticPastCompanyCount,
    syntheticCurrentRolesCount,
    syntheticPastRolesCount,
    syntheticEmploymentRowCount,
    profileExperienceWithSyntheticCount,
    highConfidenceWithSyntheticCount,
    needsReviewNoWithSyntheticCount,
    sparseHeadlineSyntheticProfileExperienceCount,
    profileExperienceWithoutAcceptedSourceCount,
    highConfidenceProfileExperienceWithoutExcerptCount,
    profileExperienceWithoutEnrichmentProvenanceCount,
    profileExperienceInputCountHistogram,
    classificationNeedsReviewYesCount,
    employmentNeedsReviewYesCount,
    hardSuspiciousCompanySamples,
    founderWithoutSignalSamples,
    likelyFounderFalsePositiveSamples,
    topSuspiciousRows,
  };
}

export function evaluateClassificationCsv(content: string): CsvEvalResult {
  const { headers, rows } = parseCsv(content);
  const openToWorkColumnPresent = headers.includes("open_to_work_status");
  const profileUrlColumnPresent = headers.includes("profile_url");

  const allRows = evaluateCsvRows(rows, openToWorkColumnPresent);
  const { uniqueFirstPerUrl, duplicateSkipCount } = dedupeRowsByProfileUrl(rows);
  const uniqueProfiles =
    duplicateSkipCount > 0 ? evaluateCsvRows(uniqueFirstPerUrl, openToWorkColumnPresent) : allRows;

  const profileExperienceInputColumnPresent = headers.includes("profile_experience_input_count");

  return {
    openToWorkColumnPresent,
    profileUrlColumnPresent,
    profileExperienceInputColumnPresent,
    csvInputRows: rows.length,
    duplicateProfileExtraRows: duplicateSkipCount,
    allRows,
    uniqueProfiles,
  };
}

function printTierBlock(
  tierLabel: string,
  tier: ClassificationCsvTierMetrics,
  profileExperienceInputColumnPresent: boolean
): void {
  console.log(`\n--- ${tierLabel} (${tier.totalRows} rows) ---`);

  console.log("open_to_work_status:");
  for (const [k, v] of Object.entries(tier.openToWorkHistogram).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(
    `unknown-only role_categories: ${tier.unknownOnlyCount} (${tier.unknownOnlyPct.toFixed(2)}%)`
  );
  console.log(`unknown-only + needs_review=no: ${tier.unknownNeedsReviewNoCount}`);
  console.log(
    `unknown role_categories with both current_title and current_company: ${tier.unknownWithTitleAndCompanyCount}`
  );
  console.log(
    `unknown-only + any non-empty function_tags: ${tier.unknownOnlyWithAnyFunctionTagsCount}`
  );
  console.log(
    `unknown-only + meaningful function_tags: ${tier.unknownOnlyWithMeaningfulFunctionTagsCount}`
  );
  console.log(`founder (role_categories): ${tier.founderRoleCount}`);
  console.log(`founder_signal (profile_flags): ${tier.founderSignalCount}`);
  console.log(`founder in roles without founder_signal: ${tier.founderRoleWithoutSignalCount}`);
  console.log(
    `likely founder false positives (heuristic): ${tier.likelyFounderFalsePositiveCount}`
  );
  console.log(`investor (role_categories): ${tier.investorCount}`);
  console.log(`founder + investor overlap rows: ${tier.founderInvestorOverlapCount}`);
  console.log(
    `venture-investor headline with founder role: ${tier.ventureInvestorHeadlineWithFounderRoleCount}`
  );
  console.log(`student (role_categories): ${tier.studentRoleCount}`);
  console.log(`student + current_company non-empty: ${tier.studentWithCompanyCount}`);
  for (const phrase of GENERIC_PHRASES) {
    console.log(
      `safe_professional_reference contains "${phrase}": ${tier.genericPhraseCounts[phrase] ?? 0}`
    );
  }
  console.log(
    `current_company soft suspicious (Former/Previously/Ex-/at scale): ${tier.softSuspiciousCompanyCount}`
  );
  console.log(
    `current_company hard suspicious (. Former / . Previously / at Scale patterns): ${tier.hardSuspiciousCompanyCount}`
  );
  console.log(`current_title looks like education: ${tier.educationTitleLikelyCount}`);
  console.log(
    `employment_source profile_experience: ${tier.employmentSourceProfileExperienceCount}`
  );
  console.log(`employment_source headline: ${tier.employmentSourceHeadlineCount}`);
  console.log(`employment_source structured_profile: ${tier.employmentSourceStructuredProfileCount}`);
  console.log(`employment_source unknown: ${tier.employmentSourceUnknownCount}`);

  console.log("\n--- Profile experience / employment derivation ---");
  console.log(
    `profile_experience_data_available: ${tier.profileExperienceDataAvailableYes ? "yes" : "no"}`
  );
  const histKeys = Object.keys(tier.profileExperienceInputCountHistogram).sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10)
  );
  if (histKeys.length) {
    console.log("profile_experience_input_count distribution:");
    for (const k of histKeys) {
      console.log(`  count=${k}: ${tier.profileExperienceInputCountHistogram[k]}`);
    }
  }
  console.log(
    `current_company_from_profile_experience: ${tier.employmentCompanyFromExperienceCount}`
  );
  console.log(`current_company_from_headline: ${tier.employmentCompanyFromHeadlineCount}`);
  console.log(`current_company_unknown (empty): ${tier.currentCompanyUnknownCount}`);
  console.log(
    `current_company_headline_fallback (headline source or no experience input): ${tier.currentCompanyHeadlineOnlyCount}`
  );
  console.log(`last_company populated: ${tier.lastCompanyPopulatedCount}`);
  console.log(`last_company_headline_fallback (no experience input): ${tier.lastCompanyHeadlineFallbackCount}`);
  console.log(
    `last_company_from_profile_experience: ${tier.lastCompanyFromProfileExperienceCount}`
  );
  console.log(`last_company_from_headline: ${tier.lastCompanyFromHeadlineCount}`);
  console.log(`past_company populated: ${tier.pastCompanyPopulatedCount}`);
  console.log(
    `profiles enriched before classification: ${tier.profilesEnrichedBeforeClassificationCount}`
  );
  console.log(
    `rows with experience input but employment_source=headline: ${tier.headlineEmploymentDespiteExperienceCount} (hard fail if > 0)`
  );

  const peInputCol =
    tier.profileExperienceInputRolesTotal > 0 || tier.profileExperienceInputRowsWithRolesCount > 0;
  if (peInputCol) {
    console.log(
      `profile_experience roles supplied at classify input: ${tier.profileExperienceInputRowsWithRolesCount} rows (${tier.profileExperienceInputRolesTotal} total roles)`
    );
    if (tier.employmentSourceProfileExperienceCount === 0 && tier.profileExperienceInputRowsWithRolesCount > 0) {
      console.log(
        "  note: input had experience roles but employment_source=profile_experience is still 0 — check role parsing/resolution."
      );
    }
  } else if (profileExperienceInputColumnPresent) {
    console.log(
      `profile_experience data available: no (${tier.totalRows} rows; profile_experience_input_count all zero)`
    );
    console.log(
      "  note: current_company/current_title are headline fallback only (not profile roles) until validation stores experienceItems or post extraJson includes role arrays."
    );
    console.log(
      "  enrichment: npx tsx scripts/enrich-linkedin-profile-employment.ts --csv <export.csv> or POST /api/projects/validate-linkedin-profiles."
    );
    console.log(
      "  current_company / last_company on these rows are headline-derived fallback only (not profile Experience roles)."
    );
  } else {
    console.log(
      "profile_experience input: column profile_experience_input_count missing from CSV (re-run sample export to include it)"
    );
    console.log(
      "  note: employment_source=profile_experience stays 0 until experience data is collected in DB/scraper output."
    );
  }
  console.log(
    `current_title from profile_experience: ${tier.employmentTitleFromExperienceCount}`
  );
  console.log(`current_title from headline: ${tier.employmentTitleFromHeadlineCount}`);
  console.log(
    `current_company from profile_experience: ${tier.employmentCompanyFromExperienceCount}`
  );
  console.log(`current_company from headline: ${tier.employmentCompanyFromHeadlineCount}`);
  if (tier.profileExperienceDataAvailableCount > 0 || tier.profileExperienceInputRowsWithRolesCount > 0) {
    console.log(
      `profile_experience data available: yes (${tier.profileExperienceInputRowsWithRolesCount} rows, ${tier.profileExperienceInputRolesTotal} roles)`
    );
  }
  console.log(
    `headline employment despite profile_experience input: ${tier.headlineEmploymentDespiteExperienceCount} (hard fail if > 0)`
  );
  console.log(
    `headline fallback (no experience input): ${tier.headlineFallbackNoExperienceCount}`
  );
  console.log("\n--- Placeholder / template employment gates ---");
  console.log(`placeholder employment rows (any field): ${tier.placeholderEmploymentRowCount}`);
  console.log(`placeholder current_company: ${tier.placeholderCurrentCompanyCount}`);
  console.log(`placeholder last_company: ${tier.placeholderLastCompanyCount}`);
  console.log(`placeholder past_company: ${tier.placeholderPastCompanyCount}`);
  console.log(`placeholder current_roles: ${tier.placeholderCurrentRolesCount}`);
  console.log(`placeholder past_roles: ${tier.placeholderPastRolesCount}`);
  console.log(`valid current_company (non-placeholder): ${tier.validCurrentCompanyCount}`);
  console.log(`valid last_company (non-placeholder): ${tier.validLastCompanyCount}`);
  console.log(
    `profile_experience source + placeholder field: ${tier.profileExperienceWithPlaceholderCount}`
  );
  console.log(
    `employment_confidence >= 0.8 + placeholder: ${tier.highConfidenceWithPlaceholderCount}`
  );
  console.log(
    `employment_needs_review=no + placeholder: ${tier.needsReviewNoWithPlaceholderCount}`
  );
  console.log(`@ null / null @ null in role strings: ${tier.nullAtRoleStringCount}`);
  console.log("\n--- Synthetic / fabricated employment gates ---");
  console.log(`synthetic employment rows (any field): ${tier.syntheticEmploymentRowCount}`);
  console.log(`synthetic current_company: ${tier.syntheticCurrentCompanyCount}`);
  console.log(`synthetic last_company: ${tier.syntheticLastCompanyCount}`);
  console.log(`synthetic past_company: ${tier.syntheticPastCompanyCount}`);
  console.log(`synthetic current_roles: ${tier.syntheticCurrentRolesCount}`);
  console.log(`synthetic past_roles: ${tier.syntheticPastRolesCount}`);
  console.log(
    `profile_experience + synthetic company: ${tier.profileExperienceWithSyntheticCount}`
  );
  console.log(
    `employment_confidence >= 0.8 + synthetic: ${tier.highConfidenceWithSyntheticCount}`
  );
  console.log(
    `employment_needs_review=no + synthetic: ${tier.needsReviewNoWithSyntheticCount}`
  );
  console.log(
    `sparse headline + synthetic profile_experience: ${tier.sparseHeadlineSyntheticProfileExperienceCount}`
  );
  console.log(
    `profile_experience without accepted experience_item_source: ${tier.profileExperienceWithoutAcceptedSourceCount}`
  );
  console.log(
    `employment_confidence >= 0.8 without evidence_excerpt: ${tier.highConfidenceProfileExperienceWithoutExcerptCount}`
  );
  console.log(
    `profile_experience with valid input but no enrichment provenance: ${tier.profileExperienceWithoutEnrichmentProvenanceCount}`
  );
  console.log(
    `open_to_work signal without job_seeker role: ${tier.openToWorkWithoutJobSeekerRoleCount}`
  );
  console.log(`multiple_current_roles (profile_flags): ${tier.multipleCurrentRolesFlagCount}`);
  console.log(
    `classification_needs_review=yes: ${tier.classificationNeedsReviewYesCount} (${tier.totalRows > 0 ? ((tier.classificationNeedsReviewYesCount / tier.totalRows) * 100).toFixed(1) : 0}%)`
  );
  console.log(
    `employment_needs_review=yes: ${tier.employmentNeedsReviewYesCount} (${tier.totalRows > 0 ? ((tier.employmentNeedsReviewYesCount / tier.totalRows) * 100).toFixed(1) : 0}%)`
  );
  console.log(`education-as-employment failures: ${tier.educationAsEmploymentFailureCount}`);
  console.log(`past-role-as-current failures: ${tier.pastRoleAsCurrentFailureCount}`);
  console.log(
    `needs_review=yes rate: ${tier.needsReviewRatePct.toFixed(2)}% (${tier.needsReviewYesCount} rows)`
  );

  console.log("\n--- Top suspicious rows (score-ranked) ---");
  for (const row of tier.topSuspiciousRows) {
    console.log(
      `  [row ${row.rowNumber} score=${row.score}] ${row.reasons.join(",")} | ${row.displayName || "(no name)"} | ${row.headline.slice(0, 70)}`
    );
    console.log(
      `    roles=${row.roleCategories} | fn=${row.functionTags} | title=${row.currentTitle.slice(0, 60)} | co=${row.currentCompany.slice(0, 60)}`
    );
    console.log(`    flags=${row.profileFlags}`);
    console.log(
      `    safe_ref=${row.safeProfessionalReference.replace(/\s+/g, " ").trim().slice(0, 100)}`
    );
  }
}

function printReport(r: CsvEvalResult): void {
  console.log("--- Classification CSV evaluation ---");
  console.log(`CSV rows (including duplicates): ${r.csvInputRows}`);
  console.log(`profile_url column present: ${r.profileUrlColumnPresent}`);
  console.log(`duplicate CSV rows skipped for unique-profile tier: ${r.duplicateProfileExtraRows}`);
  if (!r.profileUrlColumnPresent) {
    console.warn(
      "`profile_url` column missing — unique-profile tier cannot dedupe; each row counted separately."
    );
  }

  if (!r.openToWorkColumnPresent) {
    console.warn(
      'open_to_work_status column not found in header; histogram uses "(column absent)" bucket.'
    );
  }

  printTierBlock("All CSV rows", r.allRows, r.profileExperienceInputColumnPresent);
  if (r.duplicateProfileExtraRows > 0 || r.uniqueProfiles !== r.allRows) {
    printTierBlock(
      "Unique profiles (first row per normalized profile_url)",
      r.uniqueProfiles,
      r.profileExperienceInputColumnPresent
    );
  }

  console.log(
    `\n(Strict thresholds in applyThresholds use the ${r.duplicateProfileExtraRows > 0 ? '"Unique profiles"' : "full"} CSV row tier: ${r.uniqueProfiles.totalRows} rows.)`
  );
}

export type ThresholdOutcome = { hardFails: string[]; warnings: string[] };

export function applyThresholds(
  r: CsvEvalResult,
  opts: { baseline?: BaselineMetricsFile; soft: boolean }
): ThresholdOutcome {
  const gate = r.uniqueProfiles;
  const hardFails: string[] = [];
  const warnings: string[] = [];

  const n = gate.totalRows;
  const inBand = n >= THRESHOLD_MIN && n <= THRESHOLD_MAX;

  if (!inBand) {
    warnings.push(
      `[unique profile_url tier] Row count ${n} is outside ${THRESHOLD_MIN}-${THRESHOLD_MAX}; strict thresholds are designed for that band.`
    );
  }

  const strict = inBand && !opts.soft;

  if (strict) {
    if (gate.unknownNeedsReviewNoCount > 0) {
      hardFails.push(
        `unknown-only + needs_review=no: ${gate.unknownNeedsReviewNoCount} (must be 0)`
      );
    }
    if (gate.hardSuspiciousCompanyCount > 0) {
      hardFails.push(
        `hard suspicious current_company: ${gate.hardSuspiciousCompanyCount} (must be 0)`
      );
    }
    if (gate.headlineEmploymentDespiteExperienceCount > 0) {
      hardFails.push(
        `profile_experience_input_count > 0 but employment_source=headline: ${gate.headlineEmploymentDespiteExperienceCount} (must be 0)`
      );
    }
    if (gate.openToWorkWithoutJobSeekerRoleCount > 0) {
      hardFails.push(
        `open_to_work detected without job_seeker in role_categories: ${gate.openToWorkWithoutJobSeekerRoleCount} (must be 0)`
      );
    }
  }

  if (!opts.soft) {
    if (gate.placeholderCurrentCompanyCount > 0) {
      hardFails.push(
        `placeholder current_company: ${gate.placeholderCurrentCompanyCount} (must be 0)`
      );
    }
    if (gate.placeholderLastCompanyCount > 0) {
      hardFails.push(`placeholder last_company: ${gate.placeholderLastCompanyCount} (must be 0)`);
    }
    if (gate.placeholderPastCompanyCount > 0) {
      hardFails.push(`placeholder past_company: ${gate.placeholderPastCompanyCount} (must be 0)`);
    }
    if (gate.placeholderCurrentRolesCount > 0) {
      hardFails.push(
        `placeholder current_roles: ${gate.placeholderCurrentRolesCount} (must be 0)`
      );
    }
    if (gate.placeholderPastRolesCount > 0) {
      hardFails.push(`placeholder past_roles: ${gate.placeholderPastRolesCount} (must be 0)`);
    }
    if (gate.highConfidenceWithPlaceholderCount > 0) {
      hardFails.push(
        `employment_confidence >= 0.8 with placeholder employment: ${gate.highConfidenceWithPlaceholderCount} (must be 0)`
      );
    }
    if (gate.needsReviewNoWithPlaceholderCount > 0) {
      hardFails.push(
        `employment_needs_review=no with placeholder employment: ${gate.needsReviewNoWithPlaceholderCount} (must be 0)`
      );
    }
    if (gate.profileExperienceWithPlaceholderCount > 0) {
      hardFails.push(
        `employment_source=profile_experience with placeholder values: ${gate.profileExperienceWithPlaceholderCount} (must be 0)`
      );
    }
    if (gate.syntheticCurrentCompanyCount > 0) {
      hardFails.push(
        `synthetic/fabricated current_company: ${gate.syntheticCurrentCompanyCount} (must be 0)`
      );
    }
    if (gate.syntheticLastCompanyCount > 0) {
      hardFails.push(`synthetic last_company: ${gate.syntheticLastCompanyCount} (must be 0)`);
    }
    if (gate.syntheticPastCompanyCount > 0) {
      hardFails.push(`synthetic past_company: ${gate.syntheticPastCompanyCount} (must be 0)`);
    }
    if (gate.syntheticCurrentRolesCount > 0) {
      hardFails.push(`synthetic current_roles: ${gate.syntheticCurrentRolesCount} (must be 0)`);
    }
    if (gate.syntheticPastRolesCount > 0) {
      hardFails.push(`synthetic past_roles: ${gate.syntheticPastRolesCount} (must be 0)`);
    }
    if (gate.highConfidenceWithSyntheticCount > 0) {
      hardFails.push(
        `employment_confidence >= 0.8 with synthetic company: ${gate.highConfidenceWithSyntheticCount} (must be 0)`
      );
    }
    if (gate.needsReviewNoWithSyntheticCount > 0) {
      hardFails.push(
        `employment_needs_review=no with synthetic employment: ${gate.needsReviewNoWithSyntheticCount} (must be 0)`
      );
    }
    if (gate.profileExperienceWithSyntheticCount > 0) {
      hardFails.push(
        `employment_source=profile_experience with synthetic company: ${gate.profileExperienceWithSyntheticCount} (must be 0)`
      );
    }
    if (gate.sparseHeadlineSyntheticProfileExperienceCount > 0) {
      hardFails.push(
        `sparse headline with synthetic profile_experience: ${gate.sparseHeadlineSyntheticProfileExperienceCount} (must be 0)`
      );
    }
    if (gate.headlineEmploymentDespiteExperienceCount > 0) {
      hardFails.push(
        `profile_experience_input_count > 0 but employment_source=headline: ${gate.headlineEmploymentDespiteExperienceCount} (must be 0)`
      );
    }
    if (gate.profileExperienceWithoutAcceptedSourceCount > 0) {
      hardFails.push(
        `employment_source=profile_experience without accepted experience_item_source: ${gate.profileExperienceWithoutAcceptedSourceCount} (must be 0)`
      );
    }
    if (gate.highConfidenceProfileExperienceWithoutExcerptCount > 0) {
      hardFails.push(
        `employment_confidence >= 0.8 without evidence_excerpt: ${gate.highConfidenceProfileExperienceWithoutExcerptCount} (must be 0)`
      );
    }
    if (gate.profileExperienceWithoutEnrichmentProvenanceCount > 0) {
      hardFails.push(
        `profile_experience used without enrichment provenance (cached_db/in_run): ${gate.profileExperienceWithoutEnrichmentProvenanceCount} (must be 0)`
      );
    }
  }

  if (strict && gate.founderRoleWithoutSignalCount > 0) {
    warnings.push(
      `founder in role_categories without founder_signal: ${gate.founderRoleWithoutSignalCount} (review consistency)`
    );
  }
  if (strict && gate.ventureInvestorHeadlineWithFounderRoleCount > 0) {
    warnings.push(
      `venture-investor headline rows with founder role: ${gate.ventureInvestorHeadlineWithFounderRoleCount}`
    );
  }
  if (strict && gate.educationTitleLikelyCount > 0) {
    warnings.push(
      `education-like current_title rows: ${gate.educationTitleLikelyCount} (review extraction vs golden suite)`
    );
  }

  if (strict && gate.unknownOnlyPct > 15) {
    warnings.push(
      `unknown-only role_categories ${gate.unknownOnlyPct.toFixed(2)}% exceeds 15% (warn)`
    );
  }

  if (strict && gate.unknownWithTitleAndCompanyCount > 3) {
    warnings.push(
      `unknown with both current_title and current_company: ${gate.unknownWithTitleAndCompanyCount} (warn, cap 3)`
    );
  }

  if (strict && gate.unknownOnlyWithMeaningfulFunctionTagsCount > 5) {
    warnings.push(
      `unknown-only with meaningful function_tags: ${gate.unknownOnlyWithMeaningfulFunctionTagsCount} (warn, cap 5)`
    );
  }

  const founderPct = n > 0 ? gate.founderRoleCount / n : 0;
  if (strict && founderPct > 0.18) {
    warnings.push(
      `founder role rate ${(founderPct * 100).toFixed(1)}% is unusually high (warn; check sample bias / overfiring)`
    );
  }

  if (strict && gate.founderInvestorOverlapCount > 1) {
    warnings.push(
      `founder + investor overlap rows: ${gate.founderInvestorOverlapCount} (warn unless dual-mandate evidence)`
    );
  }

  const baseline = opts.baseline;
  if (baseline?.needs_review_rate_pct !== undefined && strict) {
    if (gate.needsReviewRatePct > baseline.needs_review_rate_pct * 1.15 + 3) {
      warnings.push(
        `needs_review rate ${gate.needsReviewRatePct.toFixed(2)}% vs baseline ${baseline.needs_review_rate_pct}% (material increase)`
      );
    }
  } else if (gate.needsReviewRatePct > 40 && strict) {
    warnings.push(`needs_review rate high: ${gate.needsReviewRatePct.toFixed(2)}%`);
  }

  if (baseline?.unknown_only_pct !== undefined && strict) {
    if (gate.unknownOnlyPct > baseline.unknown_only_pct * 1.2 + 2) {
      warnings.push(
        `unknown-only ${gate.unknownOnlyPct.toFixed(2)}% vs baseline ${baseline.unknown_only_pct}% (material increase)`
      );
    }
  }

  const baselineCounts = baseline?.generic_safe_reference_counts;
  if (baselineCounts) {
    for (const phrase of GENERIC_PHRASES) {
      const b = baselineCounts[phrase];
      const cur = gate.genericPhraseCounts[phrase] ?? 0;
      if (b !== undefined && cur > b * 1.25 + 2) {
        warnings.push(
          `Generic phrase "${phrase}" count ${cur} vs baseline ${b} (material increase)`
        );
      }
    }
  } else {
    warnings.push("No --baseline file: skipped generic safe-reference regression comparison.");
  }

  if (gate.likelyFounderFalsePositiveCount > 0 && strict) {
    warnings.push(
      `${gate.likelyFounderFalsePositiveCount} row(s) flagged likely founder false positives (heuristic; review founder_fires headlines)`
    );
  }

  if (r.duplicateProfileExtraRows > 0 && !r.profileUrlColumnPresent) {
    warnings.push(
      "Duplicates may be present but `profile_url` is missing — unique-profile tier could not collapse repeated profiles."
    );
  }

  return { hardFails, warnings };
}

function readBaseline(path: string | undefined): BaselineMetricsFile | undefined {
  if (!path) return undefined;
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as BaselineMetricsFile;
}

function main(): void {
  const raw = process.argv.slice(2);
  const soft = raw.includes("--soft");
  const args = raw.filter((a) => a !== "--soft");

  let baselinePath: string | undefined;
  const bi = args.indexOf("--baseline");
  if (bi >= 0) {
    baselinePath = args[bi + 1];
    if (!baselinePath || baselinePath.startsWith("--")) {
      console.error("Missing path after --baseline");
      process.exit(2);
    }
    args.splice(bi, 2);
  }

  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath) {
    console.error("Usage: run-csv-eval.ts <file.csv> [--baseline path.json] [--soft]");
    process.exit(2);
  }

  const content = readFileSync(csvPath, "utf8");
  const result = evaluateClassificationCsv(content);
  printReport(result);

  const baseline = readBaseline(baselinePath);
  const { hardFails, warnings } = applyThresholds(result, { baseline, soft });

  console.log("\n--- Threshold / regression gates ---");
  if (hardFails.length) {
    console.error("HARD FAIL:");
    for (const m of hardFails) console.error(`  - ${m}`);
  } else {
    console.log("HARD FAIL: (none)");
  }
  for (const m of warnings) console.warn(`WARN: ${m}`);

  const gateTier = result.uniqueProfiles;
  if (gateTier.hardSuspiciousCompanySamples.length) {
    console.log("\nHard suspicious current_company samples:");
    for (const s of gateTier.hardSuspiciousCompanySamples) console.log(`  ${s}`);
  }
  if (gateTier.founderWithoutSignalSamples.length) {
    console.log("\nFounder role without founder_signal samples:");
    for (const s of gateTier.founderWithoutSignalSamples) console.log(`  ${s}`);
  }
  if (gateTier.likelyFounderFalsePositiveSamples.length) {
    console.log("\nLikely founder false positive samples:");
    for (const s of gateTier.likelyFounderFalsePositiveSamples) console.log(`  ${s}`);
  }

  if (hardFails.length > 0 && !soft) process.exit(1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
