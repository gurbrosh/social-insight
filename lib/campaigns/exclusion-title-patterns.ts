import type { ProspectClassification } from "@/lib/prospect-intelligence/types";

/** Normalized title/headline blob for exclusion title heuristics. */
export function exclusionTitleBlob(c: ProspectClassification): string {
  return [
    c.currentTitle,
    c.headlineEmploymentCandidateTitle,
    c.professionalSummary,
    c.safeProfessionalReference,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isLikelyExecutiveClassification(c: ProspectClassification): boolean {
  if (c.seniority === "c_level" || c.seniority === "vp") return true;
  if (c.roleCategories.includes("executive_leader") || c.roleCategories.includes("technology_executive")) {
    return true;
  }
  const blob = exclusionTitleBlob(c);
  return /\b(?:ceo|cto|cfo|coo|chief\s+\w+\s+officer|president)\b/i.test(blob);
}

export function titleMatchesFounder(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  if (!/\b(?:co[- ]?founder|cofounder|founder)\b/i.test(blob)) return false;
  if (/\b(?:former|ex[- ]|past)\s+(?:co[- ]?founder|cofounder|founder)\b/i.test(blob)) return false;
  if (/\b(?:chief\s+of\s+staff|cos)\s+to\s+(?:the\s+)?founder\b/i.test(blob)) return false;
  return true;
}

export function titleMatchesSoftwareEngineer(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\b(?:senior\s+)?software engineer\b/i.test(blob) ||
    /\b(?:software|full[- ]?stack|front[- ]?end|back[- ]?end|web)\s+(?:developer|engineer)\b/i.test(blob) ||
    /\bdeveloper\b/i.test(blob)
  );
}

export function titleMatchesSecurityRole(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    // SOC / operations center
    /\bsoc analyst\b/i.test(blob) ||
    /\bsecurity operations\b/i.test(blob) ||
    // Cybersecurity / cyber as primary role word
    /\bcyber\s*security\b/i.test(blob) ||
    /\bcybersecurity\b/i.test(blob) ||
    // Security architect / engineer / manager / strategist
    /\bsecurity\s+(?:architect|engineer|strategist|specialist|consultant|analyst|manager|director|lead|practitioner)\b/i.test(blob) ||
    /\b(?:manager|director|lead|head)\s+(?:of\s+)?(?:cyber\s*)?security\b/i.test(blob) ||
    // Product security / application security
    /\bproduct\s+security\b/i.test(blob) ||
    /\bapplication\s+security\b/i.test(blob) ||
    /\bappsec\b/i.test(blob) ||
    // ICS / OT / rail security
    /\b(?:ics|ot|ics\/ot|rail)\s+(?:cyber\s*)?security\b/i.test(blob) ||
    /\bsecuring\s+(?:rail|ot|ics)\b/i.test(blob) ||
    // Information security
    /\binformation\s+(?:technology\s+and\s+)?security\b/i.test(blob) ||
    /\binfosec\b/i.test(blob) ||
    // Cloud security
    /\bcloud\s+security\b/i.test(blob) ||
    // DevSecOps / CISO
    /\bdevsecops\b/i.test(blob) ||
    /\bciso\b/i.test(blob)
  );
}

export function titleMatchesDevOpsPlatform(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\bdevops\b/i.test(blob) ||
    /\bplatform engineer\b/i.test(blob) ||
    /\bsre\b/i.test(blob) ||
    /\bsite reliability engineer\b/i.test(blob) ||
    /\bmlops\b/i.test(blob)
  );
}

export function titleMatchesCloudInfrastructure(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\bcloud engineer\b/i.test(blob) ||
    /\bcloud architect\b/i.test(blob) ||
    /\binfrastructure engineer\b/i.test(blob) ||
    /\b(?:aws|azure|gcp)\s+(?:architect|engineer)\b/i.test(blob)
  );
}

export function titleMatchesAiMlRole(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\bml engineer\b/i.test(blob) ||
    /\bmachine learning engineer\b/i.test(blob) ||
    /\bai solutions engineer\b/i.test(blob) ||
    /\bai\/ml engineer\b/i.test(blob) ||
    /\b(?:senior\s+)?ai engineer\b/i.test(blob)
  );
}

export function titleMatchesProductRole(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\bproduct manager\b/i.test(blob) ||
    /\bai product manager\b/i.test(blob) ||
    /\bproduct management\b/i.test(blob) ||
    /\bhead of product\b/i.test(blob) ||
    /\bproduct owner\b/i.test(blob)
  );
}

export function titleMatchesAdvisorBoard(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  return (
    /\b(?:board advisor|advisory board|board member|board director)\b/i.test(blob) ||
    (/\badvisor\b/i.test(blob) && !/\badvisor to\b/i.test(blob))
  );
}

export function titleMatchesContractorNotConsultant(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  if (/\bconsultant\b/i.test(blob)) return false;
  return /\b(?:freelance|independent contractor|contractor|1099)\b/i.test(blob);
}

export function titleMatchesSalesMarketing(c: ProspectClassification): boolean {
  const blob = exclusionTitleBlob(c);
  if (isLikelyExecutiveClassification(c) && !/\b(?:sales|marketing|gtm|growth)\b/i.test(blob)) {
    return false;
  }
  return (
    /\bdirector of sales\b/i.test(blob) ||
    /\b(?:vp|vice president)\s+of\s+(?:sales|marketing|gtm|growth)\b/i.test(blob) ||
    /\b(?:head of sales|head of marketing|sales leader|marketing leader)\b/i.test(blob)
  );
}
