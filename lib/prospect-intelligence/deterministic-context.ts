import {
  classifyProspectDeterministic,
  explicitHeadlineRecruiterEvidence,
  foldStylizedLatinForClassification,
  headlineHasExplicitFounderEvidence,
  headlineHasExplicitSelfOpenToWorkPhrase,
  normalizeHeadlineDelimiters,
  parseHeadlineEmploymentAndEducation,
  type ClassifierOptions,
  type ParsedHeadline,
} from "./classify";
import { headlineForRoleAndEmploymentParsing } from "./detect-open-to-work";
import type { ProspectClassification, ProspectEvidence } from "./types";

export type GuardrailFinding = {
  code: string;
  severity: "info" | "warn" | "block";
  message: string;
};

export type DeterministicProspectContext = {
  originalHeadline: string;
  normalizedHeadline: string;
  headlineForParsing: string;
  segments: string[];
  parsedHeadline: ParsedHeadline;
  extractionCandidates: {
    currentTitle: string | null;
    currentCompany: string | null;
    pastTitle: string | null;
    pastCompany: string | null;
    educationInstitution: string | null;
    educationArea: string | null;
  };
  guardrailFindings: GuardrailFinding[];
  postContextNote: string;
  draft: ProspectClassification;
  explicitFounderEvidence: boolean;
  foundingEngineerHeadline: boolean;
  explicitRecruiterHeadline: boolean;
  explicitSelfOpenToWorkPhrase: boolean;
};

function headlineFromEvidence(evidence: ProspectEvidence[]): string {
  const ev = evidence.find((e) => e.source === "linkedin_author_headline");
  return (ev?.rawText ?? "").replace(/\s+/g, " ").trim();
}

function collectGuardrailFindings(
  headlineForParsing: string,
  draft: ProspectClassification
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  const explicitFounder = headlineHasExplicitFounderEvidence(headlineForParsing);

  if (explicitFounder) {
    findings.push({
      code: "explicit_founder_evidence",
      severity: "info",
      message: "Headline has explicit current founder/owner wording.",
    });
  }
  if (/founding engineer/i.test(headlineForParsing)) {
    findings.push({
      code: "founding_engineer_not_founder",
      severity: "info",
      message: "Founding engineer is not founder evidence.",
    });
  }
  if (explicitHeadlineRecruiterEvidence(headlineForParsing)) {
    findings.push({
      code: "recruiter_headline",
      severity: "info",
      message: "Recruiter headline; job_seeker requires explicit job-search language.",
    });
  }
  if (/\bto the founder\b/i.test(headlineForParsing)) {
    findings.push({
      code: "to_the_founder_not_founder",
      severity: "warn",
      message: "Phrasing like chief of staff to the founder is not founder evidence.",
    });
  }
  if (/\bat scale\b/i.test(headlineForParsing) && !/\bat scale\s+(up|out|down)\b/i.test(headlineForParsing)) {
    findings.push({
      code: "at_scale_not_company",
      severity: "warn",
      message: '"at scale" is not a company name.',
    });
  }
  if (/\b(open\s*ai|open\s*source|open\s*to\s*relocation|open\s*for\s*collaboration)\b/i.test(headlineForParsing)) {
    findings.push({
      code: "open_word_false_positive_risk",
      severity: "warn",
      message: "Open* phrases may be misread as Open-to-Work; require explicit OTW wording.",
    });
  }
  if (draft.profileFlags.includes("founder_signal") && !explicitFounder) {
    findings.push({
      code: "founder_signal_without_evidence",
      severity: "block",
      message: "Draft has founder_signal without explicit founder evidence.",
    });
  }
  if (draft.profileFlags.includes("investor_signal") && draft.roleCategories.includes("founder") && !explicitFounder) {
    findings.push({
      code: "investor_founder_conflict",
      severity: "warn",
      message: "Investor-only profiles should not be labeled founder without explicit founder evidence.",
    });
  }
  return findings;
}

export function buildDeterministicProspectContext(
  evidence: ProspectEvidence[],
  options?: ClassifierOptions,
  draftOverride?: ProspectClassification
): DeterministicProspectContext {
  const originalHeadline = headlineFromEvidence(evidence);
  const normalizedHeadline = normalizeHeadlineDelimiters(
    foldStylizedLatinForClassification(originalHeadline)
  );
  const headlineForParsing = headlineForRoleAndEmploymentParsing(normalizedHeadline);
  const segments = headlineForParsing
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const parsedHeadline = parseHeadlineEmploymentAndEducation(headlineForParsing);
  const draft = draftOverride ?? classifyProspectDeterministic(evidence, options);
  const guardrailFindings = collectGuardrailFindings(headlineForParsing, draft);

  return {
    originalHeadline,
    normalizedHeadline,
    headlineForParsing,
    segments,
    parsedHeadline,
    extractionCandidates: {
      currentTitle: parsedHeadline.primaryEmployment?.title ?? null,
      currentCompany: parsedHeadline.primaryEmployment?.company ?? null,
      pastTitle: parsedHeadline.pastEmployment?.title ?? null,
      pastCompany: parsedHeadline.pastEmployment?.company ?? null,
      educationInstitution: parsedHeadline.educationInstitution,
      educationArea: parsedHeadline.educationArea,
    },
    guardrailFindings,
    postContextNote:
      "LinkedIn post/comment text is background context only. Do not treat it as proof of current employment or Open-to-Work status.",
    draft,
    explicitFounderEvidence: headlineHasExplicitFounderEvidence(headlineForParsing),
    foundingEngineerHeadline: /founding engineer/i.test(headlineForParsing),
    explicitRecruiterHeadline: explicitHeadlineRecruiterEvidence(headlineForParsing),
    explicitSelfOpenToWorkPhrase: headlineHasExplicitSelfOpenToWorkPhrase(headlineForParsing),
  };
}
