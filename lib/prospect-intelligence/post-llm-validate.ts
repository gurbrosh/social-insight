import {
  explicitHeadlineRecruiterEvidence,
  finalizeSafeProfessionalReference,
  headlineHasExplicitFounderEvidence,
  headlineHasExplicitSelfOpenToWorkPhrase,
} from "./classify";
import type { DeterministicProspectContext } from "./deterministic-context";
import { hardSuspiciousCompany, looksLikeEducationTitle } from "./employment-guardrails";
import type { ExclusionFlag, ProspectClassification } from "./types";

function normalizeOpenToWorkStatus(
  detection: ProspectClassification["openToWorkDetection"]
): ProspectClassification["openToWorkDetection"] {
  if (!detection) return detection;
  const status = detection.status as string;
  if (status === "not_indicated" || status === "unknown") {
    return {
      ...detection,
      status: "not_observed",
      confidence: 0,
      evidence: "",
      reason:
        "No public badge/frame or self-attributed job-search wording in evidence; recruiters-only Open to Work is not observable from public data.",
    };
  }
  return detection;
}

function stripInvalidOpenToWork(classification: ProspectClassification, headline: string): void {
  const otw = classification.openToWorkDetection;
  const hasExplicitOtw =
    headlineHasExplicitSelfOpenToWorkPhrase(headline) || otw?.status === "public_signal_detected";

  if (hasExplicitOtw) return;

  const falsePositiveOtw =
    /\bopen\s*ai\b/i.test(headline) ||
    /\bopen\s*source\b/i.test(headline) ||
    /\bopen\s*to\s*relocation\b/i.test(headline) ||
    /\bopen\s*for\s*collaboration\b/i.test(headline);

  if (
    !falsePositiveOtw &&
    (otw?.status === "text_signal_detected" || otw?.status === "public_signal_detected")
  ) {
    return;
  }

  if (!falsePositiveOtw) {
    return;
  }

  if (falsePositiveOtw && otw) {
    classification.openToWorkDetection = {
      ...otw,
      status: "not_observed",
      confidence: 0,
      evidence: "",
      reason:
        "Open* phrasing is not self-attributed Open-to-Work (e.g. open source, relocation, collaboration).",
    };
  }

  classification.profileFlags = classification.profileFlags.filter(
    (f) =>
      f !== "open_to_work_public_signal" &&
      f !== "open_to_work_text_signal" &&
      f !== "job_search_signal"
  );
  classification.roleCategories = classification.roleCategories.filter((r) => r !== "job_seeker");
  classification.excludedRoleFlags = Array.from(
    new Set<ExclusionFlag>([...classification.excludedRoleFlags, "open_to_work"])
  );
}

function stripEducationAsEmployment(classification: ProspectClassification): void {
  const title = classification.currentTitle ?? "";
  const company = classification.currentCompany ?? "";
  if (title && looksLikeEducationTitle(title)) {
    classification.currentTitle = null;
    classification.currentCompany = null;
    if (!classification.profileFlags.includes("education_signal")) {
      classification.profileFlags.push("education_signal");
    }
    classification.classificationNeedsReview = true;
    classification.needsReview = true;
  }
  if (company && looksLikeEducationTitle(company)) {
    classification.currentCompany = null;
  }
}

function stripSuspiciousCompany(classification: ProspectClassification): void {
  const company = classification.currentCompany ?? "";
  if (!company) return;
  if (hardSuspiciousCompany(company) || /\bat\s*scale\b/i.test(company)) {
    classification.currentCompany = null;
    classification.classificationNeedsReview = true;
    classification.needsReview = true;
  }
}

function stripFormerFromCurrentUnlessClearCurrent(
  classification: ProspectClassification,
  ctx: DeterministicProspectContext
): void {
  const title = classification.currentTitle ?? "";
  const company = classification.currentCompany ?? "";
  const formerInCurrent =
    /(^|\s)(former|formerly|previously)\b/i.test(title) ||
    /\bex-/i.test(title) ||
    hardSuspiciousCompany(company);

  if (!formerInCurrent) return;

  const parsedCurrent =
    ctx.extractionCandidates.currentTitle &&
    !/(^|\s)(former|formerly|previously)\b/i.test(ctx.extractionCandidates.currentTitle) &&
    !hardSuspiciousCompany(ctx.extractionCandidates.currentCompany ?? "");

  if (parsedCurrent) {
    classification.currentTitle = ctx.extractionCandidates.currentTitle;
    classification.currentCompany = ctx.extractionCandidates.currentCompany;
    return;
  }

  classification.currentTitle = null;
  classification.currentCompany = null;
  if (!classification.profileFlags.includes("past_role_signal")) {
    classification.profileFlags.push("past_role_signal");
  }
}

function stripFounderWithoutEvidence(
  classification: ProspectClassification,
  headline: string
): void {
  if (headlineHasExplicitFounderEvidence(headline)) return;

  classification.roleCategories = classification.roleCategories.filter((r) => r !== "founder");
  classification.functionTags = classification.functionTags.filter((t) => t !== "founder");
  classification.profileFlags = classification.profileFlags.filter(
    (f) => f !== "founder_signal" && f !== "solo_operator_signal"
  );
}

function stripInvestorOnlyFounder(
  classification: ProspectClassification,
  headline: string
): void {
  const investorOnly =
    classification.profileFlags.includes("investor_signal") &&
    !headlineHasExplicitFounderEvidence(headline);
  if (!investorOnly) return;
  classification.roleCategories = classification.roleCategories.filter((r) => r !== "founder");
  classification.profileFlags = classification.profileFlags.filter((f) => f !== "founder_signal");
}

function stripRecruiterJobSeeker(
  classification: ProspectClassification,
  headline: string
): void {
  if (!explicitHeadlineRecruiterEvidence(headline)) return;
  if (headlineHasExplicitSelfOpenToWorkPhrase(headline)) return;
  classification.roleCategories = classification.roleCategories.filter((r) => r !== "job_seeker");
  classification.profileFlags = classification.profileFlags.filter((f) => f !== "job_seeker_signal");
}

function repairGenericSafeReference(
  classification: ProspectClassification,
  headline: string
): void {
  classification.safeProfessionalReference = finalizeSafeProfessionalReference({
    roleCategories: classification.roleCategories,
    functionTags: classification.functionTags,
    profileFlags: classification.profileFlags,
    safeProfessionalReference: classification.safeProfessionalReference,
    headline,
    currentTitle: classification.currentTitle,
  });
}

/**
 * Deterministic guardrails applied after LLM merge (and on deterministic-only runs).
 */
export function applyPostLlmValidation(
  classification: ProspectClassification,
  ctx: DeterministicProspectContext
): ProspectClassification {
  const out: ProspectClassification = {
    ...classification,
    roleCategories: [...classification.roleCategories],
    functionTags: [...classification.functionTags],
    profileFlags: [...classification.profileFlags],
    excludedRoleFlags: [...classification.excludedRoleFlags],
    affiliations: [...(classification.affiliations ?? [])],
    marketSegmentTerms: [...(classification.marketSegmentTerms ?? [])],
    outreachTags: [...(classification.outreachTags ?? [])],
    openToWorkDetection: classification.openToWorkDetection
      ? { ...classification.openToWorkDetection }
      : classification.openToWorkDetection,
  };

  const headline = ctx.headlineForParsing;

  if (out.openToWorkDetection) {
    out.openToWorkDetection = normalizeOpenToWorkStatus(out.openToWorkDetection) ?? undefined;
  }

  stripInvalidOpenToWork(out, headline);
  if (out.openToWorkDetection) {
    out.openToWorkDetection = normalizeOpenToWorkStatus(out.openToWorkDetection) ?? undefined;
  }
  stripEducationAsEmployment(out);
  stripSuspiciousCompany(out);
  stripFormerFromCurrentUnlessClearCurrent(out, ctx);
  stripFounderWithoutEvidence(out, headline);
  stripInvestorOnlyFounder(out, headline);
  stripRecruiterJobSeeker(out, headline);
  repairGenericSafeReference(out, headline);

  return out;
}
