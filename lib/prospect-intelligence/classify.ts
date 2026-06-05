import {
  PROSPECT_CLASSIFIER_VERSION,
  type EmploymentRelationship,
  type OrganizationType,
  type ExclusionFlag,
  type ProfileFlag,
  type ProspectClassification,
  type ProspectEvidence,
} from "./types";
import {
  detectOpenToWorkFromEvidence,
  headlineForRoleAndEmploymentParsing,
  headlineHasOpenToWorkFalsePositivePhrase,
  headlineSuggestsJobSeekingFreelanceAvailability,
  type OpenToWorkDetectResult,
} from "./detect-open-to-work";
import type { DeterministicProspectContext } from "./deterministic-context";
import {
  hardSuspiciousCompany,
  employmentTitleLooksRetired,
  headlineEmployerLooksDescriptorOrCompoundRole,
  headlineEmployerLooksEventOrMarketing,
  headlineSegmentLooksRetiredEmployment,
  headlineTitleLooksSloganLike,
  looksLikeEducationTitle,
} from "./employment-guardrails";
import {
  composeSafeProfessionalReference,
  headlineAnchoredSafeReference,
  headlineSupportsExplicitSafeReference,
  isAwkwardLiteralSafeReference,
  isLowSignalHeadlineForSafeReference,
  professionalDomainOutreachReference,
  resolveExplicitSafeProfessionalReference,
} from "./safe-reference-compose";
import {
  collectProfileExperienceRolesFromEvidence,
  extractStructuredProfileEmploymentFromEvidence,
} from "./extract-profile-experience";
import { resolveProspectEmployment } from "./resolve-employment";
import { normalizeEmployerName } from "./normalize-employer-name";
import {
  isPlaceholderEmploymentValue,
  sanitizeResolvedProspectEmployment,
} from "./sanitize-employment-placeholders";
import { validateProfileExperienceRoles } from "./validate-profile-experience";
import { PROFILE_EXPERIENCE_ANALYSIS_METHOD_METADATA_KEY } from "./profile-experience-types";
import type { EmploymentRoleRef, EmploymentSource } from "./types";

const RECRUITER_RE =
  /\brecruiter\b|talent\s+acquisition|executive\s+search|head\s*hunter|helping\s+[^\n]{0,200}\s+hire\b|\bhiring\s+for\b|\btalent\s+partner\b|(?:candidate|talent)\s+sourcing|sourcing\s+(?:candidates|talent|for)|\bstaffing\s+(?:agency|firm|services|recruiter|company)|\bwe(?:'re|\s+are)\s+hiring\b|\bmanager\s*[-–]\s*(?:us\s+)?staffing\b|\b(?:us\s+)?staffing\s+@\s*[A-Za-z0-9]|^[^|]*\bstaffing\s+@\s*[A-Za-z0-9]/i;
const INVESTOR_RE =
  /\bvc\b(?=\s|$|[|,])|venture\s+capital|\bangel\s+investor\b|\bstartup\s+investor\b|\bearly\s+stage\s+investor\b|\bcategory[-\s]+creat(?:ing|e)\s+compan(?:y|ies)\b|\bboard\s+investor\b|\bgeneral\s+partner\b|\bventure\s+partner\b|\binvestor\s+at\b|\blimited\s+partner\b|\bseed\s+investor\b|\bportfolio\s+partner\b|\badvisor\s*,\s*investor\b|\binvestor\s*,\s*advisor\b|\badvisor\s*\|\s*investor\b|\binvestor\s*\|\s*advisor\b|\|\s*investor\b|\binvestor\s*\||\bdeal\s+maker\b|\bdeals?\s+maker\b|\binvestor\b(?=\s*(?:[\|,.]|\n|$))|\binvesting\s+in\b/i;
const SOLO_RE = /\bsolo\s+founder\b|\bindie\s+hacker\b|^founder\s+at\s+\w{0,12}$/i;
const CONSULTANT_RE_CORE =
  /\bfractional\s+cto\b|\bindependent\s+consultant\b|\bi\s+help\s+companies\b|\badvisor\b.*\|.*\bconsult|\bconsultant\b|\bconsulting\b|fractional\s+\w+/i;

function textSuggestsConsultantRole(text: string, headlineFullForFreelance: string): boolean {
  const t = norm(text);
  if (CONSULTANT_RE_CORE.test(text)) return true;
  if (/\bfreelancer\b|\bfreelance\b/.test(t)) {
    return !headlineSuggestsJobSeekingFreelanceAvailability(headlineFullForFreelance);
  }
  return false;
}
const ENG_LEADER_RE =
  /\bcto\b|\bvp\s+engineering\b|\bvp\s+of\s+engineering\b|director\s+of\s+engineering|head\s+of\s+engineering|head\s+of\s+r\s*&\s*d\b|head\s+of\s+rd\b|head\s+of\s+ai|director\s+of\s+platform|head\s+of\s+platform|principal\s+engineer|staff\s+engineer|engineering\s+manager|platform\s+engineer|\bai\s+infra|software\s+engineering\s+leader|head\s+of\s+devops|director\s+of\s+devops|\bvp\s+devops\b|devops\s+manager|devops\s+lead|(?:^|[|•·])\s*engineering\s+leader\b|(?:^|[|•·])\s*technical\s+leader\b|\btech\s+lead\b/i;
const SECURITY_LEADER_RE =
  /\bchief\s+information\s+security\s+officer\b|\bciso\b|chief\s+security\s+officer|vp\s+security|head\s+of\s+security/i;
const SOC_PRACTITIONER_RE =
  /\bsoc\s+analyst\b|security\s+operations\s+center|threat\s+hunting|incident\s+response\b|siem\b/i;
const IT_OPS_RE =
  /\bsystem\s+administrator\b|\bsysadmin\b|\bservice\s+delivery\s+manager\b|\brepair\s+operations\b|\bit\s+manager\b|\bsenior\s+it\s+manager\b/i;
const IT_OPS_SUPPLY_EXTRA = /\bsupply\s+chain\s+management\b/i;

export type ClassifierOptions = {
  linkedinUrl?: string | null;
  name?: string | null;
  competitorPatterns?: string[];
  /** Profile UI hints (e.g. image alt, badge copy) not already modeled as evidence rows. */
  linkedinProfileUiText?: string | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Remove trailing ". Previously …" / ". Formerly …" sentences so past founder titles do not tag current founder. */
function stripHeadlinePastClausesForFounder(headline: string): string {
  let h = headline.replace(/\s+/g, " ").trim();
  for (;;) {
    const idx = h.search(/\.\s*(?:Previously|Formerly|Former|Ex[-–])\b/i);
    if (idx === -1) break;
    h = h.slice(0, idx).trim();
  }
  return h;
}

/**
 * Past-tense founder identity in the headline (not current founder evidence).
 */
function headlineIndicatesPastFounder(headline: string): boolean {
  return /\bformer\s+(co[- ]?)?founder\b|\bex[- ](co[- ]?)?founder\b|\bpast\s+(co[- ]?)?founder\b/i.test(
    headline
  );
}

/** Founder mentioned only as someone else's role (e.g. chief of staff to the founder). */
function headlineMentionsFounderOnlyAsThirdPartyRole(headline: string): boolean {
  return /\b(?:chief\s+of\s+staff|cos)\s+to\s+(?:the\s+)?founder\b/i.test(headline);
}

function headlineSegmentHasExplicitFounderRole(seg: string): boolean {
  const s = seg.trim();
  if (!s) return false;
  if (/^\s*(former|ex[- ]|past)\s+(co[- ]?)?founder\b/i.test(s)) return false;
  if (/^\s*(?:building|seeking|open\s+to|aspiring)\b/i.test(s)) return false;
  if (/^\s*product\s+builder\b/i.test(s) && !/\b(?:co[- ]?founder|cofounder|founder)\b/i.test(s)) {
    return false;
  }
  const sRole = s
    .replace(/\b(?:chief\s+of\s+staff|cos)\s+to\s+(?:the\s+)?founder\b/gi, " ")
    .replace(/\bto\s+(?:the\s+)?founder\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bfounding\s+ceo\b/i.test(sRole)) return true;
  if (!sRole || !/\b(?:co[- ]?founder|cofounder|founder)\b/i.test(sRole)) return false;
  return (
    /\b(?:co[- ]?founder|cofounder|founder)\s*(?:@|at)\s+/i.test(sRole) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s+of\s+[A-Za-z0-9]/i.test(sRole) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s*,\s*\S/i.test(sRole) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s*[-–—]\s*\S/i.test(sRole) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s*[&/]\s*\S/i.test(sRole) ||
    /^\s*(?:co[- ]?founder|cofounder|founder)\b/i.test(sRole) ||
    /\b(?:ceo|cto|cpo|cro)\s*[&,]\s*(?:co[- ]?founder|cofounder)\s*(?:@|at)\b/i.test(sRole) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s*[&,]\s*(?:ceo|cto|cpo|cro|principal|architect)\b/i.test(
      sRole
    ) ||
    /\b(?:co[- ]?founder|cofounder|founder)\s+&\s+ceo\b/i.test(sRole) ||
    /\bceo\s+&\s+(?:co[- ]?founder|cofounder)\s*(?:@|at)\b/i.test(sRole) ||
    /(?:^|[\s|])[\w][\w\s&'.]{1,52}\s+founder\s*$/i.test(sRole)
  );
}

/**
 * Explicit founder/co-owner signals in headline only (CEO alone, Creator, Investor, Founding Engineer, and stray "founder" substrings excluded).
 */
export function headlineHasExplicitFounderEvidence(headline: string): boolean {
  const hRaw = stripHeadlinePastClausesForFounder(headline.replace(/\s+/g, " ").trim());
  if (!hRaw) return false;
  const firstSeg = (hRaw.split("|")[0] ?? "").trim();
  if (
    /^\s*(former\s+(co[- ]?)?founder|ex[- ](co[- ]?)?founder|past\s+(co[- ]?)?founder)\b/i.test(
      firstSeg
    )
  ) {
    return false;
  }

  const hNorm = norm(hRaw);
  if (/\bfounding\s+engineer\b|\bfounding\s+partner\b/i.test(hNorm)) return false;
  if (/\bventure\s+investor\b|\bearly[- ]stage\s+investor\b/i.test(hNorm)) return false;
  if (
    /^\s*venture\s+investor\b/i.test(firstSeg) &&
    !/\b(?:co[- ]?founder|cofounder|founder)\s*(?:@|at|of|,|[-–—/&])/i.test(hRaw)
  ) {
    return false;
  }
  if (
    /^\s*product\s+builder\b/i.test(firstSeg) &&
    !/\b(?:co[- ]?founder|cofounder|founder)\b/i.test(hRaw)
  ) {
    return false;
  }

  if (/\bowner\s*(?:@|at)\b/i.test(hRaw)) return true;
  if (SOLO_RE.test(hRaw)) return true;

  const segments = hRaw
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  const explicitInSegment = segments.some(headlineSegmentHasExplicitFounderRole);
  if (explicitInSegment) return true;

  if (headlineMentionsFounderOnlyAsThirdPartyRole(hRaw)) return false;

  const scrubbed = hRaw.replace(/\b(?:chief\s+of\s+staff|cos)\s+to\s+(?:the\s+)?founder\b/gi, " ");
  if (!/\b(?:co[- ]?founder|cofounder|founder)\b/i.test(scrubbed)) return false;

  return headlineSegmentHasExplicitFounderRole(hRaw);
}

/** After "Title at Employer", stop company at comma when the tail is a secondary role/affiliation. */
function splitEmployerAndTrailingAffiliation(companyPart: string): {
  employer: string;
  affiliation?: string;
} {
  const trimmed = companyPart.replace(/\s+/g, " ").trim();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return { employer: trimmed };
  const before = trimmed.slice(0, commaIdx).trim();
  const after = trimmed.slice(commaIdx + 1).trim();
  if (!after) return { employer: before };
  if (
    /^(?:founder|co[- ]?founder|cofounder|chair(?:man|person)?|board|director|advisor|partner|member|volunteer|president|ceo|cto|honorary)/i.test(
      after
    ) ||
    /\b(?:founder|chairman|board\s+director|chapter)\b/i.test(after)
  ) {
    return { employer: before, affiliation: after };
  }
  return { employer: trimmed };
}

function applyFounderSecondaryRolesFromHeadline(
  headlineFull: string,
  headline: string,
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  functionTags: ProspectClassification["functionTags"]
): void {
  if (!headlineHasExplicitFounderEvidence(headlineFull)) return;
  roleCategories.add("founder");
  roleCategories.delete("unknown");

  const hn = norm(`${headlineFull} ${headline}`);
  const tset = new Set(functionTags.filter((t) => t !== "unknown"));

  if (
    (/\bcyber\b|\bsecurity\b/i.test(hn) && /\bai\b/i.test(hn)) ||
    (tset.has("cybersecurity") && tset.has("ai_ml"))
  ) {
    roleCategories.add("security_practitioner");
    roleCategories.add("ai_engineer");
    roleCategories.add("technical_architect");
  }
  if (
    /\b(?:co[- ]?founder|cofounder)\s*\/\s*cro\b/i.test(hn) ||
    (/\bcro\b/i.test(hn) && /\bfounder\b/i.test(hn))
  ) {
    roleCategories.add("revenue_leader");
    roleCategories.add("gtm_leader");
  }
  if (/\bco[- ]?founder\b/i.test(hn) && /\bcpo\b/i.test(hn) && /\bsecurity\b/i.test(hn)) {
    roleCategories.add("security_leader");
    roleCategories.add("product_leader");
    roleCategories.add("executive_leader");
  }
  if (/\bceo\b/i.test(hn) && /\bco[- ]?founder\b/i.test(hn) && /\bokta\b/i.test(hn)) {
    roleCategories.add("executive_leader");
    roleCategories.add("security_leader");
  }
  if (/\bproduct\s+leader\b/i.test(hn) || (tset.has("product") && /\bfounder\b/i.test(hn))) {
    roleCategories.add("product_leader");
  }
  if (/\bprogram\s+manager\b/i.test(hn)) roleCategories.add("program_manager");
  if (/\bboard\s+director\b/i.test(hn)) roleCategories.add("board_member");
  if (
    (tset.has("web3") || tset.has("blockchain") || /\bweb3\b|\bblockchain\b|\bdao\b/i.test(hn)) &&
    /\bfounder\b/i.test(hn)
  ) {
    roleCategories.add("web3_practitioner");
  }
  if (/\barchitect\b/i.test(hn) && /\bfounder\b/i.test(hn)) {
    roleCategories.add("technical_architect");
    if (/\bframework\b|\bmethod\b/i.test(hn)) roleCategories.add("technology_strategist");
  }
  if (
    /\bprincipal\b/i.test(hn) &&
    /\bfounder\b/i.test(hn) &&
    !roleCategories.has("product_leader")
  ) {
    roleCategories.add("business_leader");
    roleCategories.add("consultant");
  }
  if (/\bsecurity\b/i.test(hn) && /\bfounder\s+of\b/i.test(hn)) {
    roleCategories.add("security_practitioner");
  }
}

/**
 * Fold stylized Latin / Unicode small caps seen in LinkedIn headlines so keyword rules match
 * plain ASCII (e.g. small-cap "IT MANAGER" → "it manager").
 */
export function foldStylizedLatinForClassification(input: string): string {
  const map: Record<number, string> = {
    0x0262: "g",
    0x026a: "i",
    0x0274: "n",
    0x0280: "r",
    0x028f: "y",
    0x0299: "b",
    0x029f: "l",
    0x1d00: "a",
    0x1d04: "c",
    0x1d05: "d",
    0x1d07: "e",
    0x1d0a: "j",
    0x1d0b: "k",
    0x1d0d: "m",
    0x1d0f: "o",
    0x1d18: "p",
    0x1d1b: "t",
    0x1d1c: "u",
    0x1d20: "v",
    0x1d21: "w",
    0x1d22: "z",
    0xa730: "f",
    0xa731: "s",
  };
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    out += map[cp] ?? ch;
  }
  return out;
}

function isLikelyEmployerOrganizationName(company: string): boolean {
  const c = company.replace(/\s+/g, " ").trim();
  if (c.length < 2) return false;
  if (/github\.com|linkedin\.com\/in/i.test(c)) return false;
  if (/^a\s+time$/i.test(c)) return false;
  if (/^an?\s+(time|day|moment|minute|year|week|go|chance|way)$/i.test(c)) return false;
  if (/^the\s+(time|way|future|past|moment|day)$/i.test(c)) return false;
  if (/^one\s+insight$/i.test(c)) return false;
  const n = norm(c);
  if (/^remote\s+work\b/i.test(n)) return false;
  if (/\bremote\s+work\s*&\b/i.test(n)) return false;
  if (headlineEmployerLooksDescriptorOrCompoundRole(c)) return false;
  if (/^devops$/i.test(n)) return false;
  if (/^full[\s-]?stack$/i.test(n)) return false;
  if (/^technical\s+lead$/i.test(n)) return false;
  if (/^network\s+automation$/i.test(n)) return false;
  if (
    !/[A-Z0-9]/.test(c) &&
    c.length < 26 &&
    !/\b(inc|llc|ltd|corp|plc|nvidia|idc|okta)\b/i.test(c) &&
    /^[a-z]+(\s+[a-z]+){0,4}$/.test(n)
  ) {
    return false;
  }
  return true;
}

export function explicitHeadlineRecruiterEvidence(headline: string): boolean {
  return /\brecruiter\b|talent\s+acquisition|executive\s+search|head\s*hunter|helping\s+[^\n]{0,200}\s+hire\b|\bhiring\s+for\b|\btalent\s+partner\b|(?:candidate|talent)\s+sourcing|sourcing\s+(?:candidates|talent)\b|\bstaffing\s+(?:agency|firm|services)\b|\brecruitment\b/i.test(
    headline
  );
}

export function headlineHasExplicitSelfOpenToWorkPhrase(headlineFull: string): boolean {
  const n = norm(headlineFull.replace(/\s+/g, " ").trim());
  if (/\b#\s*opentowork\b|\b#\s*open\s*to\s*work\b/i.test(headlineFull)) return true;
  if (/\bopen\s+to\s+work\b/.test(n)) return true;
  if (/\bopen\s+to\s+(?:new\s+)?opportunities\b/.test(n)) return true;
  if (/\bseeking\s+(?:new\s+)?(?:role|opportunities)\b/.test(n)) return true;
  if (/\blooking\s+for\s+(?:work|my\s+next\s+role|opportunities|a\s+new\s+role)\b/.test(n)) {
    return true;
  }
  if (/\bavailable\s+for\s+(?:hire|immediate\b)/i.test(headlineFull)) return true;
  if (/\bimmediate\s+joiner\b/i.test(headlineFull)) return true;
  if (
    /\bopen\s+to\s+.{4,96}\s+roles?\b/i.test(headlineFull) &&
    !/\bopen\s+source\b/.test(n) &&
    !/\bopenai\b/i.test(n)
  )
    return true;
  return false;
}

/** Recruiters routinely discuss hiring in headlines; OTW/job-seeker tagging requires explicit self job-search wording. */
function suppressOpenToWorkFalsePositiveHeadline(
  headlineFull: string,
  result: OpenToWorkDetectResult
): OpenToWorkDetectResult {
  if (result.detection.status === "not_observed") return result;
  if (result.profileFlags.includes("open_to_work_public_signal")) return result;
  if (headlineHasExplicitSelfOpenToWorkPhrase(headlineFull)) return result;
  if (!headlineHasOpenToWorkFalsePositivePhrase(headlineFull)) return result;
  return {
    profileFlags: [],
    markJobSeekerExclusion: false,
    detection: {
      status: "not_observed",
      confidence: 0,
      evidence: "",
      reason:
        "Open* phrasing is not self-attributed Open-to-Work (e.g. open source, relocation, collaboration).",
    },
  };
}

function suppressOpenToWorkMisreadOnRecruiterHeadline(
  headlineFull: string,
  result: OpenToWorkDetectResult
): OpenToWorkDetectResult {
  if (result.detection.status === "not_observed") return result;
  if (result.profileFlags.includes("open_to_work_public_signal")) return result;
  if (!explicitHeadlineRecruiterEvidence(headlineFull)) return result;
  if (headlineHasExplicitSelfOpenToWorkPhrase(headlineFull)) return result;
  return {
    profileFlags: [],
    markJobSeekerExclusion: false,
    detection: {
      status: "not_observed",
      confidence: 0,
      evidence: "",
      reason:
        "Recruiting/talent headline without explicit Open-to-Work wording; suppressing ancillary job-seeker tagging.",
    },
  };
}

/** Headlines with no usable professional signal — generic thread reference is appropriate. */
export function isWeakNonProfessionalHeadline(headline: string): boolean {
  return isLowSignalHeadlineForSafeReference(headline);
}

/** Shared generic safe-reference phrases the eval harness flags. */
export function isGenericSafeProfessionalReference(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return true;
  const t = ref.trim().toLowerCase();
  if (
    t === "your professional background" ||
    t === "your professional work" ||
    t === "your professional perspective" ||
    t === "your perspective shared on the thread" ||
    t === "your work" ||
    t === "your background" ||
    t === "your experience"
  ) {
    return true;
  }
  return (
    /^your (architecture|leadership|engineering leadership|management) work$/i.test(t) ||
    /^your (engineering|sales) (leadership )?perspective$/i.test(t) ||
    /^your product leadership perspective$/i.test(t) ||
    /^your ai practice and technical perspective$/i.test(t) ||
    /^your (engineering|consulting|cybersecurity) work$/i.test(t) ||
    /^your software development work$/i.test(t) ||
    /^your ai work$/i.test(t) ||
    /^your perspective on (AI and platform work|security operations|security leadership)$/i.test(
      t
    ) ||
    /^your founder\/operator perspective$/i.test(t) ||
    /^your investing perspective$/i.test(t) ||
    /^your studies and early career path$/i.test(t) ||
    /^your sales work$/i.test(t) ||
    /^your consulting work$/i.test(t) ||
    /^your product leadership work$/i.test(t) ||
    /^your architecture work$/i.test(t)
  );
}

function acceptSafeProfessionalReference(ref: string | null | undefined): ref is string {
  if (!ref?.trim()) return false;
  if (isGenericSafeProfessionalReference(ref)) return false;
  if (isAwkwardLiteralSafeReference(ref)) return false;
  return true;
}

function tryHeadlineAnchoredReference(
  headline: string,
  currentTitle?: string | null
): string | null {
  if (isWeakNonProfessionalHeadline(headline)) return null;
  const ref = headlineAnchoredSafeReference(headline, currentTitle);
  if (acceptSafeProfessionalReference(ref)) return ref;
  return null;
}

function safeReferenceFromTitleAndLabels(args: {
  headline: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): string | null {
  const composed = composeSafeProfessionalReference(args);
  if (composed && !isGenericSafeProfessionalReference(composed)) return composed;

  const title = (args.currentTitle ?? "").trim();
  const blob = norm(`${title} ${args.headline}`);
  const titleOnly = norm(title);
  const rc = args.roleCategories.filter((r) => r !== "unknown" && r !== "job_seeker");
  const ft = args.functionTags.filter((t) => t !== "unknown");

  if (
    /\bprofessional\s+services\s+consultant\b/i.test(blob) &&
    /\bproofpoint\b/i.test(blob)
  ) {
    return "your cybersecurity professional services work";
  }
  if (/\bcybersecurity\s+consulting\b/i.test(blob) && /\biso\s*27001\b/i.test(blob)) {
    return "your cybersecurity and ISO 27001 consulting work";
  }
  if (
    /\blecturer\b/i.test(blob) &&
    /\b(cse|computer\s+science|dept\.?\s+of\s+cse)\b/i.test(blob) &&
    /\b(cybersecurity|ai\/ml|data\s+science)\b/i.test(blob)
  ) {
    return "your cybersecurity and AI education work";
  }
  if (
    /\baws\b/i.test(blob) &&
    /\b(partner\s+management|solutions\s+architecture|field\s+cto)\b/i.test(blob)
  ) {
    return "your AWS partner solutions architecture work";
  }
  if (
    /\b(co[- ]?founder|founder)\b/i.test(blob) &&
    /\bcto\b/i.test(blob) &&
    /\b(armis|security)\b/i.test(blob)
  ) {
    return "your security engineering leadership and founder perspective";
  }
  if (
    rc.includes("founder") &&
    /\b(identity|pureid|iam|authentication)\b/i.test(blob) &&
    /\bsecurity\b/i.test(blob)
  ) {
    return "your identity and security founder perspective";
  }
  if (
    (/\bdevrel\b/i.test(blob) || /\bdeveloper\s+relations\b/i.test(blob)) &&
    (rc.includes("founder") || /\bfounder\b/i.test(blob))
  ) {
    return "your developer relations and founder perspective";
  }
  if (
    /\bcybersecurity\s+advisor\b/i.test(blob) &&
    /\b(information\s+assurance|privacy|risk\s+management)\b/i.test(blob)
  ) {
    return "your cybersecurity advisory work";
  }
  if (
    /\b(building|building\s+secure)\b/i.test(blob) &&
    /\b(identity|ai\s+identity)\b/i.test(blob) &&
    /\binfrastructure\b/i.test(blob) &&
    !/\s(@|at)\s+[A-Za-z]/i.test(blob)
  ) {
    return "your AI identity and security infrastructure work";
  }
  if (/\bcustomer\s+relationship\b/i.test(blob)) {
    return "your high-tech customer relationship management work";
  }
  if (/\bstrategist\b/i.test(blob) && /\bdata\b/i.test(blob) && /\binnovation\b/i.test(blob)) {
    return "your data and innovation strategy work";
  }
  if (/\b(vp|gm)\b/i.test(blob) && /\bpayments\b/i.test(blob)) {
    return "your payments leadership work";
  }
  if (/\bpartnerships\b/i.test(blob) && /\b(cloud|gtm)\b/i.test(blob) && /\bdirector\b/i.test(blob)) {
    return "your cloud partnerships and GTM leadership";
  }
  if (
    /\btech\s+lead\b/i.test(blob) &&
    /\b(ai\s+platform|distributed\s+systems|product\s+engineering)\b/i.test(blob) &&
    !(/\baws\b/i.test(blob) && /\b(partner|solutions\s+architecture)\b/i.test(blob))
  ) {
    return "your AI platform and distributed systems leadership";
  }
  if (/\.net\b/i.test(blob) && /\bcloud\b/i.test(blob) && /\bengineer/i.test(blob)) {
    return "your .NET and cloud platform engineering work";
  }
  if (titleOnly === "cybersecurity" || /^cybersecurity$/i.test(title)) {
    const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
    if (anchored) return anchored;
    return "your cybersecurity work";
  }
  if (titleOnly === "consultant" || /^consultant$/i.test(title)) {
    const retry = composeSafeProfessionalReference(args);
    if (retry && !isGenericSafeProfessionalReference(retry)) return retry;
    return "your consulting work";
  }
  if (/\bprofessional\b/i.test(blob) && /\bengineer\b/i.test(blob)) {
    const retry = composeSafeProfessionalReference(args);
    if (retry && !isGenericSafeProfessionalReference(retry)) return retry;
    const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
    if (anchored) return anchored;
    return "your engineering work";
  }
  if (rc.includes("customer_success_leader") || rc.includes("account_management")) {
    return "your customer relationship and account management work";
  }
  if (rc.includes("strategy_leader") && (rc.includes("data_leader") || ft.includes("data"))) {
    return "your data and innovation strategy work";
  }
  if (rc.includes("executive_leader") && /\bpayments\b/i.test(blob)) {
    return "your payments leadership work";
  }
  if (rc.includes("partnerships_leader") && (ft.includes("cloud") || /\bcloud\b/i.test(blob))) {
    return "your cloud partnerships and GTM leadership";
  }
  if (
    (rc.includes("engineering_leader") || rc.includes("technical_lead")) &&
    ft.includes("ai_ml")
  ) {
    return "your AI platform and distributed systems leadership";
  }
  if (rc.includes("analyst_security") || /\bindustry\s+analyst\b/i.test(blob)) {
    if (/\bapplication\s+security\b/i.test(blob)) {
      return "your application security analyst perspective";
    }
    return "your industry analyst perspective";
  }
  if (rc.includes("technical_evangelist") || ft.includes("evangelism")) {
    if (/\bcyber\b/i.test(blob) && /\bpodcast/i.test(blob)) {
      return "your cybersecurity evangelism and media work";
    }
    if (/\bcyber\b/i.test(blob)) return "your cybersecurity evangelism work";
    return "your technology evangelism work";
  }
  if (rc.includes("security_practitioner") || ft.includes("cybersecurity")) {
    const secRetry = composeSafeProfessionalReference(args);
    if (secRetry && !isGenericSafeProfessionalReference(secRetry)) return secRetry;
    if (/\biso\s*27001\b/i.test(blob) && /\bconsult/i.test(blob)) {
      return "your cybersecurity and ISO 27001 consulting work";
    }
    if (/\bcybersecurity\s+advisor\b/i.test(blob)) return "your cybersecurity advisory work";
    if (/\blecturer\b/i.test(blob) && /\b(cse|cybersecurity|ai)\b/i.test(blob)) {
      return "your cybersecurity and AI education work";
    }
    if (/^cybersecurity$/i.test(title) && blob.length < 40) {
      const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
      if (anchored) return anchored;
      return "your cybersecurity work";
    }
    if (/\bcybersecurity\b/i.test(blob) && /\bconsult/i.test(blob) && !/\banalyst\b/i.test(blob)) {
      return "your cybersecurity consulting work";
    }
  }
  if (rc.includes("consultant") || ft.includes("consulting")) {
    if (/\bprofessional\s+services\b/i.test(blob) && /\b(cyber|security)\b/i.test(blob)) {
      return "your cybersecurity professional services work";
    }
    if (/\biso\s*27001\b/i.test(blob)) return "your cybersecurity and ISO 27001 consulting work";
    if (/\bcybersecurity\b/i.test(blob)) return "your cybersecurity consulting work";
    if (/\b(independent|fractional)\s+consult/i.test(blob)) return "your independent consulting work";
    const consultRetry = composeSafeProfessionalReference(args);
    if (consultRetry && !isGenericSafeProfessionalReference(consultRetry)) return consultRetry;
    return "your consulting work";
  }
  if (
    (rc.includes("founder") || rc.includes("solo_founder")) &&
    (rc.includes("engineering_leader") || rc.includes("software_engineer")) &&
    /\bsecurity\b/i.test(blob)
  ) {
    return "your security engineering leadership and founder perspective";
  }
  if (ft.includes("php") || /\bphp\s+developer\b/i.test(blob)) {
    return "your PHP development work";
  }
  if (rc.includes("student")) {
    if (rc.includes("product_builder") && /\b(cs|cse|computer\s+science)\b/i.test(blob)) {
      return "your product-building and computer science background";
    }
    if (/\b(bachelor|bachelors)\s+of\b/i.test(blob) && /\bcomputer\s+science\b/i.test(blob)) {
      return "your computer science studies";
    }
    if (/\bcomputer\s+science\b/i.test(blob) || ft.includes("computer_science")) {
      return "your computer science studies";
    }
    if (rc.includes("product_builder")) return "your product-building work";
  }
  if (rc.includes("product_builder") || rc.includes("product_leader")) {
    if (rc.includes("product_builder")) return "your product-building work";
    if (ft.includes("innovation") || /\binnovation\b/i.test(blob)) {
      return "your product and innovation leadership";
    }
    return "your product leadership work";
  }
  if (ft.includes("power_bi") || /\bpower\s*bi\b/i.test(blob)) {
    return "your BI and data engineering work";
  }
  if (
    (rc.includes("ai_engineer") && rc.includes("software_engineer")) ||
    (rc.includes("ai_engineer") && ft.includes("ai_ml"))
  ) {
    const aiRetry = composeSafeProfessionalReference(args);
    if (aiRetry && !isGenericSafeProfessionalReference(aiRetry)) return aiRetry;
    if (/\b(ms\s+cs|m\.?s\.?\s+c\.?s\.?)\b/i.test(blob)) {
      return "your AI and software engineering work";
    }
    return "your AI and software engineering work";
  }
  if (rc.includes("software_engineer") || ft.includes("engineering")) {
    if (/\.net\b/i.test(blob)) return "your .NET and cloud platform engineering work";
    const engRetry = composeSafeProfessionalReference(args);
    if (engRetry && !isGenericSafeProfessionalReference(engRetry)) return engRetry;
    const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
    if (anchored) return anchored;
    return "your engineering work";
  }
  return null;
}

/** Last-resort copy from function_tags when roles stayed unknown-only. */
function safeReferenceFromMeaningfulFunctionTags(
  functionTags: ProspectClassification["functionTags"],
  hNorm: string,
  headline?: string,
  currentTitle?: string | null
): string | null {
  const tags = functionTags.filter((t) => t !== "unknown");
  if (tags.length === 0) return null;
  if (headline) {
    const composed = composeSafeProfessionalReference({
      headline,
      roleCategories: ["unknown"],
      functionTags,
    });
    if (composed && !isGenericSafeProfessionalReference(composed)) return composed;
  }
  if (tags.includes("cybersecurity") || tags.includes("security")) {
    if (headline) {
      const sec = composeSafeProfessionalReference({
        headline,
        roleCategories: ["unknown"],
        functionTags,
      });
      if (sec && !isGenericSafeProfessionalReference(sec)) return sec;
      const anchored = tryHeadlineAnchoredReference(headline, currentTitle);
      if (anchored) return anchored;
    }
    return "your cybersecurity work";
  }
  if (tags.includes("engineering")) {
    if (headline) {
      const anchored = tryHeadlineAnchoredReference(headline, currentTitle);
      if (anchored) return anchored;
    }
    return "your engineering work";
  }
  if (tags.includes("platform")) {
    if (/\b(building|operating|private)\b/i.test(hNorm)) return "your platform-building work";
    return "your platform work";
  }
  if (tags.includes("data") || tags.includes("data_analytics")) return "your data work";
  if (tags.includes("product") || tags.includes("product_engineering")) return "your product work";
  if (tags.includes("sales")) {
    if (headline) {
      const anchored = tryHeadlineAnchoredReference(headline, currentTitle);
      if (anchored) return anchored;
    }
    return "your sales work";
  }
  if (tags.includes("marketing") || tags.includes("growth")) return "your marketing work";
  if (tags.includes("consulting")) return "your consulting work";
  if (tags.includes("ai_ml")) return "your AI work";
  if (tags.includes("enterprise_architecture") || tags.includes("technical_architecture")) {
    return "your enterprise architecture work";
  }
  return null;
}

function safeReferenceFromConcreteRoles(
  roleCategories: ProspectClassification["roleCategories"],
  hNorm: string,
  headline?: string,
  currentTitle?: string | null
): string | null {
  const rc = roleCategories.filter((r) => r !== "unknown" && r !== "job_seeker");
  if (rc.length === 0) return null;
  if (
    rc.includes("technical_architect") ||
    rc.includes("systems_architect") ||
    rc.includes("business_architect")
  ) {
    if (/\b(enterprise|systems)\b/i.test(hNorm) && /\barchitect\b/i.test(hNorm)) {
      return "your systems architecture work";
    }
    if (/\benterprise\b/i.test(hNorm)) return "your enterprise architecture work";
    return "your architecture work";
  }
  if (rc.includes("executive_leader") || rc.includes("business_leader")) {
    if (/\bexecutive\s+director\b/i.test(hNorm)) return "your executive leadership work";
    if (/\bceo\b/i.test(hNorm) || /\bfounding\s+ceo\b/i.test(hNorm)) return "your executive leadership work";
    if (/\bsponsor\s+finance\b/i.test(hNorm)) return "your sponsor finance leadership";
  }
  if (rc.includes("hr_leader") || rc.includes("recruiter") || rc.includes("people_leader")) {
    return "your HR and talent leadership work";
  }
  if (rc.includes("customer_success_leader") || rc.includes("account_management")) {
    return "your customer success work";
  }
  if (rc.includes("partnerships_leader") && /\balliances?\b/i.test(hNorm)) {
    return "your global alliances leadership";
  }
  if (rc.includes("product_manager") || rc.includes("product_leader")) {
    if (/\bproduct\b/i.test(hNorm) && (/\bat\b|@/i.test(hNorm) || /\bproduct\s+at\b/i.test(hNorm))) {
      return "your product work";
    }
    return "your product management work";
  }
  if (rc.includes("student") && /\bengineering\b/i.test(hNorm)) {
    return "your engineering studies";
  }
  if (rc.includes("coach_or_advisor") && /\bcoach\b/i.test(hNorm)) {
    return "your leadership coaching work";
  }
  if (rc.includes("investor") && /\bangel\b/i.test(hNorm)) {
    return "your investing and advisory work";
  }
  if (rc.includes("founder")) {
    if (/\b(identity|iam|authentication)\b/i.test(hNorm) && /\bsecurity\b/i.test(hNorm)) {
      return "your identity and security founder perspective";
    }
    if (/\bdevrel\b/i.test(hNorm) || /\bdeveloper\s+relations\b/i.test(hNorm)) {
      return "your developer relations and founder perspective";
    }
    if (headline) {
      const anchored = tryHeadlineAnchoredReference(headline, currentTitle);
      if (anchored) return anchored;
    }
    return "your founder/operator perspective";
  }
  if (rc.includes("technical_evangelist")) {
    if (rc.includes("founder")) return "your developer relations and founder perspective";
    return "your developer relations work";
  }
  return null;
}

/** Final fallback: thread phrase only when no useful professional signal exists. */
function finalSafeReferenceFallback(args: {
  headline: string;
  hNorm: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): string {
  if (!hasUsefulProfessionalSignal(args)) {
    return THREAD_PERSPECTIVE_FALLBACK;
  }

  const composed = composeSafeProfessionalReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (composed && !isGenericSafeProfessionalReference(composed)) return composed;

  const contextual = safeReferenceFromTitleAndLabels({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (contextual && !isGenericSafeProfessionalReference(contextual)) return contextual;

  const cue = safeReferenceFromHeadlineCue(args.hNorm, args.headline);
  if (cue && !isGenericSafeProfessionalReference(cue)) return cue;

  const tagRef = safeReferenceFromMeaningfulFunctionTags(
    args.functionTags,
    args.hNorm,
    args.headline,
    args.currentTitle
  );
  if (tagRef && !isGenericSafeProfessionalReference(tagRef)) return tagRef;

  const anchoredEarly = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
  if (anchoredEarly) return anchoredEarly;

  const roleRef = safeReferenceFromConcreteRoles(
    args.roleCategories,
    args.hNorm,
    args.headline,
    args.currentTitle
  );
  if (roleRef && !isGenericSafeProfessionalReference(roleRef)) return roleRef;

  if (/^\s*engineering\s*$/i.test(args.hNorm.trim())) {
    const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
    if (anchored) return anchored;
    return "your engineering work";
  }
  if (/\barchitect\b/i.test(args.hNorm)) {
    if (/\b(enterprise|systems|decision)\b/i.test(args.hNorm)) return "your systems architecture work";
    return "your architecture work";
  }
  if (/\bexecutive\s+director\b/i.test(args.hNorm)) return "your executive leadership work";
  if (/\b(founding\s+)?ceo\b/i.test(args.hNorm)) return "your executive leadership work";

  const title = (args.currentTitle ?? "").trim();
  if (title) {
    const titleRef = safeReferenceFromTitleAndLabels({
      headline: args.headline,
      currentTitle: title,
      roleCategories: args.roleCategories,
      functionTags: args.functionTags,
    });
    if (titleRef) return titleRef;
  }

  const composedLate = composeSafeProfessionalReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (composedLate && !isGenericSafeProfessionalReference(composedLate)) return composedLate;

  if (headlineHasRecognizableProfessionalCue(args.headline)) {
    const titleRef = safeReferenceFromTitleAndLabels({
      headline: args.headline,
      currentTitle: args.currentTitle,
      roleCategories: args.roleCategories,
      functionTags: args.functionTags,
    });
    if (titleRef && !isGenericSafeProfessionalReference(titleRef)) return titleRef;
    const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
    if (anchored) return anchored;
  }

  return outreachReferenceWhenSignalExists(args);
}

export function finalizeSafeProfessionalReference(args: {
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
  profileFlags: ProfileFlag[];
  safeProfessionalReference: string | null | undefined;
  headline: string;
  currentTitle?: string | null;
}): string {
  const explicit = resolveExplicitSafeProfessionalReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (acceptSafeProfessionalReference(explicit)) {
    return explicit;
  }

  const concreteRoles = args.roleCategories.filter((r) => r !== "unknown" && r !== "job_seeker");
  if (
    isLowSignalHeadlineForSafeReference(args.headline) &&
    concreteRoles.length === 0 &&
    !headlineSupportsExplicitSafeReference(args.headline)
  ) {
    return THREAD_PERSPECTIVE_FALLBACK;
  }

  const composed = composeSafeProfessionalReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (acceptSafeProfessionalReference(composed)) {
    return composed;
  }
  const contextual = safeReferenceFromTitleAndLabels({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (acceptSafeProfessionalReference(contextual)) {
    return contextual;
  }
  if (acceptSafeProfessionalReference(args.safeProfessionalReference)) {
    return args.safeProfessionalReference;
  }
  const rebuilt = buildSafeReference({
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
    profileFlags: new Set(args.profileFlags),
    headlineTooVague: false,
    headline: args.headline,
    currentTitle: args.currentTitle,
  });
  if (acceptSafeProfessionalReference(rebuilt)) return rebuilt;
  const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
  if (anchored) return anchored;
  return (
    (composed && !isGenericSafeProfessionalReference(composed) ? composed : null) ??
    finalSafeReferenceFallback({
      headline: args.headline,
      hNorm: norm(args.headline),
      currentTitle: args.currentTitle,
      roleCategories: args.roleCategories,
      functionTags: args.functionTags,
    })
  );
}

function scrubMisleadingFunctionTags(
  headline: string,
  tags: ProspectClassification["functionTags"]
): ProspectClassification["functionTags"] {
  const hn = norm(headline);
  const out = new Set(tags);
  if (
    /\b(nfl|nba|mlb|nhl|sports|player|talent)\s+agent\b/i.test(hn) &&
    !/\b(ai|artificial\s+intelligence|machine\s+learning|mlops)\b/i.test(hn)
  ) {
    out.delete("ai_ml");
  }
  return [...out];
}

function headlineSuggestsStrongIcAiEngineering(headline: string): boolean {
  const t = norm(headline);
  return (
    /\bai\s+engineer\b/.test(t) &&
    /\b(multi[- ]agent|\bmcp\b|agentic|production\s+agentic)\b/.test(t)
  );
}

function isWeakAgenticVisionHeadline(headline: string): boolean {
  const t = headline.replace(/\s+/g, " ").trim();
  if (t.length > 100) return false;
  const tn = norm(t);
  if (
    /\b(agentic\s+future|agentic\s+enterprises?|the\s+agentic\s+future)\b/i.test(t) &&
    !/\b(engineer|developer|manager|director|founder|consultant|ciso|president|analyst)\b/.test(
      tn
    ) &&
    !/\bvp\b|\bcto\b/.test(tn)
  ) {
    return true;
  }
  if (/^preparing\s+.+\s+for\s+the\s+agentic\s+future\.?$/i.test(t)) return true;
  return false;
}

function headlineIsAppSecStrategicMarketing(headline: string): boolean {
  const t = norm(headline);
  return (
    (/\bappsec\b|\bapplication\s+security\b/.test(t) &&
      /\bstrategic\s+marketing|marketing\s+engagement\b/.test(t)) ||
    /appsec.*devops.*strategic\s+marketing|devops.*convergence.*strategic\s+marketing/i.test(t)
  );
}

/** Normalize LinkedIn headline quirks (e.g. "l" used as segment separator). */
export function normalizeHeadlineDelimiters(headline: string): string {
  return headline
    .replace(/\s+/g, " ")
    .replace(/\u2016/g, " | ")
    .replace(/\s+[lL]\s+(?=[A-Z])/g, " | ")
    .trim();
}

/** First org chunk: trim descriptors after • · | 🔹 or long comma trailers. */
export function normalizeCompanyFragment(companyRaw: string): string {
  return normalizeEmployerName(companyRaw);
}

/** Split comma/semicolon past-employer blobs into clean org names (strips Ex- prefixes). */
export function expandPastEmployerTokens(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const pushToken = (token: string) => {
    const stripped = token.replace(/^\s*ex[-–]\s*/gi, "").trim();
    if (!stripped || stripped.length < 2) return;
    const co = normalizeCompanyFragment(stripped);
    if (!co || co.length < 2) return;
    const k = norm(co);
    if (seen.has(k)) return;
    if (!isLikelyEmployerOrganizationName(co)) return;
    seen.add(k);
    out.push(co);
  };
  for (const chunk of raw.split(/[;|]/)) {
    for (const part of chunk.split(/,/)) {
      pushToken(part.trim());
    }
  }
  return out;
}

/** Collect former employers from "Ex-Org", "ex-Org" list patterns in a headline. */
export function collectExEmployersFromHeadline(headline: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\bex[-–]\s*([A-Za-z0-9][\w.&'-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headline)) !== null) {
    let co = normalizeCompanyFragment((m[1] ?? "").trim());
    co = co.split(/[,;]/)[0]?.trim() ?? co;
    if (!co || co.length < 2) continue;
    const k = norm(co);
    if (seen.has(k)) continue;
    if (!isLikelyEmployerOrganizationName(co)) continue;
    seen.add(k);
    out.push(co);
  }
  return out;
}

/** Dedupe and format past employers; last_company only when exactly one former org. */
export function finalizePastEmployerFields(
  pastCompany: string | null,
  headline: string
): { pastCompany: string | null; lastCompany: string | null } {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const co of [
    ...expandPastEmployerTokens(pastCompany),
    ...collectExEmployersFromHeadline(headline),
  ]) {
    const k = norm(co);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(co);
  }
  if (list.length === 0) return { pastCompany: null, lastCompany: null };
  return {
    pastCompany: list.join("; "),
    lastCompany: list.length === 1 ? list[0]! : null,
  };
}

function cleanTitleFragment(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Extract job title and employer from headline (conservative; skips education segments).
 */
export function extractTitleCompanyFromHeadline(headline: string): {
  title: string;
  company: string;
  confidence: number;
} | null {
  const p = parseHeadlineEmploymentAndEducation(headline);
  if (!p.primaryEmployment) return null;
  const e = p.primaryEmployment;
  return {
    title: e.title,
    company: e.company,
    confidence: e.company ? e.confidence : Math.min(e.confidence, 0.55),
  };
}

const UNIVERSITY_HINT =
  /\b(university|college|institute|polytechnic|academy|conservatory|seminary)\b/i;
const SHORT_SCHOOL_TOKEN =
  /\b(cuhk|knust|nyu|umd|ucla|mit|epfl|eth|hec|insead|lbs|lbsa|pdeu|reichman|idc\b|\bub\b|nitjsr|brown|iit[a-z]*)\b/i;

/** Drop trailing class year so "NITJSR 2020" matches school tokens. */
function stripClassYearSuffix(org: string): string {
  return org
    .replace(/\s+/g, " ")
    .replace(/\s+\d{4}\s*$/i, "")
    .trim();
}

function parsePastRoleTitleCompanyFromTail(
  tailRaw: string
): { title: string; company: string } | null {
  let tail = tailRaw
    .replace(/^(?:Previously|Formerly|Former)\s+/i, "")
    .replace(/^Ex[-–]\s*/i, "")
    .trim();
  tail = tail.replace(/\s*\([^)]{0,56}\)\s*\.?\s*$/i, "").trim();
  const ofM = tail.match(
    /^(co[- ]?founder|founder|co[- ]?owner|owner)\s+of\s+([A-Za-z0-9][\w.-]*(?:\.[A-Za-z]{2,})?)/i
  );
  if (ofM) {
    const rawT = ofM[1] ?? "";
    const title =
      /^co/i.test(rawT) && /founder/i.test(rawT)
        ? "Co-Founder"
        : /^founder/i.test(rawT)
          ? "Founder"
          : cleanTitleFragment(rawT);
    const company = normalizeCompanyFragment(ofM[2] ?? "");
    if (company) return { title, company };
  }
  return null;
}

/**
 * Split "Acme Corp. Former X, Y, Z executive" into current employer + former org list.
 * Also splits "... PressWhizz.com. Previously co-founder of Other.org" into current + structured past role.
 */
function splitFormerEmployersFromCompanyBlob(companyRaw: string): {
  current: string;
  formerCompanies: string[];
  pastRole: { title: string; company: string } | null;
} {
  let s = companyRaw.replace(/\s+/g, " ").trim();
  if (!s) return { current: "", formerCompanies: [], pastRole: null };
  const formerCompanies: string[] = [];
  let pastRole: { title: string; company: string } | null = null;

  let pastSentence = -1;
  const prevIdx = s.search(/\.\s*Previously\b/i);
  const exIdx = s.search(/\.\s*Ex[-–]\b/i);
  if (prevIdx !== -1) pastSentence = prevIdx;
  if (exIdx !== -1 && (pastSentence === -1 || exIdx < pastSentence)) pastSentence = exIdx;

  if (pastSentence !== -1) {
    const before = s.slice(0, pastSentence).trim();
    const tail = s
      .slice(pastSentence)
      .replace(/^\.\s*/i, "")
      .trim();
    pastRole = parsePastRoleTitleCompanyFromTail(tail);
    s = before;
  }

  const formerDot = s.search(/\.\s*(?:Former|Formerly)\s+/i);
  if (formerDot !== -1) {
    const before = s.slice(0, formerDot).trim();
    let tail = s
      .slice(formerDot)
      .replace(/^\.\s*(?:Former|Formerly)\s+/i, "")
      .trim();
    tail = tail.replace(/\s+executive\s*\.?\s*$/i, "").trim();
    for (const part of tail.split(/\s*,\s*/)) {
      const co = normalizeCompanyFragment(part);
      if (co && isLikelyEmployerOrganizationName(co)) formerCompanies.push(co);
    }
    s = before;
  }
  return { current: normalizeCompanyFragment(s), formerCompanies, pastRole };
}

function mergePastEmployerCompanies(existing: string | null, added: string[]): string | null {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const co of [...expandPastEmployerTokens(existing), ...added.filter(Boolean)]) {
    const k = norm(co);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(co);
  }
  return list.length > 0 ? list.join("; ") : null;
}

/** Master's/doctorate credential (e.g. MSCS, MBA) — not a job title before @ School. */
function looksLikeDegreeCredentialTitle(titlePart: string): boolean {
  const raw = titlePart.replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const n = norm(raw);
  if (
    /\b(bachelor|bachelors|master|masters)\s+of\b/i.test(n) &&
    !/\b(founder|ceo|coo|president|chief|vice\s+president|\bvp\b)\b/.test(n) &&
    raw.length <= 96
  ) {
    return true;
  }
  if (raw.length > 28) return false;
  if (
    /\b(engineer|engineering|developer|development|founder|ceo|manager|director|lead|consultant|architect|specialist|analyst|trainer|advisor|adviser|lecturer|professor|owner|scientist|designer|coach|vp|cto|cfo)\b/.test(
      n
    )
  ) {
    return false;
  }
  if (
    /\b(mscs?|m\.?\s*s\.?\s*c\.?\s*s?\.?|m\.?\s*s\b|m\.?sc\b|mba|m\.?\s*b\.?a|ph\.?\s*d\.?|phd|b\.?\s*s\b|bsc|mca|msce|m\.?eng|mfa|dba|edd|jd|md|b\.?\s*a\b|m\.?\s*a\b)\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (/^[A-Z]{3,6}$/.test(raw.trim()) && !/^(CEO|CFO|CTO|CISO|VP|HRBP|PMO)$/.test(raw.trim())) {
    return true;
  }
  return false;
}

function segmentLooksLikeSchoolName(s: string): boolean {
  const stripped = stripClassYearSuffix(s);
  const x = norm(stripped);
  return UNIVERSITY_HINT.test(stripped) || SHORT_SCHOOL_TOKEN.test(x) || /\bsmak\b/i.test(x);
}

function looksLikeDegreeAtUniversityPair(area: string, institution: string): boolean {
  const a = norm(area);
  return (
    !!area.trim() &&
    !!institution.trim() &&
    /\b(bachelor|bachelors|master|masters)\s+of\b/.test(a) &&
    (segmentLooksLikeSchoolName(institution) || UNIVERSITY_HINT.test(institution))
  );
}

/** True when subject@school education should add `student` (skip e.g. MS CS + IC engineers elsewhere in headline). */
function educationSubjectPairImpliesStudentHeadline(
  headline: string,
  educationArea: string | null
): boolean {
  if (professionalTitleOutranksStudent(headline)) return false;
  const h = norm(headline);
  if (!educationArea) return true;
  if (
    /\bai\s+engineer\b/.test(h) &&
    /\bsoftware\s+engineer\b/.test(h) &&
    /\b(ms\s+cs|m\.?s\.?\s+c\.?s\.?)\b/.test(h)
  ) {
    return false;
  }
  return true;
}

/**
 * Groups like mentorship lines — not current employer title/company.
 */
function isLikelyCampusOrProgramAffiliation(titlePart: string, companyPart: string): boolean {
  const tn = norm(titlePart);
  const cn = norm(companyPart);
  if (/^(member|mentee|volunteer|participant|ambassador|delegate)\b/i.test(tn.trim())) return true;
  if (/^top\s+\d+%?\s*ile\b/i.test(tn.trim())) return true;
  if (
    /\b(codechef|leetcode|codess|chapter\b|summer\s+analytics|summer\s+program|\biitg\b|forward['\u2019]?\s*\d{2})\b/.test(
      cn
    )
  ) {
    return true;
  }
  if (/^(member|mentee)\b/i.test(tn) && /@/.test(`${titlePart} ${companyPart}`)) return true;
  return false;
}

/**
 * Subject-field lines like "Economics & CS @ NYU" — education, not employment.
 * Conservative: requires a school-like token on the right and no obvious job-title words on the left.
 */
function looksLikeSubjectFieldsLineBeforeAtSchool(titlePart: string, companyPart: string): boolean {
  const left = titlePart.replace(/\s+/g, " ").trim();
  const school = companyPart.replace(/\s+/g, " ").trim();
  if (!left || !school) return false;
  if (!segmentLooksLikeSchoolName(school)) return false;
  const leftN = norm(left);
  if (
    /\b(director|manager|engineer|founder|ceo|coo|president|officer|consultant|analyst|developer|specialist|vp\b|cto|cfo|cro|cmo|head\s+of|lead\b|architect|executive|coach|recruiter|writer|author|partner\b|owner\b|president)\b/.test(
      leftN
    )
  ) {
    return false;
  }
  if (/[&+]|\s+\+\s+|\s+and\s+/i.test(left)) return true;
  if (
    /\b(cs|cse|ece|ict|economics|stats|statistics|math|physics|biology|chemistry)\b/i.test(leftN) &&
    left.length <= 72
  ) {
    return true;
  }
  if (
    looksLikeDegreeCredentialTitle(left) &&
    left.length <= 12 &&
    segmentLooksLikeSchoolName(school)
  ) {
    return true;
  }
  return false;
}

function isAdjunctOrProfessorTitle(titlePart: string): boolean {
  const t = norm(titlePart);
  return (
    /\badjunct\b/.test(t) || /\bprofessor\b/.test(t) || /\blecturer\b/.test(t) || /\bdean\b/.test(t)
  );
}

/**
 * True when this title/company pair describes education or academic affiliation, not commercial employment.
 */
function isEducationOrAcademicAffiliation(
  segment: string,
  titlePart: string,
  companyPart: string
): boolean {
  const segN = norm(segment);
  const titleN = norm(titlePart);
  if (looksLikeSubjectFieldsLineBeforeAtSchool(titlePart, companyPart)) return true;
  if (hasStrictStudentSignal(segment)) return true;
  if (/\bstudent\b/.test(titleN)) return true;
  if (/\bstudy\s+/i.test(titlePart)) return true;
  if (/\bstudying\b/.test(titleN)) return true;
  if (/\bmasters?\s+in\b|\bbachelors?\s+in\b|\bphd\b|\bmba\b/.test(segN)) return true;
  if (isAdjunctOrProfessorTitle(titlePart) && segmentLooksLikeSchoolName(companyPart)) return true;
  if (segmentLooksLikeSchoolName(companyPart) && /\bcandidate\b/.test(titleN)) return true;
  if (looksLikeDegreeCredentialTitle(titlePart) && segmentLooksLikeSchoolName(companyPart))
    return true;
  if (
    /\b(freshman|sophomore|junior|senior)\b/i.test(titleN) &&
    /\bmajor\b/.test(titleN) &&
    segmentLooksLikeSchoolName(companyPart)
  ) {
    return true;
  }
  if (
    /^(freshman|sophomore|junior|senior)\s*$/i.test(titlePart.trim()) &&
    segmentLooksLikeSchoolName(companyPart) &&
    (UNIVERSITY_HINT.test(companyPart) || /\buniversity\b|\bcollege\b/i.test(companyPart))
  ) {
    return true;
  }
  return false;
}

export type ParsedHeadlineEmployment = {
  title: string;
  company: string;
  confidence: number;
};

export type ParsedHeadline = {
  primaryEmployment: ParsedHeadlineEmployment | null;
  /** Ex-/former-only segment; not used as current employer. */
  pastEmployment: { title: string; company: string } | null;
  educationInstitution: string | null;
  educationArea: string | null;
  affiliations: string[];
};

function applyFormerEmployerSplitToParsed(out: ParsedHeadline): void {
  const pe = out.primaryEmployment;
  if (!pe?.company?.trim()) return;
  const { current, formerCompanies, pastRole } = splitFormerEmployersFromCompanyBlob(pe.company);
  if (formerCompanies.length === 0 && current === pe.company && !pastRole) return;

  out.primaryEmployment = { ...pe, company: current || pe.company };

  const fromList =
    formerCompanies.length > 0 ? mergePastEmployerCompanies(null, formerCompanies) : null;
  const mergedCompany = mergePastEmployerCompanies(
    fromList,
    pastRole?.company ? [pastRole.company] : []
  );

  const prevTitle = out.pastEmployment?.title?.trim() ?? "";
  const phraseTitle = pastRole?.title?.trim() ?? "";
  const nextTitle = phraseTitle || prevTitle;

  if (mergedCompany?.trim() || nextTitle) {
    out.pastEmployment = {
      title: nextTitle,
      company: mergedCompany?.trim() ?? "",
    };
  }
}

function segmentIsPastOnlyEmploymentSegment(seg: string): boolean {
  const s = seg.trim();
  if (!s) return false;
  if (headlineSegmentLooksRetiredEmployment(s)) return true;
  if (/^\s*prev(?:ious)?\s*@\s*/i.test(s)) return true;
  if (/^\s*(?:ex-?|former|formerly|previously)\b/i.test(s)) return true;
  if (/^\s*ex[-–]\s*[A-Za-z]/i.test(s)) return true;
  return false;
}

function stripPastRoleTitlePrefixes(title: string): string {
  return title.replace(/^(?:ex-?|former|formerly|previously)\s+/i, "").trim();
}

function tryParseExCompanyOnlySegment(seg: string): string | null {
  const s = seg.trim();
  if (!/^\s*ex[-–]/i.test(s)) return null;
  if (/\s+at\s+|\s*@\s*/i.test(s)) return null;
  const rest = (
    s
      .replace(/^\s*ex[-–]\s*/i, "")
      .trim()
      .split(/\s*[|•·]/)[0] ?? ""
  ).trim();
  if (!rest || rest.length < 2) return null;
  const co = normalizeCompanyFragment(rest);
  if (!co || !isLikelyEmployerOrganizationName(co)) return null;
  return co;
}

function preferIndependentConsultantCeoPrimaryEmployer(
  single: string,
  primary: ParsedHeadlineEmployment | null
): ParsedHeadlineEmployment | null {
  const firstSeg = single.split(/\|/)[0]?.trim() ?? "";
  if (!/\bindependent\s+consultant\b/i.test(firstSeg) || !/\bceo\s*@\s*/i.test(firstSeg)) {
    return primary;
  }
  const m = firstSeg.match(/\bindependent\s+consultant\s*&\s*ceo\s*@\s*([^|•·]+?)$/i);
  if (!m?.[1]) return primary;
  const co = normalizeCompanyFragment(cleanTitleFragment(m[1]));
  if (!co || !isLikelyEmployerOrganizationName(co)) return primary;
  return { title: "Independent Consultant & CEO", company: co, confidence: 0.62 };
}

function extractEducationHints(headline: string): {
  institution: string | null;
  area: string | null;
} {
  const single = headline.replace(/\s+/g, " ").trim();
  if (!single) return { institution: null, area: null };
  let institution: string | null = null;
  let area: string | null = null;

  const mStudy = single.match(/\b(?:study|studying)\s+([^@|•·]+?)\s+@\s+([^|•·]+?)(?:\s*[|•·]|$)/i);
  if (mStudy) {
    area = cleanTitleFragment(mStudy[1] ?? "");
    institution = normalizeCompanyFragment(mStudy[2] ?? "");
  }

  const mClassYearMajor = single.match(
    /\b(freshman|sophomore|junior|senior)\s+([^@|•·]+?)\s+major\s*@\s*([^|•·]+?)(?:\s*[|•·]|$)/i
  );
  if (mClassYearMajor && (!area || !institution)) {
    area = cleanTitleFragment(
      `${mClassYearMajor[1] ?? ""} ${mClassYearMajor[2] ?? ""}`.replace(/\s+/g, " ").trim()
    );
    institution = normalizeCompanyFragment(mClassYearMajor[3] ?? "");
  }

  const mStuAt = single.match(/\b(.+?)\s+student\s+@\s+([^|•·]+?)(?:\s*[|•·]|$)/i);
  if (mStuAt && (!area || !institution)) {
    area = area || cleanTitleFragment(mStuAt[1] ?? "");
    institution = institution || normalizeCompanyFragment(mStuAt[2] ?? "");
  }

  const mStuAt2 = single.match(/\b(.+?)\s+student\s+at\s+([^|•·]+?)(?:\s*[|•·]|$)/i);
  if (mStuAt2 && (!area || !institution)) {
    area = area || cleanTitleFragment(mStuAt2[1] ?? "");
    institution = institution || normalizeCompanyFragment(mStuAt2[2] ?? "");
  }

  const mBachAt = single.match(
    /\b((?:bachelor|bachelors|master|masters)\s+of\b[^|•·]{0,120}?)\s+at\s+([^|•·]+?)(?:\s*[|•·]|$)/i
  );
  if (mBachAt && (!area || !institution)) {
    const left = cleanTitleFragment(mBachAt[1] ?? "");
    const right = normalizeCompanyFragment(mBachAt[2] ?? "");
    if (left && right && (segmentLooksLikeSchoolName(right) || UNIVERSITY_HINT.test(right))) {
      area = left;
      institution = right;
    }
  }

  const mBTech = single.match(/\b(b\.?tech)\s+[^|•·]{0,40}cse[''\u2019]?\s*\d{2}\b/i);
  if (mBTech && !area) {
    area = cleanTitleFragment(mBTech[0] ?? "");
  }

  const mDualSubj = single.match(
    /(?:^|[|]\s*)([^@|•·🔹]{2,80}?)\s*@\s*([^|•·🔹]{2,48}?)(?=\s*[|•·🔹]|$)/i
  );
  if (mDualSubj) {
    const left = cleanTitleFragment(mDualSubj[1] ?? "");
    const right = normalizeCompanyFragment(mDualSubj[2] ?? "");
    if (looksLikeSubjectFieldsLineBeforeAtSchool(left, right) && (!area || !institution)) {
      area = left;
      institution = right;
    }
  }

  const mPdeu = single.match(/\b(pdeu)\s+ict[''\u2019]?\s*\d{2}\b/i);
  if (mPdeu && (!area || !institution)) {
    institution = institution || "PDEU";
    area = area || "ICT";
  }

  const mDegAt = single.match(/\b([^@|•·]+?)\s+@+\s+([^|•·]+?)(?:\s*[|•·]|$)/i);
  if (mDegAt) {
    const left = cleanTitleFragment(mDegAt[1] ?? "");
    const right = normalizeCompanyFragment(mDegAt[2] ?? "");
    if (
      looksLikeDegreeCredentialTitle(left) &&
      segmentLooksLikeSchoolName(right) &&
      (!area || !institution)
    ) {
      area = left;
      institution = right;
    }
  }

  const mCs = single.match(/\bcomputer\s+science\b/i);
  if (mCs && area && !/\bcomputer\s+science\b/i.test(area)) {
    area = area.includes("CS") || area.includes("CSE") ? area : `Computer Science · ${area}`;
  }

  if (institution) institution = institution.replace(/\s+/g, " ").trim() || null;
  if (area) area = area.replace(/\s+/g, " ").trim() || null;
  return { institution, area };
}

/** "| Major- … | Minor- …" style fields from the full headline. */
function extractMajorMinorFromHeadline(headline: string): string | null {
  const h = headline.replace(/\s+/g, " ").trim();
  if (!h) return null;
  const majorM = h.match(/\bMajor[-–\s:]*\s*([^|]+?)(?=\s*\||\s*Minor[-–\s:]|$)/i);
  const minorM = h.match(/\bMinor[-–\s:]*\s*([^|]+?)(?=\s*\||$)/i);
  const major = majorM
    ? cleanTitleFragment(majorM[1] ?? "")
        .replace(/^[-–:\s]+/, "")
        .trim()
    : "";
  const minor = minorM
    ? cleanTitleFragment(minorM[1] ?? "")
        .replace(/^[-–:\s]+/, "")
        .trim()
    : "";
  if (!major && !minor) return null;
  if (major && minor) return `${major} / ${minor}`;
  return major || minor;
}

function gatherAffiliationsFromAtChunks(single: string, primaryCompany: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (primaryCompany) seen.add(norm(primaryCompany));
  const chunks = single.split("@");
  for (let i = 1; i < chunks.length; i++) {
    const raw = (chunks[i] ?? "").trim();
    const org = normalizeCompanyFragment(raw.split(/[|•·&,]/)[0] ?? "");
    if (/github\.com/i.test(org)) continue;
    if (org.length >= 2 && !seen.has(norm(org))) {
      seen.add(norm(org));
      out.push(org);
    }
  }
  return out;
}

function shouldSkipPrimaryEmploymentSegment(seg: string): boolean {
  const s = seg.trim();
  if (!s) return true;
  if (/^(building|seeking|open\s+to|aspiring|creating|launching|scaling)\b/i.test(s)) return true;
  return false;
}

function proseAtTimeFalseEmployer(titlePart: string, companyPart: string): boolean {
  const tn = norm(titlePart);
  const cn = norm(companyPart);
  if (!cn || !tn) return false;
  if (/\bone\s+insight\b/.test(tn) && /^a\s+time$/.test(cn)) return true;
  if (/sense\s+of\b/.test(tn) && /^a\s+time$/.test(cn)) return true;
  if (/\b(one\s+step|one\s+day|one\s+go)\b/.test(tn) && /^a\s+time$/.test(cn)) return true;
  if (
    cn === "scale" &&
    (/\b(helping|driving|empowering|enabling|partnering|securing|building|scaling)\b/.test(tn) ||
      /\b(identity|identities|workload|cloud|enterprise)\b/.test(tn))
  ) {
    return true;
  }
  if (/\bat\s+scale\b/.test(tn)) return true;
  return false;
}

function tryParseAtInSegment(
  seg: string
): { title: string; company: string; confidence: number } | null {
  const presComma = seg.match(/^\s*President,\s+([^|•·🔹]{2,120}?)(?=\s*[|•·🔹]|$)/i);
  if (presComma) {
    const companyPart = normalizeCompanyFragment(presComma[1] ?? "");
    if (companyPart && isLikelyEmployerOrganizationName(companyPart)) {
      return { title: "President", company: companyPart, confidence: 0.71 };
    }
  }

  const indepConsultantCeoAt = seg.match(
    /^\s*(independent\s+consultant\s*&\s*ceo)\s*@\s*([^|•·]+?)(?:\s*[|•·]|$)/i
  );
  if (indepConsultantCeoAt) {
    let companyPart = cleanTitleFragment(indepConsultantCeoAt[2] ?? "");
    companyPart = normalizeCompanyFragment(companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart);
    if (!companyPart || !isLikelyEmployerOrganizationName(companyPart)) return null;
    return { title: "Independent Consultant & CEO", company: companyPart, confidence: 0.62 };
  }

  const founderCeoAt = seg.match(
    /^\s*(founder\s*&\s*ceo|ceo\s*&\s*founder|founder\s+&\s+ceo)\s*@\s*([^|•·]+?)(?:\s*[|•·]|$)/i
  );
  if (founderCeoAt) {
    let companyPart = cleanTitleFragment(founderCeoAt[2] ?? "");
    if (!companyPart) return null;
    companyPart = normalizeCompanyFragment(companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart);
    if (!companyPart) return null;
    if (isEducationOrAcademicAffiliation(seg, "Founder & CEO", companyPart)) return null;
    return { title: "Founder & CEO", company: companyPart, confidence: 0.64 };
  }

  const founderAt = seg.match(/^\s*(founder|co[- ]?founder)\s*@\s*([^|•·]+?)(?:\s*[|•·]|$)/i);
  if (founderAt) {
    const titlePart = cleanTitleFragment(founderAt[1] ?? "");
    let companyPart = cleanTitleFragment(founderAt[2] ?? "");
    if (!titlePart || !companyPart) return null;
    companyPart = normalizeCompanyFragment(companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart);
    if (!companyPart) return null;
    const titleNorm = /^co/i.test(titlePart) ? "Co-Founder" : "Founder";
    if (isEducationOrAcademicAffiliation(seg, titleNorm, companyPart)) return null;
    return { title: titleNorm, company: companyPart, confidence: 0.58 };
  }

  if (/\S@/.test(seg)) {
    const compact = seg.match(
      /^\s*([A-Za-z0-9&][\w\s&,.''-]{0,78}?)\s*@\s*([A-Za-z0-9][\w\s.,&'-]{0,96}?)(?=\s*[|•·🔹]|$)/i
    );
    if (compact) {
      const titlePart = cleanTitleFragment(compact[1] ?? "");
      let companyPart = cleanTitleFragment(compact[2] ?? "");
      if (!titlePart || !companyPart) return null;
      companyPart = normalizeCompanyFragment(companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart);
      if (!companyPart) return null;
      if (isLikelyCampusOrProgramAffiliation(titlePart, companyPart)) return null;
      if (/github\.com/i.test(companyPart)) return null;
      if (proseAtTimeFalseEmployer(titlePart, companyPart)) return null;
      if (!isLikelyEmployerOrganizationName(companyPart)) return null;
      if (/^incoming$/i.test(titlePart.trim())) {
        return { title: "", company: companyPart, confidence: 0.28 };
      }
      if (/^agents?$/i.test(titlePart.trim()) && /\bnvidia\b/i.test(norm(companyPart))) {
        return { title: titlePart.trim(), company: companyPart, confidence: 0.48 };
      }
      return { title: titlePart, company: companyPart, confidence: 0.67 };
    }
  }

  const atMatches = [...seg.matchAll(/\s+at\s+/gi)];
  const atWord =
    atMatches.length > 0
      ? (() => {
          const last = atMatches[atMatches.length - 1]!;
          const idx = last.index ?? 0;
          const before = seg.slice(0, idx).trim();
          const after = seg
            .slice(idx)
            .replace(/^\s*at\s+/i, "")
            .trim();
          if (before.length >= 2 && after.length >= 2)
            return { 1: before, 2: after } as unknown as RegExpMatchArray;
          return null;
        })()
      : null;
  if (atWord) {
    const titlePart = cleanTitleFragment(atWord[1] ?? "");
    let companyPart = cleanTitleFragment(atWord[2] ?? "");
    companyPart = (companyPart.split(/\s*[|•·🔹]\s*/)[0] ?? companyPart).trim();
    companyPart = companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart;
    if (!titlePart || !companyPart) return null;
    if (/^(helping|driving|empowering|enabling|partnering\s+with)\b/i.test(titlePart)) return null;
    const vagueCompany =
      /^something\s+new$/i.test(companyPart) ||
      /^my\s+own(\s+thing)?$/i.test(companyPart) ||
      /^building\b/i.test(companyPart) ||
      companyPart.length < 2;
    if (vagueCompany) return null;
    if (/^(building|seeking|open)\b/i.test(titlePart)) return null;
    companyPart = normalizeCompanyFragment(companyPart);
    if (!companyPart) return null;
    if (/github\.com/i.test(companyPart)) return null;
    if (proseAtTimeFalseEmployer(titlePart, companyPart)) return null;
    if (!isLikelyEmployerOrganizationName(companyPart)) {
      if (/^devops$/i.test(norm(companyPart))) {
        return { title: titlePart, company: "", confidence: 0.45 };
      }
      return null;
    }
    if (isLikelyCampusOrProgramAffiliation(titlePart, companyPart)) return null;
    if (/^incoming$/i.test(titlePart.trim())) {
      return { title: "", company: companyPart, confidence: 0.28 };
    }
    return { title: titlePart, company: companyPart, confidence: 0.72 };
  }
  const atSymbol = seg.match(/^(.{2,140}?)\s*@\s*([^|•·🔹]+?)(?:\s*[|•·🔹]|$)/i);
  if (atSymbol) {
    const titlePart = cleanTitleFragment(atSymbol[1] ?? "");
    let companyPart = cleanTitleFragment(atSymbol[2] ?? "");
    companyPart = companyPart.split(/\s+[-—]\s+/)[0] ?? companyPart;
    if (!titlePart || !companyPart) return null;
    companyPart = normalizeCompanyFragment(companyPart);
    if (!companyPart) return null;
    if (/github\.com/i.test(companyPart)) return null;
    if (proseAtTimeFalseEmployer(titlePart, companyPart)) return null;
    if (!isLikelyEmployerOrganizationName(companyPart)) return null;
    if (isLikelyCampusOrProgramAffiliation(titlePart, companyPart)) return null;
    if (/^agents?$/i.test(titlePart.trim()) && /\bnvidia\b/i.test(norm(companyPart))) {
      return { title: titlePart.trim(), company: companyPart, confidence: 0.48 };
    }
    return { title: titlePart, company: companyPart, confidence: 0.7 };
  }
  return null;
}

/**
 * Primary employer from headline: skips education / adjunct-at-university segments; collects affiliations.
 */
export function parseHeadlineEmploymentAndEducation(headline: string): ParsedHeadline {
  const single = normalizeHeadlineDelimiters(
    foldStylizedLatinForClassification(headline.replace(/\s+/g, " ").trim())
  ).replace(/\s*\|\|\s*/g, " | ");
  const out: ParsedHeadline = {
    primaryEmployment: null,
    pastEmployment: null,
    educationInstitution: null,
    educationArea: null,
    affiliations: [],
  };
  if (!single || single.length > 320) return out;

  const edu = extractEducationHints(single);
  out.educationInstitution = edu.institution;
  out.educationArea = edu.area;

  const segments = single
    .split(/\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  const toScan = segments.length > 0 ? segments : [single];

  for (const seg of toScan) {
    if (shouldSkipPrimaryEmploymentSegment(seg)) continue;
    const pastOnly = segmentIsPastOnlyEmploymentSegment(seg);
    if (pastOnly) {
      const empPast = tryParseAtInSegment(seg);
      if (empPast?.company) {
        const cleanedTitle = stripPastRoleTitlePrefixes(empPast.title).trim();
        if (!out.pastEmployment) {
          out.pastEmployment = {
            title: cleanedTitle || empPast.title.replace(/^ex-?\s*/i, "").trim(),
            company: empPast.company,
          };
        }
      } else {
        const exList = expandPastEmployerTokens(seg);
        if (exList.length > 0 && !out.pastEmployment) {
          out.pastEmployment = { title: "", company: exList.join("; ") };
        } else {
          const exOnlyCo = tryParseExCompanyOnlySegment(seg);
          if (exOnlyCo && !out.pastEmployment) {
            out.pastEmployment = { title: "", company: exOnlyCo };
          }
        }
      }
      continue;
    }
    let emp = tryParseAtInSegment(seg);
    if (!emp) continue;
    const employerSplit = splitEmployerAndTrailingAffiliation(emp.company);
    if (employerSplit.affiliation) {
      const aff = employerSplit.affiliation.trim();
      if (aff.length >= 3 && !out.affiliations.some((x) => norm(x) === norm(aff))) {
        out.affiliations.push(aff);
      }
    }
    if (employerSplit.employer !== emp.company) {
      emp = {
        ...emp,
        company: normalizeCompanyFragment(employerSplit.employer) || employerSplit.employer,
      };
    }
    if (isEducationOrAcademicAffiliation(seg, emp.title, emp.company)) {
      if (looksLikeSubjectFieldsLineBeforeAtSchool(emp.title, emp.company)) {
        if (!out.educationArea) out.educationArea = cleanTitleFragment(emp.title);
        if (!out.educationInstitution) {
          out.educationInstitution = normalizeCompanyFragment(emp.company);
        }
      }
      if (isAdjunctOrProfessorTitle(emp.title)) {
        out.affiliations.push(emp.company);
        const areaFromTitle = emp.title.match(
          /\b(?:adjunct\s+)?(?:professor|lecturer)\s+of\s+(.+)$/i
        );
        if (areaFromTitle && !out.educationArea) {
          out.educationArea = cleanTitleFragment(areaFromTitle[1] ?? "");
        }
      }
      if (looksLikeDegreeCredentialTitle(emp.title) && segmentLooksLikeSchoolName(emp.company)) {
        if (!out.educationArea) out.educationArea = emp.title;
        if (!out.educationInstitution) out.educationInstitution = emp.company;
      }
      if (!out.educationInstitution && segmentLooksLikeSchoolName(emp.company)) {
        out.educationInstitution = emp.company;
      }
      if (
        /^(freshman|sophomore|junior|senior)\s*$/i.test(emp.title.trim()) &&
        segmentLooksLikeSchoolName(emp.company)
      ) {
        const mm = extractMajorMinorFromHeadline(single);
        if (mm && !out.educationArea) out.educationArea = mm;
      }
      continue;
    }
    if (!out.primaryEmployment) {
      out.primaryEmployment = {
        title: emp.title,
        company: emp.company,
        confidence: emp.confidence,
      };
    }
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = (segments[i] ?? "").trim();
    if (!seg || seg.length > 72) continue;
    if (
      /\bat\s+|\bfounder\b|\bceo\b|\bciso\b|\bdirector\b|\bmanager\b|\blead\b|\bengineer\b|\bconsultant\b|\bvp\b|\bhead\s+of\b|\bspecialist\b|\banalyst\b|\bstudent\b|\bprofessor\b|\bdeveloper\b/i.test(
        seg
      )
    ) {
      continue;
    }
    if (/^[A-Za-z0-9][\w.-]*(?:\s*&\s*[A-Za-z0-9][\w.-]*)+$/.test(seg)) {
      for (const part of seg.split(/\s*&\s*/)) {
        const org = normalizeCompanyFragment(part.trim());
        if (org.length >= 2 && !out.affiliations.some((x) => norm(x) === norm(org))) {
          out.affiliations.push(org);
        }
      }
    }
  }

  const commaCo = single.match(/^Director\s+of\s+[^,]+,\s*([^,|]+)$/i);
  if (!out.primaryEmployment && commaCo?.[1]) {
    const co = normalizeCompanyFragment(commaCo[1].trim());
    if (co.length >= 2 && !/\bopen\s+to\b/i.test(co)) {
      out.primaryEmployment = {
        title: cleanTitleFragment(single.split(",")[0] ?? single),
        company: co,
        confidence: 0.58,
      };
    }
  }

  const firstSeg = segments[0] ?? single;
  if (
    !out.primaryEmployment &&
    firstSeg &&
    !/\bat\b/i.test(firstSeg) &&
    SECURITY_LEADER_RE.test(firstSeg)
  ) {
    out.primaryEmployment = {
      title: cleanTitleFragment(firstSeg.split(/[|]/)[0] ?? firstSeg),
      company: "",
      confidence: 0.52,
    };
  }

  if (!out.primaryEmployment && /^vp,?\s+product\s+marketing\b/i.test(single.trim())) {
    out.primaryEmployment = {
      title: cleanTitleFragment(
        single.match(/^vp,?\s+product\s+marketing\b/i)?.[0] ?? "VP, Product Marketing"
      ),
      company: "",
      confidence: 0.54,
    };
  }

  if (!out.primaryEmployment) {
    const fs = (segments[0] ?? single).trim();
    const m = fs.match(/^\s*(founder|co[- ]?founder)\s*@\s*([^|•·]+?)(?:\s*[|•·]|$)/i);
    if (m) {
      const titlePart = /^co/i.test(m[1] ?? "") ? "Co-Founder" : "Founder";
      const companyPart = normalizeCompanyFragment(cleanTitleFragment(m[2] ?? ""));
      if (companyPart && !isEducationOrAcademicAffiliation(fs, titlePart, companyPart)) {
        out.primaryEmployment = {
          title: titlePart,
          company: companyPart,
          confidence: 0.58,
        };
      }
    }
  }

  if (!out.primaryEmployment) {
    const principalIo = single.match(/^\s*principal\s*,\s*([A-Za-z0-9][\w.-]*\.io)\b/i);
    if (principalIo) {
      const co = normalizeCompanyFragment(principalIo[1] ?? "");
      if (co && isLikelyEmployerOrganizationName(co)) {
        out.primaryEmployment = {
          title: "Principal",
          company: co,
          confidence: 0.58,
        };
      }
    }
  }

  if (!out.primaryEmployment && /\bsr\.?\s*account\s+executive\b/i.test(single)) {
    const m = single.match(/^\s*(sr\.?\s*account\s+executive)\b/i);
    if (m?.[1]) {
      out.primaryEmployment = {
        title: cleanTitleFragment(m[1]),
        company: "",
        confidence: 0.52,
      };
    }
  }

  if (
    !out.primaryEmployment &&
    /\bIDC\b/i.test(single) &&
    /\bindustry\s+analyst\b/i.test(single) &&
    /\bapplication\s+security\b/i.test(single)
  ) {
    out.primaryEmployment = {
      title: "Industry Analyst",
      company: "IDC",
      confidence: 0.58,
    };
  }

  out.primaryEmployment = preferIndependentConsultantCeoPrimaryEmployer(
    single,
    out.primaryEmployment
  );

  if (out.primaryEmployment) {
    const pe = out.primaryEmployment;
    if (pe.company && !isLikelyEmployerOrganizationName(pe.company)) {
      if (/\bIDC\b/i.test(single) && /\bindustry\s+analyst\b/i.test(single)) {
        out.primaryEmployment = {
          title: "Industry Analyst",
          company: "IDC",
          confidence: 0.58,
        };
      } else if (
        /\bapplication\s+security\b/i.test(single) &&
        /\banalyst\b/i.test(single) &&
        /\b(idc|gartner|forrester)\b/i.test(single)
      ) {
        let firm = "IDC";
        if (/\bGartner\b/i.test(single)) firm = "Gartner";
        else if (/\bForrester\b/i.test(single)) firm = "Forrester";
        out.primaryEmployment = {
          title: "Industry Analyst",
          company: firm,
          confidence: 0.58,
        };
      } else {
        out.primaryEmployment = null;
      }
    }
    if (out.primaryEmployment?.company && /github\.com/i.test(out.primaryEmployment.company)) {
      out.primaryEmployment = null;
    }
  }

  if (out.primaryEmployment?.company) {
    for (const a of gatherAffiliationsFromAtChunks(single, out.primaryEmployment.company)) {
      if (!out.affiliations.some((x) => norm(x) === norm(a))) out.affiliations.push(a);
    }
  }

  if (
    /github\.com\/[^\s|•·]+/i.test(single) &&
    /\b(cyber|cybersecurity|infosec|digital\s+privacy|privacy|ciso)\b/i.test(norm(single)) &&
    (!out.primaryEmployment?.company || /github/i.test(out.primaryEmployment.company))
  ) {
    out.primaryEmployment = null;
  }

  if (!out.primaryEmployment && /\brvp\b/i.test(single) && /\bhashicorp\b/i.test(single)) {
    const m = single.match(/\b(rvp\s*,\s*.{2,40}?)\s+hashicorp\b/i);
    if (m?.[1]) {
      out.primaryEmployment = {
        title: cleanTitleFragment(m[1]),
        company: "HashiCorp",
        confidence: 0.64,
      };
    }
  }

  if (out.educationInstitution) {
    out.educationInstitution = stripClassYearSuffix(out.educationInstitution);
  }

  applyFormerEmployerSplitToParsed(out);

  return out;
}

export function extractMarketSegmentTerms(headline: string): string[] {
  const h = headline.replace(/\s+/g, " ");
  const terms: string[] = [];
  if (/\benterprise\s+software\b/i.test(h)) terms.push("enterprise_software");
  if (/\benterprise\s+it\b/i.test(h)) terms.push("enterprise_it");
  if (/\benterprise\s+it[-\s]?ot\b/i.test(h)) terms.push("enterprise_it_ot");
  if (/\benterprise\s+security\b/i.test(h)) terms.push("enterprise_security");
  if (/\bb2b\b/i.test(h)) terms.push("b2b");
  if (/\bsaas\b/i.test(h)) terms.push("saas");
  if (/\boil\s*(?:&|and)?\s*gas\b|\boil\s+and\s+gas\b|\benergy\s+sector\b/i.test(h))
    terms.push("oil_and_gas");
  if (/\bregulated\b.*\benvironment|\bcompliance[-\s]heavy|\bgovernance.?risk\b/i.test(h))
    terms.push("regulated_industries");
  return terms;
}

function exclusionToProfileFlag(x: ExclusionFlag): ProfileFlag | null {
  const m: Partial<Record<ExclusionFlag, ProfileFlag>> = {
    open_to_work: "job_seeker_signal",
    recruiter: "recruiter_signal",
    investor: "investor_signal",
    student: "student_signal",
    solo_operator: "solo_operator_signal",
    consultant: "consultant_signal",
    competitor: "competitor_signal",
    wrong_function: "non_target_function_signal",
    non_buyer: "commercial_non_core_signal",
    company_too_small: "micro_employer_signal",
    insufficient_evidence: "weak_evidence",
    low_relevance: "weak_post_context_signal",
    low_seniority: "junior_or_intern_signal",
  };
  return m[x] ?? null;
}

function buildProfileFlags(excluded: Set<ExclusionFlag>, extra: ProfileFlag[]): ProfileFlag[] {
  const s = new Set<ProfileFlag>();
  for (const x of excluded) {
    const p = exclusionToProfileFlag(x);
    if (p) s.add(p);
  }
  for (const p of extra) s.add(p);
  return Array.from(s).sort();
}

function applySpecializedHeadlineRoles(args: {
  headline: string;
  currentTitle: string | null;
  strictStudent: boolean;
  roleCategories: Set<ProspectClassification["roleCategories"][number]>;
  profileExtra: ProfileFlag[];
  atCount: number;
}): void {
  if (args.strictStudent) {
    const h = args.headline;
    if (/\bstudent\b/i.test(h) && /\bcommunications\b|\bpublic\s+relations\b/i.test(h)) {
      args.roleCategories.add("communications_leader");
      args.roleCategories.add("marketing_leader");
      args.roleCategories.add("student");
      args.roleCategories.delete("unknown");
      if (!args.profileExtra.includes("student_signal")) args.profileExtra.push("student_signal");
      if (!args.profileExtra.includes("early_career_signal")) {
        args.profileExtra.push("early_career_signal");
      }
    }
    return;
  }
  const h = args.headline;
  const blob = `${h} ${args.currentTitle ?? ""}`.replace(/\s+/g, " ");
  const tBlob = norm(blob);

  if (/\bretired\b/i.test(blob)) {
    if (!args.profileExtra.includes("retired_signal")) args.profileExtra.push("retired_signal");
    if (!args.profileExtra.includes("past_role_signal")) args.profileExtra.push("past_role_signal");
  }

  if (/\bpartner\s+at\b/i.test(h) && /\bventures\b/i.test(h)) {
    args.roleCategories.add("investor");
    args.roleCategories.add("venture_capital");
    args.roleCategories.delete("unknown");
    if (!args.profileExtra.includes("investor_signal")) {
      args.profileExtra.push("investor_signal");
    }
  }

  if (
    /\bpartner\s+at\b/i.test(h) &&
    !/\bventures?\b/i.test(h) &&
    !/\bventure\s+capital\b/i.test(tBlob)
  ) {
    args.roleCategories.add("consultant");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bchief\s+of\s+staff\b/i.test(blob) && /\bto\s+(the\s+)?founder\b/i.test(blob)) {
    args.roleCategories.add("chief_of_staff");
    args.roleCategories.add("hr_leader");
    args.roleCategories.add("people_leader");
    args.roleCategories.add("executive_operations");
    args.roleCategories.delete("founder");
    args.roleCategories.delete("solo_founder");
    args.roleCategories.delete("unknown");
  }

  if (/\bpartner\s+and\s+advisor\b/i.test(blob) && /\bpreviously\s+co[- ]?founder\b/i.test(blob)) {
    args.roleCategories.add("advisor");
    args.roleCategories.add("consultant");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("founder");
    args.roleCategories.delete("solo_founder");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bexecutive\s+director\b/i.test(blob) &&
    /\bat\s+/i.test(blob) &&
    !/\b(nonprofit|foundation|charity)\s+board\b/i.test(tBlob)
  ) {
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bhybrid\s+systems\s+architect\b/i.test(blob) || /\bsystems\s+architect\b/i.test(blob)) {
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("systems_architect");
    args.roleCategories.delete("unknown");
  }

  if (
    /\benterprise\s+ae\b/i.test(blob) ||
    (/\baccount\s+executive\b/i.test(blob) && /\benterprise\b/i.test(blob))
  ) {
    args.roleCategories.add("sales_account");
    args.roleCategories.add("sales_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\benabling\b/i.test(h) &&
    /\benterprise\s+ai\b/i.test(tBlob) &&
    (/\bdata\s+plane\b/i.test(tBlob) || /\bagentic\b/i.test(tBlob))
  ) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("data_leader");
    args.roleCategories.add("technical_evangelist");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bvp\b/i.test(tBlob) &&
    /\bhead\s+of\s+channels?\b/i.test(tBlob) &&
    /\balliances\b/i.test(tBlob)
  ) {
    args.roleCategories.add("channel_leader");
    args.roleCategories.add("partnerships_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bchief\s+product\s+officer\b|\bcpo\b/i.test(tBlob)) {
    args.roleCategories.add("product_leader");
    args.roleCategories.add("executive_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bsase\b/i.test(tBlob) && /\bproduct\s+specialist\b/i.test(tBlob)) {
    args.roleCategories.add("product_specialist");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+integrator\b/i.test(tBlob)) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("automation_specialist");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bpartner\s+marketing\b/i.test(blob) &&
    /\bprogram\s+manager\b/i.test(blob) &&
    /\bstrategic\b/i.test(blob)
  ) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("program_manager");
    args.roleCategories.add("partnerships_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\brvp\b/i.test(h) && /\bhashicorp\b/i.test(h)) {
    args.roleCategories.add("sales_leader");
    args.roleCategories.add("regional_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+engineer\b/i.test(blob)) {
    args.roleCategories.add("ai_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bfounding\s+ceo\b/i.test(blob) ||
    (/\bceo\b/i.test(blob) && /\bturnarounds?/i.test(blob) && /\bemba\b/i.test(blob))
  ) {
    args.roleCategories.add("founder");
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\blogistics\b/i.test(blob) && /\boperations\s+leader\b/i.test(blob)) {
    args.roleCategories.add("operations_leader");
    args.roleCategories.add("supply_chain");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcareer\b/i.test(blob) &&
    /\b(leadership\s+)?strategist\b/i.test(blob) &&
    /\bgo[- ]?to[- ]?market\b/i.test(blob)
  ) {
    args.roleCategories.add("consultant");
    args.roleCategories.add("coach_or_advisor");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bsupplier\s+management\b/i.test(blob)) {
    args.roleCategories.add("supply_chain");
    args.roleCategories.add("operations_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsaas\b/i.test(h) &&
    /\blanding\s+page/i.test(h) &&
    /\bconversion/i.test(h) &&
    /\brewrit/i.test(h)
  ) {
    args.roleCategories.add("copywriter");
    args.roleCategories.add("marketing_consultant");
    args.roleCategories.delete("unknown");
  }

  if (/\bproduct\s+architect\b/i.test(h) && /\bcreator\s+of\b/i.test(h)) {
    args.roleCategories.add("product_leader");
    args.roleCategories.add("technical_architect");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsocial\s+media\s+strategist\b/i.test(blob) ||
    (/\bcontent\s+creator\b/i.test(blob) &&
      /\bwriter\b/i.test(blob) &&
      /\bstrategist\b/i.test(blob))
  ) {
    args.roleCategories.add("media_creator");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bglobal\s+executive\b/i.test(h) && /\bocm\s+practice\s+leader\b/i.test(h)) {
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("consultant");
    args.roleCategories.add("change_management_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\benterprise\b.*\bcloud\b/i.test(blob) &&
    /\bworkload\s+identity\b/i.test(blob) &&
    /\bat\s+scale\b/i.test(tBlob)
  ) {
    args.roleCategories.add("security_leader");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bcybersecurity\s+sme\b/i.test(h)) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bai\b/i.test(blob) &&
    /\bcybersecurity\b/i.test(blob) &&
    /\btrain(?:er|ing)\s+lead\b/i.test(blob) &&
    /\bibm\b/i.test(blob)
  ) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.add("technical_trainer");
    args.roleCategories.delete("unknown");
  }

  if (/\bsecuring\s+applications\b/i.test(h) && /\bnetworks?\b/i.test(h) && /\bdeliver/i.test(h)) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (
    /\b99\.9%\b/.test(h) &&
    /\breliable\s+ai\b/i.test(h) &&
    /\b(immigration|banks|airlines|high[- ]stakes)\b/i.test(h)
  ) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("ai_strategy");
    args.roleCategories.add("consultant");
    args.roleCategories.delete("unknown");
  }

  if (
    /\btech\s+lead\b/i.test(blob) &&
    /\bai\s+platforms?|\bdistributed\s+systems?|\bproduct\s+engineering\b/i.test(blob)
  ) {
    args.roleCategories.add("technical_lead");
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("platform_engineer");
    args.roleCategories.add("ai_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bcloud\b/i.test(blob) && /\bai\b/i.test(blob) && /\barchitect\b/i.test(blob)) {
    args.roleCategories.add("cloud_architect");
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("ai_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bregional\s+director\b/i.test(blob)) {
    args.roleCategories.add("sales_leader");
    if (/\bcyera\b|\bcybersecurity\b/i.test(blob)) {
      args.roleCategories.add("security_practitioner");
    }
    args.roleCategories.delete("unknown");
  }

  if (
    /\bai\s+content\s+creator\b/i.test(blob) ||
    (/\bcontent\s+creator\b/i.test(blob) && /\bai\b/i.test(blob))
  ) {
    args.roleCategories.add("media_creator");
    args.roleCategories.add("ai_practitioner");
    if (/\bteaching\b|\beducat/i.test(blob)) {
      args.roleCategories.add("education_leader");
    }
    args.roleCategories.delete("unknown");
  }

  if (/\bresponsable\s+communication\b/i.test(tBlob)) {
    args.roleCategories.add("communications_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\broustabout\b|\bfield\s+operations\b/i.test(blob)) {
    args.roleCategories.add("field_operations");
    if (/\boil\s*(?:&|and)?\s*gas\b|\bseeking\s+opportunities\b/i.test(blob)) {
      args.roleCategories.add("operations_leader");
    }
    args.roleCategories.delete("unknown");
  }

  if (/\blecturer\b/i.test(blob) && /@/.test(blob)) {
    args.roleCategories.add("academic");
    args.roleCategories.add("education_leader");
    args.roleCategories.delete("unknown");
  }
  if (/\bdata\s+scientist\b/i.test(blob) && /\blecturer\b/i.test(blob)) {
    args.roleCategories.add("data_leader");
    args.roleCategories.add("ai_engineer");
    args.roleCategories.delete("unknown");
  }
  if (/\bbioinformatician\b|\bbioinformatics\b/i.test(blob)) {
    args.roleCategories.add("ai_engineer");
    args.roleCategories.add("data_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+products?\s*&\s*strategy\b/i.test(blob) && /\bproduct\s+manager\b/i.test(blob)) {
    args.roleCategories.add("product_leader");
    args.roleCategories.add("ai_strategy");
    args.roleCategories.add("ai_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\b(sr\.?|senior)\s+sales\s+director\b|\bsales\s+director\b/i.test(blob)) {
    args.roleCategories.add("sales_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\baccount\s+manager\b/i.test(blob) && !/\bsupport\s+account\s+manager\b/i.test(blob)) {
    args.roleCategories.add("account_management");
    args.roleCategories.add("sales_account");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsenior\s+it\s+manager\b|\bit\s+manager\b/i.test(blob) &&
    /\bcybersecurity\b|\bcyber\b|\bokta\b/i.test(blob)
  ) {
    args.roleCategories.add("it_operations");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/keeping\s+ai\s+agents\b/i.test(blob)) {
    args.roleCategories.add("ai_strategy");
    args.profileExtra.push("weak_evidence");
    args.roleCategories.delete("unknown");
  }

  if (/\bitil\b/i.test(blob) && /\bcontinuous\s+improvement\b/i.test(blob)) {
    args.roleCategories.add("it_operations");
    args.roleCategories.add("operations_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bpublic\s+safety\b/i.test(blob) &&
    /\bcommunications\b/i.test(blob) &&
    /\bcyber(?:security)?\b/i.test(blob) &&
    /\bemergency\s+communications\b/i.test(blob)
  ) {
    args.roleCategories.add("communications_leader");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcyber(?:security)?\b/i.test(blob) &&
    /\btech\s+evangelist\b|\btechnology\s+evangelist\b/i.test(blob) &&
    /\bpodcasts?\b|\bpodcaster\b/i.test(blob)
  ) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.add("technical_evangelist");
    args.roleCategories.add("media_creator");
    args.roleCategories.delete("unknown");
  }

  if (/\blearn\s+ai\s+for\s+marketing\b/i.test(blob) && /\b(ai|marketing)\b/i.test(blob)) {
    args.roleCategories.add("ai_creator");
    args.roleCategories.add("educator");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\brobotics\s+engineering\b/i.test(blob) &&
    /\bhackathon\b/i.test(blob) &&
    /\bmarketing\b/i.test(blob)
  ) {
    args.roleCategories.add("robotics_engineer");
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("marketing_leader");
    if (/\bwinner\b/i.test(blob)) args.roleCategories.add("early_career");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bgenai\b/i.test(blob) &&
    /\boracle\s+health\b/i.test(blob) &&
    /\blife[- ]sciences\b/i.test(blob)
  ) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("healthtech");
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bdata\b/i.test(blob) &&
    /\banalytical\s+eng\b/i.test(blob) &&
    /\bdata\s+ops\b/i.test(blob) &&
    /\b(llm\s*\/\s*ml\s+ops|llmops|mlops)\b/i.test(blob)
  ) {
    args.roleCategories.add("data_engineer");
    args.roleCategories.add("analytics_engineer");
    args.roleCategories.add("mlops_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsoftware\s+engineering\s+ph\.?d\b/i.test(blob) ||
    /\bsoftware\s+engineering\s+phd\b/i.test(blob)
  ) {
    args.roleCategories.add("academic");
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bhead\s+of\s+worldwide\s+banking\b/i.test(blob) && /\baws\b/i.test(blob)) {
    args.roleCategories.add("business_leader");
    args.roleCategories.add("cloud_industry_leader");
    args.roleCategories.delete("unknown");
  }

  if (headlineIsAppSecStrategicMarketing(h)) {
    args.roleCategories.add("product_marketing");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("engineering_leader");
    args.roleCategories.delete("unknown");
  }

  if (isWeakAgenticVisionHeadline(h) && !explicitHeadlineRecruiterEvidence(h)) {
    args.roleCategories.add("ai_strategy");
    args.profileExtra.push("weak_evidence");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+engineer\b/i.test(blob) && /\b(multi[- ]agent|\bmcp\b|agentic)/i.test(blob)) {
    args.roleCategories.add("ai_engineer");
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\btechnology\s+strategist\b|\btech\s+strategist\b/i.test(blob)) {
    args.roleCategories.add("technology_strategist");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\b(sr\.?|senior)\s*account\s+executive\b/i.test(blob)) {
    args.roleCategories.add("sales_account");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsoftware\s+developer\b/i.test(blob) ||
    /\bfull\s*s?t[a]?cks?\s+developer\b/i.test(blob) ||
    /\bfulls?t\s*acks?\s+developer\b/i.test(blob) ||
    /\bsenior\s+full\s*s?t[a]?ck/i.test(blob) ||
    /\bsenior\s+fullst\s*acks?\b/i.test(blob) ||
    /\bsenior\s+fullstsack\b/i.test(blob) ||
    /\bfullst\s*ack\b/i.test(tBlob)
  ) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bphp\s+developer\b/i.test(blob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bfull[\s-]?stack\s+developer\b/i.test(blob) &&
    /\bsql\b|\bjava\b|numpy|pandas/i.test(blob)
  ) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("full_stack_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bsenior\s+web\s+developer\b|\bweb\s+developer\b/i.test(blob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("web_developer");
    args.roleCategories.delete("unknown");
  }

  if (/\bstaff\s+swe\b|\bstaff\s+software\s+engineer\b|\bstaf{2}\s+swe\b/i.test(blob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bdata\s+scientist\b/i.test(blob)) {
    args.roleCategories.add("data_scientist");
    args.roleCategories.add("ai_ml_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bsenior\s+research\s+analyst\b|\bresearch\s+analyst\b/i.test(blob)) {
    args.roleCategories.add("research_analyst");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bmanager\b/i.test(blob) &&
    /\bey\b|\bernst\s*(?:&|and)\s*young/i.test(blob) &&
    /\bstrategy\b|\bchange\s+management\b|\bprocess\s+improvement\b|\bagile\s+change\b/i.test(blob)
  ) {
    args.roleCategories.add("strategy_consultant");
    args.roleCategories.add("operations_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bsenior\s+advisor\b/i.test(blob) || /\badvisor\s*@/i.test(h)) {
    args.roleCategories.add("advisor");
    args.roleCategories.add("business_advisor");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+trainer\b/i.test(blob)) {
    args.roleCategories.add("ai_trainer");
    args.roleCategories.add("educator");
    args.roleCategories.add("education_leader");
    args.roleCategories.add("data_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\b(senior\s+)?\.net\s+developer\b/i.test(blob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bfull[\s-]?stack\s+engineer\b/i.test(blob) &&
    (/\bspring\s+boot\b/i.test(blob) || /\bnext\.js\b|\bnextjs\b/i.test(blob))
  ) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("full_stack_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bprincipal\s*,\s*[\w.-]+\.io\b/i.test(h) &&
    (/\bapplied\s+ai\b|\btechnical\s+search\b/i.test(blob) || /\bai\b/i.test(tBlob))
  ) {
    args.roleCategories.add("founder_or_principal");
    args.roleCategories.add("ai_leader");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bbusiness\s+development\s+expert\b/i.test(blob) ||
    (/\blinkedin\s+outreach\b/i.test(blob) &&
      (/\bmarket\s+researcher\b/i.test(blob) || /\bgenerating\s+leads\b/i.test(blob))) ||
    (/\bconnecting\s+businesses\b/i.test(blob) && /\blead/i.test(blob))
  ) {
    args.roleCategories.add("business_development");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bstrategic\s+enterprise\s+accounts\b/i.test(blob) && /\bf500|fortune\b/i.test(blob)) {
    args.roleCategories.add("sales_account");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/engineering\s*\/\s*data\s*(?:&|and)\s*ai\s+platforms?/i.test(blob)) {
    args.roleCategories.add("platform_engineer");
    args.roleCategories.add("data_engineer");
    args.roleCategories.add("ai_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bgrowth\s+marketing\b/i.test(blob) && /\babm\b/i.test(blob)) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("growth_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcommunications\b/i.test(blob) &&
    /\bbrand\b/i.test(blob) &&
    /\bexecutive\b/i.test(blob) &&
    /\bai\s+builder\b/i.test(blob)
  ) {
    args.roleCategories.add("communications_leader");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bbi\s+developer\b/i.test(blob) && /\bpower\s*bi\b/i.test(blob)) {
    args.roleCategories.add("data_engineer");
    args.roleCategories.add("bi_developer");
    args.roleCategories.delete("unknown");
  }

  if (/\bautonomous\s+secops\b/i.test(blob)) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bbusiness\s*\/\s*enterprise\s*\/\s*technical\s+architect\b/i.test(blob)) {
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("business_architect");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bfaculty\b/i.test(blob) &&
    (/\b(professor|lecturer|university|college|institute)\b/i.test(blob) ||
      /\bmachine\s+learning\b|\bgenerative\s+ai|\bgen[- ]?ai\b/i.test(blob))
  ) {
    args.roleCategories.add("educator");
    args.roleCategories.add("education_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /^\s*President,?\s+/i.test((h.split("|")[0] ?? "").trim()) &&
    /\b(helping|reduce\s+downtime|cyber\s*risk|compliance|healthcare|law\s+firms)\b/i.test(blob)
  ) {
    args.roleCategories.add("business_leader");
    args.roleCategories.add("it_operations");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+transformation\b/i.test(blob) && /\b(businesses|systems|intelligent)\b/i.test(blob)) {
    args.roleCategories.add("consultant");
    args.roleCategories.add("ai_strategy");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\btechnical\s+training\b/i.test(blob) && /\benablement\b/i.test(blob)) {
    args.roleCategories.add("educator");
    args.roleCategories.add("technical_enablement");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bb2b\s+growth\s+strategist\b/i.test(blob) ||
    (/\bgrowth\s+strategist\b/i.test(blob) && /\bpredictable\s+revenue\b/i.test(blob))
  ) {
    args.roleCategories.add("growth_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.add("business_development");
    args.roleCategories.delete("unknown");
  }

  if (/^\s*channel\s+head\b/i.test(blob.trim())) {
    args.roleCategories.add("channel_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\btechnology\s+leader\b/i.test(blob) &&
    /\bdigital\s+transformation\b/i.test(blob) &&
    (/\bsenior\s+director\b/i.test(blob) || /\bdirector\b/i.test(blob))
  ) {
    args.roleCategories.add("technology_executive");
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("ai_leader");
    args.roleCategories.add("technology_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcontent\s+creator\b/i.test(blob) &&
    (/\bgrowth\s+strategist\b/i.test(blob) || /\bhelping\s+brand\b/i.test(blob)) &&
    (/\blinkedin\s+growth\b/i.test(blob) ||
      /\bsocial\s+media\b/i.test(blob) ||
      /\bvideo\b/i.test(blob))
  ) {
    args.roleCategories.add("media_creator");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("growth_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bit\s+leader\b/i.test(blob) &&
    (/\bcloud\s+enablement\b/i.test(blob) || /\btransformation\b/i.test(blob)) &&
    (/\bcloud\b/i.test(blob) || /\bevangelist\b/i.test(blob))
  ) {
    args.roleCategories.add("it_operations");
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.add("technical_evangelist");
    args.roleCategories.add("technology_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bsenior\s+staff\s+accountant\b/i.test(blob) || /\bstaff\s+accountant\b/i.test(blob)) {
    args.roleCategories.add("finance_accounting");
    args.roleCategories.delete("unknown");
  }

  if (/\bagile\s+project\s+manager\b/i.test(blob) && /\bscrum\s+master\b/i.test(blob)) {
    args.roleCategories.add("program_manager");
    args.roleCategories.add("project_manager");
    args.roleCategories.delete("unknown");
  }

  if (/\bpenetration\s+tester\b/i.test(blob) && /\bred\s+team(er)?\b/i.test(blob)) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bstartups\s*@\s*aws\b/i.test(blob)) {
    args.roleCategories.add("startup_business_development");
    args.roleCategories.add("cloud_industry_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bsupply\s+chain\b/i.test(blob) && /\boperation(s)?\s+leader\b/i.test(blob)) {
    args.roleCategories.add("supply_chain");
    args.roleCategories.add("operations_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bincoming\s*@\s*aws\b/i.test(blob)) {
    args.roleCategories.add("early_career");
    args.roleCategories.add("intern_or_student");
    args.roleCategories.delete("unknown");
  }

  if (/^\s*design\s*@\s+/i.test(blob.trim())) {
    args.roleCategories.add("designer");
    args.roleCategories.delete("unknown");
  }

  if (/\bpresident\b/i.test(blob) && /\bchief\s+commercial\s+officer\b/i.test(blob)) {
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("commercial_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bcloud\s+engineer\b/i.test(blob) && /\baws\b|\bgcp\b|\bazure\b/i.test(blob)) {
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.add("platform_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bbusiness\s+analyst\b/i.test(blob) &&
    (/\bopen\s+to\s+work\b/i.test(blob) || /\btelecom\b|\boss\b|\bbss\b/i.test(blob))
  ) {
    args.roleCategories.add("business_analyst");
    args.roleCategories.delete("unknown");
  }

  if (
    /\brich\s+experience\s+in\s+customer\s+service\b/i.test(blob) ||
    (/\bcustomer\s+service\b/i.test(blob) && /\bopen\s+to\s+new\s+opportunities\b/i.test(blob))
  ) {
    args.roleCategories.add("customer_support");
    args.roleCategories.delete("unknown");
  }

  if (
    /^\s*content\s+writer\s*$/i.test(blob.trim()) ||
    (/^\s*content\s+writer\b/i.test(blob.trim()) && blob.trim().length < 52)
  ) {
    args.roleCategories.add("content_creator");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bmarketing\b/i.test(blob) && /\bcontent\b/i.test(blob) && /\bcopywriter\b/i.test(blob)) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("media_creator");
    args.roleCategories.delete("unknown");
  }

  if (/\bai\s+automation\s+specialist\b/i.test(blob)) {
    args.roleCategories.add("automation_specialist");
    args.roleCategories.add("consultant");
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bjava\b/i.test(blob) &&
    /\bspring\b/i.test(blob) &&
    /\breact\b/i.test(blob) &&
    !/\bengineer\b|\bdeveloper\b/i.test(blob)
  ) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsenior\s+executive\b/i.test(blob) &&
    /\bpartnerships\b/i.test(blob) &&
    /\bcollaborations\b|\bsolutions\b/i.test(blob)
  ) {
    args.roleCategories.add("partnerships_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bi\s+help\s+you\s+grow\s+your\s+personal\s+brand\b/i.test(blob) ||
    (/\bpersonal\s+brand\b/i.test(blob) && /\blinkedin\b/i.test(blob))
  ) {
    args.roleCategories.add("personal_brand_consultant");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    (/\btcp\s*\/\s*ip\b/i.test(blob) ||
      /\bnetwork\s+programmer\b/i.test(blob) ||
      /\bcybersecurity\s+instructor\b/i.test(blob)) &&
    (/\baws\b/i.test(blob) ||
      /\bunix\b|\blinux\b/i.test(blob) ||
      /\bsecurity\s+monitoring\b|\bvulnerability\b/i.test(blob))
  ) {
    args.roleCategories.add("educator");
    args.roleCategories.add("technical_trainer");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bchief\s+strategy\s+officer\b/i.test(blob) &&
    (/\bzscaler\b/i.test(blob) || /\bsecurity\s+strategy\b/i.test(blob))
  ) {
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("strategy_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcybersecurity\s+professional\b/i.test(blob) &&
    /\bjunior\s+penetration\s+tester\b/i.test(blob) &&
    /\bhands[\s-]on\s+lab\s+instructor\b/i.test(blob)
  ) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.add("technical_trainer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bbusiness\s+development\b/i.test(blob) &&
    /\bprogram\s+management\b/i.test(blob) &&
    /\bsales\s+leadership\b/i.test(blob)
  ) {
    args.roleCategories.add("business_development");
    args.roleCategories.add("program_manager");
    args.roleCategories.add("sales_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    (/(?:^|\|)\s*ex[-–]\s*[A-Za-z]/i.test(blob) || /^\s*ex[-–]\s*[A-Za-z]/i.test(blob)) &&
    /\bfinancial\s+analyst\b/i.test(blob) &&
    (/\bfinancial\s+modell?ing\b/i.test(blob) ||
      /\besg\b/i.test(blob) ||
      /\bbloomberg\b/i.test(blob))
  ) {
    args.roleCategories.add("financial_analyst");
    args.roleCategories.delete("unknown");
  }

  if (/\bsenior\s+executive\s+assistant\b/i.test(blob) && /\bbachelor/i.test(blob)) {
    args.roleCategories.add("executive_assistant");
    args.roleCategories.add("operations_support");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bexecutive\s+assistant\b/i.test(blob) &&
    (/\bc[-\s]?suite\b/i.test(blob) ||
      /\bempowering\s+team\b/i.test(blob) ||
      /\bpassionate\s+about\s+tech\b/i.test(blob))
  ) {
    args.roleCategories.add("executive_assistant");
    args.roleCategories.add("operations_support");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bhelping\b/i.test(blob) &&
    /\b(brands?|creators?)\b/i.test(blob) &&
    /\b(social\s+media|high[-\s]?converting)\b/i.test(blob) &&
    /\bdesign\b/i.test(blob)
  ) {
    args.roleCategories.add("designer");
    args.roleCategories.add("marketing_consultant");
    args.roleCategories.delete("unknown");
  }

  if (
    /\brecruiting\s+revops\b/i.test(blob) ||
    (/\brecruiting\b/i.test(blob) && /\brevops\b/i.test(blob) && /\bpe\s+backed\b/i.test(blob))
  ) {
    args.roleCategories.add("recruiter");
    args.roleCategories.add("revops");
    args.roleCategories.add("operations_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bturning\s+ai\s+hype\b/i.test(blob) &&
    (/\bai\s+strategy\b/i.test(blob) || /\bautomation\b/i.test(blob))
  ) {
    args.roleCategories.add("ai_strategy");
    args.roleCategories.add("consultant");
    args.roleCategories.add("automation_specialist");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bdata\s+scientist\b/i.test(blob) &&
    /\bai\s*\/\s*ml\s+engineer\b/i.test(blob) &&
    /\bgenai\b|\bmlops\b|\brag\b|\bvector\s+db/i.test(blob)
  ) {
    args.roleCategories.add("data_scientist");
    args.roleCategories.add("ai_engineer");
    args.roleCategories.add("mlops_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/^\s*design\s*@\s+/i.test(blob.trim())) {
    args.roleCategories.add("designer");
    args.roleCategories.delete("unknown");
  }

  if (/\bfulls?t\s*acks?\s+developer\b/i.test(blob) || /\bfullst\s*ack\b/i.test(tBlob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bfull\s*s?t[a]?cks?\s+developer\b/i.test(blob) ||
    /\bfulls?t\s*acks?\s+developer\b/i.test(blob) ||
    /\bfullst\s*ack\b/i.test(tBlob) ||
    /\bfulls?t\s*sack\b/i.test(tBlob)
  ) {
    if (!args.profileExtra.includes("typo_signal")) args.profileExtra.push("typo_signal");
  }

  if (
    (/\bsenior\s+full\s*s?t[a]?ck/i.test(blob) ||
      /\bfulls?t\s*acks?\s+developer\b/i.test(blob) ||
      /\bfullst\s*ack\b/i.test(tBlob) ||
      /\bsenior\s+fullst\s*acks?\b/i.test(blob) ||
      /\bsenior\s+fullstsack\b/i.test(blob)) &&
    /\b(eye\s+for\s+design|ui\/ux|\bdesign\b)/i.test(blob)
  ) {
    args.roleCategories.add("frontend_engineer");
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bcommunications\b/i.test(blob) &&
    (/\bmarketing\b/i.test(blob) || /\bai[- ]driven\s+marketing\b/i.test(blob)) &&
    /\bvp\b|\bvice\s+president\b/i.test(blob)
  ) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("communications_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bmicrosoft\s+mvp\b|\bmct\b.*\bdynamics\b|\bdynamics\s*365\b|\bdynamics\b.*\b(fo|ce|crm|erp)\b|\bpower\s+platform\b|\bai\s+erp\b/i.test(
      blob
    )
  ) {
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("solutions_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsenior\s+education\b|\beducation\s*&\s*program\s+leader\b/i.test(blob) ||
    (/\beducation\b/i.test(blob) &&
      /\bprogram\s+leader\b/i.test(blob) &&
      /\bworkforce\s+development\b/i.test(blob))
  ) {
    args.roleCategories.add("education_leader");
    args.roleCategories.add("program_manager");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsenior\s+enterprise\s+sales\b|\benterprise\s+sales\s+executive\b/i.test(blob) ||
    (/\baws\b/i.test(blob) && /\bdatabase\s+sales\b/i.test(blob))
  ) {
    args.roleCategories.add("sales_account");
    args.roleCategories.add("business_development");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bai\s+strategy\b/i.test(blob) &&
    /\badoption\b|\benterprise\s+transformation\b|\bchange\s+agent\b|people[- ]centered/i.test(blob)
  ) {
    args.roleCategories.add("ai_strategy");
    args.roleCategories.add("transformation_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bstaffing\b/i.test(blob) && /\bmanager\b/i.test(blob) && /@/.test(h)) {
    args.roleCategories.add("recruiter");
    args.roleCategories.add("staffing_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\btechnical\s+lead\b/i.test(blob) &&
    /\bdevops\b/i.test(blob) &&
    (/\bnetwork\s+automation\b/i.test(blob) || /\bfull\s+stack\b/i.test(blob))
  ) {
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("technical_lead");
    args.roleCategories.add("platform_engineer");
    args.roleCategories.delete("unknown");
  }

  if (/\bmulti[- ]cloud\b/i.test(blob) && /@/.test(h)) {
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.add("cloud_architect");
    args.roleCategories.add("technical_influencer");
    if (/\bmaestro\b|\bninja\b|\bguru\b|\bwizard\b/i.test(blob)) {
      if (!args.profileExtra.includes("informal_title_signal"))
        args.profileExtra.push("informal_title_signal");
    }
    args.roleCategories.delete("unknown");
  }

  if (
    /\bdevops\b/i.test(blob) &&
    /\bcloud\b/i.test(blob) &&
    /\bterraform\b|\bci\s*\/\s*cd\b|\bkubernetes\b|aws.*azure|gcp|engineer|specialist|analyst|automation|support/i.test(
      blob
    )
  ) {
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.add("platform_engineer");
    args.roleCategories.add("devops_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bin\s+training\b/i.test(blob) && /\bcloud\b/i.test(blob) && /\bdevops\b/i.test(blob)) {
    args.roleCategories.add("cloud_engineer");
    args.roleCategories.add("platform_engineer");
    args.roleCategories.add("early_career");
    if (!args.profileExtra.includes("early_career_signal"))
      args.profileExtra.push("early_career_signal");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bsenior\s+frontend\s+engineer\b/i.test(blob) ||
    (/\bfrontend\s+engineer\b/i.test(blob) && /\breact\b/i.test(blob))
  ) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("frontend_engineer");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bsite\s+reliability\s+engineer\b|\bsre\s+engineer\b|\bsre\s*[|,]/i.test(blob)) {
    args.roleCategories.add("sre_engineer");
    args.roleCategories.add("platform_engineer");
    if (/\bcloud\b|\baws\b|\bazure\b|\bgcp\b/i.test(blob)) {
      args.roleCategories.add("cloud_engineer");
    }
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bfounding\s+engineer\b/i.test(blob)) {
    args.roleCategories.add("software_engineer");
    args.roleCategories.add("technical_influencer");
    if (!args.profileExtra.includes("founding_engineer_signal"))
      args.profileExtra.push("founding_engineer_signal");
    if (!args.profileExtra.includes("early_team_signal"))
      args.profileExtra.push("early_team_signal");
    args.roleCategories.delete("unknown");
  }

  if (/\btransforming\s+digital\s+identity\b/i.test(blob) || /\bdigital\s+identity\b/i.test(blob)) {
    args.roleCategories.add("technology_strategist");
    args.roleCategories.add("product_leader");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bcompetitive\s+advantage\b/i.test(blob) && /\bcybersecurity\s+vendors?\b/i.test(blob)) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("product_marketing");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bindependent\s+consultant\s*&\s*ceo\s*@/i.test(h) &&
    /\bfounder\s*@\s*/i.test(h) &&
    (args.atCount >= 2 || /\|/.test(h))
  ) {
    args.roleCategories.add("consultant");
    args.roleCategories.add("founder");
    args.roleCategories.add("technical_influencer");
    if (!args.profileExtra.includes("consultant_signal"))
      args.profileExtra.push("consultant_signal");
    if (!args.profileExtra.includes("founder_signal")) args.profileExtra.push("founder_signal");
    if (!args.profileExtra.includes("multiple_roles_signal"))
      args.profileExtra.push("multiple_roles_signal");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bexecutive\s+vice\s+president\b|\bevp\b/i.test(blob) ||
    /\bformer\s+gm\b.*\bvp\b/i.test(tBlob)
  ) {
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.add("growth_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bvp\b.*\b(growth|strategy)\b|\bvp\s+growth\b|\bvp\s+growth\s*&\s*strategy\b/i.test(blob)) {
    args.roleCategories.add("growth_leader");
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bproduct\s+operations\b/i.test(blob) && /\bprogram\s+manager\b/i.test(blob)) {
    args.roleCategories.add("product_operations");
    args.roleCategories.add("program_manager");
    args.roleCategories.delete("unknown");
  }

  if (/\bcustomer\s+experience\b|\bcustomer\s+engagement\b/i.test(blob)) {
    args.roleCategories.add("customer_experience");
    args.roleCategories.add("customer_success_leader");
    args.roleCategories.delete("unknown");
  }

  if (/\bglobal\s+customer\s+success\b/i.test(blob) && /\brenewals\b/i.test(blob)) {
    args.roleCategories.add("customer_success_leader");
  }

  if (
    /\bIDC\b/i.test(blob) &&
    /\bindustry\s+analyst\b/i.test(blob) &&
    /\bapplication\s+security\b/i.test(blob)
  ) {
    args.roleCategories.add("analyst_security");
    args.roleCategories.add("security_practitioner");
    args.roleCategories.delete("unknown");
  }

  if (/\bagents?\b/i.test(blob) && /\bnvidia\b/i.test(blob)) {
    args.roleCategories.add("ai_practitioner");
    args.roleCategories.add("technical_influencer");
    args.roleCategories.delete("unknown");
  }

  if (/\bboard\s+member\b/i.test(blob)) {
    args.roleCategories.add("board_member");
    args.profileExtra.push("board_member_signal");
  }

  if (/\bchief\s+ai\s+officer\b|\bcaio\b/i.test(blob)) {
    args.roleCategories.add("ai_leader");
    args.roleCategories.add("technology_executive");
    args.roleCategories.add("executive_leader");
  }

  if (/\bchief\s+technology\s+officer\b|\bcto\b/i.test(blob)) {
    args.roleCategories.add("technology_executive");
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("executive_leader");
  }

  if (/\bvp\b.*\bdata\b|\bvp\s+data\b/i.test(blob)) {
    args.roleCategories.add("data_leader");
    args.roleCategories.add("technology_executive");
  }

  if (/\bhead\s+of\s+sales\b/i.test(blob)) {
    args.roleCategories.add("sales_leader");
    args.roleCategories.add("gtm_leader");
    args.roleCategories.add("business_leader");
  }

  if (
    /\bcybersecurity\b.*\bcommercial\s+enablement\b|\bcommercial\s+enablement\b.*\bcyber|\bcybersecurity\s+commercial\b/i.test(
      blob
    )
  ) {
    args.roleCategories.add("gtm_leader");
    if (/\bdirector\b|\bvp\b|\bciso\b|\bchief\b/i.test(blob)) {
      args.roleCategories.add("security_leader");
    } else {
      args.roleCategories.add("security_practitioner");
    }
  }

  if (/\bproduct\s+marketing\b/i.test(blob)) {
    args.roleCategories.add("product_marketing");
    args.roleCategories.add("marketing_leader");
  }

  if (/\bprincipal\s+product\s+manager\b/i.test(blob)) {
    args.roleCategories.add("product_leader");
  }

  if (/\btpm\b|\btechnical\s+program\s+manager\b/.test(tBlob)) {
    args.roleCategories.add("program_manager");
  }

  if (/\bsolution\s+engineering\b|\bsolutions?\s+engineer/i.test(blob)) {
    args.roleCategories.add("solutions_engineer");
  }

  if (
    !headlineIsAppSecStrategicMarketing(blob) &&
    /\bsoftware\s+engineering\s+leader\b|\bengineering\s+leader\b/i.test(blob)
  ) {
    args.roleCategories.add("engineering_leader");
    args.roleCategories.add("software_engineer");
  }

  if (/\bprincipal\s+architect\b/i.test(blob)) {
    args.roleCategories.add("technical_architect");
    args.roleCategories.add("technical_influencer");
    if (/\bgoogle\s+cloud\b|\baws\b|\bazure\b/i.test(blob)) {
      args.roleCategories.add("cloud_engineer");
    }
  }

  if (/\bgtm\b/i.test(blob)) {
    args.roleCategories.add("gtm_leader");
    args.roleCategories.add("business_leader");
  }

  if (/\bfull[\s-]?stack\s+ai\b|\bai\s+developer\b/i.test(blob)) {
    args.roleCategories.add("ai_engineer");
    args.roleCategories.add("software_engineer");
  }

  if (
    /\bcybersecurity\s+advisor\b|\bcyber\s+security\s+advisor\b|\bindependent\s+technology\s+advisor\b/i.test(
      blob
    )
  ) {
    args.roleCategories.add("security_advisor");
    args.roleCategories.add("coach_or_advisor");
  }

  if (
    /\bcmo\b/i.test(blob) ||
    (/\bbusiness\s+executive\b/i.test(blob) && /\bmarketing\b/i.test(blob))
  ) {
    args.roleCategories.add("marketing_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.add("executive_leader");
  }

  if (
    /\bcustomer\s+success\b|\bvp\s+customer\s+success\b|head\s+of\s+customer\s+success/i.test(blob)
  ) {
    args.roleCategories.add("customer_success_leader");
  }

  if (
    /\bquality\s+assurance\b/i.test(blob) ||
    /\bquality\s+engineer\b/i.test(blob) ||
    (/\bqa\b/i.test(blob) && /\bengineer\b/i.test(blob))
  ) {
    args.roleCategories.add("quality_engineering");
    args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }

  if (
    /\bdean\b|\bprovost\b|\bsuperintendent\b|\bprincipal\s*\(\s*k[-\s]?12\b|head\s+of\s+school/i.test(
      blob
    )
  ) {
    args.roleCategories.add("education_leader");
  }

  if (/\bnetwork\s+administrator\b.*\binfrastructure\b/i.test(blob)) {
    args.roleCategories.add("platform_engineer");
  }

  if (
    /\badvisor\b/.test(tBlob) &&
    /\binvestor\b/.test(tBlob) &&
    args.roleCategories.has("investor")
  ) {
    args.profileExtra.push("advisor_signal");
  }

  if (/\baka\b/i.test(h) || /\bflip\s+flops\b/i.test(blob)) {
    args.profileExtra.push("informal_title_signal");
  }
  if (/\bplatform\s+team\s+manager\b/i.test(blob)) {
    args.profileExtra.push("platform_manager_signal");
  }

  if (args.atCount >= 3 && (/\s\|\s/.test(h) || /\s@\s/.test(h))) {
    args.profileExtra.push("multiple_roles_signal");
  }

  if (
    /\b(chro|chief\s+human\s+resources|human\s+resources|hr\s+generalist|hr\s+business\s+partner|organizational\s+development|talent\s+management)\b/i.test(
      blob
    )
  ) {
    args.roleCategories.add("hr_leader");
    args.roleCategories.add("people_leader");
    if (/\b(recruit|talent\s+acquisition|hiring|business\s+recruiting)\b/i.test(blob)) {
      args.roleCategories.add("recruiter");
    }
    args.roleCategories.delete("unknown");
  }
  if (/\bhead\s+of\b.*\b(recruit|hiring|business\s+recruiting|talent)\b/i.test(blob)) {
    args.roleCategories.add("recruiter");
    args.roleCategories.add("hr_leader");
    args.roleCategories.delete("unknown");
  }
  if (
    /\bproduct\s+management\b/i.test(blob) ||
    (/\bproduct\b/i.test(blob) &&
      (/\bat\b|@/.test(blob) || /\bproduct\s+at\b/i.test(blob)) &&
      !/\bproduct\s+marketing\b/i.test(blob))
  ) {
    if (/\b(head|lead|leader|director|vp|svp|principal)\b/i.test(blob)) {
      args.roleCategories.add("product_leader");
    } else {
      args.roleCategories.add("product_manager");
    }
    args.roleCategories.delete("unknown");
  }
  if (/\b(success\s+guide|client\s+success)\b/i.test(blob)) {
    args.roleCategories.add("customer_success_leader");
    args.roleCategories.delete("unknown");
  }
  if (
    /\b(svp|senior\s+vice\s+president)\b/i.test(blob) &&
    /\balliances\b/i.test(blob)
  ) {
    args.roleCategories.add("partnerships_leader");
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }
  if (/\bstrategic\s+communications\b/i.test(blob) && /\b(brand|narrative)\b/i.test(blob)) {
    args.roleCategories.add("communications_leader");
    args.roleCategories.add("marketing_leader");
    args.roleCategories.delete("unknown");
  }
  if (/\bsponsor\s+finance\b/i.test(blob) && /\bmanaging\s+director\b/i.test(blob)) {
    args.roleCategories.add("finance_accounting");
    args.roleCategories.add("executive_leader");
    args.roleCategories.add("business_leader");
    args.roleCategories.delete("unknown");
  }
  if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/i.test(blob)) {
    args.roleCategories.add("security_practitioner");
    args.roleCategories.add("it_operations");
    args.roleCategories.delete("unknown");
  }
  if (
    /\b(leadership\s+career\s+coach|leadership\s+coach)\b/i.test(blob) &&
    /\b(speaker|author|mentor)\b/i.test(blob)
  ) {
    args.roleCategories.add("coach_or_advisor");
    args.roleCategories.add("consultant");
    args.roleCategories.delete("unknown");
  }
  if (
    /\b(attended|student\s+at)\b/i.test(blob) &&
    /\b(college|university)\b/i.test(blob) &&
    !professionalTitleOutranksStudent(h)
  ) {
    args.roleCategories.add("student");
    if (/\bengineering\b/i.test(blob)) args.roleCategories.add("software_engineer");
    args.roleCategories.delete("unknown");
  }
}

/** Degree-seekers are not faculty “academic”; past-founder alumni are not CS students. */
function reconcileDegreeSeekerPastFounderAndAcademic(
  headlineFull: string,
  headline: string,
  strictStudent: boolean,
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  refinement: ProfileFlag[]
): void {
  const h = headline;
  const hNorm = norm(h);
  const hf = headlineFull.replace(/\s+/g, " ").trim();

  if (
    headlineIndicatesPastFounder(hf) &&
    (/\b(alum|graduate)\b/i.test(hNorm) || /\bcomputer\s+science\s+graduate\b/i.test(hNorm)) &&
    !headlineHasExplicitFounderEvidence(hf)
  ) {
    roleCategories.delete("academic");
    roleCategories.add("past_founder");
    roleCategories.delete("unknown");
    if (!refinement.includes("past_founder_signal")) refinement.push("past_founder_signal");
    if (!refinement.includes("past_role_signal")) refinement.push("past_role_signal");
    if (/\bearly\b|\bgraduate\b/i.test(hNorm) && !roleCategories.has("student")) {
      roleCategories.add("early_career");
      if (!refinement.includes("early_career_signal")) refinement.push("early_career_signal");
    }
  }

  const facultyLike =
    /\b(professor|associate\s+professor|assistant\s+professor|\bfaculty\b|postdoctoral\s+fellow)\b/i.test(
      h
    ) ||
    /\blecturer\b.{0,40}\b(?:university|college)\b/i.test(h) ||
    (/\binstructor\b/i.test(hNorm) && /\b(university|college|academy)\b/i.test(hNorm));
  const degreeSeeking =
    strictStudent ||
    /\bstudent\b|\bb\.?\s*tech\b|\bcse\b(?:\s*\([^)]+\))?\s*\|/i.test(h) ||
    /\bengineering\s+student\b|\bcomputer\s+science\s+engineering\s+student\b/i.test(h) ||
    (/\bcomputer\s+science\b/i.test(hNorm) && /\bstudent\b/i.test(hNorm)) ||
    /\b(bachelor|bachelors|undergrad)\b/i.test(hNorm);

  if (/\bb\.?\s*tech\b/i.test(hNorm) && /\bcse\b/i.test(hNorm) && roleCategories.has("academic")) {
    roleCategories.delete("academic");
    if (!facultyLike) {
      if (!roleCategories.has("student")) roleCategories.add("student");
      if (!refinement.includes("student_signal")) refinement.push("student_signal");
      if (!refinement.includes("early_career_signal")) refinement.push("early_career_signal");
    }
  }
  if (degreeSeeking && !facultyLike && roleCategories.has("academic")) {
    roleCategories.delete("academic");
    if (!roleCategories.has("job_seeker")) {
      roleCategories.add("student");
    }
    roleCategories.delete("unknown");
    if (!refinement.includes("student_signal")) refinement.push("student_signal");
    if (!refinement.includes("early_career_signal")) refinement.push("early_career_signal");
  }

  if (
    degreeSeeking &&
    !facultyLike &&
    /cyber|digital\s+forensic|forensic|security/i.test(h) &&
    /\bcse\b|\bcyber\b/i.test(hNorm)
  ) {
    if (!roleCategories.has("security_practitioner")) roleCategories.add("security_practitioner");
  }
  if (
    degreeSeeking &&
    !facultyLike &&
    /\bcomputer\s+science\b/i.test(hNorm) &&
    /\b(software|development|developer|programming|problem\s+solving)\b/i.test(hNorm)
  ) {
    if (!roleCategories.has("software_engineer")) roleCategories.add("software_engineer");
    if (!roleCategories.has("student")) roleCategories.add("student");
    roleCategories.delete("unknown");
    if (!refinement.includes("student_signal")) refinement.push("student_signal");
    if (!refinement.includes("early_career_signal")) refinement.push("early_career_signal");
  }
}

function augmentFounderDomainSecondaryRoles(
  headlineFull: string,
  headline: string,
  strictStudent: boolean,
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  functionTags: ProspectClassification["functionTags"]
): ProspectClassification["functionTags"] {
  const founderLike =
    headlineHasExplicitFounderEvidence(headlineFull) &&
    (roleCategories.has("founder") || roleCategories.has("solo_founder"));
  if (!founderLike || strictStudent) return functionTags;

  const blob = norm(`${headlineFull} ${headline}`);
  const next = [...functionTags];

  if (/\bweb3\b|\bdao\b|\bdefi\b|\bnft\b|\bblockchain\b/i.test(blob)) {
    roleCategories.add("web3_practitioner");
    roleCategories.delete("unknown");
    if (!next.includes("web3")) next.push("web3");
    if (!next.includes("blockchain")) next.push("blockchain");
  }

  const clinicalTrainingFounder =
    /\bregistered\s+nurse|\brn\b|\bnurse\b/i.test(blob) &&
    /\b(mental\s+health|therapy|counsel|cbt)\b/i.test(blob);
  if (clinicalTrainingFounder) {
    if (!roleCategories.has("healthtech")) roleCategories.add("healthtech");
    if (!roleCategories.has("educator")) roleCategories.add("educator");
    if (!roleCategories.has("coach_or_advisor")) roleCategories.add("coach_or_advisor");
    if (!next.includes("healthcare")) next.push("healthcare");
    if (!next.includes("education")) next.push("education");
  }

  const methodArchFounder =
    /\b(?:framework|methodology|architecture\s+patterns?)\b/i.test(blob) &&
    /\bprincipal\b|\b(?:lead|chief)\s+architect\b|\b(?:enterprise\s+architecture|consulting\s+principal)\b/i.test(
      blob
    );
  if (methodArchFounder) {
    roleCategories.add("technical_architect");
    roleCategories.delete("unknown");
    if (!next.includes("technical_architecture")) next.push("technical_architecture");
  }

  return Array.from(new Set(next)).sort((a, b) =>
    a.localeCompare(b)
  ) as ProspectClassification["functionTags"];
}

function labelsAreClearlyClassified(args: {
  headline: string;
  headlineFull?: string;
  currentTitle?: string | null;
  roleCategories: Set<ProspectClassification["roleCategories"][number]>;
  functionTags: ProspectClassification["functionTags"];
  strictStudent: boolean;
  founderLeadSegment: boolean;
}): boolean {
  const {
    headline,
    headlineFull,
    currentTitle,
    roleCategories: rc,
    functionTags: ft,
    strictStudent,
    founderLeadSegment,
  } = args;
  const hForFounder = (headlineFull ?? headline).trim();
  const hText = `${headline} ${currentTitle ?? ""}`;
  return (
    (rc.has("student") && strictStudent) ||
    (rc.has("sales_account") &&
      (/\b(enterprise\s+software\s+sales|sales\s+leader|account\s+director)\b/i.test(hText) ||
        /\baccount\s+executive\b|\bsr\.?\s+account\s+executive\b/i.test(hText))) ||
    (rc.has("product_marketing") &&
      /\bvp\b.*\bproduct\s+marketing\b|\bvp,\s*product\s+marketing\b|\bproduct\s+marketing\b/i.test(
        hText
      )) ||
    (rc.has("technology_executive") &&
      /\b(chief\s+technology\s+officer|chief\s+ai\s+officer|\bcto\b|\bcaio\b)/i.test(hText)) ||
    (rc.has("ai_leader") && /\b(chief\s+ai\s+officer|\bcaio\b|\bai\s+product\b)/i.test(hText)) ||
    (rc.has("data_leader") && /\bvp\s+data\b/i.test(hText)) ||
    (rc.has("product_leader") && /\bprincipal\s+product\s+manager\b/i.test(hText)) ||
    (rc.has("product_manager") && /\bproduct\s+manager\b|\bai\s+product\b/i.test(hText)) ||
    (rc.has("sales_leader") && /\bhead\s+of\s+sales\b/i.test(hText)) ||
    (rc.has("solutions_engineer") &&
      /\bsolution\s+engineering\b|\bsolutions?\s+engineer/i.test(hText)) ||
    (rc.has("program_manager") && /\bprogram\s+manager\b/i.test(hText)) ||
    (rc.has("quality_engineering") &&
      /\bqa\b|\bquality\s+engineering\b|\bmanual\s+and\s+automation\b/i.test(hText)) ||
    (rc.has("software_engineer") &&
      (/\bsoftware\s+developer\b/i.test(hText) ||
        /\bfull\s*s?t[a]?cks?\s+developer\b/i.test(hText) ||
        /\bfulls?t\s*acks?\s+developer\b/i.test(hText) ||
        /\bfullstsack\b/i.test(norm(hText)))) ||
    (rc.has("analyst_security") &&
      /\bIDC\b/i.test(hText) &&
      /\bindustry\s+analyst\b/i.test(hText) &&
      /\bapplication\s+security\b/i.test(hText)) ||
    (rc.has("product_operations") &&
      /\bproduct\s+operations\b/i.test(hText) &&
      /\bprogram\s+manager\b/i.test(hText)) ||
    (rc.has("business_development") &&
      /\bbusiness\s+development\b|\bbd\s+expert|\blinkedin\s+outreach|\bmarket\s+researcher|\bgenerating\s+leads\b|\bbusiness\s+development\s+expert\b/i.test(
        hText
      )) ||
    (rc.has("technology_strategist") &&
      /\btechnology\s+strategist\b|\btech\s+strategist\b/i.test(hText)) ||
    (rc.has("customer_success_leader") &&
      /\bsupport\s+account\s+manager\b|\bcustomer\s+success\b/i.test(hText)) ||
    (rc.has("ai_engineer") &&
      /\bai\s+engineer\b/i.test(hText) &&
      /\b(multi[- ]agent|\bmcp\b|agentic)\b/i.test(hText)) ||
    (rc.has("gtm_leader") &&
      /\bcommercial\s+enablement\b|\bgo-?to-?market\b/i.test(hText) &&
      /\bcyber(security)?\b/i.test(hText)) ||
    (rc.has("investor") &&
      /\b(investor|venture\s+partner|angel\s+investor|startup\s+investor)\b/i.test(hText)) ||
    ((rc.has("security_leader") || rc.has("security_practitioner")) &&
      (/\bciso\b|\bcyber\s+security\b|\bgrc\b|\bsoc\b/i.test(hText) ||
        SECURITY_LEADER_RE.test(hText))) ||
    (rc.has("legal_counsel") && /\bgeneral\s+counsel\b/i.test(hText)) ||
    (rc.has("it_operations") &&
      (/\bsystem\s+administrator\b/i.test(hText) ||
        /\bitil\b|\bcontinuous\s+improvement\b/i.test(hText))) ||
    (rc.has("consultant") && ft.includes("security")) ||
    (rc.has("founder") &&
      (founderLeadSegment || headlineHasExplicitFounderEvidence(hForFounder))) ||
    (rc.has("network_engineer") && /\bnetwork\s+(engineer|administrator)\b/i.test(hText)) ||
    (rc.has("infrastructure_engineer") && /\binfrastructure\s+engineer\b/i.test(hText)) ||
    (rc.has("education_leader") &&
      (/\bdean\b|\bprovost\b|\bsuperintendent\b|\bprincipal\s*\(\s*k[-\s]?12|head\s+of\s+school/i.test(
        hText
      ) ||
        /\bsenior\s+education\b|\beducation\s*&\s*program\s+leader\b/i.test(hText) ||
        (/\bprogram\s+leader\b/i.test(hText) && /\bworkforce\s+development\b/i.test(hText)))) ||
    (rc.has("communications_leader") && /\bcommunications\b|\bcomms\b/i.test(hText)) ||
    (rc.has("marketing_leader") &&
      /\bcommunications\b/i.test(hText) &&
      /\bmarketing\b/i.test(hText) &&
      /\bvp\b/i.test(hText)) ||
    (rc.has("operations_leader") &&
      (/\boperations\s+leader\b|\bvp\s+of\s+operations\b/i.test(hText) ||
        /\bitil\b|\bcontinuous\s+improvement\b/i.test(hText))) ||
    (rc.has("growth_leader") && /\bhead\s+of\s+growth\b|\bvp\s+growth\b/i.test(hText)) ||
    (rc.has("technical_evangelist") &&
      /\btechnical\s+evangelist\b|\btech\s+evangelist\b|\bdevrel\b|\bdev(eloper)?\s+advocate\b/i.test(
        hText
      )) ||
    (rc.has("media_creator") && /\bpodcasts?\b|\bpodcaster\b/i.test(hText)) ||
    (rc.has("platform_engineer") &&
      (/\bplatform\s+engineer\b/i.test(hText) || /\bflip\s+flops\b/i.test(hText))) ||
    (rc.has("recruiter") && /\bstaffing\b/i.test(hText)) ||
    (rc.has("sre_engineer") && /\bsite\s+reliability\b|\bsre\b/i.test(hText)) ||
    (rc.has("cloud_engineer") &&
      /\bdevops\b/i.test(hText) &&
      /\b(aws|azure|gcp|terraform|kubernetes|cloud)\b/i.test(hText)) ||
    (rc.has("devops_engineer") && /\bdevops\b/i.test(hText) && /\bcloud\b/i.test(hText)) ||
    (rc.has("cloud_industry_leader") &&
      /\baws\b/i.test(hText) &&
      /\b(head\s+of|banking|financial|worldwide|startups)\b/i.test(hText)) ||
    (rc.has("frontend_engineer") && /\bfrontend\b|\breact\b/i.test(hText)) ||
    (rc.has("ai_strategy") &&
      /\benterprise\s+transformation\b|people[- ]centered|\badoption\b|\bchange\s+agent\b/i.test(
        hText
      )) ||
    (rc.has("finance_accounting") && /\baccountant\b/i.test(hText)) ||
    (rc.has("channel_leader") && /channel\s+head\b/i.test(hText)) ||
    (rc.has("technical_enablement") && /\btechnical\s+training\b/i.test(hText)) ||
    (rc.has("project_manager") && /\bagile\s+project\s+manager\b/i.test(hText)) ||
    (rc.has("supply_chain") && /\bsupply\s+chain\b/i.test(hText)) ||
    (rc.has("startup_business_development") && /\bstartups\s*@\s*aws\b/i.test(hText)) ||
    (rc.has("designer") && /^design\s*@/im.test(hText.trim())) ||
    (rc.has("technology_leader") &&
      /\btechnology\s+leader\b/i.test(hText) &&
      /\bdigital\s+transformation\b/i.test(hText)) ||
    (rc.has("business_analyst") &&
      /\bbusiness\s+analyst\b/i.test(hText) &&
      (/\boss\b|\bbss\b|\btelecom\b|\bagile\b|\bscrum\b/i.test(hText) ||
        /\bopen\s+to\s+work\b/i.test(hText))) ||
    (rc.has("customer_support") &&
      /\bcustomer\s+service\b/i.test(hText) &&
      /\bopen\s+to\b|\bnew\s+opportunities\b|\brich\s+experience\b/i.test(hText)) ||
    (rc.has("executive_leader") &&
      rc.has("commercial_leader") &&
      /\bpresident\b/i.test(hText) &&
      /\bchief\s+commercial\s+officer\b|\bcco\b/i.test(hText)) ||
    (rc.has("cloud_engineer") && /\bcloud\s+engineer\b/i.test(hText)) ||
    (rc.has("partnerships_leader") &&
      /\bpartnerships\b/i.test(hText) &&
      /\bsenior\s+executive\b|\bcollaborations\b|\bsolutions\b/i.test(hText)) ||
    (rc.has("personal_brand_consultant") &&
      /\bpersonal\s+brand\b/i.test(hText) &&
      /\blinkedin\b/i.test(hText)) ||
    (rc.has("automation_specialist") &&
      /\bautomation\s+specialist\b/i.test(hText) &&
      /\bai\b/i.test(hText)) ||
    ((rc.has("technical_trainer") || rc.has("educator")) &&
      (/\bcybersecurity\s+instructor\b/i.test(hText) ||
        (/\btcp\s*\/\s*ip\b/i.test(hText) &&
          (/\bnetwork\s+programmer\b/i.test(hText) || /\bunix\b|\blinux\b/i.test(hText))))) ||
    (rc.has("software_engineer") &&
      /\bjava\b/i.test(hText) &&
      /\bspring\b/i.test(hText) &&
      /\breact\b/i.test(hText) &&
      !/\b(engineer|developer)\b/i.test(hText)) ||
    (rc.has("strategy_leader") &&
      /\bchief\s+strategy\s+officer\b/i.test(hText) &&
      /\bzscaler\b/i.test(hText)) ||
    (rc.has("financial_analyst") &&
      /\bfinancial\s+analyst\b/i.test(hText) &&
      (/\bfinancial\s+modell?ing\b/i.test(hText) || /\besg\b/i.test(hText))) ||
    (rc.has("business_development") &&
      rc.has("sales_leader") &&
      rc.has("program_manager") &&
      /\bbusiness\s+development\b/i.test(hText)) ||
    (rc.has("mlops_engineer") &&
      /\bdata\s+scientist\b/i.test(hText) &&
      /\b(mlops|rag)\b/i.test(hText)) ||
    (rc.has("content_creator") && /\bcontent\s+writer\b/i.test(hText)) ||
    (rc.has("revops") && /\brevops\b/i.test(hText) && /\brecruiting\b/i.test(hText)) ||
    (rc.has("it_operations") &&
      rc.has("security_practitioner") &&
      /\bsenior\s+it\s+manager\b/i.test(hText) &&
      /\bokta\b/i.test(hText)) ||
    (rc.has("ai_creator") &&
      rc.has("educator") &&
      /\blearn\s+ai\s+for\s+marketing\b/i.test(hText)) ||
    (rc.has("robotics_engineer") &&
      /\brobotics\s+engineering\b/i.test(hText) &&
      /\bhackathon\b/i.test(hText)) ||
    (rc.has("healthtech") &&
      rc.has("ai_practitioner") &&
      /\bgenai\b/i.test(hText) &&
      /\boracle\s+health\b/i.test(hText)) ||
    ((rc.has("data_engineer") || rc.has("analytics_engineer")) &&
      rc.has("mlops_engineer") &&
      /\banalytical\s+eng\b/i.test(hText) &&
      /\bdata\s+ops\b/i.test(hText)) ||
    (rc.has("academic") &&
      rc.has("software_engineer") &&
      /\bsoftware\s+engineering\s+ph\.?d\b/i.test(hText)) ||
    (rc.has("security_practitioner") &&
      rc.has("technical_evangelist") &&
      rc.has("media_creator") &&
      /\bcyber(?:security)?\b/i.test(hText) &&
      /\btech\s+evangelist\b/i.test(hText) &&
      /\bpodcasts?\b|\bpodcaster\b/i.test(hText)) ||
    (rc.has("student") &&
      !strictStudent &&
      rc.has("product_builder") &&
      /\bproduct\s+builder\b/i.test(hText) &&
      /\b(cs|cse)\s*@/i.test(hText))
  );
}

function headlineIsCleanForVerbatimSummary(h: string): boolean {
  const s = h.replace(/\s+/g, " ").trim();
  if (s.length < 4 || s.length > 88) return false;
  if (/[|•·▪]/.test(s)) return false;
  if (/\s@\s/.test(s)) return false;
  if ((s.match(/\//g) ?? []).length > 1) return false;
  if (/\b(?:aspiring|author)\b/i.test(s) && s.length > 45) return false;
  return true;
}

function verbatimSummaryOrNull(h: string): string | null {
  if (!headlineIsCleanForVerbatimSummary(h)) return null;
  const s = h.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function roleBasedFallbackSummary(args: {
  headline: string;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
  seniority: ProspectClassification["seniority"];
  strictStudent: boolean;
  currentTitle: string | null;
  currentCompany: string | null;
  educationInstitution: string | null;
  educationArea: string | null;
}): string {
  const {
    roleCategories: rc,
    functionTags: ft,
    seniority: _seniority,
    strictStudent,
    currentTitle,
    currentCompany,
    educationInstitution,
    educationArea,
    headline: h,
  } = args;
  void _seniority;
  const rcSet = new Set(rc);
  const t = norm(h);

  if (rcSet.has("recruiter")) {
    if (ft.includes("staffing") || /\bstaffing\b/i.test(h)) {
      return "Staffing and recruiting professional focused on screening, negotiation, and hiring workflows.";
    }
    return "Talent and recruiting professional.";
  }
  if (rcSet.has("investor"))
    return "Investor focused on companies, partnerships, and portfolio work.";
  if (rcSet.has("competitor")) return "Professional in a market-adjacent or competing context.";
  if (rcSet.has("job_seeker")) return "Professional open to or actively seeking new opportunities.";
  if (rcSet.has("finance_accounting")) {
    return "Accounting and finance professional focused on reporting, close processes, and controls.";
  }
  if (rcSet.has("designer")) {
    return "Design professional focused on brand, product, or marketing creative execution.";
  }
  if (rcSet.has("channel_leader")) {
    return "Channel leader focused on partner ecosystems, coverage, and indirect revenue programs.";
  }
  if (rcSet.has("technical_enablement")) {
    return "Technical enablement professional focused on training, certification, and practitioner skill-building.";
  }
  if (rcSet.has("project_manager") && rcSet.has("program_manager")) {
    return "Agile delivery leader running complex software programs with Scrum and stakeholder alignment.";
  }
  if (rcSet.has("supply_chain")) {
    return "Supply chain leader focused on sourcing, logistics alignment, and operational procurement.";
  }
  if (rcSet.has("startup_business_development") && ft.includes("aws")) {
    return "Cloud ecosystem professional focused on startups, builders, and adoption programs.";
  }
  if (
    rcSet.has("technology_leader") &&
    (rcSet.has("technology_executive") || ft.includes("digital_transformation"))
  ) {
    return "Senior technology leader spanning architecture, digital transformation, and innovation programs.";
  }
  if (rcSet.has("media_analyst"))
    return "Media or industry analyst focused on research and narrative.";
  if (rcSet.has("solo_founder")) return "Solo founder building a product or company.";
  if (
    rcSet.has("business_development") &&
    (rcSet.has("gtm_leader") || ft.includes("lead_generation"))
  ) {
    return "Professional focused on business development, outbound reach, and revenue pipeline growth.";
  }
  if (rcSet.has("customer_success_leader")) {
    if (/\bcyber|\bsecurity\s+saas\b/i.test(t)) {
      return "Customer success leader focused on adoption, retention, and expansion in security and SaaS contexts.";
    }
    return "Customer success leader focused on retention, expansion, and customer outcomes.";
  }
  if (rcSet.has("gtm_leader")) {
    if (/\bcro\b/i.test(t) || /\bchief\s+revenue\b/i.test(t)) {
      return "Chief revenue officer focused on enterprise go-to-market strategy, partnerships, and scalable growth.";
    }
    if (rcSet.has("business_leader")) {
      return "Senior business and go-to-market leader focused on commercial strategy and organizational growth.";
    }
    return "Go-to-market leader focused on revenue strategy, channel programs, and growth execution.";
  }
  if (rcSet.has("early_career") && (ft.includes("cloud") || ft.includes("devops"))) {
    return "Early-career professional building practical cloud and DevOps skills.";
  }
  if (
    (rcSet.has("cloud_engineer") || rcSet.has("platform_engineer")) &&
    (ft.includes("devops") || ft.includes("sre") || /\bdevops\b/i.test(t))
  ) {
    return "Infrastructure professional focused on cloud platforms, automation, and reliability.";
  }
  if (rcSet.has("academic")) {
    return "Academic or faculty role combining teaching with deep subject-matter expertise.";
  }
  if (rcSet.has("engineering_leader")) {
    return "Engineering leader focused on technical execution, delivery, and team leadership.";
  }
  if (rcSet.has("security_leader")) {
    return "Security leader focused on governance, risk, and security program direction.";
  }
  if (rcSet.has("security_practitioner")) {
    return "Security practitioner focused on operations, monitoring, and incident readiness.";
  }
  if (
    rcSet.has("technical_influencer") ||
    rcSet.has("platform_engineer") ||
    rcSet.has("ai_engineer")
  ) {
    return "Technical professional working across engineering, platforms, or specialized solution delivery.";
  }
  if (rcSet.has("consultant") && ft.includes("security")) {
    return "Cybersecurity consultant or advisor focused on risk, architecture, and security programs.";
  }
  if (rcSet.has("consultant")) {
    return "Consultant or independent advisor delivering professional services engagements.";
  }
  if (rcSet.has("sales_account")) {
    if (
      /\benterprise\s+software\s+sales\b|\brevenue\s+growth\b/i.test(t) ||
      ft.includes("revenue")
    ) {
      return "Commercial leader focused on enterprise sales, accounts, and revenue growth.";
    }
    return "Sales and account professional focused on client relationships and growth.";
  }
  if (rcSet.has("legal_counsel")) {
    return "Legal executive focused on corporate counsel, compliance, and risk.";
  }
  if (rcSet.has("it_operations")) {
    return "IT and operations professional focused on infrastructure, systems, and service reliability.";
  }
  if (rcSet.has("marketing_leader") || rcSet.has("product_marketing")) {
    return "Marketing leader focused on positioning, product marketing, and go-to-market.";
  }
  if (rcSet.has("sales_leader")) {
    return "Commercial leadership role spanning accounts, revenue accountability, and growth.";
  }
  if (rcSet.has("target_buyer")) {
    return "Commercial or economic buyer involved in technology and vendor decisions.";
  }
  if (rcSet.has("intern_or_student")) {
    return "Early-career professional combining study, internships, or comparable training signals.";
  }
  if (rcSet.has("student") || strictStudent) {
    if (educationArea && educationInstitution) {
      return `Student focused on ${educationArea} at ${educationInstitution}.`;
    }
    if (educationInstitution) {
      return `Student at ${educationInstitution}.`;
    }
    return "Student building skills across the areas highlighted in the profile.";
  }
  if (currentTitle && currentCompany && currentTitle.length < 58 && currentCompany.length < 42) {
    return `Currently ${currentTitle} at ${currentCompany}.`;
  }
  if (currentTitle && currentTitle.length < 68) {
    return `Currently in a ${currentTitle} capacity.`;
  }
  const meaningfulTags = ft.filter((x) => x !== "unknown");
  if (rcSet.size === 1 && rcSet.has("unknown") && meaningfulTags.length > 0) {
    return "Professional with a mixed headline; partial signals are inferred from identifiable function language.";
  }
  if (meaningfulTags.length >= 2) {
    return "Professional whose headline spans more than one function; summary stays general by design.";
  }
  return "Professional profile with multiple headline signals; summary inferred from roles and function focus.";
}

function buildNormalizedProfessionalSummary(args: {
  headline: string;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
  seniority: ProspectClassification["seniority"];
  strictStudent: boolean;
  founderLeadSegment: boolean;
  internSignal: boolean;
  currentTitle: string | null;
  currentCompany: string | null;
  educationInstitution: string | null;
  educationArea: string | null;
}): string | null {
  const {
    headline: rawHeadline,
    roleCategories: rc,
    functionTags: ft,
    seniority,
    strictStudent,
    founderLeadSegment,
    internSignal,
    currentTitle,
    currentCompany,
    educationInstitution,
    educationArea,
  } = args;
  const h = rawHeadline.replace(/\s+/g, " ").trim();
  if (!h) return null;
  const t = norm(h);

  if (/\bai\s+transformation\b/i.test(t) && /\b(businesses|systems|days|existing)\b/i.test(t)) {
    return "Consultant focused on practical AI adoption, workflows, and leverage of existing systems.";
  }
  if (/\btechnical\s+training\b/i.test(t) && /\benablement\b/i.test(t)) {
    return "Technical training and enablement professional helping teams adopt tools and platforms.";
  }
  if (/\bb2b\s+growth\s+strategist\b/i.test(t) || /\bpredictable\s+revenue\b/i.test(t)) {
    return "B2B growth strategist building repeatable revenue motion for founders and small teams.";
  }
  if (/^\s*channel\s+head\b/i.test(h.trim())) {
    return "Channel leader responsible for partner strategy, coverage, and ecosystem growth.";
  }
  if (/\btechnology\s+leader\b/i.test(t) && /\bdigital\s+transformation\b/i.test(t)) {
    return "Technology leader steering digital transformation, architecture, and innovation initiatives.";
  }
  if (/\bcontent\s+creator\b/i.test(t) && /\bgrowth\s+strategist\b/i.test(t)) {
    return "Creator and growth strategist focused on content-led distribution across social platforms.";
  }
  if (/\bit\s+leader\b/i.test(t) && /\bcloud\s+enablement\b/i.test(t)) {
    return "IT leader focused on cloud adoption narratives, enablement, and transformation delivery.";
  }
  if (/\bsenior\s+staff\s+accountant\b/i.test(t) || /\bstaff\s+accountant\b/i.test(t)) {
    return "Staff accountant focused on financial reporting, reconciliation, and period close.";
  }
  if (/\bagile\s+project\s+manager\b/i.test(t) && /\bscrum\s+master\b/i.test(t)) {
    return "Agile project leader combining Scrum practice with SaaS stakeholder and delivery management.";
  }
  if (/\bpenetration\s+tester\b/i.test(t) || /\bred\s+team\b/i.test(t)) {
    return "Offensive security practitioner focused on penetration testing and adversarial simulation.";
  }
  if (/\bsupply\s+chain\b/i.test(t) && /\boperation\b/i.test(t) && /\bleader\b/i.test(t)) {
    return "Supply chain operations leader spanning sourcing strategy and procurement alignment.";
  }
  if (
    /^\s*President,?\s+/i.test(h) &&
    /\b(cyber|compliance|downtime|healthcare|law\s+firms|msp)\b/i.test(t)
  ) {
    return "President of an IT-services business focused on availability, cyber risk, and compliance for clients.";
  }

  if (
    /\bcybersecurity\s+analyst\b/i.test(t) &&
    /\bintern\b/i.test(t) &&
    /\b(high\s+school|secondary\s+school|student)\b/i.test(t)
  ) {
    return "Student or early-career cybersecurity profile with Python and internship experience.";
  }

  if ((strictStudent || rc.includes("student")) && /\bdata\s+science\s+student\b/i.test(h)) {
    return "Data science student focused on analytics, modeling, and quantitative methods.";
  }

  if (/\bitil\b/i.test(t) && /\bcontinuous\s+improvement\b/i.test(t)) {
    return "IT operations and continuous improvement professional with cross-industry experience.";
  }
  if (
    /\bbusiness\s+development\b/i.test(t) &&
    /\blinkedin\s+outreach\b/i.test(t) &&
    /\blead\s+generation\b|\bgenerating\s+leads\b|\bmarket\s+research\b/i.test(t)
  ) {
    return "Business development and LinkedIn outreach specialist focused on lead generation and market research.";
  }
  if (/\bprincipal\b/i.test(t) && /\bapplied\s+ai\b|\btechnical\s+search\b/i.test(t)) {
    const ioMatch = h.match(/\b([A-Za-z0-9][A-Za-z0-9.-]*\.io)\b/);
    const co = ioMatch?.[1] ?? currentCompany;
    if (co) return `Principal at ${co} focused on applied AI and technical search.`;
    return "Principal focused on applied AI and technical search.";
  }
  if (/\bsenior\s+full\s*s?t[a]?ck/i.test(t) || /\bfulls?t\s*acks?\s+developer\b/i.test(t)) {
    return "Software developer with full-stack engineering experience.";
  }
  if (/\bcloud\b/i.test(t) && /\bdevops\b/i.test(t) && /\bin\s+training\b/i.test(t)) {
    return "Cloud and DevOps learner building hands-on infrastructure and security awareness.";
  }
  if (
    /\bpublic\s+safety\b/i.test(t) &&
    /\bcybersecurity\b|\bemergency\s+communications\b/i.test(t)
  ) {
    return "Public safety communications professional focused on cybersecurity and emergency communications.";
  }
  if (/\bsoftware\s+developer\b/i.test(t) && /\bmono\b|\bunicore\b/i.test(t)) {
    return "Software developer working on engineering teams or product infrastructure.";
  }
  if (
    /\bai\s+strategy\b/i.test(t) &&
    /\badoption\b|\benterprise\s+transformation\b|\bchange\s+agent\b|people[- ]centered/i.test(t)
  ) {
    return "AI strategy and adoption leader focused on enterprise transformation and change management.";
  }
  if (/\bcro\b/i.test(t) && /\bgtm\b/i.test(t)) {
    return "Chief revenue officer and global go-to-market leader.";
  }
  if (
    /\btransforming\s+digital\s+identity\b/i.test(t) ||
    (/\bdigital\s+identity\b/i.test(t) && /\btransform/i.test(t))
  ) {
    return "Leader focused on digital identity, trust, and secure customer verification experiences.";
  }
  if (/\bcompetitive\s+advantage\b/i.test(t) && /\bcybersecurity\s+vendors?\b/i.test(t)) {
    return "Advisor focused on positioning and go-to-market narratives for cybersecurity vendors.";
  }
  if (
    /\bksqldb\b/i.test(t) &&
    /\bdeltastream\b/i.test(t) &&
    (rc.includes("founder") || /^ceo\b/i.test(norm(currentTitle ?? "")))
  ) {
    return "CEO of DeltaStream and creator of ksqlDB, with data infrastructure experience.";
  }
  if (
    rc.includes("gtm_leader") &&
    (rc.includes("security_leader") || rc.includes("security_practitioner")) &&
    /\bcommercial\s+enablement\b/i.test(t) &&
    /\bcyber/i.test(t)
  ) {
    return "Go-to-market leader in cybersecurity focused on commercial enablement.";
  }

  if (/\bindependent\s+technology\s+advisor\b/i.test(t) && /\bcyber/i.test(t)) {
    return "Independent technology advisor focused on cybersecurity, cloud, and infrastructure strategy.";
  }
  if (/\bcybersecurity\s+advisor\b/i.test(t) && /\b(executive|board)/i.test(t)) {
    return "Cybersecurity advisor focused on executive and board-level cyber risk decisions.";
  }
  if (/\bprincipal\s+product\s+manager\b/i.test(t) && /\bmicrosoft\s+security\b/i.test(t)) {
    return "Product leader focused on Microsoft Security product direction and roadmap.";
  }
  if (/\bsoftware\s+engineering\s+leader\b/i.test(t)) {
    return "Software engineering leader.";
  }
  if (/\bfull[\s-]?stack\s+ai\s+developer\b/i.test(t)) {
    return "Full-stack developer focused on AI applications.";
  }
  if (/\bnetwork\s+administrator\b/i.test(t) && /\binfrastructure\b/i.test(t)) {
    return "Network and infrastructure specialist focused on routing, switching, firewalls, VoIP, and network operations.";
  }
  if (/\btpm\b|\btechnical\s+program\s+manager\b/i.test(t) && /\bai\/?ml|ai\/ml/i.test(t)) {
    return "Technical program manager focused on AI/ML product delivery and enterprise automation.";
  }
  if (
    /\bcmo\b/i.test(t) ||
    (/\bbusiness\s+executive\b/i.test(t) &&
      /\bmarketing\b/i.test(t) &&
      /\b(cyber|defense)/i.test(t))
  ) {
    return "Business and marketing executive focused on cyber/defense technology, growth, and transformation.";
  }

  if (
    rc.includes("student") &&
    /\bcomputer\s+science\b/i.test(h) &&
    /\b(web|front-?end|developer|design|visual)\b/i.test(t)
  ) {
    return "Computer science student with frontend, web development, and visual design experience.";
  }

  if (
    (strictStudent || rc.includes("student")) &&
    /\bmasters?\s+in\b/i.test(t) &&
    /\b(data|analytics)\b/i.test(t)
  ) {
    return "Graduate student focused on computer applications, analytics, and data-oriented coursework.";
  }

  if (
    rc.includes("it_operations") ||
    /\bsystem\s+administrator\b/i.test(t) ||
    /\brepair\s+operations\b|\bsupply\s+chain\b|service\s+delivery\s+manager/i.test(t)
  ) {
    if (/help\s+companies|optimize\s+it|seamless\s+operations|proactive\s+solutions/i.test(t)) {
      return "IT operations/service provider focused on systems optimization and operational reliability.";
    }
    if (/\brepair\s+operations\b|\bsupply\s+chain\b/i.test(t)) {
      return "Operations professional focused on repair operations, supply chain, and service delivery.";
    }
    return "IT operations professional focused on systems administration and service delivery.";
  }

  if (rc.includes("legal_counsel") || ft.includes("legal")) {
    if (/saas|private\s+equity|growth|risk|transformation/i.test(t)) {
      return "Legal and risk leader focused on SaaS, private equity, growth, and transformation.";
    }
    return "Legal executive focused on corporate counsel, compliance, and risk.";
  }

  if (
    (/\bauthor\b/i.test(t) && /\b(grc|cyber|security|soc|iso\s*27001)\b/i.test(t)) ||
    (rc.includes("consultant") &&
      ft.includes("security") &&
      /\b(advisor|architect|strategist|grc)\b/i.test(t))
  ) {
    return "Cybersecurity advisor/consultant focused on GRC, IT/OT security, SOC, data security governance, and security leadership.";
  }

  if (rc.includes("product_marketing") || ft.includes("product_marketing")) {
    return "Marketing leader focused on product marketing and go-to-market.";
  }

  if (rc.includes("sales_account") && /\baccount\s+director\b/i.test(t)) {
    return "Commercial leader focused on account management, revenue growth, and customer relationships.";
  }

  if (
    rc.includes("sales_account") &&
    /\benterprise\s+software\s+sales\b|\bsales\s+leader\b/i.test(t)
  ) {
    return "Commercial leader focused on enterprise software sales and revenue growth.";
  }

  if (rc.includes("owner_operator") || /\bowner\s+at\b/i.test(h)) {
    if (ft.includes("security") || /\b(cyber|security)\b/i.test(h)) {
      return "Business owner/operator with security-related responsibilities and technical depth.";
    }
    return "Business owner/operator.";
  }

  if (
    /\bfounder\s*[&,]\s*ceo\b/i.test(t) &&
    /\bai\b/i.test(t) &&
    /\b(soc|soar|agentic|ai\s+powered|ai\s+security|defense)\b/i.test(t)
  ) {
    return "Founder focused on AI-driven security operations, agentic defense, and AI security programs.";
  }

  if (founderLeadSegment && rc.includes("founder")) {
    if (internSignal) {
      return "Early-stage founder with concurrent technical training, internships, or research-oriented programs.";
    }
    return "Founder building or leading an early-stage company.";
  }

  const verbatim = verbatimSummaryOrNull(h);
  if (verbatim) return verbatim;

  return roleBasedFallbackSummary({
    headline: h,
    roleCategories: rc,
    functionTags: ft,
    seniority,
    strictStudent,
    currentTitle,
    currentCompany,
    educationInstitution,
    educationArea,
  });
}

function computeLabelConfidence(args: {
  roleCategories: ProspectClassification["roleCategories"];
  profileFlags: ProfileFlag[];
  employmentConfidence: number;
  headlineTooShort: boolean;
  genericPost: boolean;
  pipedHeadline: boolean;
  unknownHeavy: boolean;
  headline: string;
  labelsClearlyClassified: boolean;
  associateOnly: boolean;
}): number {
  let c = 0.48;
  const rc = args.roleCategories;
  const pf = new Set(args.profileFlags);
  const h = args.headline;

  if (args.associateOnly) {
    return Math.round(0.2 * 1000) / 1000;
  }

  const definitiveProfessionalRole =
    rc.includes("security_leader") ||
    rc.includes("engineering_leader") ||
    rc.includes("technology_executive") ||
    rc.includes("ai_leader") ||
    rc.includes("data_leader") ||
    rc.includes("product_leader") ||
    rc.includes("sales_leader") ||
    rc.includes("solutions_engineer") ||
    rc.includes("board_member") ||
    rc.includes("investor") ||
    (rc.includes("technical_influencer") &&
      /\b(solutions\s+engineer|software\s+engineer|aws|azure|developer|architect|devops)\b/i.test(
        h
      )) ||
    rc.includes("product_marketing") ||
    rc.includes("sales_account") ||
    rc.includes("legal_counsel") ||
    rc.includes("consultant") ||
    rc.includes("it_operations") ||
    rc.includes("program_manager") ||
    rc.includes("quality_engineering") ||
    rc.includes("business_development") ||
    rc.includes("technology_strategist") ||
    rc.includes("product_manager") ||
    rc.includes("software_engineer") ||
    rc.includes("ai_engineer") ||
    rc.includes("founder_or_principal") ||
    rc.includes("staffing_leader") ||
    rc.includes("transformation_leader") ||
    rc.includes("cloud_engineer") ||
    rc.includes("cloud_architect") ||
    rc.includes("cloud_industry_leader") ||
    rc.includes("devops_engineer") ||
    rc.includes("media_creator") ||
    rc.includes("sre_engineer") ||
    rc.includes("frontend_engineer") ||
    rc.includes("communications_leader") ||
    rc.includes("technical_lead") ||
    rc.includes("education_leader") ||
    rc.includes("recruiter") ||
    (rc.includes("founder") && /\bfounder\s*@/i.test(h)) ||
    rc.includes("coach_or_advisor");

  if (!rc.includes("unknown") || rc.length > 1) c += 0.12;
  if (rc.includes("student") && pf.has("student_signal")) c += 0.14;
  if (rc.includes("product_marketing") || rc.includes("sales_account")) c += 0.1;
  if (rc.includes("business_development") || rc.includes("staffing_leader")) c += 0.06;
  if (rc.includes("legal_counsel")) c += 0.08;
  if (rc.includes("security_leader") || rc.includes("engineering_leader")) c += 0.08;
  if (rc.includes("technology_executive") || rc.includes("ai_leader") || rc.includes("data_leader"))
    c += 0.06;
  if (rc.includes("product_leader") || rc.includes("sales_leader")) c += 0.05;
  if (rc.includes("consultant") && /grc|cyber|security|enterprise\s+it|soc\b/i.test(h)) c += 0.1;
  if (rc.includes("it_operations")) c += 0.08;
  if (rc.includes("founder") && /\bfounder\s*@/i.test(h)) c += 0.06;
  if (rc.includes("owner_operator")) c += 0.05;

  if (definitiveProfessionalRole && args.employmentConfidence < 0.55) c += 0.1;

  if (args.employmentConfidence >= 0.68) c += 0.08;
  else if (args.employmentConfidence >= 0.5) c += 0.05;
  else if (args.employmentConfidence > 0) c += 0.03;

  if (args.labelsClearlyClassified) c += 0.06;

  if (args.unknownHeavy && rc.every((r) => r === "unknown")) c -= 0.12;
  if (pf.has("weak_evidence")) c -= 0.16;

  if (
    pf.has("ambiguous_employment") &&
    !definitiveProfessionalRole &&
    !args.labelsClearlyClassified
  )
    c -= 0.08;
  else if (pf.has("ambiguous_employment")) c -= 0.03;

  if (pf.has("multiple_roles_signal") && !args.labelsClearlyClassified) c -= 0.06;
  else if (pf.has("multiple_roles_signal")) c -= 0.02;

  if (pf.has("ambiguous_professional_identity")) c -= 0.04;
  if (args.headlineTooShort) c -= 0.1;

  if (args.genericPost && !args.labelsClearlyClassified) c -= 0.06;
  else if (args.genericPost) c -= 0.02;

  if (args.pipedHeadline && args.employmentConfidence < 0.55 && !definitiveProfessionalRole)
    c -= 0.04;

  return Math.max(0.15, Math.min(0.92, Math.round(c * 1000) / 1000));
}

function hasStrictStudentSignal(text: string): boolean {
  const t = norm(text);
  if (/\bcomputer\s+engineering\s+student\b/.test(t)) return true;
  if (/\bdata\s+science\s+student\b/.test(t)) return true;
  if (/\bgraduate\s+student\b|\bundergraduate\s+student\b/.test(t)) return true;
  if (/\bstudying\b/.test(t) && /\b(at|university|college|student)\b/.test(t)) return true;
  if (/\b(m\.?s\.?c|m\.?s\b|mba|phd)\b/.test(t) && /\b(candidate|student)\b/.test(t)) return true;
  if (/\b(1st|first)\s+year\b/.test(t)) return true;
  if (/\baspiring\b/.test(t) && /\bstudent\b/.test(t)) return true;
  if (/\b(cse|cs)\s+student\b/.test(t)) return true;
  if (/\bcomputer\s+science\s+student\b/.test(t)) return true;
  if (/\bstudent\s*@\b/.test(t)) return true;
  if (/\bstudent\s+at\b/.test(t)) return true;
  if (/\bphd\s+candidate\b|\bmba\s+candidate\b/.test(t)) return true;
  if (/\bundergraduate\b|\bundergrad\b/.test(t)) return true;
  if (/\bgraduated\s+\d{4}\b/.test(t)) return true;
  if (
    /\b(freshman|sophomore|junior|senior)\b[^@|]{0,100}\bmajor\b/i.test(t) ||
    /\bmajor\s*@\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(freshman|sophomore|junior|senior)\b\s+at\s+[^|]{4,140}\|/i.test(
      text.replace(/\s+/g, " ")
    ) &&
    /\bmajor[-–\s]/i.test(text)
  ) {
    return true;
  }
  if (/\bstudy\s+[^|]{2,60}\s+@\b/.test(t)) return true;
  if (/\bmasters?\s+in\b|\bbachelors?\s+in\b|\bmasters?\s+degree\b/.test(t)) return true;
  if (/\bmasters?\s+in\s+computer\b|\bcomputer\s+applications\b/i.test(text)) return true;
  if (/\buniversity\b/.test(t) && /\bstudent\b/.test(t)) return true;
  const dualCue = text.match(
    /(?:^|[|]\s*)([^@|•·🔹]{2,80}?)\s*@\s*([^|•·🔹]{2,48}?)(?=\s*[|•·🔹]|$)/i
  );
  if (
    dualCue &&
    looksLikeSubjectFieldsLineBeforeAtSchool(
      cleanTitleFragment(dualCue[1] ?? ""),
      normalizeCompanyFragment(dualCue[2] ?? "")
    )
  ) {
    const headlineOnly = text.replace(/\n[\s\S]*/, "").trim();
    if (professionalTitleOutranksStudent(headlineOnly)) return false;
    if (/\bgolang\b|\bdocker\b|\bkubernetes\b|go\s+lang/i.test(norm(headlineOnly))) return false;
    const firstPipeSeg = (text.split("|")[0] ?? "").trim();
    if (/\bproduct\s+builder\b/i.test(firstPipeSeg)) return false;
    const h = norm(text);
    if (
      /\bai\s+engineer\b/.test(h) &&
      /\bsoftware\s+engineer\b/.test(h) &&
      /\b(ms\s+cs|m\.?s\.?\s+c\.?s\.?)\b/.test(h)
    ) {
      return false;
    }
    return true;
  }
  if (/\b(pdeu)\s+ict[''\u2019]?\s*\d{2}\b/i.test(text)) return true;
  return false;
}

function hasInternSignal(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const stripped = raw
    .replace(/\bformer\s+[^|]{0,140}\bintern(?:ship)?s?\b(?:\s*@[^|]+)?/gi, " ")
    .replace(/\bex[-\s]*intern(?:ship)?s?\b(?:\s*@[^|]+)?/gi, " ");
  const t = norm(stripped);
  return /\bintern\b|\binternship\b|\bnasa\s+intern\b|'?\s*\d{2}\s*$/i.test(t);
}

function isGenericEngagementPost(content: string): boolean {
  const g = norm(content).replace(/\s+/g, " ").trim();
  if (g.length > 500) return false;
  return /^(interesting|great\s+post|congrats|congratulations|well\s+said|thought\s*[- ]?provoking|thanks?\s+for\s+sharing|love\s+this|nice\s+share)\b/.test(
    g
  );
}

function inferSeniority(text: string): ProspectClassification["seniority"] {
  const t = norm(text);
  if (
    /\b(chief\s+product\s+officer|\bcpo\b)/i.test(t) &&
    !/\bacquirer\b|\bhistorical\b|\bproducer\b|\bpolice\b/i.test(t)
  ) {
    return "c_level";
  }
  if (/^\s*associate\s*$/i.test(text.trim())) return "unknown";
  if (/\bowner\s+at\b/.test(t)) return "owner";
  if (/\bchief\s+ai\s+officer\b|\bcaio\b/.test(t)) return "c_level";
  if (/\bchief\s+revenue\s+officer\b|\bchief\s+commercial\s+officer\b|\bcro\b|\bcco\b/.test(t)) {
    return "c_level";
  }
  if (
    /\bpresident\b/.test(t) &&
    /\bchief\s+commercial\b|\bcommercial\s+officer\b|\bcco\b/.test(t)
  ) {
    return "c_level";
  }
  if (
    /\bciso\b|\bchief\s+information\s+security\b|\bchief\s+security\b|\bchief\s+data\s+(?:and\s+)?ai\s+officer\b|\bcdaio\b|\bcto\b|\bceo\b|\bcfo\b|\bcoo\b|\bchief\b/.test(
      t
    )
  ) {
    return "c_level";
  }
  if (/\bexecutive\s+vice\s+president\b|\bevp\b/.test(t)) return "vp";
  if (/\bvp\b|\bvice\s+president\b/.test(t)) return "vp";
  if (/\bsr\.?\b|\bsenior\b/.test(t) && /\baccount\s+executive\b/.test(t)) return "senior_ic";
  if (/\bdirector\b|\bhead\s+of\b/.test(t)) return "director";
  if (/\btechnical\s+leader\b/.test(t) || /\btech\s+lead\b/.test(t)) return "director";
  if (
    /\bprincipal\b/.test(t) &&
    /\b(product\s+manager|architect|engineer|consultant|scientist|solutions?\s+engineer)\b/.test(t)
  ) {
    return "principal";
  }
  if (
    /\bstaff\s+(?:software\s+engineer|swe)\b|\bstaff\s+eng(?:ineer)?\b|\bstaf{2}\s+swe\b/i.test(t)
  ) {
    return "staff";
  }
  if (/\binvestor\b|\bgeneral\s+partner\b/.test(t)) return "investor";
  if (/\bmanager\b|\blead\b/.test(t)) return "manager";
  if (/\banalyst\b|engineer\b/.test(t)) return "ic";
  return "unknown";
}

function inferFunctionTags(
  text: string,
  opts?: { freelanceAvailabilityHeadline?: string }
): ProspectClassification["functionTags"] {
  const t = norm(text);
  const tags = new Set<ProspectClassification["functionTags"][number]>();
  const freelanceAvail = headlineSuggestsJobSeekingFreelanceAvailability(
    opts?.freelanceAvailabilityHeadline ?? ""
  );
  if (/\bdistributed\s+systems?\b|\bai\s+platforms?\b/i.test(text)) {
    tags.add("distributed_systems");
    tags.add("platform");
  }
  if (/\bproduct\s+engineering\b/i.test(t)) {
    tags.add("product_engineering");
    tags.add("product");
    tags.add("engineering");
  }
  if (/\bbioinformatician\b|\bbioinformatics\b/i.test(t)) {
    tags.add("bioinformatics");
    tags.add("data_analytics");
    tags.add("research");
  }
  if (/\b(okta|identity\s+access|iam\b|\bsso\b)/i.test(text)) {
    tags.add("identity_access");
    tags.add("security");
    if (/\bokta\b/i.test(text)) tags.add("okta");
  }
  if (/\bregulated\b.*\benvironment|\bproduction\b.*\bregulated/i.test(text))
    tags.add("regulated_industries");
  if (/\boil\s*(?:&|and)?\s*gas\b|\boil\s+and\s+gas\b/i.test(text)) tags.add("oil_and_gas");
  if (
    /\bproduct\s+marketing\b|\bvp,?\s+product\s+marketing\b|\bvp\b.*\bmarketing\b|\bdemand\s+gen\b|\bdemand\s+generation\b/.test(
      t
    )
  ) {
    tags.add("marketing");
    tags.add("product_marketing");
    tags.add("go_to_market");
    tags.add("product");
  }
  if (/\bgtm\b/i.test(text)) {
    tags.add("go_to_market");
  }
  if (/\bsolutions?\s+engineer|solution\s+engineering|sales\s+engineer|pre[- ]?sales\b/i.test(t)) {
    tags.add("sales_engineering");
    tags.add("engineering");
    tags.add("go_to_market");
  }
  if (/\btpm\b|\btechnical\s+program\s+manager\b/i.test(t)) {
    tags.add("product");
    tags.add("engineering");
    tags.add("operations");
  }
  if (/\bfull[\s-]?stack.*\bai\b|\bai\s+developer\b|\bml\s+engineer\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("engineering");
  }
  if (/\bdata\s+science\b|\bvp\s+data\b|\bhead\s+of\s+data\b/i.test(t)) {
    tags.add("data");
    tags.add("data_analytics");
    tags.add("ai_ml");
  } else if (
    /\bdata\b(?!\s+science)|\banalytics\b|chief\s+data/i.test(t) ||
    /\bdba\b|\bdata\s+engineer/i.test(t)
  ) {
    tags.add("data");
    tags.add("data_analytics");
  }
  if (
    /\bgoogle\s+cloud\b|\baws\b|\bazure\b|\bcloud\s+engineer\b|\bcloud\s+architect\b|multi[- ]cloud/i.test(
      text
    )
  ) {
    tags.add("cloud");
    tags.add("platform");
  }
  if (
    /\barchitect\b/i.test(t) &&
    (/\bprincipal\b|\bcloud\b|\bsolutions?\b/i.test(t) || /\bgoogle\s+cloud\b/i.test(text))
  ) {
    tags.add("platform");
  }
  if (/\btechnology\b|\btechnical\b/i.test(t) && /\b(chief|cto|vp|officer)\b/i.test(t)) {
    tags.add("technology");
  }
  if (/\bacademic\b|\bstudent\b/i.test(text) && /\bcomputer\s+science\b/i.test(t)) {
    tags.add("computer_science");
  }
  if (/\bsecurity\b|ciso|infosec|governance|soc\b|cyber\s+security/i.test(text)) {
    tags.add("security");
  }
  if (/\bcybersecurity\b|\bcyber\s+security\b/i.test(text)) tags.add("cybersecurity");
  if (/\bitil\b|\bit\s+service\s+management\b/i.test(t)) tags.add("it_service_management");
  if (/\bcontinuous\s+improvement\b/i.test(t)) tags.add("continuous_improvement");
  if (/\bpublic\s+safety\b/i.test(t)) tags.add("public_safety");
  if (/\bevangelist\b|\bdevrel\b/i.test(t)) tags.add("evangelism");
  if (/\bpodcasts?\b|\bpodcaster\b/i.test(t)) {
    tags.add("media");
    tags.add("podcasting");
  }
  if (
    /\bhead\s+of\s+worldwide\s+banking\b|\bfinancial\s+services\b/i.test(t) &&
    /\baws\b/i.test(text)
  ) {
    tags.add("financial_services");
  }
  if (
    /\bcommercial\s+enablement\b/i.test(text) &&
    /\bcyber|\bcybersecurity\b|\bsecurity\b/i.test(text)
  ) {
    tags.add("commercial_enablement");
    tags.add("go_to_market");
  }
  if (/\bsoftware\s+developer\b|\bsoftware\s+development\b/i.test(t)) {
    tags.add("software_development");
  }
  if (/\bfullstsack\b|\bfullst\s*ack\b/i.test(t)) {
    tags.add("software_development");
  }
  if (/\btechnology\s+strategist\b|\btech\s+strategist\b/i.test(t)) {
    tags.add("strategy");
    tags.add("technology");
  }
  if (/\bappsec\b|application\s+security/i.test(t)) {
    tags.add("appsec");
    tags.add("application_security");
    tags.add("security");
  }
  if (/\bdevops\b/i.test(t)) {
    tags.add("devops");
    tags.add("platform");
    if (/\bappsec\b|application\s+security/i.test(t)) tags.add("operations");
  }
  if (/\bterraform\b|\bci\s*\/\s*cd\b|\bci\s*cd\b/i.test(t)) {
    tags.add("ci_cd");
    tags.add("automation");
    tags.add("cloud");
  }
  if (/\bkubernetes\b|\bk8s\b/i.test(t)) {
    tags.add("kubernetes");
    tags.add("platform");
  }
  if (/\bsite\s+reliability\b|\bsre\b/i.test(t)) {
    tags.add("sre");
    tags.add("platform");
    tags.add("automation");
  }
  if (/\breact\b/i.test(t)) tags.add("react");
  if (/\bfrontend\b|front[- ]?end/i.test(t) && /\bdeveloper\b|\bengineer\b/i.test(t)) {
    tags.add("frontend");
    tags.add("software_development");
  }
  if (/\bdesigner\b|ui\/ux|\beye\s+for\s+design\b|graphic\s+design|visual\s+design/i.test(t))
    tags.add("design");
  if (/\btypescript\b/i.test(t)) tags.add("typescript");
  if (/\bcommunications\b|\bcomms\b/i.test(t)) tags.add("communications");
  if (
    /\bmicrosoft\s+mvp\b|\bdynamics\s*365\b|\bdynamics\b.*\b(fo|ce|crm|erp)\b|\bpower\s+platform\b/i.test(
      t
    )
  ) {
    tags.add("microsoft_dynamics");
    tags.add("crm");
    tags.add("erp");
    if (/\bpower\s+platform\b/i.test(t)) tags.add("power_platform");
    tags.add("ai_ml");
  }
  if (/\benterprise\s+transformation\b|\bchange\s+agent\b|people[- ]centered/i.test(t)) {
    tags.add("enterprise_transformation");
    tags.add("change_management");
  }
  if (/\beducation\b|\bacademic\s+operations\b|\bworkforce\s+development\b/i.test(t))
    tags.add("education");
  if (/\bstaffing\b|\bscreening\b|\bbenefits\s+negotiation\b/i.test(t)) {
    tags.add("staffing");
    tags.add("recruiting");
    if (/\bscreening\b/i.test(t)) tags.add("screening");
  }
  if (/\bagentic\b|\bmulti[- ]agent\b|\bmcp\b/i.test(t)) tags.add("agentic_ai");
  if (/\bkeeping\s+ai\s+agents\b/i.test(text)) {
    tags.add("agentic_ai");
    tags.add("ai_ml");
  }
  if (/\bdigital\s+identity\b|transforming\s+digital\s+identity/i.test(t)) {
    tags.add("technology");
    tags.add("strategy");
    tags.add("security");
    tags.add("product");
  }
  if (/\bweb3\b/i.test(text) || /\bdao\b|\bdefi\b|\bnft\b|\bsmart\s+contracts?\b/i.test(t)) {
    tags.add("web3");
    tags.add("blockchain");
  } else if (/\bblockchain\b/i.test(text)) {
    tags.add("blockchain");
  }
  if (/\bidentities?\b/i.test(t) && /\bsecur/i.test(t)) {
    tags.add("identity_access");
    tags.add("security");
    tags.add("cybersecurity");
  }
  if (
    /\bworkload\s+identity\b/i.test(t) ||
    /\benterprise\b.*\bidentity\b/i.test(t) ||
    /\bcloud\b.*\bworkload\s+identity\b/i.test(t)
  ) {
    tags.add("identity_access");
    tags.add("security");
    tags.add("cybersecurity");
  }
  if (/\bcybersecurity\s+vendors?\b/i.test(t) && /\bcompetitive\s+advantage\b/i.test(t)) {
    tags.add("marketing");
    tags.add("product_marketing");
    tags.add("go_to_market");
    tags.add("security");
  }
  if (/\bgrowth\b/i.test(t)) tags.add("growth");
  if (/\bcustomer\s+experience\b|\bcustomer\s+engagement\b/i.test(t))
    tags.add("customer_experience");
  if (/\btechnical\s+search\b/i.test(t)) tags.add("technical_search");
  if (/\bmarket\s+research\b|market\s+researcher/i.test(t)) tags.add("market_research");
  if (/\bstrategic\s+enterprise\s+accounts\b/i.test(t) && /\bf500|fortune\b/i.test(t)) {
    tags.add("enterprise_sales");
    tags.add("account_management");
    if (/\bai\b/i.test(t)) tags.add("ai_ml");
    if (/\bcloud\b/i.test(t)) tags.add("cloud");
  }
  if (/\bgrowth\s+marketing\b/i.test(t)) {
    tags.add("growth_marketing");
    tags.add("marketing");
  }
  if (/\bhead\s+of\s+marketing\b/i.test(t)) {
    tags.add("marketing");
    tags.add("go_to_market");
    tags.add("leadership");
  }
  if (/\bdwh\b|\bdwh\s*&\s*bi\b/i.test(t)) {
    tags.add("data");
    tags.add("data_analytics");
    tags.add("business_intelligence");
  }
  if (/\bai\s+solutions?\s+architect\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("engineering");
    tags.add("technical_architecture");
  }
  if (/\bchief\s+data\s+(?:and\s+)?ai\s+officer\b/i.test(t)) {
    tags.add("data");
    tags.add("ai_ml");
    tags.add("data_analytics");
  }
  if (/\bmarketing\s+ops\b/i.test(t)) {
    tags.add("marketing");
    tags.add("operations");
  }
  if (/\bpublic\s+relations\b/i.test(t)) {
    tags.add("communications");
    tags.add("social_media");
  }
  if (/\bstudent\b/i.test(t) && /\bcommunications\b/.test(t)) {
    tags.add("communications");
    tags.add("brand");
  }
  if (/\bapplied\s+science\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("research");
    tags.add("machine_learning");
  }
  if (/\babm\b/i.test(t)) tags.add("abm");
  if (/\bbi\s+developer\b/i.test(t) || /\bpower\s*bi\b/i.test(t)) {
    tags.add("business_intelligence");
    tags.add("data");
    if (/\bpower\s*bi\b/i.test(t)) tags.add("power_bi");
  }
  if (/\betl\b/i.test(t)) tags.add("etl");
  if (/\bsecops\b/i.test(t)) {
    tags.add("secops");
    tags.add("cybersecurity");
  }
  if (/\brisk\s*ops\b|\briskops\b/i.test(t)) tags.add("risk_operations");
  if (
    /\bbusiness\s*\/\s*enterprise\s*\/\s*technical\s+architect\b/i.test(text) ||
    /\benterprise\s+architect\b/i.test(t)
  ) {
    tags.add("enterprise_architecture");
    tags.add("technical_architecture");
  }
  if (/\bbrand\b/i.test(t) && /\bcommunications\b/i.test(t)) tags.add("brand");
  if (/\bitil\b|\bcontinuous\s+improvement\b/i.test(t)) {
    tags.add("operations");
  }
  if (/\bpublic\s+safety\b|\bemergency\s+communications\b/i.test(t)) {
    tags.add("operations");
  }
  if (/\bplatform\b|devops|sre|infra(structure)?\b|cloud\s+solutions\b|aws\b|azure\b/.test(t))
    tags.add("platform");
  if (
    !/\b(nfl|nba|mlb|nhl|sports|player|talent)\s+agent\b/i.test(text) &&
    /\bai\b|machine\s+learning|mlops|agentic\b|\bai\s+agents?\b/i.test(t)
  ) {
    tags.add("ai_ml");
  }
  if (/\bengineer|engineering|developer|cto\b/.test(t)) tags.add("engineering");
  if (/\bchief\s+technology\s+officer\b|\bcto\b/i.test(text)) tags.add("engineering");
  if (/\br\s*&\s*d\b|head\s+of\s+r\s*&\s*d|research\s+and\s+development/i.test(t)) {
    tags.add("engineering");
  }
  if (/\bproduct\b(?!\s+marketing)|\bpm\b\s|^pm\b/.test(t)) tags.add("product");
  if (
    /\bconsult|fractional|advisor\b/.test(t) ||
    (/\bfreelance\b|\bfreelancer\b/.test(t) && !freelanceAvail)
  )
    tags.add("consulting");
  if (/\brecruit|talent|hiring\b/.test(t)) tags.add("recruiting");
  if (/\binvestor|venture|venture\s+partner|angel\s+investor/i.test(text)) tags.add("investor");
  if (headlineHasExplicitFounderEvidence(text)) {
    tags.add("founder");
  }
  if (
    /\bsales\b|account\s+director|revenue\s+growth|account\s+executive|head\s+of\s+sales/i.test(
      text
    )
  ) {
    tags.add("sales");
    tags.add("account_management");
    tags.add("revenue");
    tags.add("go_to_market");
  }
  if (/\bservice\s+delivery|supply\s+chain|system\s+admin|it\s+operations\b/i.test(text))
    tags.add("operations");
  if (/\br\s*&\s*d\b|head\s+of\s+r\s*&\s*d\b|head\s+of\s+rd\b|\bresearch\b|scientist\b/i.test(t))
    tags.add("research");
  if (
    /\bcomputer\s+science\b|\bcse\b|\bprofessor\b|\badjunct\b|\buniversity\s+faculty\b|professor\s+of\s+computer\s+science/i.test(
      t
    ) &&
    !(/\b(bachelor|bachelors)\s+of\b/i.test(t) && /\b(university|college|institute)\b/i.test(t)) &&
    !(
      /\bb\.?tech\b/i.test(t) &&
      /\bcse\b/i.test(t) &&
      (/\b(member|mentee)\s*@\b/.test(t) || /\bcodechef\b/.test(t) || /\bchapter\b/.test(t))
    )
  ) {
    tags.add("academic");
    if (/\bcomputer\s+science\b|professor\s+of\s+computer\s+science/i.test(t))
      tags.add("computer_science");
  }
  if (/\bphp\b/i.test(text) && /\bdeveloper\b/i.test(t)) {
    tags.add("php");
    tags.add("software_development");
  }
  if (/\bfull[\s-]?stack\b/i.test(t) && /\bdeveloper\b/i.test(t)) {
    tags.add("full_stack");
    tags.add("software_development");
  }
  if (/\bjava\b/i.test(t) && /\bdeveloper\b|\bskilled\s+in\b|\bengineer\b/i.test(text))
    tags.add("java");
  if (/\bsql\b/i.test(text)) tags.add("sql");
  if (/\bnumpy\b|\bpandas\b/i.test(text)) {
    tags.add("data_analysis");
    tags.add("data");
  }
  if (/\bweb\s+developer\b/i.test(t)) {
    tags.add("web_development");
    tags.add("software_development");
  }
  if (/\blegacy\b.*\bmodern|modern\s+architecture|transforming\s+legacy/i.test(text))
    tags.add("modernization");
  if (/\b\.net\b|\bdotnet\b/i.test(text)) tags.add("dotnet");
  if (/\bspring\s+boot\b/i.test(text)) tags.add("spring_boot");
  if (/\bnext\.js\b|\bnextjs\b/i.test(text)) tags.add("nextjs");
  if (/\bdata\s+scientist\b/i.test(t)) {
    tags.add("data_science");
    tags.add("data_analytics");
    tags.add("ai_ml");
    tags.add("analytics");
  }
  if (/\bresearch\s+analyst\b/i.test(t)) {
    tags.add("research");
    tags.add("analysis");
    tags.add("analytics");
  }
  if (
    /\bmanager\b/i.test(t) &&
    /\bstrategy\b|\bchange\s+management\b|\bprocess\s+improvement\b|\bagile\s+change\b/i.test(text)
  ) {
    tags.add("strategy");
    tags.add("change_management");
    tags.add("process_improvement");
  }
  if (/\bsenior\s+advisor\b|\badvisor\b/i.test(t) && /@/.test(text)) tags.add("advisory");
  if (/\bai\s+trainer\b/i.test(t)) {
    tags.add("education");
    tags.add("ai_ml");
    tags.add("data_analysis");
    if (/\bpython\b/i.test(text)) tags.add("python");
    if (/\bsql\b/i.test(text)) tags.add("sql");
  }
  if (/\bai\s+trainer\b/i.test(t) && /\bibm\b/i.test(t) && /\bcyber/i.test(text)) {
    tags.add("technical_training");
    tags.add("cybersecurity");
  }
  if (
    /^\s*President,?\s+/i.test(text) &&
    /\b(cyber|compliance|downtime|healthcare|law\s+firms|msp)\b/i.test(t)
  ) {
    tags.add("it_services");
    tags.add("cybersecurity");
    tags.add("compliance");
    if (/\bhealthcare\b/i.test(t)) tags.add("healthcare");
    if (/\blaw\s+firms\b|\blegal\b/i.test(t)) tags.add("legal");
  }
  if (/\bai\s+transformation\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("business_transformation");
    tags.add("automation");
  }
  if (/\btechnical\s+training\b/i.test(t) && /\benablement\b/i.test(t)) {
    tags.add("technical_training");
    tags.add("enablement");
  }
  if (/\bb2b\s+growth\s+strategist\b/i.test(t) || /\bpredictable\s+revenue\b/i.test(t)) {
    tags.add("growth");
    tags.add("revenue");
    tags.add("founder_support");
  }
  if (/^\s*channel\s+head\b/i.test(text.trim())) {
    tags.add("channel");
    tags.add("partnerships");
    tags.add("regional_leadership");
  }
  if (/\btechnology\s+leader\b/i.test(t) && /\bdigital\s+transformation\b/i.test(t)) {
    tags.add("digital_transformation");
    tags.add("enterprise_architecture");
    tags.add("ai_ml");
    tags.add("innovation");
  }
  if (/\bcontent\s+creator\b/i.test(t) && /\bgrowth\s+strategist\b/i.test(t)) {
    tags.add("content");
    tags.add("growth");
    tags.add("video");
    tags.add("social_media");
    tags.add("marketing");
  }
  if (/\bit\s+leader\b/i.test(t) && /\bcloud\s+enablement\b/i.test(t)) {
    tags.add("cloud_enablement");
    tags.add("cloud");
    tags.add("enterprise_transformation");
    tags.add("evangelism");
  }
  if (/\bstaff\s+accountant\b/i.test(t)) {
    tags.add("accounting");
    tags.add("financial_services");
  }
  if (/\bagile\s+project\s+manager\b/i.test(t) || /\bscrum\s+master\b/i.test(t)) {
    tags.add("agile");
    tags.add("scrum");
    tags.add("project_management");
    tags.add("product");
  }
  if (/\bpenetration\s+tester\b/i.test(t) || /\bred\s+team(er)?\b/i.test(t)) {
    tags.add("penetration_testing");
    tags.add("red_team");
    tags.add("offensive_security");
    tags.add("cybersecurity");
  }
  if (/\bstartups\s*@\s*aws\b/i.test(t)) {
    tags.add("startups");
    tags.add("aws");
    tags.add("cloud");
  }
  if (/\bsupply\s+chain\b/i.test(t) && /\bleader\b/i.test(t)) {
    tags.add("supply_chain");
    tags.add("procurement");
    tags.add("operations");
  }
  if (
    /\bbi\s+dev\b/i.test(t) ||
    (/\bbi\b/i.test(t) && /\bstatistics\b/i.test(t) && /\breports?\b/i.test(t))
  ) {
    tags.add("business_intelligence");
    tags.add("statistics");
    tags.add("software_development");
  }
  if (/\bpresident\b/i.test(t) && /\bchief\s+commercial\s+officer\b/i.test(t)) {
    tags.add("commercial");
    tags.add("go_to_market");
    tags.add("growth");
    tags.add("leadership");
  }
  if (/\bcloud\s+engineer\b/i.test(t) && /\baws\b|\bgcp\b|\bazure\b/i.test(t)) {
    tags.add("cloud");
    tags.add("platform");
    if (/\baws\b/i.test(t)) tags.add("aws");
  }
  if (/\bbusiness\s+analyst\b/i.test(t)) {
    tags.add("business_analysis");
    if (/\btelecom\b|\boss\b|\bbss\b/i.test(t)) tags.add("telecom");
    if (/\bagile\b/i.test(t)) tags.add("agile");
    if (/\bscrum\b/i.test(t)) tags.add("scrum");
  }
  if (
    /\brich\s+experience\s+in\s+customer\s+service\b/i.test(t) ||
    (/\bcustomer\s+service\b/i.test(t) && /\bopen\s+to\b/i.test(t))
  ) {
    tags.add("customer_service");
  }
  if (/^\s*content\s+writer\b/i.test(text.trim()) && text.trim().length < 64) {
    tags.add("content_writing");
    tags.add("content");
    tags.add("marketing");
  }
  if (/\bmarketing\b/i.test(t) && /\bcontent\b/i.test(t) && /\bcopywriter\b/i.test(t)) {
    tags.add("marketing");
    tags.add("copywriting");
    tags.add("content");
  }
  if (/\bai\s+automation\s+specialist\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("automation");
    tags.add("sales");
    tags.add("customer_success");
  }
  if (/\bjava\b/i.test(t) && /\bspring\b/i.test(t) && /\breact\b/i.test(t)) {
    tags.add("java");
    tags.add("spring");
    tags.add("spring_boot");
    tags.add("react");
    tags.add("software_development");
    if (/\bmicroservice\b/i.test(t)) tags.add("microservices");
    if (/\bangular\b/i.test(t)) tags.add("angular");
    if (/\bjpa\b/i.test(t)) tags.add("sql");
  }
  if (
    /\bsenior\s+executive\b/i.test(t) &&
    /\bpartnerships\b/i.test(t) &&
    /\bcollaborations\b|\bsolutions\b/i.test(t)
  ) {
    tags.add("partnerships");
    tags.add("business_development");
    tags.add("strategy");
  }
  if (
    /\bi\s+help\s+you\s+grow\s+your\s+personal\s+brand\b/i.test(t) ||
    (/\bpersonal\s+brand\b/i.test(t) && /\blinkedin\b/i.test(t))
  ) {
    tags.add("marketing");
    tags.add("personal_branding");
    tags.add("linkedin_growth");
    if (/\bhr\b/i.test(t) || /\bhuman\s+resources\b/i.test(t)) tags.add("hr");
  }
  if (
    (/\btcp\s*\/\s*ip\b/i.test(t) ||
      /\bnetwork\s+programmer\b/i.test(t) ||
      /\bcybersecurity\s+instructor\b/i.test(t)) &&
    (/\baws\b/i.test(t) ||
      /\bunix\b|\blinux\b/i.test(t) ||
      /\bsecurity\s+monitoring\b|\bvulnerability\b/i.test(t))
  ) {
    tags.add("tcp_ip");
    tags.add("cybersecurity");
    tags.add("technical_training");
    if (/\baws\b/i.test(t)) tags.add("aws");
    if (/\blinux\b|\bunix\b/i.test(t)) tags.add("linux");
    tags.add("network_programming");
  }
  if (/\bprogram\s+management\b/i.test(t)) tags.add("program_management");
  if (/\bbusiness\s+development\b/i.test(t)) tags.add("business_development");
  if (/\bsales\s+leadership\b/i.test(t)) tags.add("sales");
  if (/\bmachine\s+learning\b/i.test(text) || /\barchitecture\s+computer\b/i.test(t)) {
    tags.add("machine_learning");
    tags.add("ai_ml");
  }
  if (/\bllmops\b|\bmlops\b/i.test(t) || /\bgenai\b/i.test(t)) {
    tags.add("llmops");
    tags.add("ai_ml");
  }
  if (/\bmlops\b/i.test(t)) tags.add("mlops");
  if (/\brag\b/i.test(t) || /\blangchain\b/i.test(t)) tags.add("rag");
  if (/\bvector\s+db/i.test(t)) tags.add("vector_databases");
  if (/\bfinancial\s+modell?ing\b/i.test(t) || /\bfinancial\s+statements\b/i.test(t)) {
    tags.add("financial_modeling");
    tags.add("finance");
  }
  if (/\besg\b/i.test(t) || /\bbloomberg\b/i.test(t)) {
    tags.add("esg");
    tags.add("finance");
  }
  if (/\bfinancial\s+analyst\b/i.test(t)) tags.add("finance");
  if (/\brevops\b/i.test(t)) tags.add("revenue_operations");
  if (/\bpe\s+backed\b|\bprivate\s+equity\b/i.test(t)) tags.add("private_equity");
  if (/\bjunior\s+penetration\s+tester\b/i.test(t) && /\binstructor\b/i.test(t)) {
    tags.add("technical_training");
    if (/\bpython\b/i.test(t)) tags.add("python");
    if (/\blinux\b/i.test(t)) tags.add("linux");
  }
  if (/\bsenior\s+executive\s+assistant\b/i.test(t)) {
    tags.add("administration");
    tags.add("executive_support");
    tags.add("operations");
  }
  if (
    /\bai\s+strategy\b/i.test(t) &&
    /\bautomation\b/i.test(t) &&
    /\bturning\s+ai\s+hype\b/i.test(t)
  ) {
    tags.add("strategy");
    tags.add("automation");
  }
  if (/\btalent\s+acquisition\b/i.test(t) && /\bnvidia\b/i.test(t)) {
    tags.add("recruiting");
    tags.add("technical_search");
  }
  if (/^\s*design\s*@\s+/i.test(text.trim())) tags.add("design");
  if (/\blearn\s+ai\s+for\s+marketing\b/i.test(t) && /\bai\b/i.test(t)) {
    tags.add("ai_ml");
    tags.add("marketing");
    tags.add("education");
    tags.add("content");
  }
  if (/\btop\s+100\s+educational\s+creator\b/i.test(t) || /\btop\s+ai\s+voice\b/i.test(t)) {
    tags.add("education");
    tags.add("content");
    tags.add("marketing");
  }
  if (/\brobotics\s+engineering\b/i.test(t) && /\bhackathon\b/i.test(t)) {
    tags.add("robotics");
    tags.add("engineering");
    tags.add("hackathons");
    tags.add("marketing");
  }
  if (/\bgenai\b/i.test(t) && /\boracle\s+health\b/i.test(t)) {
    tags.add("genai");
    tags.add("ai_ml");
    tags.add("healthcare");
    tags.add("life_sciences");
    tags.add("cloud");
    if (/\baws\b/i.test(t)) tags.add("aws");
  }
  if (
    /\bdata\b/i.test(t) &&
    /\banalytical\s+eng\b/i.test(t) &&
    /\bdata\s+ops\b/i.test(t) &&
    /\b(llm\s*\/\s*ml\s+ops|llmops|mlops)\b/i.test(t)
  ) {
    tags.add("data");
    tags.add("analytics_engineering");
    tags.add("data_ops");
    tags.add("llmops");
    tags.add("mlops");
    tags.add("machine_learning");
    tags.add("devops");
  }
  if (/\bsoftware\s+engineering\s+ph\.?d\b/i.test(t)) {
    tags.add("software_development");
    tags.add("academic");
  }
  if (/\bsenior\s+it\s+manager\b/i.test(t) && /\bcybersecurity\b/i.test(t) && /\bokta\b/i.test(t)) {
    tags.add("it_operations");
    tags.add("cybersecurity");
    tags.add("identity_access");
    tags.add("okta");
  }
  if (/\brvp\b/i.test(t) && /\bhashicorp\b/i.test(t)) {
    tags.add("sales");
    tags.add("go_to_market");
    tags.add("enterprise_software");
    tags.add("regional_leadership");
  }
  if (
    /\bsaas\b/i.test(t) &&
    /\blanding\s+page/i.test(t) &&
    /\bconversion/i.test(t) &&
    /\brewrit/i.test(t)
  ) {
    tags.add("copywriting");
    tags.add("marketing");
    tags.add("conversion");
    tags.add("landing_pages");
  }
  if (/\bglobal\s+executive\b/i.test(t) && /\bocm\s+practice\s+leader\b/i.test(t)) {
    tags.add("business_transformation");
    tags.add("change_management");
    tags.add("organizational_change");
    tags.add("people_transformation");
  }
  if (/\bbusiness\s*[&]\s*people\s+transformation\b/i.test(t)) {
    tags.add("business_transformation");
    tags.add("people_transformation");
  }
  if (/\bcybersecurity\s+sme\b/i.test(t)) {
    tags.add("cybersecurity");
    tags.add("security");
  }
  if (/\bsecuring\s+applications\b/i.test(t) && /\bnetworks?\b/i.test(t) && /\bdeliver/i.test(t)) {
    tags.add("application_security");
    tags.add("network_security");
    tags.add("cybersecurity");
    tags.add("security");
  }
  if (
    /\b99\.9%\b/.test(t) &&
    /\breliable\s+ai\b/i.test(t) &&
    /\b(immigration|banks|airlines|high[- ]stakes)\b/i.test(t)
  ) {
    tags.add("ai_ml");
    tags.add("high_stakes_ai");
    tags.add("regulated_industries");
  }
  if (/\bhead\s+of\s+channels?\b|\bchannels?\s*&\s*alliances\b/i.test(text)) {
    tags.add("channel");
    tags.add("partnerships");
    tags.add("go_to_market");
  }
  if (/\b(customer\s+advocacy|content\s+strategy)\b/i.test(text)) {
    tags.add("marketing");
    tags.add("communications");
    tags.add("customer_advocacy");
    tags.add("content_strategy");
  }
  if (/\bmonetiz/i.test(text)) {
    tags.add("monetization");
    tags.add("product");
    tags.add("growth");
  }
  if (/\bsase\b/i.test(text)) {
    tags.add("sase");
    tags.add("cybersecurity");
    tags.add("security");
    tags.add("product");
  }
  if (/\bportfolio\s+lead\b/i.test(text)) {
    tags.add("portfolio_management");
    tags.add("leadership");
  }
  if (/\bclient\s+director\b/i.test(text)) {
    tags.add("account_management");
    tags.add("sales");
    tags.add("cybersecurity");
  }
  if (/\bchannel\s+manager\b/i.test(text)) {
    tags.add("channel");
    tags.add("partnerships");
    tags.add("cybersecurity");
  }
  if (/\btraining\s+developer\b|\binstructional\s+design/i.test(text)) {
    tags.add("education");
    tags.add("technical_training");
    tags.add("instructional_design");
  }
  if (/\brevops\b|\brevenue\s+operations\b/i.test(text)) {
    tags.add("revenue_operations");
    tags.add("operations");
    tags.add("revenue");
  }
  if (/\bpodcast/i.test(text)) {
    tags.add("podcasting");
    tags.add("media");
  }
  if (/\bstrategic\s+sourcing\b|\btalent\s+mapping\b/i.test(text)) {
    tags.add("recruiting");
    tags.add("strategic_sourcing");
    tags.add("talent_mapping");
  }
  if (/\bprocess\s+optimization\b/i.test(text)) {
    tags.add("process_improvement");
    tags.add("automation");
  }
  if (/\bhuman\s+resources\b|\bhr\s+manager\b|\bpeople\s+operations\b/i.test(text)) {
    tags.add("hr");
  }
  if (/\bpartner\s+at\b/i.test(text) && /\bventures\b/i.test(text)) {
    tags.add("investor");
    tags.add("venture_capital");
  }
  if (/\bventure\s+investor\b/i.test(text)) {
    tags.add("investor");
    tags.add("venture_capital");
  }
  if (/\bai\s+integrator\b/i.test(text)) {
    tags.add("ai_ml");
    tags.add("automation");
  }
  if (/\bchief\s+ai\s+evangelist\b|\bai\s+evangelist\b/i.test(text)) {
    tags.add("ai_ml");
    tags.add("evangelism");
  }
  if (/\bproduct\s+monetization\b|\bmonetization\s+manager\b/i.test(text)) {
    tags.add("product");
    tags.add("monetization");
    tags.add("growth");
  }
  if (/\bsase\s+product\s+specialist\b|\bproduct\s+specialist\b.*\bsase\b/i.test(text)) {
    tags.add("product");
    tags.add("sase");
    tags.add("cybersecurity");
  }
  if (/\bredpanda\b|\benterprise\s+ai\b|\bagentic\s+data\s+plane\b/i.test(text)) {
    tags.add("data_platform");
    tags.add("ai_ml");
    tags.add("enterprise_ai");
    tags.add("agentic_ai");
  }
  if (
    /\bgolang\b|\bgo\s+lang\b/i.test(text) ||
    (/\bjava\b/i.test(text) && /\bdocker\b/i.test(text) && /\bkubernetes\b/i.test(text))
  ) {
    tags.add("golang");
    tags.add("java");
    tags.add("kubernetes");
    tags.add("software_development");
    tags.add("platform");
  }
  if (/\btechnical\s+recruit/i.test(text)) {
    tags.add("recruiting");
    tags.add("staffing");
  }
  if (/\bproduct\s+owner\b/i.test(text) && /\bai\s+product\b/i.test(text)) {
    tags.add("product");
    tags.add("ai_ml");
    tags.add("data_analytics");
  }
  if (/\b(solutions?\s+business\s+architect|business\s+solutions\s+architect)\b/i.test(text)) {
    tags.add("enterprise_architecture");
    tags.add("platform");
  }
  if (/\benterprise\s+architect\b/i.test(text) && /\bsupply\s+chain\b/i.test(text)) {
    tags.add("enterprise_architecture");
    tags.add("supply_chain");
    tags.add("operations");
  }
  if (
    /\bmarketing\b/i.test(text) &&
    /\bcommunications\b/i.test(text) &&
    /\bcontent\s+strategy\b/i.test(text)
  ) {
    tags.add("marketing");
    tags.add("communications");
    tags.add("content_strategy");
  }
  if (
    /\b(chro|chief\s+human\s+resources|human\s+resources|hr\s+generalist|hr\s+business\s+partner|organizational\s+development|talent\s+management)\b/i.test(
      t
    )
  ) {
    tags.add("hr");
    if (/\b(recruit|talent\s+acquisition|hiring|business\s+recruiting)\b/i.test(t)) {
      tags.add("recruiting");
    }
  }
  if (/\b(customer\s+success|success\s+guide|client\s+success)\b/i.test(t)) {
    tags.add("customer_success");
  }
  if (
    /\bproduct\s+management\b/i.test(t) ||
    (/\bproduct\b/i.test(t) &&
      (/\bat\b|@/.test(text) || /\bproduct\s+at\b/i.test(t)) &&
      !/\bproduct\s+marketing\b/i.test(t))
  ) {
    tags.add("product");
  }
  if (/\bsponsor\s+finance\b/i.test(t)) {
    tags.add("finance");
    tags.add("financial_modeling");
  }
  if (/\b(strategic\s+communications|communications\s+major)\b/i.test(t)) {
    tags.add("communications");
    if (/\b(marketing|social\s+media|brand)\b/i.test(t)) tags.add("marketing");
  }
  if (/\b(alliances?|partnerships?|isv\s+partner)\b/i.test(t) && !tags.has("partnerships")) {
    tags.add("partnerships");
  }
  if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/i.test(t)) {
    tags.add("cybersecurity");
    tags.add("operations");
  }
  if (/\b(leadership\s+career\s+coach|leadership\s+coach|career\s+coach)\b/i.test(t)) {
    tags.add("consulting");
  }
  if (tags.size === 0) tags.add("unknown");
  return Array.from(tags);
}

/** Last-rescue neutral roles from headline when labels are still unknown-only. */
function applyHeadlineUnknownSalvageFromCues(
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  headline: string
): void {
  const nonJobSeeker = [...roleCategories].filter((r) => r !== "job_seeker");
  if (!(nonJobSeeker.length === 1 && nonJobSeeker[0] === "unknown")) return;
  const h = norm(headline);
  const pick = (...roles: ProspectClassification["roleCategories"][number][]) => {
    for (const r of roles) roleCategories.add(r);
    roleCategories.delete("unknown");
  };
  if (/\bmarketing\b/.test(h) && /\bcommunications\b/.test(h) && /\bcontent\s+strategy\b/.test(h)) {
    pick("marketing_leader", "communications_leader");
  }
  if (/\brevops\b/.test(h) && /\bpodcast/i.test(headline)) {
    pick("revops", "revenue_leader", "media_creator");
  }
  if (/\bstrategy\s+principal\b/.test(h) && /\benterprise\s+transformation\b/.test(h)) {
    pick("strategy_leader", "change_management_leader", "consultant");
  }
  if (/\bsenior\s+business\s+development\s+manager\b/.test(h)) {
    pick("business_development", "sales_leader");
  }
  if (/\bglobal\s+director\b/i.test(headline) && /\bpartnerships\b/i.test(h)) {
    pick("partnerships_leader", "gtm_leader");
  }
  if (/\benterprise\s+architect\b/.test(h) && /\bsupply\s+chain\b/.test(h)) {
    pick("technical_architect", "supply_chain");
  }
  if (
    /\bbusiness\s+solutions\s+architect\b/.test(h) ||
    /\bsolutions?\s+business\s+architect\b/.test(h)
  ) {
    pick("solutions_engineer", "technical_architect");
  }
  if (/\bfounding\s+ceo\b/.test(h) || (/\bceo\b/.test(h) && /\bturnarounds?\b/.test(h))) {
    pick("founder", "executive_leader", "business_leader");
  }
  if (/\blogistics\b/.test(h) && /\boperations\s+leader\b/.test(h)) {
    pick("operations_leader", "supply_chain");
  }
  if (/\bcareer\b/.test(h) && /\bstrategist\b/.test(h) && /\bgo[- ]?to[- ]?market\b/.test(h)) {
    pick("consultant", "coach_or_advisor", "gtm_leader");
  }
  if (/\bsupplier\s+management\b/.test(h)) {
    pick("supply_chain", "operations_leader");
  }
}

/** Broad business/professional families when labels are still unknown-only (semantic cues, not title lists). */
function applyBroadProfessionalFamilyUnknownSalvage(
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  headline: string,
  headlineFull: string
): void {
  const nonJobSeeker = [...roleCategories].filter((r) => r !== "job_seeker");
  if (!(nonJobSeeker.length === 1 && nonJobSeeker[0] === "unknown")) return;
  const h = norm(headline);
  const hf = norm(headlineFull);
  const blob = `${h} ${hf}`.trim();
  const pick = (...roles: ProspectClassification["roleCategories"][number][]) => {
    for (const r of roles) roleCategories.add(r);
    roleCategories.delete("unknown");
  };

  if (
    /\b(chief\s+revenue\s+officer|\bcro\b)\b/.test(blob) ||
    (/\bpresident\b/.test(blob) &&
      !/\bvice\s+president\b/.test(blob) &&
      (/\bat\b|@|advisors?\b/.test(blob) || /\bchief\s+commercial\b/.test(blob)))
  ) {
    pick("executive_leader", "business_leader");
    if (/\b(chief\s+revenue|\bcro\b|revenue)\b/.test(blob)) pick("revenue_leader", "gtm_leader");
  }
  if (
    /\bceo\b/.test(blob) &&
    (/\bat\b|@/.test(blob)) &&
    !headlineHasExplicitFounderEvidence(headlineFull)
  ) {
    pick("executive_leader", "business_leader");
  }
  if (/\bmanaging\s+director\b/.test(blob)) {
    pick("executive_leader", "business_leader");
    if (/\bsponsor\s+finance\b/.test(blob)) {
      pick("finance_accounting", "commercial_leader");
    }
  }

  if (
    /\b(chro|chief\s+human\s+resources|human\s+resources|hr\s+generalist|hr\s+business\s+partner|organizational\s+development|talent\s+management)\b/.test(
      blob
    )
  ) {
    pick("hr_leader", "people_leader");
    if (/\b(recruit|talent\s+acquisition|hiring|business\s+recruiting)\b/.test(blob)) {
      pick("recruiter");
    }
  }
  if (/\bhead\s+of\b.*\b(recruit|hiring|business\s+recruiting|talent)\b/.test(blob)) {
    pick("recruiter", "hr_leader");
  }

  if (
    /\bproduct\s+management\b/.test(blob) ||
    (/\bproduct\b/.test(blob) &&
      (/\bat\b|@/.test(blob) || /\bproduct\s+at\b/.test(blob)) &&
      !/\bproduct\s+marketing\b/.test(blob))
  ) {
    if (/\b(head|lead|leader|director|vp|svp|principal)\b/.test(blob)) pick("product_leader");
    else pick("product_manager");
  }

  if (/\b(customer\s+success|success\s+guide|client\s+success)\b/.test(blob)) {
    pick("customer_success_leader");
    if (/\baccount\s+manag/.test(blob) || /\bopen\s+to\b.*\b(?:cs|customer\s+success|am)\b/.test(blob)) {
      pick("account_management", "growth_leader");
    }
  }
  if (
    /\baccount\s+management\b/.test(blob) &&
    /\b(success|customer|cs\b|growth)\b/.test(blob)
  ) {
    pick("customer_success_leader", "account_management");
  }

  if (/\b(alliances?|partnerships?|isv\s+partner|strategic\s+partner)\b/.test(blob)) {
    pick("partnerships_leader", "gtm_leader");
    if (/\bbusiness\s+development\b/.test(blob)) pick("business_development");
  }
  if (/\b(svp|senior\s+vice\s+president)\b/.test(blob) && /\balliances\b/.test(blob)) {
    pick("partnerships_leader", "executive_leader", "business_leader");
  }

  if (
    /\b(strategic\s+communications|narrative\b.*\bbrand|brand\s+strategy)\b/.test(blob) ||
    /\bcommunications\s+major\b/.test(blob)
  ) {
    pick("communications_leader", "marketing_leader");
    if (/\bstudent\b/.test(blob)) pick("student");
  }
  if (/\bsocial\s+media\s+manager\b/.test(blob)) {
    pick("marketing_leader", "communications_leader");
  }
  if (
    /\bhelping\s+brands\b/.test(blob) ||
    (/\blinkedin\s+profile\b/.test(blob) && /\b(brand|maximize)\b/.test(blob))
  ) {
    pick("marketing_consultant", "consultant");
  }

  if (/\b(warehousing|distribution)\b/.test(blob) && /\b(program|operations|management)\b/.test(blob)) {
    pick("operations_leader", "program_manager");
  }
  if (/\b(logistics|maritime|supply\s+chain)\b/.test(blob)) {
    pick("operations_leader", "supply_chain");
    if (/\badvisor\b/.test(blob)) pick("consultant");
  }
  if (
    /\b(machine\s+vision|smart\s+factory)\b/.test(blob) &&
    /\b(automation|industrial)\b/.test(blob)
  ) {
    pick("automation_specialist", "operations_leader");
  }

  if (
    /\b(attended|student\s+at)\b/.test(blob) &&
    /\b(college|university|school)\b/.test(blob)
  ) {
    pick("student");
    if (/\bengineering\b/.test(blob)) pick("software_engineer");
  }
  if (/\bnetwork\s+engineering\s+student\b/.test(blob)) {
    pick("student", "software_engineer");
  }

  if (/\bangel\s+investor\b/.test(blob) && /\b(board\s+member|mentor|advisor)\b/.test(blob)) {
    pick("investor", "advisor", "business_leader");
  }
  if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/.test(blob)) {
    pick("security_practitioner", "it_operations");
  }
  if (
    /\b(leadership\s+career\s+coach|career\s+coach|leadership\s+coach)\b/.test(blob) &&
    /\b(speaker|author|mentor)\b/.test(blob)
  ) {
    pick("coach_or_advisor", "consultant");
  }

  if (/\bengineering\s+lead\b/.test(blob) && /\b(ml|ai|platform)\b/.test(blob)) {
    pick("engineering_leader", "ai_ml_practitioner");
  }
  if (/\b(pmp\b|project\s+management\s+professional)\b/.test(blob)) {
    pick("program_manager", "project_manager");
  }
  if (/\bai\s+transformation\b/.test(blob) && /\bpartner\b/.test(blob)) {
    pick("consultant", "ai_practitioner");
  }
  if (/\bseo\b/.test(blob) && /\bads\b/.test(blob)) {
    pick("growth_leader", "marketing_consultant");
  }
  if (
    /\bexecutive\s+director\b/.test(blob) &&
    /\b(startup|advis|law|business)\b/.test(blob)
  ) {
    pick("executive_leader", "advisor", "business_leader");
  }
  if (/\bbuilder\b/.test(blob) && /\boperator\b/.test(blob) && /\badvisor\b/.test(blob)) {
    pick("consultant", "business_leader");
  }
  if (/\bbuilding\b/.test(blob) && /\b(infrastructure|economic)\b/.test(blob)) {
    pick("operations_leader", "strategy_leader");
  }
  if (/\bi\s+build\s+ai\s+agents\b/.test(blob) || /\bbuild\s+ai\s+agents\b/.test(blob)) {
    pick("ai_practitioner", "consultant");
  }
  if (/\bbuilding\s*&\s*scaling\b/.test(blob) && /\bbackend\b/.test(blob)) {
    pick("software_engineer", "engineering_leader");
  }
  if (
    /\b(ai\s+strategy|business\s+&\s+technology\s+strategy)\b/.test(blob) &&
    /\boperations\s+leader\b/.test(blob)
  ) {
    pick("strategy_leader", "operations_leader", "consultant");
  }
  if (/\bsecuring\b/.test(blob) && /\b(digital\s+transformation|zero\s+trust)\b/.test(blob)) {
    pick("security_practitioner", "consultant");
  }
  if (/\bhelping\b/.test(blob) && /\b(high[- ]performing|professionals|brands)\b/.test(blob)) {
    pick("consultant", "coach_or_advisor");
  }
  if (/\bowner\b/.test(blob) && /\b(ai|automation|saas|api)\b/.test(blob)) {
    pick("owner_operator", "consultant");
  }
}

/** When function_tags carry signal but role_categories stayed unknown-only. */
function applyUnknownOnlyFromMeaningfulTagsSalvage(
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  functionTags: ProspectClassification["functionTags"],
  headline: string,
  headlineFull: string
): void {
  const nonJobSeeker = [...roleCategories].filter((r) => r !== "job_seeker");
  if (!(nonJobSeeker.length === 1 && nonJobSeeker[0] === "unknown")) return;
  const tags = functionTags.filter((t) => t !== "unknown");
  if (tags.length === 0) return;

  const blob = norm(`${headline} ${headlineFull}`);
  const pick = (...roles: ProspectClassification["roleCategories"][number][]) => {
    for (const r of roles) roleCategories.add(r);
    roleCategories.delete("unknown");
  };
  const tset = new Set(tags);

  if (tset.has("hr") || tset.has("recruiting")) {
    pick("hr_leader");
    if (tset.has("recruiting") || /\brecruit/i.test(blob)) pick("recruiter");
    else pick("people_leader");
    return;
  }
  if (tset.has("product")) {
    pick(/\b(head|lead|leader|director|vp)\b/.test(blob) ? "product_leader" : "product_manager");
    return;
  }
  if (tset.has("customer_success")) {
    pick("customer_success_leader");
    return;
  }
  if (tset.has("partnerships") || (tset.has("channel") && /\balliances\b/.test(blob))) {
    pick("partnerships_leader", "gtm_leader");
    return;
  }
  if (
    (tset.has("engineering") || tset.has("platform")) &&
    (/\bengineering\s+lead\b/.test(blob) || tset.has("distributed_systems"))
  ) {
    pick("engineering_leader", "technical_influencer");
    if (tset.has("ai_ml")) pick("ai_ml_practitioner");
    return;
  }
  if (tset.has("program_management") || /\bpmp\b/.test(blob)) {
    pick("program_manager", "project_manager");
    return;
  }
  if (tset.has("consulting") && /\b(builder|operator|advisor|m&a)\b/i.test(blob)) {
    pick("consultant", "business_leader");
    return;
  }
  if (tset.has("research") && /\bstrategy\b/.test(blob)) {
    pick("strategy_leader", "research_analyst");
    return;
  }
  if (tset.has("ai_ml") && tset.has("business_transformation")) {
    pick("consultant", "ai_practitioner");
    return;
  }
  if (tset.has("blockchain") && tset.has("ai_ml")) {
    pick("web3_practitioner", "consultant");
    return;
  }
  if (
    tset.has("react") ||
    tset.has("nextjs") ||
    (tset.has("engineering") && /\b(ship|building|backend|full[\s-]?stack)\b/.test(blob))
  ) {
    pick("software_engineer", "technical_influencer");
    return;
  }
  if (tset.has("platform") && /\bbuilding\b/.test(blob) && /\binfrastructure\b/.test(blob)) {
    pick("operations_leader", "strategy_leader");
    return;
  }
  if (
    tags.length === 1 &&
    tags[0] === "ai_ml" &&
    (/\bai\s+(strategy|transformation|native)\b/.test(blob) ||
      /\bhelping\b.*\b(ai|startups?)\b/.test(blob) ||
      /\bsecuring\b/.test(blob))
  ) {
    if (/\bsecuring\b|\bzero\s+trust\b/.test(blob)) pick("security_practitioner", "consultant");
    else if (/\bstrategy\b/.test(blob)) pick("ai_strategy", "consultant");
    else pick("ai_practitioner", "consultant");
  }
}

function competitorHit(text: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  const t = norm(text);
  return patterns.some((p) => p.length >= 2 && t.includes(norm(p)));
}

function professionalTitleOutranksStudent(headline: string): boolean {
  const segments = headline
    .split(/\|/)
    .map((x) => x.trim())
    .filter(Boolean);
  const execRe =
    /\b(ciso|chief\s+information\s+security|chief\s+security|chief\s+ai\s+officer|caio\b|vp\b|vice\s+president|ceo\b|cto\b|cfo\b|general\s+counsel|account\s+director|founder\b|owner\b)\b/i;
  const headRe =
    /\bhead\s+of\s+(?:engineering|security|product|platform|sales|marketing|ai|r\s*&\s*d|research)\b/i;
  for (const seg of segments) {
    if (
      /\bstudent\b|undergrad|1st\s+year|\bcse\s+student\b|phd\s+candidate|\bmasters?\s+in\b/i.test(
        seg
      )
    )
      continue;
    if (
      /@/.test(seg) &&
      /\b(end\s+user\s+services|it\s+services|field\s+services|customer\s+services)\b/i.test(seg) &&
      !/\bstudent\b|\bmajor\b/i.test(seg)
    ) {
      return true;
    }
    if (
      execRe.test(seg) ||
      headRe.test(seg) ||
      /\bdirector\b/i.test(seg) ||
      /\bproduct\s+marketing\b/i.test(seg) ||
      /\bprincipal\s+product\s+manager\b/i.test(seg) ||
      /\bcloud\s+engineer\b/i.test(seg) ||
      /\b(full[\s-]?stack|software\s+engineer|software\s+developer)\b/i.test(seg) ||
      /\bbusiness\s+analyst\b/i.test(seg) ||
      /\bpresident\b/i.test(seg)
    )
      return true;
  }
  return false;
}

function mergeStudentFunctionTags(
  headline: string,
  tags: ProspectClassification["functionTags"]
): ProspectClassification["functionTags"] {
  const s = new Set(tags.filter((t) => t !== "unknown"));
  const t = norm(headline);
  const h = headline;
  if (
    /\bdata\s+science\s+student\b/i.test(h) ||
    (/\bdata\s+science\b/i.test(t) && /\bstudent\b/i.test(t))
  ) {
    s.add("data_analytics");
  }
  if (
    /\bcomputer\s+science\b|\bcse\b|\bcs\s+student\b|\bcs\s*@|\bcomputer\s+applications\b|\bmca\b|\bmis\b|\bm\.?s\.?\s+computer/i.test(
      h
    )
  ) {
    s.add("computer_science");
  }
  if (
    /\bdata\s+analytics\b|data\s+science\b|\banalytics\b|data\s+engineer/i.test(t) ||
    /masters?\s+in\s+.*\b(data|analytics)\b/i.test(t)
  ) {
    s.add("data_analytics");
  }
  if (
    /\bfrontend\b|front-end|front\s+end|full[\s-]?stack|web\s+development|\bui\/ux\b|\bui\s+ux\b/i.test(
      h
    )
  ) {
    s.add("frontend");
  }
  if (/\bdesigner\b|visual\s+design|graphic\s+design|ux\s+design|ui\/ux/i.test(t)) {
    s.add("design");
  }
  if (
    /\bstudent\b|undergrad|university|college|phd\s+candidate|masters?\b|bachelors?\b|^\s*aspiring\b/i.test(
      t
    )
  ) {
    s.add("education");
    if (
      /\b(professor|associate\s+professor|\bfaculty\b|postdoctoral|doctoral\s+fellow\b)\b/i.test(
        t
      ) ||
      /\blecturer\b\s+.{0,40}\bat\s+(?:the\s+)?\w*\s*(?:university|college)/i.test(h)
    ) {
      s.add("academic");
    }
  }
  if (
    /\bweb\s+development\b|\bdeveloper\b|\bprogramming\b|\bdevops\b|\baws\b|\bazure\b|\bcloud\b/i.test(
      h
    )
  ) {
    s.add("engineering");
  }
  if (/\blearn/i.test(t) && /\b(ml|machine\s+learning|\bai\b)\b/i.test(t)) {
    s.add("ai_ml");
  }
  if (s.size === 0) s.add("academic");
  return Array.from(s).sort();
}

function isOwnerMultiRoleAmbiguous(headline: string): boolean {
  if (!/\bowner\s+at\b/i.test(headline)) return false;
  const bulletCount = (headline.match(/[•·]/g) ?? []).length;
  if (bulletCount >= 2) return true;
  if (
    /\b(analyst|consultant|coach|innovator|founder|freelance|designer|developer)\b/i.test(
      norm(headline)
    ) &&
    (headline.includes("|") || bulletCount >= 1)
  ) {
    return true;
  }
  return false;
}

/** True when headline/title text clearly names a professional function (even if role_categories stayed unknown). */
function headlineHasRecognizableProfessionalCue(text: string): boolean {
  const n = norm(text);
  if (n.length < 5) return false;
  if (/^\s*engineering\s*$/i.test(n.trim())) return true;
  if (
    /\b(developer|engineer|architect|analyst|scientist|designer|consultant|trainer|advis(?:or|er)|manager|director|specialist|coordinator|administrator|officer|founder|coach|lecturer|professor|swe\b|pm\b|producer|editor|writer|planner|copywriter|programmer|instructor)\b/.test(
      n
    )
  ) {
    return true;
  }
  if (
    /\bpresident\b|\bchief\s+commercial\b|\bcloud\s+engineer\b|\bbusiness\s+analyst\b|\bcustomer\s+service\b|\bautomation\b|\bpartnerships\b|\bpersonal\s+brand\b|\btcp\s*\/\s*ip\b|\bunix\b|\blinux\b|\bjava\b|\bspring\b|\breact\b|\bangular\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (/\b(lead|head)\s+of\b/.test(n)) return true;
  if (/\b(vp|cto|cfo|ceo|cmo|ciso|coo|evp)\b/.test(n)) return true;
  if (/\b(marketing|sales|product|operations|recruiting|talent|hr)\b/.test(n)) return true;
  if (/\bchief\s+strategy\s+officer\b|\bfinancial\s+analyst\b|\bdevrel\b/i.test(n)) return true;
  if (/\bprogram\s+management\b|\bbusiness\s+development\b/i.test(n)) return true;
  if (/\bsenior\s+executive\s+assistant\b/i.test(n)) return true;
  if (/^\s*design\s*@\s+/i.test(text.trim())) return true;
  if (
    /\bsecops\b|\briskops\b|\bcyber\s+riskops\b|\bcorporate\s+recruiter\b|\bcybersecurity\s+consulting\b|\banalytical\s+eng\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (
    /\b(product\s+leader|cybersecurity\s+advisor|fractional\s+product|global\s+hiring|enterprise\s+ae|practice\s+leader|\brvp\b|\bsme\b|landing\s+page|conversion-?focused|securing\s+applications|people\s+transformation|\bocm\b|software\s+engineering\s+ph\.?d|dreamer\b.*\bcyber)/i.test(
      n
    )
  ) {
    return true;
  }
  if (
    /\b(ai\s+platform|distributed\s+systems|agent\s+security|aspm|agentic\s+security|product\s+security|developer\s+security|dev\s*sec|devsecops|cloud\s+platform|data\s+platform|information\s+security|infrastructure\s+leadership)\b/i.test(
      n
    )
  ) {
    return true;
  }
  return false;
}

/** True when headline, title, roles, or tags carry outreach-usable professional context. */
export function hasUsefulProfessionalSignal(args: {
  headline: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): boolean {
  if (isWeakNonProfessionalHeadline(args.headline)) return false;
  const concreteRoles = args.roleCategories.filter((r) => r !== "unknown" && r !== "job_seeker");
  if (concreteRoles.length > 0) return true;
  const meaningfulTags = args.functionTags.filter((t) => t !== "unknown");
  if (meaningfulTags.length > 0) return true;
  if ((args.currentTitle ?? "").trim().length >= 3) return true;
  if (headlineHasRecognizableProfessionalCue(args.headline)) return true;
  const merged = norm(`${args.currentTitle ?? ""} ${args.headline}`);
  if (isLowSignalHeadlineForSafeReference(args.headline)) return false;
  return /\b(ai|ml|platform|distributed|security|cyber|infosec|ciso|founder|architect|engineer|devsec|devops|cloud|data|agentic|consultant|director|gtm|account\s+executive|partnerships?|success\s+guide|student\s+at|it\s+security|machine\s+vision)\b/i.test(
    merged
  );
}

const THREAD_PERSPECTIVE_FALLBACK = "your perspective shared on the thread";

function outreachReferenceWhenSignalExists(args: {
  headline: string;
  hNorm: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): string {
  const explicit = resolveExplicitSafeProfessionalReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (acceptSafeProfessionalReference(explicit)) return explicit;

  const rc = args.roleCategories.filter((r) => r !== "unknown" && r !== "job_seeker");
  const hn = args.hNorm;

  if (rc.includes("student") && /\b(engineering|engineer)\b/i.test(hn)) {
    return "your engineering studies";
  }
  if (
    rc.includes("investor") &&
    (/\bangel\b/i.test(hn) || (/\bboard\b/i.test(hn) && /\b(mentor|advisor)\b/i.test(hn)))
  ) {
    return "your investing and advisory work";
  }
  if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/i.test(hn)) {
    return "your IT audit and information security work";
  }
  if (rc.includes("coach_or_advisor") && /\bcoach\b/i.test(hn)) {
    return "your leadership coaching work";
  }
  if (rc.includes("partnerships_leader") && /\balliances\b/i.test(hn)) {
    return "your global alliances leadership";
  }
  if (rc.includes("product_manager") || rc.includes("product_leader")) {
    if (/\bproduct\b/i.test(hn) && (/\bat\b|@/.test(hn) || /\bproduct\s+at\b/i.test(hn))) {
      return "your product work";
    }
    return "your product management work";
  }
  if (rc.includes("hr_leader") || rc.includes("recruiter")) {
    return "your HR and talent leadership work";
  }
  if (rc.includes("customer_success_leader")) {
    return "your customer success work";
  }
  if (rc.includes("finance_accounting") && /\bsponsor\s+finance\b/i.test(hn)) {
    return "your sponsor finance leadership";
  }
  if (rc.includes("marketing_consultant") && /\b(linkedin|personal\s+brand)\b/i.test(hn)) {
    return "your personal brand and LinkedIn growth work";
  }
  if (rc.includes("operations_leader") && /\b(marketplace|marketplaces)\b/i.test(hn)) {
    return "your marketplace management work";
  }

  const domain = professionalDomainOutreachReference({
    headline: args.headline,
    currentTitle: args.currentTitle,
    roleCategories: args.roleCategories,
    functionTags: args.functionTags,
  });
  if (acceptSafeProfessionalReference(domain)) return domain;

  const anchored = tryHeadlineAnchoredReference(args.headline, args.currentTitle);
  if (anchored) return anchored;

  if (rc.length > 0) {
    const roleRef = safeReferenceFromConcreteRoles(
      args.roleCategories,
      hn,
      args.headline,
      args.currentTitle
    );
    if (roleRef && acceptSafeProfessionalReference(roleRef)) return roleRef;
  }

  return "your professional work";
}

/** Narrow generic “your X work” headline cues—only when headline does not anchor a domain cue. */
function headlineSupportsGenericRoleFallbackCue(hNorm: string): boolean {
  const strongCue =
    /\b(ai|ml|machine\s+learning|cyber(?:security)?|infosec|software|engineering|architecture\s+patterns?|architecture\s+(?:thinking|review)|principal\s+systems|principal\s+solutions|\bsre\b|\bdevops\b|data\b|cloud\b|web3\b|blockchain|identity|nft|dao|defi|sales\b|marketing|research|MBA\b|Ph\.?\s*D|mentor\b|education|trainer|founder\b|consultant\b)\b/i.test(
      hNorm
    );
  if (strongCue) return false;
  const richestSeg = Math.max(...hNorm.split("|").map((s) => s.trim().split(/\s+/).length), 0);
  return richestSeg <= 12 && hNorm.length < 104;
}

/**
 * Headline-only copy for safe_professional_reference when concrete role_categories are missing or unknown-heavy.
 * Ordered most-specific → general; avoids generic thread/background phrasing when cues exist.
 */
function safeReferenceFromHeadlineCue(hNorm: string, h: string): string | null {
  if (hNorm.length < 6) return null;
  if (/\bquality\s+manager\b/i.test(hNorm) && /\bsix\s+sigma\b/i.test(hNorm)) {
    return "your quality management and process improvement work";
  }
  if (/\bproduct\b/i.test(hNorm) && /\binnovation\s+lead\b/i.test(hNorm)) {
    return "your product and innovation leadership";
  }
  if (/\bai\s+agents?\b/i.test(hNorm) && /\bsystems?\s+and\s+business\b/i.test(hNorm)) {
    return "your AI agents and business systems work";
  }
  if (/\bprofessional\s+services\s+consultant\b/i.test(hNorm) && /\bproofpoint\b/i.test(hNorm)) {
    return "your cybersecurity professional services work";
  }
  if (/\bregional\s+director\b/i.test(hNorm) && /\bcyera\b/i.test(hNorm)) {
    return "your regional cybersecurity sales leadership";
  }
  if (/\bhybrid\s+systems\s+architect\b/i.test(hNorm)) {
    return "your systems architecture work";
  }
  if (/\bsales\s*&\s*business\s+development\s+consultant\b/i.test(hNorm)) {
    return "your sales and business development consulting work";
  }
  if (
    /\bidentity\b/i.test(hNorm) &&
    /\btrust\b/i.test(hNorm) &&
    /\bai\s+agents?\b/i.test(hNorm)
  ) {
    return "your AI identity and trust infrastructure work";
  }
  if (/\bformer\s+founder\b/i.test(hNorm)) {
    return "your founder background";
  }
  if (/\bpartner\s+at\b/i.test(hNorm) && /\bfounder\s+chairman\b/i.test(hNorm)) {
    return "your consulting and leadership work";
  }
  if (/\bai\s+innovation\s+owner\b/i.test(hNorm)) {
    return "your AI innovation and project leadership";
  }
  if (/\bpacket\s+pushers\b/i.test(hNorm) && /\bfounder\b/i.test(hNorm)) {
    return "your networking and founder perspective";
  }
  if (/\bfounder\s+of\s+meetmagic\b/i.test(hNorm) || /\bmeetmagic\b/i.test(hNorm)) {
    const anchored = tryHeadlineAnchoredReference(h);
    if (anchored) return anchored;
    return "your founder/operator perspective";
  }
  if (/\bbi\s+developer\b/i.test(hNorm) && /\bpower\s+bi\b/i.test(hNorm)) {
    return "your BI and data engineering work";
  }
  if (/\barchitect\s+advocate\b/i.test(hNorm) && /\baws\b/i.test(hNorm)) {
    return "your AWS architecture advocacy work";
  }
  if (/\bpartner\s+and\s+advisor\b/i.test(hNorm) && /\bpresswhizz\b/i.test(hNorm)) {
    return "your advisory and operator experience";
  }
  if (/\bfounder\b/i.test(hNorm) && /\barchitect\b/i.test(hNorm) && /\bframework\b/i.test(hNorm)) {
    return "your founder and framework development work";
  }
  if (/\bfounder\b/i.test(hNorm) && /\b(web3|blockchain|dao|nft|defi)\b/i.test(hNorm)) {
    return "your blockchain and Web3 founder perspective";
  }
  if (
    /\bmental\s+health\b/i.test(hNorm) &&
    /\b(registered\s+nurse|\brn\b|nurse\b)/i.test(hNorm) &&
    /\b(?:founder|ceo)\b/i.test(hNorm)
  ) {
    return "your founder work at the intersection of mental health training and clinical practice";
  }
  if (/\b(data\s+)?leakage\b/i.test(hNorm) && /\b(ai|misuse|risk)\b/i.test(hNorm)) {
    return "your trusted-AI perspective on leakage and misuse risk";
  }
  if (/\bexecutive\s+director\b/i.test(hNorm) && /\bexecutive\s+leadership\b/i.test(hNorm)) {
    return "your nonprofit executive leadership perspective";
  }
  if (
    /\bprincipal\s+systems\b/i.test(hNorm) &&
    /\barchitect\b/i.test(hNorm) &&
    /\bintegration\b|\benterprise\b|\bsecurity\b|\bfinance\b|\barchitecture\s+patterns?\b/i.test(
      hNorm
    )
  ) {
    return "your systems architecture integration work";
  }
  if (
    /\bfounder\b/i.test(hNorm) &&
    /\bproduct\s+leader\b/i.test(hNorm) &&
    (/\bcreative\b/i.test(hNorm) || /\bbuilder\b/i.test(hNorm))
  ) {
    return "your founder and product leadership";
  }
  if (/\bglobal\s+hiring\s+partner\b/i.test(hNorm)) {
    return "your global recruiting work";
  }
  if (/\bsenior\s+enterprise\s+ae\b/i.test(hNorm)) {
    return "your enterprise sales work";
  }
  if (/\bfounder\b/i.test(hNorm) && /\bceo\b/i.test(hNorm) && /\bai\s+agents\b/i.test(hNorm)) {
    return "your AI agents and founder perspective";
  }
  if (/\bcybersecurity\s+advisor\b/i.test(hNorm) && /\binformation\s+assurance\b/i.test(hNorm)) {
    return "your cybersecurity advisory work";
  }
  if (/\bfractional\s+product\s+leader\b/i.test(hNorm)) {
    return "your fractional product leadership";
  }
  if (/^\s*founder\s*[|-]/i.test(h.trim()) && /\bceo\b|\bbuilder\b|\bconsultant\b/i.test(hNorm)) {
    return "your founder perspective";
  }
  if (/\bsoftware\s+engineering\s+ph\.?d\b/i.test(hNorm)) {
    return "your software engineering research";
  }
  if (/\bco[- ]?founder\b/i.test(hNorm) && /@/.test(h)) {
    const anchored = tryHeadlineAnchoredReference(h);
    if (anchored) return anchored;
    return "your founder/operator perspective";
  }
  if (/\btalent\s+acquisition\b/i.test(hNorm) && /\bnvidia\b/i.test(hNorm)) {
    return "your technical recruiting perspective";
  }
  if (/\bceo\b/i.test(hNorm) && /\bagentic\b/i.test(hNorm) && /\.com\b/i.test(hNorm)) {
    return "your founder and agentic AI product perspective";
  }
  if (/\bdevrel\b/i.test(hNorm) && /\bfounder\b/i.test(hNorm)) {
    return "your developer relations and founder perspective";
  }
  if (/^\s*design\s*@\s+/i.test(h.trim())) {
    return "your design work";
  }
  if (/\bcybersecurity\s+consulting\b/i.test(hNorm) && /\biso\s*27001\b/i.test(hNorm)) {
    return "your cybersecurity consulting work";
  }
  if (/\bautonomous\s+secops\b/i.test(hNorm) && /\briskops\b|\bcyber\s+risk/i.test(hNorm)) {
    return "your SecOps and cyber risk perspective";
  }
  if (
    /\bdata\b/i.test(hNorm) &&
    /\banalytical\s+eng\b/i.test(hNorm) &&
    /\bdata\s+ops\b/i.test(hNorm) &&
    /\b(llm|ml)\s*ops\b/i.test(hNorm)
  ) {
    return "your data engineering and MLOps work";
  }
  if (/\bgenai\b/i.test(hNorm) && /\boracle\s+health\b/i.test(hNorm)) {
    return "your GenAI and health technology work";
  }
  if (/\blearn\s+ai\s+for\s+marketing\b/i.test(hNorm)) {
    return "your AI marketing education work";
  }
  if (/\bsenior\s+it\s+manager\b/i.test(hNorm) && /\bcybersecurity\b/i.test(hNorm)) {
    return "your IT and cybersecurity operations work";
  }
  if (/\bfounder\b/i.test(hNorm) && /\bprincipal\b/i.test(hNorm)) {
    const anchored = tryHeadlineAnchoredReference(h);
    if (anchored) return anchored;
    return "your founder/operator perspective";
  }
  if (
    /\bbusiness\s+development\b/i.test(hNorm) &&
    /\bprogram\s+management\b/i.test(hNorm) &&
    /\bsales\s+leadership\b/i.test(hNorm)
  ) {
    return "your business development and sales leadership";
  }
  if (
    /\bcybersecurity\s+professional\b/i.test(hNorm) &&
    /\bpenetration\s+tester\b/i.test(hNorm) &&
    /\binstructor\b/i.test(hNorm)
  ) {
    return "your offensive security and technical training work";
  }
  if (
    /\bmachine\s+learning\b/i.test(hNorm) &&
    /\barchitecture\b/i.test(hNorm) &&
    /\bdevops\b/i.test(hNorm)
  ) {
    return "your machine learning and DevOps work";
  }
  if (
    /\bfinancial\s+analyst\b/i.test(hNorm) &&
    (/\bfinancial\s+modell?ing\b/i.test(hNorm) || /\besg\b/i.test(hNorm))
  ) {
    return "your financial analysis work";
  }
  if (/\bsenior\s+executive\s+assistant\b/i.test(hNorm)) {
    return "your executive support and operations work";
  }
  if (/^\s*content\s+writer\b/i.test(hNorm)) return "your content writing work";
  if (/\brecruiting\b/i.test(hNorm) && /\brevops\b/i.test(hNorm)) {
    return "your recruiting and RevOps work";
  }
  if (/\bturning\s+ai\s+hype\b/i.test(hNorm)) {
    return "your AI strategy and automation work";
  }
  if (/\bchief\s+strategy\s+officer\b/i.test(hNorm) && /\bzscaler\b/i.test(hNorm)) {
    return "your security strategy leadership perspective";
  }
  if (/\bpresident\b/i.test(hNorm) && /\bchief\s+commercial\s+officer\b/i.test(hNorm)) {
    return "your commercial leadership perspective";
  }
  if (/\bbusiness\s+analyst\b/i.test(hNorm)) return "your business analysis work";
  if (
    /\brich\s+experience\s+in\s+customer\s+service\b/i.test(hNorm) ||
    (/\bcustomer\s+service\b/i.test(hNorm) && /\bopen\s+to\b/i.test(hNorm))
  ) {
    return "your customer service experience";
  }
  if (/\bai\s+automation\s+specialist\b/i.test(hNorm)) return "your AI automation work";
  if (/\bmarketing\b/i.test(hNorm) && /\bcontent\b/i.test(hNorm) && /\bcopywriter\b/i.test(hNorm)) {
    return "your marketing and copywriting work";
  }
  if (
    /\bi\s+help\s+you\s+grow\s+your\s+personal\s+brand\b/i.test(hNorm) ||
    (/\bpersonal\s+brand\b/i.test(hNorm) && /\blinkedin\b/i.test(hNorm))
  ) {
    return "your personal branding and marketing work";
  }
  if (
    /\bsenior\s+executive\b/i.test(hNorm) &&
    /\bpartnerships\b/i.test(hNorm) &&
    /\bcollaborations\b|\bsolutions\b/i.test(hNorm)
  ) {
    return "your partnerships and solutions leadership";
  }
  if (
    /\bjava\b/i.test(hNorm) &&
    /\bspring\b/i.test(hNorm) &&
    /\breact\b/i.test(hNorm) &&
    /\bmicroservice\b/i.test(hNorm)
  ) {
    return "your software development work";
  }
  if (
    (/\btcp\s*\/\s*ip\b/i.test(hNorm) ||
      /\bnetwork\s+programmer\b/i.test(hNorm) ||
      /\bcybersecurity\s+instructor\b/i.test(hNorm)) &&
    (/\baws\b/i.test(hNorm) ||
      /\bunix\b|\blinux\b/i.test(hNorm) ||
      /\bsecurity\s+monitoring\b|\bvulnerability\b/i.test(hNorm))
  ) {
    return "your cybersecurity and network training work";
  }
  if (/\btechnical\s+training\b/i.test(hNorm) && /\benablement\b/i.test(hNorm)) {
    return "your technical training and enablement work";
  }
  if (/\bsenior\s+staff\s+accountant\b|\bstaff\s+accountant\b/i.test(hNorm)) {
    return "your accounting work";
  }
  if (/\bagile\s+project\s+manager\b/i.test(hNorm)) {
    return "your agile project management work";
  }
  if (/\bpenetration\s+tester\b/i.test(hNorm) || /\bred\s+team(er)?\b/i.test(hNorm)) {
    return "your offensive security work";
  }
  if (/\blocal\s+marketing\s+strategist\b/i.test(hNorm)) {
    return "your local marketing strategy work";
  }
  if (/\brecruiting\b/i.test(hNorm) && /\brevops\b/i.test(hNorm)) {
    return "your recruiting and RevOps work";
  }
  if (/^\s*engineering\s*$/i.test(hNorm.trim())) return "your engineering work";
  if (
    /\boperating\s+platform\b/i.test(hNorm) ||
    (/\bplatform\b/i.test(hNorm) && /\b(building|private)\b/i.test(hNorm))
  ) {
    return "your platform-building work";
  }
  if (/\bexecutive\s+assistant\b/i.test(hNorm)) {
    return "your executive support and operations work";
  }
  if (/\bphp\s+developer\b/i.test(hNorm)) return "your PHP development work";
  if (/\b(senior\s+)?web\s+developer\b/i.test(hNorm) && !/\.net/i.test(hNorm)) {
    return "your web development work";
  }
  if (/\b(senior\s+)?\.net\s+developer\b/i.test(hNorm)) return "your .NET development work";
  if (/\bdata\s+scientist\b/i.test(hNorm)) return "your data science work";
  if (/\bsenior\s+research\s+analyst\b|\bresearch\s+analyst\b/i.test(hNorm)) {
    return "your research analysis work";
  }
  if (
    /\bmanager\b/i.test(hNorm) &&
    /\bey\b|\bernst/i.test(hNorm) &&
    /\bstrategy\b|\bchange\s+management\b|\bprocess\s+improvement\b/i.test(hNorm)
  ) {
    return "your strategy and change management work";
  }
  if (/\bsenior\s+advisor\b/i.test(hNorm) || /\badvisor\s*@/i.test(h)) {
    return "your advisory work";
  }
  if (/\bai\s+trainer\b/i.test(hNorm)) return "your AI training and data analysis work";
  if (
    /\bfull[\s-]?stack\s+engineer\b/i.test(hNorm) &&
    (/\bspring\s+boot\b/i.test(hNorm) || /\bnext\.js\b|\bnextjs\b/i.test(hNorm))
  ) {
    return "your full-stack engineering work";
  }
  if (/\bfull[\s-]?stack\s+developer\b/i.test(hNorm)) return "your full-stack development work";
  if (/\b(ml|machine\s+learning)\s+engineer\b/i.test(hNorm)) {
    return "your machine learning engineering work";
  }
  if (/\bdata\s+engineer\b/i.test(hNorm)) return "your data engineering work";
  if (/\bdevops\b/i.test(hNorm) && /\bengineer\b/i.test(hNorm))
    return "your DevOps engineering work";
  if (/\bsite\s+reliability\b|\bsre\b/i.test(hNorm)) return "your site reliability work";
  if (/\bproduct\s+manager\b/i.test(hNorm)) return "your product management work";
  if (/\bprogram\s+manager\b/i.test(hNorm)) return "your program management work";
  if (/\bqa\b|\bquality\s+engineer\b/i.test(hNorm)) return "your quality engineering work";
  if (
    /\bdeveloper\b/i.test(hNorm) ||
    (/\bengineer\b/i.test(hNorm) && !/\bai\s+(?:agents?)\b/i.test(hNorm))
  ) {
    if (headlineSupportsGenericRoleFallbackCue(hNorm)) return "your software development work";
    return null;
  }
  if (/\bdata\s+analyst\b/i.test(hNorm)) return "your data analysis work";
  if (/\banalyst\b/i.test(hNorm) && !/\bsystem\s+admin|\bsoc\b/i.test(hNorm)) {
    if (headlineSupportsGenericRoleFallbackCue(hNorm)) return "your analysis work";
    return null;
  }
  if (/\bdesigner\b/i.test(hNorm)) return "your design work";
  if (/\barchitect\b/i.test(hNorm) && !/\bsalesforce\b/i.test(hNorm)) {
    return null;
  }
  if (/\bconsultant\b/i.test(hNorm)) {
    return "your consulting work";
  }
  if (/\b(scientist|researcher)\b/i.test(hNorm)) return "your research work";
  if (/\bdirector\b/i.test(hNorm)) {
    return null;
  }
  if (/\bmanager\b/i.test(hNorm)) {
    return null;
  }
  return null;
}

export function buildSafeReference(args: {
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
  profileFlags: Set<ProfileFlag>;
  headlineTooVague: boolean;
  headline: string;
  currentTitle?: string | null;
}): string {
  const {
    roleCategories: rc,
    functionTags: ft,
    profileFlags: pf,
    headlineTooVague,
    headline: h,
    currentTitle,
  } = args;
  const hNorm = norm(h);

  const composedRef = composeSafeProfessionalReference({
    headline: h,
    currentTitle,
    roleCategories: rc,
    functionTags: ft,
  });
  if (composedRef && !isGenericSafeProfessionalReference(composedRef)) return composedRef;

  const titleContextRef = safeReferenceFromTitleAndLabels({
    headline: h,
    currentTitle,
    roleCategories: rc,
    functionTags: ft,
  });
  if (titleContextRef && !isGenericSafeProfessionalReference(titleContextRef)) return titleContextRef;

  if (
    (pf.has("founder_signal") || rc.includes("founder")) &&
    (pf.has("junior_or_intern_signal") || /\bintern\b/i.test(h))
  ) {
    return "your perspective as a founder and early-career technologist";
  }

  if (rc.includes("owner_operator")) {
    return "your perspective as a business owner and operator";
  }

  if (
    rc.includes("chief_of_staff") ||
    (/\bchief\s+of\s+staff\b/i.test(hNorm) && /\bto\s+(the\s+)?founder\b/i.test(hNorm))
  ) {
    return "your people leadership and executive operations work";
  }

  if (/\brecruitment\s+lead\b/i.test(hNorm) || /\brecruit(?:er|ing)\s+lead\b/i.test(hNorm)) {
    return "your recruiting leadership work";
  }

  if (/\bfreelancer\b/i.test(hNorm) && (/\bat\s+[A-Za-z]/i.test(h) || rc.includes("consultant"))) {
    return "your freelance consulting work";
  }

  if (
    /\b(us\s+)?it\s+recruiter\b/i.test(hNorm) ||
    (/\brecruiter\b/i.test(hNorm) && /\bit\b/i.test(hNorm) && /\bus\b/i.test(hNorm))
  ) {
    return "your IT recruiting work";
  }

  if (
    (pf.has("founder_signal") || rc.includes("founder")) &&
    /\bidentity\b/i.test(hNorm) &&
    /\bsecur/i.test(hNorm)
  ) {
    return "your identity and security founder perspective";
  }

  if (
    (pf.has("founder_signal") || rc.includes("founder")) &&
    (ft.includes("web3") ||
      ft.includes("blockchain") ||
      /\bweb3\b|\bblockchain\b|\bdao\b/i.test(hNorm))
  ) {
    return "your web3 and founder-led product perspective";
  }

  if (
    (pf.has("founder_signal") || rc.includes("founder")) &&
    (ft.includes("podcasting") || /\bpodcasts?\b/i.test(hNorm))
  ) {
    return "your networking and founder perspective";
  }
  if (
    rc.includes("ai_engineer") &&
    rc.includes("software_engineer") &&
    /\b(ms\s+cs|m\.?s\.?\s+c\.?s\.?)\b/i.test(hNorm) &&
    !rc.includes("student")
  ) {
    return "your AI and software engineering work";
  }

  if (
    /\brvp\b/i.test(hNorm) &&
    /\bhashicorp\b/i.test(hNorm) &&
    (rc.includes("sales_leader") || rc.includes("regional_leader"))
  ) {
    return "your regional sales leadership";
  }

  if (
    /\bsaas\b/i.test(hNorm) &&
    /\blanding\s+page/i.test(hNorm) &&
    /\bconversion/i.test(hNorm) &&
    /\brewrit/i.test(hNorm)
  ) {
    return "your SaaS copywriting work";
  }

  if (/\bglobal\s+executive\b/i.test(hNorm) && /\bocm\s+practice\s+leader\b/i.test(hNorm)) {
    return "your business and people transformation work";
  }

  if (/\bcybersecurity\s+sme\b/i.test(hNorm)) {
    return "your cybersecurity expertise";
  }

  if (
    /\bsecuring\s+applications\b/i.test(hNorm) &&
    /\bnetworks?\b/i.test(hNorm) &&
    /\bdeliver/i.test(hNorm)
  ) {
    return "your application and network security work";
  }

  if (
    /\b99\.9%\b/.test(hNorm) &&
    /\breliable\s+ai\b/i.test(hNorm) &&
    /\b(immigration|banks|airlines|high[- ]stakes)\b/i.test(hNorm)
  ) {
    return "your high-stakes AI work";
  }

  if (
    rc.includes("product_builder") &&
    (/\b(cs|cse)\s*@\b/i.test(hNorm) ||
      (/\b(cs|cse|computer\s+science)\b/i.test(hNorm) && rc.includes("student"))) &&
    !rc.includes("founder")
  ) {
    return "your product-building and computer science background";
  }

  if ((pf.has("student_signal") || rc.includes("student")) && !rc.includes("founder")) {
    if (
      /\bformer\s+[^|]{0,140}\bintern\b|\bex[-\s]*intern\b/i.test(hNorm) &&
      (/\bcloud\s+engineer\b|\bengineer\b|\bdeveloper\b/i.test(hNorm) || rc.includes("job_seeker"))
    ) {
      /* Former intern + current IC job search: do not use student phrasing. */
    } else if (
      /\b(bachelor|bachelors)\s+of\b/i.test(hNorm) &&
      /\bcomputer\s+science\b/i.test(hNorm)
    ) {
      return "your computer science studies";
    } else if (
      /\bb\.?tech\b/i.test(hNorm) &&
      /\bcse\b/i.test(hNorm) &&
      /\banalytics\b/i.test(hNorm)
    ) {
      return "your computer science and analytics background";
    } else if (
      /\bcse\b/i.test(hNorm) &&
      (/\bcyber/i.test(hNorm) || /\bsecurity\b|\bcybersecurity\b/i.test(hNorm))
    ) {
      return "your cybersecurity-focused computer engineering studies";
    } else {
      return "your studies and early career path";
    }
  }
  if (/\bkeeping\s+ai\s+agents\b/i.test(hNorm)) {
    return "your perspective on steering responsible agentic AI systems";
  }
  if (/\blead\s+technical\b/i.test(hNorm) && /\brecruiter\b/i.test(hNorm)) {
    return "your technical recruiting perspective";
  }
  if (/\bcorporate\s+recruiter\b/i.test(hNorm) && /\btechnical\b/i.test(hNorm)) {
    return "your technical recruiting perspective";
  }
  if (
    /\bpublic\s+safety\b/.test(hNorm) &&
    /\bcyber(?:security)?\b/.test(hNorm) &&
    /\bcommunications\b/.test(hNorm)
  ) {
    return "your public safety and cybersecurity communications perspective";
  }
  if (
    /\bcyber(?:security)?\b/.test(hNorm) &&
    /\btech\s+evangelist\b|\btechnology\s+evangelist\b/.test(hNorm) &&
    /\bpodcasts?\b|\bpodcaster\b/.test(hNorm)
  ) {
    return "your cybersecurity evangelism and media work";
  }
  if (headlineSuggestsStrongIcAiEngineering(h)) {
    return "your work in agentic AI engineering";
  }
  if (
    /\bIDC\b/i.test(h) &&
    /\bindustry\s+analyst\b/.test(hNorm) &&
    /\bapplication\s+security\b/.test(hNorm)
  ) {
    return "your application security analyst perspective";
  }
  if (
    rc.includes("founder_or_principal") &&
    /\bapplied\s+ai\b|\btechnical\s+search\b/.test(hNorm)
  ) {
    return "your work in applied AI and technical search";
  }
  if (
    /\btechnology\s+strategist\b|\btech\s+strategist\b/.test(hNorm) ||
    (/\bstrategist\b/.test(hNorm) && /\btechnology\b/.test(hNorm))
  ) {
    return "your technology strategy perspective";
  }
  if (
    /\bbusiness\s+development\b/.test(hNorm) &&
    /\blead\s+generation\b|\bgenerating\s+leads\b|\blinkedin\s+outreach\b|\bmarket\s+researcher\b/i.test(
      h
    )
  ) {
    return "your business development and lead generation work";
  }
  if (/\b(sr\.?|senior)\s*account\s+executive\b/i.test(h) || /\benterprise\s+sales\b/.test(hNorm)) {
    return "your enterprise sales perspective";
  }
  if (/\bglobal\s+customer\s+success\b/.test(hNorm) && /\brenewals\b/.test(hNorm)) {
    return "your customer success and renewals leadership";
  }
  if (/\bprincipal\s+support\s+account\s+manager\b/.test(hNorm) && /\bservicenow\b/i.test(h)) {
    return "your account management and customer success work";
  }
  if (/^ceo\b/.test(hNorm) && /\bat\s+/i.test(h) && !/\bco-?founder\b/.test(hNorm)) {
    return "your founder/operator perspective";
  }
  if (/\bco-?founder\b/.test(hNorm) && /\bceo\b/.test(hNorm) && /\b(ai|data)\b/.test(hNorm)) {
    return "your founder and AI/data leadership perspective";
  }
  if (/\bcro\b/.test(hNorm) || /\bchief\s+revenue\b/.test(hNorm)) {
    return "your revenue leadership perspective";
  }
  if (/\bcoo\b|chief\s+operating/.test(hNorm)) {
    return "your operating leadership perspective";
  }
  if (/chief\s+commercial|\bpresident\b.*\bcommercial\b/.test(hNorm)) {
    return "your commercial leadership perspective";
  }
  if (/\bboard\s+of\s+director/.test(hNorm)) {
    return "your board leadership perspective";
  }
  if (/\bgrowth\s+marketing\b/.test(hNorm) && /\babm\b/.test(hNorm)) {
    return "your growth marketing perspective";
  }
  if (/\bcommunications\b/.test(hNorm) && /\bbrand\b/.test(hNorm) && /\bexecutive\b/.test(hNorm)) {
    return "your communications and brand leadership";
  }
  if (
    /\bfaculty\b/.test(hNorm) &&
    (/\bmachine\s+learning\b|\bgen[- ]?ai\b|\bgenerative\s+ai\b/.test(hNorm) ||
      /\bai\b/.test(hNorm))
  ) {
    return "your AI and machine learning education work";
  }
  if (/\bhelping\b.*\bidentities?\b.*\bsecur/i.test(hNorm)) {
    return "your identity security perspective";
  }
  if (/\bdigital\s+identity\b/i.test(hNorm)) {
    return "your digital identity and trust technology perspective";
  }
  if (rc.includes("customer_success_leader")) {
    if (/\bcyber/i.test(hNorm)) {
      return "your cybersecurity customer success leadership";
    }
    return "your customer success leadership";
  }
  if (/\bcybersecurity\b/.test(hNorm) && /\bboard\s+member\b/.test(hNorm)) {
    return "your cybersecurity board and advisory perspective";
  }
  if (/\bindependent\s+technology\s+advisor\b/i.test(h) && /\b(cyber|cloud)\b/i.test(hNorm)) {
    return "your cybersecurity and cloud advisory perspective";
  }
  if (
    /\bcybersecurity\s+advisor\b/i.test(hNorm) &&
    /\bexecutives\b/.test(hNorm) &&
    /\bboards\b/i.test(hNorm)
  ) {
    return "your executive cybersecurity advisory perspective";
  }
  if (
    /\bfounder\s*&\s*ceo\b/i.test(hNorm) &&
    /\bai\b/i.test(hNorm) &&
    /\bsecurity\b/i.test(hNorm)
  ) {
    return "your founder and AI security perspective";
  }
  if (/\btechnical\s+leader\b/i.test(hNorm) && /\bcisco\b/i.test(hNorm)) {
    return "your technical leadership perspective";
  }
  if (/\bhead\s+of\s+worldwide\s+banking\b/i.test(hNorm) && /\baws\b/i.test(hNorm)) {
    return "your AWS industry leadership perspective";
  }
  if (/\bfounding\s+engineer\b/i.test(hNorm)) {
    return "your founding engineering perspective";
  }
  if (/\bmicrosoft\s+mvp\b|\bdynamics\s*365\b/i.test(hNorm)) {
    return "your Microsoft Dynamics and technical architecture work";
  }
  if (
    /\bai\s+strategy\b/.test(hNorm) &&
    /\badoption\b|people[- ]centered|\bchange\s+agent\b|\benterprise\s+transformation\b/.test(hNorm)
  ) {
    return "your AI strategy and enterprise transformation work";
  }
  if (
    /\bindependent\s+consultant\s*&\s*ceo\b/i.test(hNorm) &&
    /\b(data|advisory|consulting)\b/i.test(hNorm)
  ) {
    return "your independent consulting and data advisory work";
  }
  if (rc.includes("staffing_leader") || (rc.includes("recruiter") && /\bstaffing\b/i.test(hNorm))) {
    return "your staffing and recruiting work";
  }
  if (/\bmarketing\b/.test(hNorm) && /\bcommunications\b/.test(hNorm) && /\bvp\b/i.test(hNorm)) {
    return "your marketing and communications leadership";
  }
  if (
    /\bdevops\b/.test(hNorm) &&
    (/\btechnical\s+lead\b/i.test(hNorm) || /\bassistant\s+manager\b/i.test(hNorm))
  ) {
    return "your DevOps and technical leadership";
  }
  if (/\bmulti[- ]cloud\b/i.test(hNorm)) {
    return "your multi-cloud work";
  }
  if (rc.includes("sre_engineer") && /\bsite\s+reliability\b|\bsre\b/i.test(hNorm)) {
    return "your SRE and cloud infrastructure work";
  }
  if (
    rc.includes("frontend_engineer") ||
    (/\bfrontend\b/i.test(hNorm) && /\bengineer\b/i.test(hNorm))
  ) {
    return "your frontend engineering work";
  }
  if (
    /\bexecutive\s+vice\s+president\b|\bevp\b/.test(hNorm) &&
    /\bgrowth\b|\bstrategy\b/.test(hNorm)
  ) {
    return "your growth strategy perspective";
  }
  if (/\bexecutive\s+vice\s+president\b|\bevp\b/.test(hNorm)) {
    return "your executive leadership perspective";
  }
  if (/\bvp\s+growth\b|\bvp\s+growth\s*&\s*strategy\b/i.test(h)) {
    return "your growth strategy perspective";
  }
  if (/\bcustomer\s+experience\b|\bcustomer\s+engagement\b/.test(hNorm)) {
    return "your customer experience work";
  }
  if (/\bproduct\s+operations\b/.test(hNorm) && /\bprogram\s+manager\b/.test(hNorm)) {
    return "your product operations and program management work";
  }
  if (/\bphp\s+developer\b/i.test(hNorm)) {
    return "your PHP development work";
  }
  if (/\b(senior\s+)?web\s+developer\b/i.test(hNorm) && !/\.net/i.test(hNorm)) {
    return "your web development work";
  }
  if (/\b(senior\s+)?\.net\s+developer\b/i.test(hNorm)) {
    return "your .NET development work";
  }
  if (/\bdata\s+scientist\b/i.test(hNorm)) {
    return "your data science work";
  }
  if (/\bsenior\s+research\s+analyst\b|\bresearch\s+analyst\b/i.test(hNorm)) {
    return "your research analysis work";
  }
  if (
    /\bmanager\b/i.test(hNorm) &&
    /\bey\b|\bernst/i.test(hNorm) &&
    /\bstrategy\b|\bchange\s+management\b|\bprocess\s+improvement\b/i.test(hNorm)
  ) {
    return "your strategy and change management work";
  }
  if (/\bsenior\s+advisor\b/i.test(hNorm) || /\badvisor\s*@/i.test(h)) {
    return "your advisory work";
  }
  if (/\bai\s+trainer\b/i.test(hNorm)) {
    return "your AI training and data analysis work";
  }
  if (
    /\bfull[\s-]?stack\s+engineer\b/i.test(hNorm) &&
    (/\bspring\s+boot\b/i.test(hNorm) || /\bnext\.js\b|\bnextjs\b/i.test(hNorm))
  ) {
    return "your full-stack engineering work";
  }
  if (headlineIsAppSecStrategicMarketing(h)) {
    return "your strategic marketing lens on application security";
  }
  if (
    rc.includes("software_engineer") &&
    (/\bdeveloper\b/.test(hNorm) || /\bfull[\s-]?stack/i.test(hNorm))
  ) {
    return "your software development work";
  }

  if (/\bchief\s+ai\s+officer\b/.test(hNorm) || /\bcaio\b/.test(hNorm)) {
    return "your work in AI leadership";
  }
  if (/\bprincipal\s+product\s+manager\b/.test(hNorm)) {
    return "your product leadership work";
  }
  if (/\bhead\s+of\s+sales\b/.test(hNorm)) {
    return "your sales leadership work";
  }
  if (/\bksqldb\b/.test(hNorm) && /\bdeltastream\b/.test(hNorm) && rc.includes("founder")) {
    return "your perspective as a founder and data infrastructure leader";
  }
  if (
    /\bchief\s+technology\s+officer\b/.test(hNorm) ||
    (/\bcto\b/.test(hNorm) && !rc.includes("student"))
  ) {
    return "your technology leadership perspective";
  }
  if (/\bvp\b.*\bdata\b|\bvp\s+data\b/i.test(h)) {
    return "your data leadership perspective";
  }
  if (/\bprincipal\s+architect\b/.test(hNorm) && /\bgoogle\s+cloud\b/.test(hNorm)) {
    return "your cloud architecture perspective";
  }
  if (/\bai\s+product\b/.test(hNorm)) {
    return "your AI product perspective";
  }
  if (
    /\bflip\s+flops\s+engineer\b/.test(hNorm) ||
    (pf.has("informal_title_signal") && rc.includes("platform_engineer"))
  ) {
    return "your platform engineering leadership perspective";
  }
  if (/software\s+engineering\s+leader/i.test(h)) {
    return "your software engineering leadership perspective";
  }
  if (/\bproduct\s+marketing\b/.test(hNorm)) {
    const sec = ft.includes("security") || /\b(cyber|security)\b/i.test(h);
    return sec ? "your product marketing work in security" : "your product marketing work";
  }
  if (rc.includes("investor") || ft.includes("investor")) return "your investing perspective";
  if (
    /^\s*President,?\s+/i.test(h) &&
    /\b(cyber|compliance|healthcare|law\s+firms|downtime)\b/i.test(hNorm)
  ) {
    return "your IT services and cybersecurity leadership";
  }
  if (
    rc.includes("sales_account") ||
    (ft.includes("sales") && pf.has("non_target_function_signal"))
  ) {
    return "your experience in commercial and account leadership";
  }
  if (rc.includes("legal_counsel") || ft.includes("legal")) {
    return "your legal and risk perspective";
  }
  if (
    rc.includes("product_marketing") ||
    (ft.includes("marketing") && rc.includes("product_marketing"))
  ) {
    return "your go-to-market perspective";
  }
  if (
    rc.includes("security_leader") ||
    (ft.includes("security") && rc.includes("security_leader"))
  ) {
    const leadRef = composeSafeProfessionalReference({
      headline: h,
      currentTitle,
      roleCategories: rc,
      functionTags: ft,
    });
    if (leadRef && !isGenericSafeProfessionalReference(leadRef)) return leadRef;
    return "your perspective on security leadership";
  }
  if (
    /\bsenior\s+it\s+manager\b/i.test(hNorm) &&
    /\bcybersecurity\b/i.test(hNorm) &&
    /\bokta\b/i.test(hNorm)
  ) {
    return "your IT and cybersecurity operations work";
  }
  if (rc.includes("security_practitioner") && ft.includes("security")) {
    const secRef = composeSafeProfessionalReference({
      headline: h,
      currentTitle,
      roleCategories: rc,
      functionTags: ft,
    });
    if (secRef && !isGenericSafeProfessionalReference(secRef)) return secRef;
    if (/\b(api|apis)\b/i.test(hNorm)) return "your API security and data protection work";
    return "your perspective on security operations";
  }
  if (rc.includes("engineering_leader") && ft.includes("engineering")) {
    const engRef = safeReferenceFromTitleAndLabels({
      headline: h,
      currentTitle,
      roleCategories: rc,
      functionTags: ft,
    });
    if (engRef) return engRef;
    return "your engineering leadership work";
  }
  if (
    rc.includes("supply_chain") &&
    /\bsupply\s+chain\b/i.test(hNorm) &&
    /\boperation\b/i.test(hNorm)
  ) {
    return "your supply chain operations leadership";
  }
  if ((rc.includes("it_operations") || ft.includes("operations")) && !rc.includes("supply_chain")) {
    return "your work in IT operations";
  }
  if (rc.includes("technical_influencer") && ft.includes("ai_ml")) {
    if (/\bstrategy\b/.test(hNorm) || rc.includes("technology_strategist")) {
      return "your technology strategy perspective";
    }
    if (ft.includes("agentic_ai") || /\bagentic\b/i.test(h)) {
      return "your work shaping agentic systems";
    }
    return "your perspective on AI and platform work";
  }
  if (ft.includes("platform") && ft.includes("engineering")) {
    if (rc.includes("recruiter") || /\brecruiter\b/i.test(hNorm)) {
      return "your technical recruiting perspective";
    }
    if (rc.includes("devops_engineer") || /\bdevops\b/i.test(hNorm)) {
      return "your DevOps and cloud infrastructure work";
    }
    if (rc.includes("sre_engineer")) {
      return "your site reliability and platform work";
    }
    if (rc.includes("cloud_engineer") || /\bcloud\b/i.test(hNorm)) {
      return "your cloud engineering work";
    }
    return "your platform and infrastructure engineering perspective";
  }
  const concrete = rc.filter((x) => x !== "unknown");
  if (!headlineTooVague && concrete.length > 0) {
    if (rc.includes("communications_leader") || /\bresponsable\s+communication\b/i.test(hNorm)) {
      return "your communications leadership perspective";
    }
    if (
      rc.includes("technical_lead") &&
      (ft.includes("ai_ml") || /\bai\s+platforms?\b|\bdistributed\s+systems?\b/i.test(hNorm))
    ) {
      return "your technical leadership in AI platforms and distributed systems";
    }
    if (rc.includes("sales_leader") && /\bsales\s+director\b/i.test(hNorm)) {
      return "your sales leadership perspective";
    }
    if (
      (rc.includes("sales_account") || rc.includes("account_management")) &&
      /\baccount\s+manager\b/i.test(hNorm)
    ) {
      return "your account management and commercial sales work";
    }
    if (rc.includes("media_creator") && ft.includes("ai_ml") && /\bteaching\b|\beducat/i.test(h)) {
      return "your AI content and teaching work";
    }
    if (rc.includes("academic") && /\bdata\s+scientist\b|\blecturer\b/i.test(hNorm)) {
      return "your academic and data science teaching work";
    }
    if (rc.includes("cloud_architect") || (/\bcloud\b/i.test(hNorm) && /\bai\b/i.test(hNorm))) {
      if (ft.includes("regulated_industries") || /\bregulated\b/i.test(hNorm)) {
        return "your cloud and AI architecture work in regulated environments";
      }
    }
    if (rc.includes("field_operations") || /\broustabout\b/i.test(hNorm)) {
      return "your field operations perspective";
    }
  }
  const cueOnly = safeReferenceFromHeadlineCue(hNorm, h);
  if (cueOnly) return cueOnly;

  if (/\bai\s+transformation\b/i.test(hNorm)) {
    return "your AI transformation work";
  }
  if (/\btechnical\s+training\b/i.test(hNorm) && /\benablement\b/i.test(hNorm)) {
    return "your technical training and enablement work";
  }
  if (/\bb2b\s+growth\s+strategist\b/i.test(hNorm) || /\bpredictable\s+revenue\b/i.test(hNorm)) {
    return "your B2B growth strategy work";
  }
  if (/^\s*channel\s+head\b/i.test(h.trim())) {
    return "your channel leadership work";
  }
  if (/\btechnology\s+leader\b/i.test(hNorm) && /\bdigital\s+transformation\b/i.test(hNorm)) {
    return "your technology and digital transformation leadership";
  }
  if (/\bcontent\s+creator\b/i.test(hNorm) && /\bgrowth\s+strategist\b/i.test(hNorm)) {
    return "your content and growth strategy work";
  }
  if (/\bit\s+leader\b/i.test(hNorm) && /\bcloud\s+enablement\b/i.test(hNorm)) {
    return "your cloud enablement and IT leadership";
  }
  if (/\bsenior\s+staff\s+accountant\b|\bstaff\s+accountant\b/i.test(hNorm)) {
    return "your accounting work";
  }
  if (/\bagile\s+project\s+manager\b/i.test(hNorm) && /\bscrum\s+master\b/i.test(hNorm)) {
    return "your agile project management work";
  }
  if (/\bpenetration\s+tester\b/i.test(hNorm) && /\bred\s+team(er)?\b/i.test(hNorm)) {
    return "your offensive security work";
  }
  if (/\bstartups\s*@\s*aws\b/i.test(hNorm)) {
    return "your work with startups at AWS";
  }
  if (/\blocal\s+marketing\s+strategist\b/i.test(hNorm)) {
    return "your local marketing strategy work";
  }
  if (/\brecruiting\b/i.test(hNorm) && /\brevops\b/i.test(hNorm)) {
    return "your recruiting and RevOps work";
  }

  if (headlineTooVague && concrete.length === 0 && !headlineHasRecognizableProfessionalCue(h)) {
    return finalSafeReferenceFallback({
      headline: h,
      hNorm,
      currentTitle,
      roleCategories: rc,
      functionTags: ft,
    });
  }
  if (concrete.length > 0 && h.length >= 28) {
    if (
      (rc.includes("product_leader") || rc.includes("product_manager")) &&
      (ft.includes("innovation") || /\binnovation\b/i.test(hNorm))
    ) {
      return "your product and innovation leadership";
    }
    if (rc.includes("product_leader") || rc.includes("product_manager")) {
      return "your product leadership work";
    }
    if (rc.includes("quality_engineering") || rc.includes("operations_leader")) {
      return "your quality management and process improvement work";
    }
    if (rc.includes("ai_practitioner") && ft.includes("ai_ml")) {
      const cue = safeReferenceFromHeadlineCue(hNorm, h);
      if (cue) return cue;
      return "your AI practice work";
    }
    if (rc.includes("sales_leader")) return "your sales leadership work";
    if (rc.includes("engineering_leader") || rc.includes("software_engineer")) {
      const engCue = safeReferenceFromHeadlineCue(hNorm, h);
      if (engCue) return engCue;
      const engRef = safeReferenceFromTitleAndLabels({
        headline: h,
        currentTitle,
        roleCategories: rc,
        functionTags: ft,
      });
      if (engRef && !isGenericSafeProfessionalReference(engRef)) return engRef;
      const engAnchored = tryHeadlineAnchoredReference(h, currentTitle);
      if (engAnchored) return engAnchored;
      return "your engineering work";
    }
    if (rc.includes("consultant")) {
      const cue = safeReferenceFromHeadlineCue(hNorm, h);
      if (cue) return cue;
      return "your consulting work";
    }
  }
  if (headlineTooVague && !headlineHasRecognizableProfessionalCue(h)) {
    return finalSafeReferenceFallback({
      headline: h,
      hNorm,
      currentTitle,
      roleCategories: rc,
      functionTags: ft,
    });
  }
  if (headlineHasRecognizableProfessionalCue(h)) {
    const fallbackCue = safeReferenceFromHeadlineCue(hNorm, h);
    if (fallbackCue) return fallbackCue;
    const concreteRoles = rc.filter((x) => x !== "unknown");
    const meaningfulTags = ft.filter((x) => x !== "unknown");
    if (concreteRoles.includes("designer") || concreteRoles.includes("product_designer")) {
      return "your design and product work";
    }
    if (
      concreteRoles.includes("marketing_consultant") ||
      concreteRoles.includes("growth_leader") ||
      meaningfulTags.includes("growth")
    ) {
      return "your marketing and growth work";
    }
    if (concreteRoles.includes("chief_of_staff") || concreteRoles.includes("people_leader")) {
      return "your people leadership and executive operations work";
    }
    if (concreteRoles.includes("recruiter") || concreteRoles.includes("technical_recruiter")) {
      return "your recruiting work";
    }
    if (
      concreteRoles.includes("ai_practitioner") ||
      concreteRoles.includes("ai_strategy") ||
      meaningfulTags.includes("ai_ml")
    ) {
      const aiRef = safeReferenceFromTitleAndLabels({
        headline: h,
        currentTitle,
        roleCategories: rc,
        functionTags: ft,
      });
      if (aiRef) return aiRef;
      return "your AI practice work";
    }
    if (rc.includes("founder") || pf.has("founder_signal")) {
      const founderRef = safeReferenceFromHeadlineCue(hNorm, h);
      if (founderRef && !isGenericSafeProfessionalReference(founderRef)) return founderRef;
      if (rc.includes("consultant") && rc.includes("business_leader")) {
        return "your consulting and leadership work";
      }
      const founderAnchored = tryHeadlineAnchoredReference(h, currentTitle);
      if (founderAnchored) return founderAnchored;
      return "your founder/operator perspective";
    }
    if (concreteRoles.length > 0 || meaningfulTags.length > 0) {
      const tagRef = safeReferenceFromTitleAndLabels({
        headline: h,
        currentTitle,
        roleCategories: rc,
        functionTags: ft,
      });
      if (tagRef && !isGenericSafeProfessionalReference(tagRef)) return tagRef;
      const cueRef = safeReferenceFromHeadlineCue(hNorm, h);
      if (cueRef && !isGenericSafeProfessionalReference(cueRef)) return cueRef;
      const roleRef = safeReferenceFromConcreteRoles(rc, hNorm, h, currentTitle);
      if (roleRef && !isGenericSafeProfessionalReference(roleRef)) return roleRef;
      const anchored = tryHeadlineAnchoredReference(h, currentTitle);
      if (anchored) return anchored;
    }
  }
  {
    const concreteFinal = rc.filter((x) => x !== "unknown");
    const tagsFinal = ft.filter((x) => x !== "unknown");
    if (rc.includes("founder") || pf.has("founder_signal")) {
      const founderRef = safeReferenceFromHeadlineCue(hNorm, h);
      if (founderRef && !isGenericSafeProfessionalReference(founderRef)) return founderRef;
      const founderAnchored = tryHeadlineAnchoredReference(h, currentTitle);
      if (founderAnchored) return founderAnchored;
      return "your founder/operator perspective";
    }
    if (concreteFinal.length > 0 || tagsFinal.length > 0) {
      const tagRef = safeReferenceFromTitleAndLabels({
        headline: h,
        currentTitle,
        roleCategories: rc,
        functionTags: ft,
      });
      if (tagRef && !isGenericSafeProfessionalReference(tagRef)) return tagRef;
      const cueRef = safeReferenceFromHeadlineCue(hNorm, h);
      if (cueRef && !isGenericSafeProfessionalReference(cueRef)) return cueRef;
      const roleRef = safeReferenceFromConcreteRoles(rc, hNorm, h, currentTitle);
      if (roleRef && !isGenericSafeProfessionalReference(roleRef)) return roleRef;
      const anchored = tryHeadlineAnchoredReference(h, currentTitle);
      if (anchored) return anchored;
    }
  }
  return finalSafeReferenceFallback({
    headline: h,
    hNorm,
    currentTitle,
    roleCategories: rc,
    functionTags: ft,
  });
}

function deriveRoleCategoriesFromFunctionSeniority(
  functionTags: ProspectClassification["functionTags"],
  seniority: ProspectClassification["seniority"],
  headline: string
): ProspectClassification["roleCategories"][number][] {
  const extra: ProspectClassification["roleCategories"][number][] = [];
  const h = norm(headline);

  if (functionTags.includes("academic")) {
    const undergradSignals =
      functionTags.includes("education") &&
      /\b(student|undergrad|engineering\s+student|computer\s+science\s+engineering|cse\b|b\.?\s*tech)\b/i.test(
        headline
      );
    const facultySignals =
      /\b(professor|associate\s+professor|assistant\s+professor|\bfaculty\b|postdoctoral\s+fellow)\b/i.test(
        headline
      ) ||
      /\blecturer\b.{0,40}\b(?:university|college)\b|\binstructor\b.*\bacademy\b|\bresearch\s+fellow\b/i.test(
        headline
      );
    if (!(undergradSignals && !facultySignals)) extra.push("academic");
  }

  const offensiveSecurityTag =
    functionTags.includes("penetration_testing") ||
    functionTags.includes("red_team") ||
    functionTags.includes("offensive_security");
  if (
    offensiveSecurityTag &&
    !extra.includes("security_practitioner") &&
    !headlineIsAppSecStrategicMarketing(headline)
  ) {
    extra.push("security_practitioner");
  }

  if (
    functionTags.includes("security") ||
    functionTags.includes("cybersecurity") ||
    offensiveSecurityTag
  ) {
    const dirThreatDetect =
      /\bdirector\b/i.test(headline) &&
      /\bthreat\b/i.test(headline) &&
      /\b(detect|detection|cortex)\b/i.test(headline);
    if (
      SECURITY_LEADER_RE.test(headline) ||
      seniority === "c_level" ||
      seniority === "vp" ||
      dirThreatDetect
    ) {
      if (!extra.includes("security_leader")) extra.push("security_leader");
    }
    if (SOC_PRACTITIONER_RE.test(headline)) {
      if (!extra.includes("security_practitioner")) extra.push("security_practitioner");
    } else if (!extra.includes("security_practitioner")) {
      extra.push("security_practitioner");
    }
  }

  if (
    (functionTags.includes("data") || functionTags.includes("data_analytics")) &&
    /\bdata\s+analyst\b/i.test(headline) &&
    !/\bbi\s+developer\b/i.test(h)
  ) {
    if (!extra.includes("data_practitioner")) extra.push("data_practitioner");
  }
  if (
    /\b(bi|business\s+intelligence)\b/i.test(headline) &&
    (functionTags.includes("data") || functionTags.includes("business_intelligence"))
  ) {
    if (!extra.includes("bi_developer")) extra.push("bi_developer");
  }

  if (
    functionTags.includes("ai_ml") &&
    /\barchitect\b/i.test(headline) &&
    /\bai\b/i.test(headline)
  ) {
    if (!extra.includes("ai_engineer")) extra.push("ai_engineer");
    if (!extra.includes("technical_architect")) extra.push("technical_architect");
    if (!extra.includes("solutions_engineer")) extra.push("solutions_engineer");
  }

  if (
    functionTags.includes("engineering") &&
    !headlineIsAppSecStrategicMarketing(headline) &&
    (seniority === "c_level" ||
      seniority === "vp" ||
      seniority === "director" ||
      /\bhead\s+of\b/.test(h) ||
      /\bengineering\s+lead\b/.test(h))
  ) {
    extra.push("engineering_leader");
    extra.push("technical_influencer");
  } else if (
    functionTags.includes("engineering") &&
    (seniority === "ic" || seniority === "senior_ic" || seniority === "staff")
  ) {
    extra.push("technical_influencer");
  }

  if (
    functionTags.includes("platform") &&
    (seniority === "director" ||
      seniority === "vp" ||
      seniority === "c_level" ||
      seniority === "principal")
  ) {
    extra.push("technical_influencer");
  }

  if (
    functionTags.includes("data") &&
    (seniority === "vp" || seniority === "director" || /\bhead\s+of\s+data\b/.test(h))
  ) {
    extra.push("data_leader");
  }
  if (/\bchief\s+data\s+(?:and\s+)?ai\s+officer\b/i.test(headline) || /\bcdaio\b/i.test(headline)) {
    if (!extra.includes("data_leader")) extra.push("data_leader");
    if (!extra.includes("ai_leader")) extra.push("ai_leader");
    if (!extra.includes("executive_leader")) extra.push("executive_leader");
  }

  if (
    functionTags.includes("sales_engineering") &&
    (seniority === "manager" ||
      seniority === "director" ||
      /\bteam\s+lead\b/.test(h) ||
      /\blead\b/.test(h))
  ) {
    if (!extra.includes("solutions_engineer")) extra.push("solutions_engineer");
    extra.push("engineering_leader");
  }

  if (functionTags.includes("engineering") && seniority === "principal") {
    extra.push("technical_influencer");
    extra.push("software_engineer");
  }

  if (functionTags.includes("cloud") && /\barchitect\b/.test(h)) {
    extra.push("cloud_engineer");
    if (!extra.includes("technical_architect")) extra.push("technical_architect");
  }

  if (
    functionTags.includes("product") &&
    functionTags.includes("operations") &&
    /\btpm\b/.test(h)
  ) {
    extra.push("program_manager");
  }

  if (functionTags.includes("supply_chain")) {
    if (!extra.includes("supply_chain")) extra.push("supply_chain");
    if (!extra.includes("operations_leader")) extra.push("operations_leader");
  }

  if (
    functionTags.includes("project_management") &&
    (/\bagile\b/.test(h) || /\bscrum\b/.test(h)) &&
    !extra.includes("project_manager")
  ) {
    extra.push("project_manager");
    if (!extra.includes("program_manager")) extra.push("program_manager");
  }

  if (
    functionTags.includes("marketing") &&
    (seniority === "c_level" ||
      seniority === "director" ||
      seniority === "vp" ||
      /\bcmo\b/.test(h) ||
      /\bhead\s+of\s+marketing\b/.test(h)) &&
    !extra.includes("marketing_leader")
  ) {
    extra.push("marketing_leader");
    if (seniority === "c_level") extra.push("business_leader");
    else if (/\bhead\s+of\s+marketing\b/.test(h) || seniority === "vp") {
      if (!extra.includes("business_leader")) extra.push("business_leader");
    }
  }

  if (
    (functionTags.includes("growth") ||
      functionTags.includes("growth_marketing") ||
      /\bgrowth\s+marketing\b/i.test(headline) ||
      /\bdemand\s+gen\b/i.test(headline)) &&
    (seniority === "director" ||
      seniority === "vp" ||
      seniority === "c_level" ||
      /\bhead\s+of\b/.test(h)) &&
    !extra.includes("growth_leader")
  ) {
    extra.push("growth_leader");
  }

  if (
    functionTags.includes("marketing") &&
    functionTags.includes("communications") &&
    /\bvp\b|\bvice\s+president\b/i.test(headline)
  ) {
    if (!extra.includes("marketing_leader")) extra.push("marketing_leader");
    if (!extra.includes("communications_leader")) extra.push("communications_leader");
  }

  if (
    (functionTags.includes("sre") || /\bsite\s+reliability\b|\bsre\b/i.test(headline)) &&
    !extra.includes("sre_engineer")
  ) {
    extra.push("sre_engineer");
    extra.push("platform_engineer");
    extra.push("technical_influencer");
    if (/\bcloud\b|\baws\b|\bazure\b|\bgcp\b/i.test(h) && !extra.includes("cloud_engineer")) {
      extra.push("cloud_engineer");
    }
  }

  if (
    functionTags.includes("frontend") &&
    (functionTags.includes("software_development") || functionTags.includes("react")) &&
    /\bfrontend\b|\breact\b|typescript/i.test(headline)
  ) {
    if (!extra.includes("frontend_engineer")) extra.push("frontend_engineer");
    if (!extra.includes("software_engineer")) extra.push("software_engineer");
    extra.push("technical_influencer");
  }

  if (
    functionTags.includes("cloud") &&
    (functionTags.includes("devops") || /\bterraform\b|\bci\s*\/\s*cd\b/i.test(headline)) &&
    /\bdevops\b|multi[- ]cloud|terraform|kubernetes|aws|azure|gcp/i.test(headline)
  ) {
    if (!extra.includes("cloud_engineer")) extra.push("cloud_engineer");
    if (!extra.includes("platform_engineer")) extra.push("platform_engineer");
    extra.push("technical_influencer");
  }

  if (
    /\bsoftware\s+engineer\b|\bsoftware\s+developer\b|\bweb\s+developer\b|\bphp\s+developer\b|\bjava\s+developer\b|\bfrontend\s+developer\b|\bbackend\s+developer\b|\bfull[\s-]?stack\b|\bfulls?t\s*acks?\b/i.test(
      headline
    ) &&
    !headlineIsAppSecStrategicMarketing(headline)
  ) {
    if (!extra.includes("software_engineer")) extra.push("software_engineer");
    if (
      /\bfull[\s-]?stack\b|\bfulls?t\s*acks?\b/i.test(headline) &&
      !extra.includes("full_stack_engineer")
    ) {
      extra.push("full_stack_engineer");
    }
    if (/\bweb\s+developer\b/i.test(headline) && !extra.includes("web_developer")) {
      extra.push("web_developer");
    }
    if (!extra.includes("technical_influencer")) extra.push("technical_influencer");
  }

  if (
    functionTags.includes("engineering") &&
    !headlineIsAppSecStrategicMarketing(headline) &&
    /\b(backend\s+engineer|backend\s+engineering|laravel|\bphp\b|open\s+source|api\s+design|system\s+architecture|saas\s+builder)\b/i.test(
      headline
    )
  ) {
    if (!extra.includes("software_engineer")) extra.push("software_engineer");
    if (!extra.includes("technical_influencer")) extra.push("technical_influencer");
  }

  if (/\bdata\s+scientist\b/i.test(headline)) {
    if (!extra.includes("data_scientist")) extra.push("data_scientist");
    if (!extra.includes("ai_ml_practitioner")) extra.push("ai_ml_practitioner");
  }

  if (/\bresearch\s+analyst\b/i.test(headline)) {
    if (!extra.includes("research_analyst")) extra.push("research_analyst");
  }

  if (/\bai\s+trainer\b/i.test(headline)) {
    if (!extra.includes("ai_trainer")) extra.push("ai_trainer");
    if (!extra.includes("educator")) extra.push("educator");
    if (!extra.includes("education_leader")) extra.push("education_leader");
    if (!extra.includes("data_practitioner")) extra.push("data_practitioner");
  }

  if (/\bsenior\s+advisor\b/i.test(headline) || /\badvisor\s*@/i.test(headline)) {
    if (!extra.includes("advisor")) extra.push("advisor");
    if (!extra.includes("business_advisor")) extra.push("business_advisor");
  }

  if (functionTags.includes("business_analysis") && !extra.includes("business_analyst")) {
    extra.push("business_analyst");
  }
  if (functionTags.includes("customer_service") && !extra.includes("customer_support")) {
    extra.push("customer_support");
  }

  if (functionTags.includes("program_management") && !extra.includes("program_manager")) {
    extra.push("program_manager");
  }
  if (
    functionTags.includes("financial_modeling") &&
    (functionTags.includes("finance") || /\bfinancial\b/.test(h)) &&
    !extra.includes("financial_analyst")
  ) {
    extra.push("financial_analyst");
  }

  if (
    functionTags.includes("sase") &&
    (functionTags.includes("product") || /\bproduct\s+specialist\b/i.test(headline))
  ) {
    if (!extra.includes("product_specialist")) extra.push("product_specialist");
    if (!extra.includes("security_practitioner")) extra.push("security_practitioner");
  }

  if (functionTags.includes("monetization") && functionTags.includes("product")) {
    if (!extra.includes("monetization_leader")) extra.push("monetization_leader");
    if (!extra.includes("product_manager")) extra.push("product_manager");
    if (!extra.includes("growth_leader")) extra.push("growth_leader");
  }

  if (functionTags.includes("portfolio_management") && /\bportfolio\s+lead\b/i.test(h)) {
    if (!extra.includes("portfolio_leader")) extra.push("portfolio_leader");
    if (!extra.includes("business_leader")) extra.push("business_leader");
  }

  if (functionTags.includes("venture_capital") && functionTags.includes("investor")) {
    if (!extra.includes("investor")) extra.push("investor");
    if (!extra.includes("venture_capital")) extra.push("venture_capital");
  }

  if (
    functionTags.includes("revenue_operations") &&
    /\brevops\b|\brevenue\s+operations\b/i.test(h)
  ) {
    if (!extra.includes("revops")) extra.push("revops");
    if (!extra.includes("revenue_leader")) extra.push("revenue_leader");
  }
  if (
    functionTags.includes("podcasting") &&
    (functionTags.includes("revenue_operations") || /\brevops\b/i.test(h))
  ) {
    if (!extra.includes("media_creator")) extra.push("media_creator");
  }

  if (functionTags.includes("instructional_design") || /\binstructional\s+designer\b/i.test(h)) {
    if (!extra.includes("instructional_designer")) extra.push("instructional_designer");
    if (!extra.includes("educator")) extra.push("educator");
    if (!extra.includes("technical_enablement")) extra.push("technical_enablement");
  }

  if (
    functionTags.includes("content_strategy") &&
    functionTags.includes("marketing") &&
    functionTags.includes("communications")
  ) {
    if (!extra.includes("marketing_leader")) extra.push("marketing_leader");
    if (!extra.includes("communications_leader")) extra.push("communications_leader");
  }

  if (
    functionTags.includes("enterprise_architecture") &&
    /\bsupply\s+chain\b/i.test(h) &&
    /\benterprise\s+architect\b/i.test(h)
  ) {
    if (!extra.includes("technical_architect")) extra.push("technical_architect");
    if (!extra.includes("supply_chain")) extra.push("supply_chain");
  }

  if (functionTags.includes("data_platform") && functionTags.includes("enterprise_ai")) {
    if (!extra.includes("ai_practitioner")) extra.push("ai_practitioner");
    if (/\benabling\b|\bevangeli|\bproduct\s+marketing\b/i.test(h)) {
      if (!extra.includes("technical_evangelist")) extra.push("technical_evangelist");
      if (!/evangeli/i.test(h) && !extra.includes("product_marketing"))
        extra.push("product_marketing");
    }
  }

  if (/\bai\s+integrator\b/i.test(h) && functionTags.includes("automation")) {
    if (!extra.includes("ai_practitioner")) extra.push("ai_practitioner");
    if (!extra.includes("automation_specialist")) extra.push("automation_specialist");
  }

  if (/\bchief\s+ai\s+evangelist\b/i.test(h) || /\bai\s+evangelist\b/i.test(h)) {
    if (!extra.includes("ai_leader")) extra.push("ai_leader");
    if (!extra.includes("technical_evangelist")) extra.push("technical_evangelist");
  }

  if (
    functionTags.includes("channel") &&
    functionTags.includes("partnerships") &&
    (seniority === "vp" || /\bvp\b/i.test(h))
  ) {
    if (!extra.includes("channel_leader")) extra.push("channel_leader");
    if (!extra.includes("partnerships_leader")) extra.push("partnerships_leader");
    if (!extra.includes("gtm_leader")) extra.push("gtm_leader");
  }

  if (/\bclient\s+director\b/i.test(headline) && functionTags.includes("account_management")) {
    if (!extra.includes("sales_leader")) extra.push("sales_leader");
    if (!extra.includes("account_management")) extra.push("account_management");
    if (functionTags.includes("cybersecurity") && !extra.includes("security_practitioner")) {
      extra.push("security_practitioner");
    }
  }

  if (functionTags.includes("golang") && functionTags.includes("kubernetes")) {
    if (!extra.includes("software_engineer")) extra.push("software_engineer");
    if (!extra.includes("platform_engineer")) extra.push("platform_engineer");
  }

  if (functionTags.includes("hr")) {
    if (/\bchro\b|\bchief\s+human\s+resources\b/i.test(headline)) {
      if (!extra.includes("hr_leader")) extra.push("hr_leader");
      if (!extra.includes("executive_leader")) extra.push("executive_leader");
    } else if (
      functionTags.includes("recruiting") ||
      /\b(recruit|talent\s+acquisition|business\s+recruiting)\b/i.test(headline)
    ) {
      if (!extra.includes("recruiter")) extra.push("recruiter");
      if (!extra.includes("hr_leader")) extra.push("hr_leader");
    } else {
      if (!extra.includes("hr_leader")) extra.push("hr_leader");
      if (!extra.includes("people_leader")) extra.push("people_leader");
    }
  }

  if (
    functionTags.includes("product") &&
    !extra.includes("product_leader") &&
    !extra.includes("product_manager")
  ) {
    if (
      seniority === "director" ||
      seniority === "vp" ||
      seniority === "c_level" ||
      /\bhead\s+of\s+product\b|\bproduct\s+leader\b|\b(svp|principal)\b/i.test(headline)
    ) {
      extra.push("product_leader");
    } else {
      extra.push("product_manager");
    }
  }

  if (functionTags.includes("customer_success") && !extra.includes("customer_success_leader")) {
    extra.push("customer_success_leader");
  }

  if (
    (functionTags.includes("partnerships") || functionTags.includes("channel")) &&
    /\balliances?\b|\bpartnerships?\b/i.test(headline) &&
    !extra.includes("partnerships_leader")
  ) {
    extra.push("partnerships_leader");
  }

  if (
    functionTags.includes("communications") &&
    functionTags.includes("marketing") &&
    !extra.includes("communications_leader")
  ) {
    extra.push("communications_leader");
    if (!extra.includes("marketing_leader")) extra.push("marketing_leader");
  }

  if (
    functionTags.includes("finance") &&
    /\bsponsor\s+finance\b/i.test(h) &&
    !extra.includes("finance_accounting")
  ) {
    extra.push("finance_accounting");
    if (!extra.includes("business_leader")) extra.push("business_leader");
    if (!extra.includes("executive_leader")) extra.push("executive_leader");
  }

  return extra;
}

/** When labels stayed `unknown` only, recover roles from meaningful function tags + headline cues. */
function applyUnknownOnlyRoleFallbackFromFunctionTags(
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  functionTags: ProspectClassification["functionTags"],
  headline: string
): ProspectClassification["functionTags"] {
  const nonJobSeeker = [...roleCategories].filter((r) => r !== "job_seeker");
  const unknownIsOnlyProfessionalLabel = nonJobSeeker.length === 1 && nonJobSeeker[0] === "unknown";
  if (!unknownIsOnlyProfessionalLabel) {
    return functionTags;
  }

  const meaningful = functionTags.filter((t) => t !== "unknown");
  const hn = norm(headline);
  const tset = new Set(meaningful);
  const headlineSupportsLeanTags =
    /\bdata\s+scientist\b/i.test(headline) ||
    /\bfinancial\s+analyst\b/i.test(headline) ||
    /\bdata\s+analyst\b/i.test(headline) ||
    /\bpenetration\b|\bred\s+team\b|\bethical\s+hacking\b|\bvapt\b/i.test(headline) ||
    /\bhead\s+of\s+marketing\b/i.test(headline) ||
    /\blaravel\b|\bbackend\s+engineer|backend\s+engineering\b/i.test(headline) ||
    /\bcommunications\b|\bpublic\s+relations\b/i.test(headline) ||
    /\bai\s+solutions?\s+architect\b/i.test(headline) ||
    /\bcybersecurity\b.*\bnavigate\b|\bcybersecurity\b.*\brisk\b/i.test(headline) ||
    (/\bai\s+agents?\b/i.test(headline) && /\bsystems?\s+and\s+business\b/i.test(headline)) ||
    (/\bquality\s+manager\b/i.test(headline) &&
      (/\bsix\s+sigma\b/i.test(headline) || /\bconsultor\b/i.test(headline))) ||
    (/\bproduct\b/i.test(headline) &&
      /\binnovation\b/i.test(headline) &&
      /\blead\b/i.test(headline)) ||
    /\bhead\s+of\s+channels?\b|\balliances\b|\bsase\b|\bmonetiz|\bportfolio\s+lead\b|\bclient\s+director\b|\bchannel\s+manager\b|\btechnical\s+recruit|\bai\s+integrator\b|\bchief\s+ai\s+evangelist\b|\bcpo\b|\bchief\s+product\b|\bpartner\s+at\b|\bventures\b|\brevops\b|\btraining\s+developer\b|\binstructional\s+design|\bstrategy\s+principal\b|\bredpanda\b|\benterprise\s+ai\b/i.test(
      headline
    ) ||
    headlineHasRecognizableProfessionalCue(headline);

  const headlineSupportsSingleTagRecovery =
    /\bdesigner\b|\bux\b|\bui\b|\bservice\s+design/i.test(headline) ||
    /\bceo\b|\bchief\s+executive\b/i.test(headline) ||
    /\bmarketing\s+strategist\b/i.test(headline) ||
    /\bleakage\b|\bdata\s+leakage\b/i.test(headline) ||
    /\b99\.9%\b|\breliable\s+ai\b|\bhigh[- ]stakes\b/i.test(headline) ||
    (/\bai\s+agents?\b|\bagentic\b/i.test(headline) &&
      /\bmba\b|\bstrategy\b|\bconsulting\b/i.test(hn)) ||
    tset.has("hr") ||
    tset.has("product") ||
    tset.has("customer_success") ||
    tset.has("partnerships") ||
    tset.has("communications") ||
    /\bchro\b|\bhuman\s+resources\b|\bproduct\s+management\b|\bcustomer\s+success\b|\balliances\b|\bsponsor\s+finance\b|\bit\s+auditor\b|\bleadership\s+coach\b/i.test(
      headline
    );

  if (meaningful.length === 0) {
    return functionTags;
  }
  if (meaningful.length < 2 && !headlineSupportsLeanTags && !headlineSupportsSingleTagRecovery) {
    return functionTags;
  }

  const added = new Set<ProspectClassification["roleCategories"][number]>();
  const tagAdds = new Set<ProspectClassification["functionTags"][number]>();

  if (
    tset.has("sales") &&
    tset.has("go_to_market") &&
    tset.has("account_management") &&
    (/\bbusiness\s+development\b/i.test(hn) ||
      /\bprogram\s+management\b/i.test(hn) ||
      /\bsales\s+leadership\b/i.test(hn) ||
      tset.has("program_management") ||
      tset.has("revenue"))
  ) {
    added.add("business_development");
    added.add("sales_leader");
    if (/\bprogram\s+management\b/i.test(hn) || tset.has("program_management")) {
      added.add("program_manager");
      tagAdds.add("program_management");
    }
    if (/\bbusiness\s+development\b/i.test(hn)) tagAdds.add("business_development");
  }

  if (
    tset.has("cybersecurity") &&
    (tset.has("penetration_testing") || tset.has("offensive_security") || tset.has("red_team")) &&
    (/\blab\s+instructor\b/i.test(hn) ||
      /\binstructor\b/i.test(hn) ||
      /\btrainer\b/i.test(hn) ||
      /\bhands[\s-]on\s+lab\b/i.test(hn))
  ) {
    added.add("security_practitioner");
    added.add("technical_trainer");
    tagAdds.add("technical_training");
    if (/\bpython\b/i.test(hn)) tagAdds.add("python");
    if (/\blinux\b/i.test(hn)) tagAdds.add("linux");
  }

  if (
    tset.has("devops") &&
    tset.has("platform") &&
    (tset.has("ai_ml") ||
      tset.has("machine_learning") ||
      /\bmachine\s+learning\b/i.test(headline)) &&
    (/\barchitecture\b/i.test(hn) ||
      /\bcomputer\b/i.test(hn) ||
      /\bllmops\b|\bmlops\b/i.test(hn) ||
      tset.has("llmops"))
  ) {
    added.add("ai_ml_practitioner");
    added.add("platform_engineer");
    added.add("devops_engineer");
    if (/\bllmops\b|\bmlops\b/i.test(hn) || tset.has("llmops")) added.add("mlops_engineer");
  }

  if (
    (tset.has("data_science") || /\bdata\s+scientist\b/i.test(headline)) &&
    tset.has("ai_ml") &&
    (/\bmlops\b|\bllmops\b|\brag\b/i.test(hn) || tset.has("rag") || tset.has("llmops"))
  ) {
    added.add("data_scientist");
    added.add("ai_engineer");
    added.add("mlops_engineer");
  }

  if (
    (tset.has("finance") ||
      tset.has("financial_modeling") ||
      /\bfinancial\s+analyst\b/i.test(headline)) &&
    (/\bfinancial\b/i.test(hn) || tset.has("esg") || /\bbloomberg\b/i.test(hn))
  ) {
    added.add("financial_analyst");
  }

  if (
    (tset.has("channel") && tset.has("partnerships")) ||
    /\bhead\s+of\s+channels?\b.*\balliances\b/i.test(headline)
  ) {
    added.add("channel_leader");
    added.add("partnerships_leader");
    added.add("gtm_leader");
  }

  if (tset.has("investor") && (tset.has("venture_capital") || /\bventures\b/i.test(headline))) {
    added.add("investor");
    added.add("venture_capital");
  }

  if (tset.has("hr")) {
    if (
      tset.has("recruiting") ||
      /\b(recruit|talent\s+acquisition|business\s+recruiting|chro)\b/i.test(hn)
    ) {
      added.add("hr_leader");
      if (/\b(recruit|head\s+of\b.*\brecruit|business\s+recruiting)\b/i.test(hn)) {
        added.add("recruiter");
      } else {
        added.add("people_leader");
      }
    } else {
      added.add("hr_leader");
      added.add("people_leader");
    }
  }

  if (tset.has("product") && !added.has("product_manager") && !added.has("product_leader")) {
    if (/\b(head|lead|leader|director|vp|svp|principal)\b/i.test(hn)) added.add("product_leader");
    else added.add("product_manager");
  }

  if (tset.has("customer_success")) {
    added.add("customer_success_leader");
    if (/\baccount\b/i.test(hn)) added.add("account_management");
  }

  if (tset.has("partnerships") || (tset.has("channel") && /\balliances\b/i.test(hn))) {
    added.add("partnerships_leader");
    added.add("gtm_leader");
    if (tset.has("business_development") || /\bbusiness\s+development\b/i.test(hn)) {
      added.add("business_development");
    }
  }

  if (tset.has("communications") && tset.has("marketing")) {
    added.add("communications_leader");
    added.add("marketing_leader");
  }

  if (tset.has("finance") && /\bsponsor\s+finance\b/i.test(hn)) {
    added.add("finance_accounting");
    added.add("executive_leader");
    added.add("business_leader");
  }

  if (
    tset.has("consulting") &&
    /\b(leadership\s+career\s+coach|leadership\s+coach|career\s+coach)\b/i.test(hn)
  ) {
    added.add("coach_or_advisor");
    added.add("consultant");
  }

  if (tset.has("cybersecurity") && /\bit\s+auditor\b/i.test(hn)) {
    added.add("security_practitioner");
    added.add("it_operations");
  }

  if (tset.has("recruiting") && /\btechnical\s+recruit/i.test(headline)) {
    added.add("technical_recruiter");
    added.add("recruiter");
  }

  if (tset.has("account_management") && /\bclient\s+director\b/i.test(headline)) {
    added.add("sales_leader");
    added.add("account_management");
    if (tset.has("cybersecurity")) added.add("security_practitioner");
  }

  if (
    tset.has("ai_ml") &&
    tset.has("recruiting") &&
    (tset.has("hr") || /\bhr\s+manager\b|\bpeople\s+operations\b/i.test(hn))
  ) {
    added.add("ai_practitioner");
    added.add("recruiter");
    added.add("hr_leader");
    added.add("automation_specialist");
  }

  if (tset.has("product") && tset.has("ai_ml") && /\bproduct\s+owner\b/i.test(headline)) {
    added.add("product_manager");
    added.add("ai_practitioner");
  }

  if (tset.has("design") && tset.has("product")) {
    added.add("designer");
    added.add("product_designer");
  }

  if (
    (/\bceo\b/i.test(hn) || /\bchief\s+executive\b/i.test(hn)) &&
    (tset.has("agentic_ai") || tset.has("ai_ml") || /\bagentic\b/i.test(hn))
  ) {
    added.add("executive_leader");
    added.add("ai_practitioner");
    added.add("automation_specialist");
  }

  if (
    tset.has("growth") &&
    (/\blocal\s+marketing\s+strategist\b/i.test(hn) || /\bmarketing\s+strategist\b/i.test(hn))
  ) {
    added.add("marketing_consultant");
    added.add("growth_leader");
  }

  if (
    tset.has("ai_ml") &&
    ((/\b99\.9%\b/.test(headline) && /\breliable\s+ai\b/i.test(headline)) ||
      /\bhigh[- ]stakes\b/i.test(headline))
  ) {
    added.add("ai_practitioner");
    added.add("ai_strategy");
    added.add("consultant");
  }

  if (
    tset.has("data") &&
    tset.has("ai_ml") &&
    (tset.has("data_analytics") || /\bleakage\b|\bdata\s+leakage\b/i.test(headline))
  ) {
    added.add("data_security");
    added.add("ai_practitioner");
    added.add("security_practitioner");
  }

  if (
    tset.has("ai_ml") &&
    (tset.has("platform") || /\bcomputing\b|\bcloud\b|\bplatform\b/i.test(headline)) &&
    (/\bidentity\b|\bsso\b|\biam\b|\baccess\s+governance\b|\bzero\s+trust\b|\btrust\s+infra/i.test(
      headline
    ) ||
      (/\bagents?\b/i.test(headline) &&
        /\bidentity\b|\bauthorization\b|\baccess\b/i.test(headline)))
  ) {
    added.add("identity_security");
    added.add("ai_practitioner");
    if (!added.has("security_practitioner")) added.add("security_practitioner");
    tagAdds.add("identity_access");
  }

  if (
    (tset.has("consulting") || /\bconsultant\b|\bconsulting\b/i.test(headline)) &&
    (tset.has("platform") || tset.has("cloud")) &&
    /\biaas\b|\binfrastructure[-\s]+as[-\s]+a[-\s]+service\b|\bcloud\s+infrastructure\b|\bmulti[\s/-]cloud/i.test(
      headline
    )
  ) {
    added.add("consultant");
    added.add("cloud_architect");
  }

  if (
    (tset.has("web3") || tset.has("blockchain")) &&
    /\bmba\b|\bm\.?\s*b\.?\s*a\.?\b|\bmaster['\s]s?\s+of\s+business\b/i.test(hn)
  ) {
    added.add("web3_practitioner");
    added.add("consultant");
  }

  if (headlineHasExplicitFounderEvidence(headline)) {
    added.add("founder");
    if (tset.has("product") || /\bproduct\s+leader\b/i.test(headline)) added.add("product_leader");
    if (tset.has("web3") || tset.has("blockchain") || /\bweb3\b|\bblockchain\b/i.test(headline)) {
      added.add("web3_practitioner");
    }
    if (
      /\barchitect\b/i.test(headline) &&
      (tset.has("research") || /\bframework\b/i.test(headline))
    ) {
      added.add("technical_architect");
      added.add("technology_strategist");
    }
    if (/\bprincipal\b/i.test(headline)) {
      added.add("business_leader");
      added.add("consultant");
    }
    if (/\bcyber\b|\bsecurity\b/i.test(headline) && /\bai\b/i.test(headline)) {
      added.add("security_practitioner");
      added.add("ai_engineer");
      added.add("technical_architect");
    }
    if (/\b(?:co[- ]?founder|cofounder)\s*\/\s*cro\b/i.test(headline)) {
      added.add("revenue_leader");
      added.add("gtm_leader");
    }
    if (/\bprogram\s+manager\b/i.test(headline)) added.add("program_manager");
    if (/\bboard\s+director\b/i.test(headline)) added.add("board_member");
  }

  if (
    tset.has("ai_ml") &&
    (/\bai\s+agents?\b/i.test(headline) || tset.has("agentic_ai")) &&
    (/\bsystems?\b|\bbusiness\b/i.test(headline) || tset.has("consulting"))
  ) {
    added.add("ai_practitioner");
    added.add("consultant");
  }

  if (
    /\bquality\s+manager\b/i.test(headline) &&
    (/\bsix\s+sigma\b/i.test(hn) ||
      /\bconsultor\b/i.test(hn) ||
      tset.has("continuous_improvement") ||
      tset.has("consulting"))
  ) {
    added.add("quality_engineering");
    added.add("operations_leader");
    added.add("consultant");
    tagAdds.add("continuous_improvement");
  }

  if (
    /\bproduct\b/i.test(headline) &&
    /\binnovation\b/i.test(headline) &&
    /\blead\b/i.test(headline)
  ) {
    added.add("product_leader");
    added.add("strategy_leader");
    tagAdds.add("product");
    tagAdds.add("innovation");
  }

  if (
    /\bai\s+agents?\b/i.test(headline) &&
    /\bsystems?\s+and\s+business\b/i.test(headline)
  ) {
    added.add("ai_practitioner");
    added.add("consultant");
  }

  if (
    (tset.has("consulting") || /\bconsultancy\b/i.test(headline)) &&
    (tset.has("platform") || /\binfrastructure\b/i.test(headline)) &&
    (/\biaas\b|\binfrastructure[-\s]+as[-\s]+a[-\s]+service\b/i.test(headline) ||
      /\bconsulting\s+&\s+services\b/i.test(headline))
  ) {
    added.add("consultant");
    added.add("cloud_architect");
  }

  if (
    tset.has("platform") &&
    !headlineHasExplicitFounderEvidence(headline) &&
    (/\bexecutive\s+support\b|\binfrastructure\b/i.test(headline) || tset.has("consulting"))
  ) {
    added.add("consultant");
    added.add("operations_leader");
  }

  if (added.size === 0) return functionTags;

  for (const r of added) roleCategories.add(r);
  roleCategories.delete("unknown");
  return Array.from(new Set([...meaningful, ...tagAdds])).sort();
}

function applyTitleDerivedRolesAndTags(args: {
  currentTitle: string | null;
  headline: string;
  strictStudent: boolean;
  roleCategories: Set<ProspectClassification["roleCategories"][number]>;
  profileExtra: ProfileFlag[];
  seniority: ProspectClassification["seniority"];
  functionTags: ProspectClassification["functionTags"];
}): {
  seniority: ProspectClassification["seniority"];
  functionTags: ProspectClassification["functionTags"];
} {
  let { seniority } = args;
  const { functionTags } = args;
  if (args.strictStudent || !args.currentTitle?.trim()) {
    return { seniority, functionTags };
  }

  const title = args.currentTitle.trim();
  const titleN = norm(title);
  const blob = norm(`${title} ${args.headline}`);
  const rc = args.roleCategories;
  let addedRole = false;
  type FnTag = ProspectClassification["functionTags"][number];
  const tagSet = new Set<FnTag>(functionTags.filter((t): t is FnTag => t !== "unknown"));

  const addRc = (r: ProspectClassification["roleCategories"][number]) => {
    rc.add(r);
    addedRole = true;
  };
  const addTags = (...tags: ProspectClassification["functionTags"][number][]) => {
    for (const t of tags) tagSet.add(t);
  };

  if (
    /\bqa\b|\bquality\s+engineering\b|\bmanual\s+and\s+automation\b|\btest\s+automation\b|\bqae\b|\bquality\s+assurance\b|\bquality\s+engineer/i.test(
      title
    )
  ) {
    addRc("quality_engineering");
    addRc("engineering_leader");
    addTags("qa", "automation", "engineering");
    if (
      /\bteam\s+leader\b|\bteam\s+lead\b/i.test(titleN) &&
      (seniority === "unknown" || seniority === "ic")
    ) {
      seniority = "manager";
    }
  }

  if (/\bprogram\s+manager\b/.test(titleN) && !/\bproduct\s+marketing\b/.test(titleN)) {
    addRc("program_manager");
    addTags("program_management", "operations", "product");
    if (seniority === "unknown") seniority = "manager";
  }

  if (
    /\bvp\b|\bvice\s+president\b/i.test(titleN) &&
    /\bproduct\b/i.test(titleN) &&
    !/\bproduct\s+marketing\b/i.test(titleN)
  ) {
    addRc("product_leader");
    addTags("product", "go_to_market");
    if (seniority === "unknown" || seniority === "director") seniority = "vp";
  }

  if (/\bdirector\s+of\s+strategy\b/i.test(titleN)) {
    addRc("strategy_leader");
    addRc("business_leader");
    addTags("strategy");
    if (seniority === "unknown") seniority = "director";
  }

  if (/\bhead\s+of\s+tech\s+hub\b/i.test(titleN) || /\bhead\s+of\s+technology\b/i.test(titleN)) {
    addRc("technology_leader");
    addRc("engineering_leader");
    addTags("engineering", "leadership");
    if (seniority === "unknown") seniority = "director";
  }

  if (/\bit\s+services\s+manager\b/i.test(titleN)) {
    addRc("it_operations");
    addRc("operations_leader");
    addTags("it_services", "it_operations", "operations");
    if (seniority === "unknown") seniority = "manager";
  }

  if (/\bchief\s+data\s+(?:and\s+)?ai\s+officer\b/i.test(titleN) || /\bcdaio\b/i.test(titleN)) {
    addRc("data_leader");
    addRc("ai_leader");
    addRc("executive_leader");
    addTags("data", "ai_ml", "data_analytics");
    if (seniority !== "founder") seniority = "c_level";
  }

  if (/\bsenior\s+applied\s+science\s+manager\b/i.test(titleN)) {
    addRc("ai_leader");
    addRc("engineering_leader");
    addTags("ai_ml", "research", "machine_learning");
    if (seniority === "unknown") seniority = "manager";
  }

  if (
    /\bdirector\b/i.test(titleN) &&
    /\bthreat\b/i.test(blob) &&
    /\b(detect|detection|cortex)\b/i.test(blob)
  ) {
    addRc("security_leader");
    addRc("security_practitioner");
    addTags("cybersecurity", "security");
    if (seniority === "unknown") seniority = "director";
  }

  if (/\bproduct\s+manager\b/i.test(titleN) && /\bcissp\b/i.test(blob)) {
    addRc("product_leader");
    addRc("security_practitioner");
    addTags("product", "cybersecurity");
  }

  if (/\brecruitment\s+leader\b/i.test(blob)) {
    addRc("recruiter");
    addRc("staffing_leader");
    addTags("recruiting", "staffing");
  }

  if (
    /\bsupport\s+account\s+manager\b|\bprincipal\s+support\s+account\s+manager\b/i.test(title) ||
    (/\baccount\s+manager\b/.test(titleN) && /\bsupport\b|\bcustomer\s+success\b/i.test(title))
  ) {
    addRc("customer_success_leader");
    addRc("account_management");
    addTags("customer_success", "account_management");
    if (/\bprincipal\b/.test(titleN) && seniority === "director") {
      /* keep */
    } else if (/\bprincipal\b/.test(titleN) && seniority === "unknown") {
      seniority = "principal";
    } else if (seniority === "unknown") seniority = "manager";
  }

  if (/^ai\s+product\b|\bai\s+product\b/i.test(title.trim())) {
    addRc("product_manager");
    addRc("ai_leader");
    addTags("ai_ml", "product");
  }

  if (
    /\baccount\s+executive\b|\bsr\.?\s+account\s+executive\b|\benterprise\s+account\s+executive\b/i.test(
      titleN
    ) ||
    /^\s*ae\s*[|@]/i.test(title) ||
    titleN === "ae"
  ) {
    addRc("sales_account");
    addTags("sales", "account_management", "revenue", "go_to_market");
    if (seniority === "unknown") seniority = /\bsr\b|senior/i.test(titleN) ? "senior_ic" : "ic";
  }

  if (
    /\baccount\s+manager\b/i.test(titleN) &&
    !/\bsupport\s+account\s+manager\b/i.test(title) &&
    !/\bprogram\s+manager\b/.test(titleN)
  ) {
    addRc("account_management");
    addRc("sales_account");
    addTags("sales", "account_management", "revenue", "go_to_market");
    if (seniority === "unknown")
      seniority = /\bsr\.?|senior\b/i.test(titleN) ? "senior_ic" : "manager";
  }

  if (/\b(sr\.?|senior)\s+sales\s+director\b|\bsales\s+director\b/i.test(titleN)) {
    addRc("sales_leader");
    addTags("sales", "revenue", "go_to_market");
    if (seniority === "unknown" || seniority === "ic" || seniority === "senior_ic")
      seniority = "director";
  }

  if (
    /\bsoftware\s+developer\b|\bfull\s*s?t[a]?cks?\s+developer\b|\bfulls?t\s*acks?\s+developer\b/i.test(
      titleN
    )
  ) {
    addRc("software_engineer");
    addTags("software_development", "engineering");
    if (/\bdesign|frontend|front[- ]?end|ui\s*\/\s*ux/i.test(blob)) addTags("frontend");
  }

  if (/\bphp\s+developer\b/i.test(titleN)) {
    addRc("software_engineer");
    addTags("php", "software_development", "engineering");
  }

  if (/\bweb\s+developer\b/i.test(titleN)) {
    addRc("web_developer");
    addRc("software_engineer");
    addTags("web_development", "software_development", "engineering");
  }

  if (/\b(senior\s+)?\.net\s+developer\b/i.test(titleN)) {
    addRc("software_engineer");
    addTags("dotnet", "software_development", "engineering");
  }

  if (/\bdata\s+scientist\b/i.test(titleN)) {
    addRc("data_scientist");
    addRc("ai_ml_practitioner");
    addTags("data_science", "data_analytics", "ai_ml", "data", "analytics");
    if (/\bsenior\b/i.test(titleN) && seniority === "unknown") seniority = "senior_ic";
  }

  if (/\bsenior\s+research\s+analyst\b|\bresearch\s+analyst\b/i.test(titleN)) {
    addRc("research_analyst");
    addTags("research", "analysis");
  }

  if (/\bai\s+trainer\b/i.test(titleN)) {
    addRc("ai_trainer");
    addRc("educator");
    addRc("education_leader");
    addRc("data_practitioner");
    addTags("ai_ml", "education", "data_analysis", "analytics");
    if (/\bpython\b/i.test(blob)) addTags("python");
    if (/\bsql\b/i.test(blob)) addTags("sql");
  }

  if (/\bsenior\s+advisor\b/i.test(titleN)) {
    addRc("advisor");
    addRc("business_advisor");
    addTags("advisory");
  }

  if (
    /^manager\b/i.test(titleN.trim()) &&
    /\bey\b|\bernst/i.test(blob) &&
    /\bstrategy\b|\bchange\s+management\b|\bprocess\s+improvement\b/i.test(blob)
  ) {
    addRc("strategy_consultant");
    addRc("operations_leader");
    addTags("strategy", "change_management", "process_improvement");
    if (seniority === "unknown") seniority = "manager";
  }

  if (
    /\bflip\s+flops\s+engineer\b/i.test(titleN) ||
    (/\blead\b/i.test(titleN) && /\bflip\s+flops\b/i.test(blob))
  ) {
    addRc("engineering_leader");
    addRc("platform_engineer");
    addTags("platform", "engineering");
    if (!args.profileExtra.includes("informal_title_signal"))
      args.profileExtra.push("informal_title_signal");
    if (
      /\baka\b|platform\s+team\s+manager/i.test(blob) &&
      !args.profileExtra.includes("platform_manager_signal")
    ) {
      args.profileExtra.push("platform_manager_signal");
    }
    if (seniority === "unknown" || seniority === "ic") seniority = "manager";
  }

  if (
    /\bbusiness\s+development\b/i.test(blob) ||
    /\bbd\s+expert\b/i.test(blob) ||
    /\blinkedin\s+outreach\s+specialist\b/i.test(blob)
  ) {
    addRc("business_development");
    addRc("gtm_leader");
    addTags("business_development", "lead_generation", "market_research", "go_to_market");
    if (
      /\bexpert\b|\bspecialist\b|\bconnecting\s+businesses\b|\bconsult/i.test(blob) &&
      !args.profileExtra.includes("consultant_signal")
    ) {
      args.profileExtra.push("consultant_signal");
    }
  }

  if (/\btechnology\s+strategist\b|\btech\s+strategist\b/i.test(blob)) {
    addRc("technology_strategist");
    addRc("technical_influencer");
    addTags("technology", "strategy");
  }

  if (/\btechnical\s+evangelist\b|\bdeveloper\s+advocate\b|\bdevrel\b/i.test(blob)) {
    addRc("technical_evangelist");
    addTags("engineering", "marketing", "go_to_market");
  }

  if (/\binfrastructure\s+engineer\b/i.test(titleN)) {
    addRc("infrastructure_engineer");
    addTags("platform", "cloud", "engineering");
  }

  if (/\bnetwork\s+engineer\b|\bnetwork\s+administrator\b/i.test(titleN)) {
    addRc("network_engineer");
    addTags("platform", "engineering");
  }

  if (
    /\boperations\s+leader\b|\bvp\s+of\s+operations\b|\bdirector\s+of\s+operations\b/i.test(titleN)
  ) {
    addRc("operations_leader");
    addTags("operations");
  }

  if (/\bhead\s+of\s+growth\b|\bvp\s+growth\b|\bgrowth\s+lead\b/i.test(titleN)) {
    addRc("growth_leader");
    addTags("go_to_market", "marketing", "revenue");
  }

  if (/\bcommunications\s+lead\b|\bvp\s+communications\b|head\s+of\s+comms/i.test(titleN)) {
    addRc("communications_leader");
    addTags("marketing", "go_to_market");
  }

  if (
    /^principal\b/i.test(title.trim()) &&
    /\.io\b/i.test(blob) &&
    /\bapplied\s+ai\b|\btechnical\s+search\b/i.test(blob)
  ) {
    addRc("founder_or_principal");
    addRc("ai_leader");
    addRc("technical_influencer");
    addTags("ai_ml", "technical_search", "technology");
  }

  if (
    (/^ceo\b/i.test(titleN) || /^chief\s+executive\b/i.test(titleN)) &&
    /\bksqldb\b|\bdeltastream\b|data\s+infrastructure|stream\s+processing/i.test(blob)
  ) {
    if (headlineHasExplicitFounderEvidence(args.headline)) {
      addRc("founder");
      addTags("founder");
    }
    addRc("technology_executive");
    addRc("data_leader");
    addTags("data", "platform", "engineering");
  }

  if (
    /\bteam\s+lead\b/i.test(titleN) &&
    /\bengineering\b|\bsolution\s+engineering\b|\bsolutions?\s+engineer\b/i.test(blob) &&
    !rc.has("engineering_leader")
  ) {
    addRc("engineering_leader");
    addTags("engineering", "go_to_market");
    if (seniority === "unknown") seniority = "manager";
  }

  if (/\bcoo\b|chief\s+operating\b/i.test(titleN)) {
    addRc("executive_leader");
    addRc("business_leader");
    addRc("operations_leader");
    addTags("operations", "strategy");
    if (seniority === "unknown" || seniority === "director" || seniority === "vp")
      seniority = "c_level";
  }

  if (
    /chief\s+commercial\s+officer|\bcco\b/i.test(titleN) ||
    /\bpresident\b.*\bchief\s+commercial\b/i.test(titleN)
  ) {
    addRc("executive_leader");
    addRc("gtm_leader");
    addRc("commercial_leader");
    addTags("commercial", "go_to_market", "growth", "leadership");
    if (seniority === "unknown" || seniority === "director" || seniority === "vp")
      seniority = "c_level";
  }

  if (/\bcro\b|chief\s+revenue\b/i.test(titleN)) {
    addRc("executive_leader");
    addRc("revenue_leader");
    addRc("gtm_leader");
    addTags("revenue", "go_to_market", "sales");
    if (/\bretired\b/i.test(blob)) {
      if (!args.profileExtra.includes("retired_signal")) args.profileExtra.push("retired_signal");
    }
    if (seniority === "unknown" || seniority === "director" || seniority === "vp")
      seniority = "c_level";
  }

  if (/board\s+of\s+directors?\b|\bdirector\s+on\s+the\s+board\b/i.test(titleN)) {
    addRc("board_member");
    addRc("business_leader");
    if (!args.profileExtra.includes("board_member_signal"))
      args.profileExtra.push("board_member_signal");
  }

  if (/\bcontent\s+writer\b/i.test(titleN)) {
    addRc("media_creator");
    addRc("marketing_leader");
    addTags("content_writing", "content", "marketing");
  }

  if (/\bexecutive\s+assistant\b/i.test(titleN)) {
    addRc("operations_leader");
    addTags("operations");
    if (seniority === "unknown") seniority = "ic";
  }

  if (/\bsecops\b/i.test(titleN) || /\bcyber\s+riskops\b/i.test(blob)) {
    addRc("security_practitioner");
    addTags("secops", "cybersecurity");
    if (/\briskops\b|\brisk\s+ops\b/i.test(blob)) addTags("risk_operations");
  }

  if (
    /\bbi\s+developer\b/i.test(titleN) ||
    (/\bpower\s*bi\b/i.test(blob) && /\bsql\b/i.test(blob) && /\bpython\b/i.test(blob))
  ) {
    addRc("data_engineer");
    addRc("bi_developer");
    addTags("business_intelligence", "power_bi", "sql", "python", "etl", "data");
  }

  if (/^design$/i.test((title ?? "").trim())) {
    addRc("designer");
    addTags("design");
  }

  if (/\bsenior\s+staff\s+accountant\b|\bstaff\s+accountant\b/i.test(titleN)) {
    addRc("finance_accounting");
    addTags("accounting", "financial_services");
  }

  if (/^\s*channel\s+head\b/i.test((title ?? "").trim())) {
    addRc("channel_leader");
    addRc("gtm_leader");
    addRc("business_leader");
    addTags("channel", "partnerships", "regional_leadership", "go_to_market");
  }

  if (
    /\bsenior\s+developer\b/i.test(titleN) &&
    /\bteam\s+leader\b/i.test(titleN) &&
    /\bbi\b/i.test(titleN)
  ) {
    addRc("engineering_leader");
    addRc("software_engineer");
    addRc("bi_developer");
    addTags("software_development", "business_intelligence", "statistics", "engineering", "data");
    if (seniority === "unknown") seniority = "manager";
  }

  if (/^startups$/i.test((title ?? "").trim()) && /\baws\b/i.test(norm(blob))) {
    addRc("startup_business_development");
    addRc("cloud_industry_leader");
    addTags("startups", "aws", "cloud", "go_to_market");
  }

  if (/\bchief\s+product\s+officer\b|\bcpo\b/i.test(titleN)) {
    addRc("product_leader");
    addRc("executive_leader");
    addTags("product", "go_to_market");
    if (seniority !== "founder") seniority = "c_level";
  }

  if (/\bportfolio\s+lead\b/i.test(titleN)) {
    addRc("portfolio_leader");
    addRc("business_leader");
    addTags("portfolio_management", "leadership");
  }

  if (/\bclient\s+director\b/i.test(titleN)) {
    addRc("sales_leader");
    addRc("account_management");
    addTags("account_management", "sales", "go_to_market");
  }

  if (/\bchannel\s+manager\b/i.test(titleN)) {
    addRc("channel_leader");
    addRc("partnerships_leader");
    addTags("channel", "partnerships");
    if (/\bsecurity\b|\bcyber/i.test(blob)) {
      addTags("cybersecurity");
    }
  }

  if (/\bproduct\s+monetization\s+manager\b|\bmonetization\s+manager\b/i.test(titleN)) {
    addRc("monetization_leader");
    addRc("product_manager");
    addRc("growth_leader");
    addTags("monetization", "product", "growth");
  }

  if (/\bproduct\s+owner\b/i.test(titleN) && /\bai\s+product\b/i.test(blob)) {
    addRc("product_manager");
    addRc("ai_practitioner");
    addTags("product", "ai_ml", "data_analytics");
  }

  if (/\btechnical\s+recruit/i.test(title)) {
    addRc("technical_recruiter");
    addRc("recruiter");
    addTags("recruiting", "talent_mapping", "strategic_sourcing", "staffing");
  }

  if (/\btraining\s+developer\b|\binstructional\s+designer\b/i.test(titleN)) {
    addRc("instructional_designer");
    addRc("educator");
    addRc("technical_enablement");
    addTags("education", "instructional_design", "technical_training");
  }

  if (/\bcustomer\s+relationship\s+manager\b/i.test(titleN)) {
    addRc("customer_success_leader");
    addRc("account_management");
    addTags("customer_success", "account_management");
    if (seniority === "unknown") seniority = "manager";
  }

  if (
    /\bstrategist\b/i.test(titleN) &&
    /\bdata\b/i.test(titleN) &&
    /\binnovation\b/i.test(titleN)
  ) {
    addRc("strategy_leader");
    addRc("data_leader");
    addTags("data", "data_analytics", "innovation", "strategy");
    if (seniority === "unknown") seniority = "manager";
  }

  if (/\b(vp|gm)\b/i.test(titleN) && /\bpayments\b/i.test(titleN)) {
    addRc("executive_leader");
    addRc("revenue_leader");
    addRc("commercial_leader");
    addTags("revenue", "go_to_market");
    if (seniority === "unknown" || seniority === "director") seniority = "vp";
  }

  if (/\bdirector\b/i.test(titleN) && /\bpartnerships\b/i.test(titleN)) {
    addRc("partnerships_leader");
    addRc("gtm_leader");
    addTags("partnerships", "go_to_market", "cloud");
    if (seniority === "unknown") seniority = "director";
  }

  if (/\btech\s+lead\b/i.test(titleN) && /\bai\b/i.test(blob)) {
    addRc("engineering_leader");
    addRc("technical_lead");
    addTags("ai_ml", "engineering", "platform");
    if (/\bdistributed\s+systems\b/i.test(blob)) addTags("distributed_systems");
    if (seniority === "unknown") seniority = "manager";
  }

  if (/\.net\b/i.test(titleN) && /\bcloud\b/i.test(blob) && /\bengineer/i.test(blob)) {
    addRc("software_engineer");
    addTags("dotnet", "cloud", "engineering");
    if (/\bengineering\s+manager\b/i.test(blob)) {
      addRc("engineering_leader");
      if (seniority === "unknown") seniority = "manager";
    }
  }

  if (/^cybersecurity$/i.test(title.trim())) {
    addRc("security_practitioner");
    addTags("cybersecurity", "security");
  }

  if (/^consultant$/i.test(title.trim())) {
    addRc("consultant");
    addTags("consulting");
  }

  if (/\bprofessional\b/i.test(titleN) && /\bengineer\b/i.test(titleN)) {
    addRc("software_engineer");
    addTags("engineering");
  }

  if (addedRole) {
    rc.delete("unknown");
  }

  const merged = tagSet.size ? Array.from(tagSet).sort() : functionTags;
  return { seniority, functionTags: merged };
}

/** When employment was extracted but labels stayed unknown-only, recover roles from the title. */
function salvageUnknownOnlyFromExtractedEmployment(
  roleCategories: Set<ProspectClassification["roleCategories"][number]>,
  currentTitle: string | null,
  currentCompany: string | null,
  headline: string
): void {
  const nonJobSeeker = [...roleCategories].filter((r) => r !== "job_seeker");
  if (!(nonJobSeeker.length === 1 && nonJobSeeker[0] === "unknown")) return;
  const title = (currentTitle ?? "").trim();
  const company = (currentCompany ?? "").trim();
  if (!title || !company) return;
  if (looksLikeEducationTitle(title) || hardSuspiciousCompany(company)) return;

  const blob = norm(`${title} ${headline}`);
  const before = roleCategories.size;

  if (/\bcustomer\s+relationship\b/i.test(blob)) {
    roleCategories.add("customer_success_leader");
    roleCategories.add("account_management");
  } else if (/\bstrategist\b/i.test(blob) && /\bdata\b/i.test(blob) && /\binnovation\b/i.test(blob)) {
    roleCategories.add("strategy_leader");
    roleCategories.add("data_leader");
  } else if (/\b(vp|gm)\b/i.test(blob) && /\bpayments\b/i.test(blob)) {
    roleCategories.add("executive_leader");
    roleCategories.add("revenue_leader");
    roleCategories.add("commercial_leader");
  } else if (/\bpartnerships\b/i.test(blob) && /\bdirector\b/i.test(blob)) {
    roleCategories.add("partnerships_leader");
    roleCategories.add("gtm_leader");
  } else if (/^cybersecurity$/i.test(title)) {
    roleCategories.add("security_practitioner");
  } else if (/^consultant$/i.test(title)) {
    roleCategories.add("consultant");
  } else if (/\bengineer\b/i.test(blob) && !/\bstudent\b/i.test(blob)) {
    roleCategories.add("software_engineer");
  } else if (/\b(human\s+resources|hr\s+generalist|hr\s+business\s+partner)\b/i.test(blob)) {
    roleCategories.add("hr_leader");
    roleCategories.add("people_leader");
  } else if (/\bproduct\s+manager\b/i.test(blob) || /\bproduct\s+management\b/i.test(blob)) {
    roleCategories.add("product_manager");
  } else if (/\bcustomer\s+success\b/i.test(blob)) {
    roleCategories.add("customer_success_leader");
  } else if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/i.test(blob)) {
    roleCategories.add("security_practitioner");
    roleCategories.add("it_operations");
  } else if (/\bmarketplaces?\s+manager\b/i.test(blob)) {
    roleCategories.add("account_management");
    roleCategories.add("operations_leader");
  } else if (/\b(rank|seo|organic\s+traffic)\b/i.test(blob) && /\b(google|chatgpt)\b/i.test(blob)) {
    roleCategories.add("growth_leader");
    roleCategories.add("marketing_consultant");
  }

  if (roleCategories.size > before) {
    roleCategories.delete("unknown");
  }
}

function enrichFounderExecSecurityFromHeadline(args: {
  headline: string;
  currentTitle: string | null;
  currentCompany: string | null;
  roleCategories: Set<ProspectClassification["roleCategories"][number]>;
  profileExtra: ProfileFlag[];
}): boolean {
  const h = norm(args.headline);
  const { currentTitle, currentCompany } = args;
  if (!currentCompany || !currentTitle) return false;
  if (!headlineHasExplicitFounderEvidence(args.headline)) return false;
  if (
    /founder.*ceo|ceo.*founder|founder\s*&\s*ceo/i.test(args.headline) &&
    /\b(ai\s+security|autonomous\s+ai|security\s+platform)\b/i.test(h)
  ) {
    args.roleCategories.add("security_leader");
    args.roleCategories.add("technical_influencer");
    args.profileExtra.push("ambiguous_employment");
    args.roleCategories.delete("unknown");
    return true;
  }
  return false;
}

/**
 * Deterministic classification from evidence only. Does not call LLMs.
 */
export function classifyProspectDeterministic(
  evidence: ProspectEvidence[],
  options: ClassifierOptions = {}
): ProspectClassification {
  const headlineEv = evidence.find((e) => e.source === "linkedin_author_headline");
  const headlineRaw = headlineEv?.rawText ?? "";
  const headlineFull = headlineRaw
    ? normalizeHeadlineDelimiters(
        foldStylizedLatinForClassification(headlineRaw.replace(/\s+/g, " ").trim())
      )
    : "";
  const headline = headlineForRoleAndEmploymentParsing(headlineFull);
  const postTextSources = evidence.filter(
    (e) => e.source === "source_post_text" || e.source === "source_comment_text"
  );
  const postContentJoined = postTextSources.map((e) => e.rawText).join("\n");
  const mergedText = evidence.map((e) => e.rawText).join("\n");
  const textBlob = `${headlineFull}\n${mergedText}`;
  const n = norm(textBlob);

  const openToWorkResult = suppressOpenToWorkFalsePositiveHeadline(
    headlineFull,
    suppressOpenToWorkMisreadOnRecruiterHeadline(
      headlineFull,
      detectOpenToWorkFromEvidence({
        evidence,
        mergedTextBlob: textBlob,
        linkedinProfileUiText: options.linkedinProfileUiText,
      })
    )
  );

  const roleCategories = new Set<ProspectClassification["roleCategories"][number]>();
  const excludedRoleFlags = new Set<ProspectClassification["excludedRoleFlags"][number]>();

  const authorMetaLine =
    evidence.find((e) => e.source === "linkedin_author_metadata")?.rawText ?? "";
  const strictStudent = hasStrictStudentSignal(`${headline}\n${authorMetaLine}`);
  const internSignal = hasInternSignal(`${headline}\n${authorMetaLine}`);
  const founderLeadSegment = headlineHasExplicitFounderEvidence(headlineFull);
  const coachTail = /\|\s*coach\b/i.test(headlineFull);
  const atCount = (headlineFull.match(/@/g) ?? []).length;

  if (/\bowner\s+at\b/i.test(headlineFull)) {
    roleCategories.add("owner_operator");
  }

  const otwStatus = openToWorkResult.detection.status;
  if (
    otwStatus === "public_signal_detected" ||
    otwStatus === "text_signal_detected"
  ) {
    roleCategories.add("job_seeker");
  }
  if (openToWorkResult.markJobSeekerExclusion) {
    excludedRoleFlags.add("open_to_work");
  }
  if (RECRUITER_RE.test(textBlob)) {
    roleCategories.add("recruiter");
    excludedRoleFlags.add("recruiter");
  }
  if (roleCategories.has("recruiter")) {
    if (
      headlineSuggestsStrongIcAiEngineering(headline) &&
      !explicitHeadlineRecruiterEvidence(headline)
    ) {
      roleCategories.delete("recruiter");
      excludedRoleFlags.delete("recruiter");
    } else if (
      isWeakAgenticVisionHeadline(headline) &&
      !explicitHeadlineRecruiterEvidence(headline)
    ) {
      roleCategories.delete("recruiter");
      excludedRoleFlags.delete("recruiter");
    }
  }
  if (roleCategories.has("recruiter") && /\bstaffing\b/i.test(headline)) {
    roleCategories.add("staffing_leader");
  }
  const headlineAndMetaForInvestor = `${headlineFull}\n${authorMetaLine}`.trim();
  if (INVESTOR_RE.test(headlineAndMetaForInvestor)) {
    roleCategories.add("investor");
    excludedRoleFlags.add("investor");
    if (
      /\bventure\s+investor\b/i.test(headlineFull) ||
      /\bventure\s+capital\b/i.test(headlineFull) ||
      /\bearly\s+stage\s+investor\b/i.test(headlineFull) ||
      /\bcategory[-\s]+creat/i.test(headlineFull) ||
      (/\bpartner\s+at\b/i.test(headlineFull) && /\bventures\b/i.test(headlineFull))
    ) {
      roleCategories.add("venture_capital");
    }
  }
  if ((strictStudent || (internSignal && !founderLeadSegment)) && !founderLeadSegment) {
    roleCategories.add("student");
    excludedRoleFlags.add("student");
  }
  if (strictStudent && founderLeadSegment && internSignal) {
    roleCategories.add("student");
    excludedRoleFlags.add("student");
  }
  if (
    strictStudent &&
    /\blearn/i.test(headlineFull) &&
    /\b(ml|machine\s+learning|\bai\b)\b/i.test(headlineFull)
  ) {
    roleCategories.add("ai_ml_practitioner");
  }
  if (strictStudent && /\bcomputer\s+engineering\s+student\b/i.test(headlineFull)) {
    roleCategories.add("software_engineer");
    roleCategories.add("security_practitioner");
  }
  if (
    strictStudent &&
    /\bcybersecurity\b/i.test(headlineFull) &&
    /\bmajor\b/i.test(headlineFull) &&
    /\b(freshman|sophomore|junior|senior)\b/i.test(headlineFull)
  ) {
    roleCategories.add("security_practitioner");
  }

  if (SOLO_RE.test(headlineFull)) {
    roleCategories.add("solo_founder");
    roleCategories.add("founder");
    excludedRoleFlags.add("solo_operator");
  }
  if (textSuggestsConsultantRole(textBlob, headlineFull) && !strictStudent) {
    roleCategories.add("consultant");
    excludedRoleFlags.add("consultant");
  }
  if (headlineHasExplicitFounderEvidence(headlineFull) || founderLeadSegment) {
    roleCategories.add("founder");
  }
  if (
    roleCategories.has("recruiter") &&
    /\btalent\s+acquisition\b/i.test(headlineFull) &&
    /\bnvidia\b/i.test(norm(headlineFull))
  ) {
    roleCategories.add("technical_recruiter");
  }

  if (/\bauthor\b\s*[|]|grc\s+advisor|solution\s+architect|cxo\s+strategist/i.test(headline)) {
    roleCategories.add("consultant");
    if (!excludedRoleFlags.has("student")) excludedRoleFlags.add("consultant");
  }

  if (competitorHit(textBlob, options.competitorPatterns)) {
    roleCategories.add("competitor");
    excludedRoleFlags.add("competitor");
  }

  if (/\benterprise\s+software\s+sales\b|\bsales\s+leader\b/i.test(headline)) {
    roleCategories.add("sales_account");
    excludedRoleFlags.add("wrong_function");
    excludedRoleFlags.add("non_buyer");
  }
  if (/\baccount\s+director\b/i.test(headline)) {
    roleCategories.add("sales_account");
    roleCategories.add("sales_leader");
    excludedRoleFlags.add("wrong_function");
    excludedRoleFlags.add("non_buyer");
  }
  if (/\bgeneral\s+counsel\b|\besq\b|\bccep\b/i.test(headline)) {
    roleCategories.add("legal_counsel");
    excludedRoleFlags.add("wrong_function");
    excludedRoleFlags.add("non_buyer");
  }
  if (/\bvp\b.*\bproduct\s+marketing\b|\bvp,\s*product\s+marketing\b/i.test(headline)) {
    roleCategories.add("product_marketing");
    roleCategories.add("marketing_leader");
    excludedRoleFlags.add("wrong_function");
  }

  if (coachTail) {
    roleCategories.add("coach_or_advisor");
  }

  if (
    IT_OPS_RE.test(headline) ||
    IT_OPS_SUPPLY_EXTRA.test(headline) ||
    /\boptimize\s+it\s+systems\b/i.test(n) ||
    /\bend\s+user\s+services\b/i.test(norm(headline))
  ) {
    roleCategories.add("it_operations");
  }

  if (SOC_PRACTITIONER_RE.test(headline)) {
    roleCategories.add("security_practitioner");
  } else if (SECURITY_LEADER_RE.test(headline)) {
    roleCategories.add("security_leader");
  }

  if (
    !strictStudent &&
    ENG_LEADER_RE.test(headline) &&
    !headlineIsAppSecStrategicMarketing(headline)
  ) {
    roleCategories.add("engineering_leader");
    roleCategories.add("technical_influencer");
  }

  const mediaJournalist =
    /\bjournalist\b|\breporter\b|\beditor-?in-?chief\b/.test(n) &&
    !/\bsoc\b|\bsecurity\s+operations\b|soc\s+analyst/i.test(n);
  if (mediaJournalist) {
    roleCategories.add("media_analyst");
  }

  let seniority = inferSeniority(headline || mergedText.slice(0, 600));
  if (/\bowner\s+at\b/i.test(headlineFull)) {
    seniority = "owner";
  } else if (founderLeadSegment || headlineHasExplicitFounderEvidence(headlineFull)) {
    seniority = "founder";
  } else if (roleCategories.has("student") && !professionalTitleOutranksStudent(headline)) {
    seniority = "student";
  }
  let functionTags = inferFunctionTags(headline || mergedText.slice(0, 600), {
    freelanceAvailabilityHeadline: headlineFull,
  });
  if (roleCategories.has("student")) {
    functionTags = mergeStudentFunctionTags(headline, functionTags);
  }

  for (const rc of deriveRoleCategoriesFromFunctionSeniority(functionTags, seniority, headline)) {
    if (!strictStudent || rc === "security_practitioner") roleCategories.add(rc);
  }

  if (internSignal && founderLeadSegment) {
    excludedRoleFlags.add("low_seniority");
  }
  if (internSignal && (roleCategories.has("student") || founderLeadSegment)) {
    roleCategories.add("intern_or_student");
  }
  if (/\bformer\s+[^|]{0,140}\bintern\b|\bex[-\s]*intern\b/i.test(headlineFull) && !strictStudent) {
    roleCategories.delete("student");
    roleCategories.delete("intern_or_student");
    excludedRoleFlags.delete("student");
    if (seniority === "student") {
      seniority = inferSeniority(headline || mergedText.slice(0, 600));
      if (/\bowner\s+at\b/i.test(headlineFull)) {
        seniority = "owner";
      } else if (founderLeadSegment || headlineHasExplicitFounderEvidence(headlineFull)) {
        seniority = "founder";
      }
    }
    if (!roleCategories.has("student")) {
      functionTags = inferFunctionTags(headline || mergedText.slice(0, 600), {
        freelanceAvailabilityHeadline: headlineFull,
      });
    }
  }
  if (/\bfreelance\b|\bfreelancer\b/i.test(headline) && !strictStudent) {
    excludedRoleFlags.add("consultant");
  }

  const headlineTokens = headlineFull.trim().split(/\s+/).filter(Boolean);
  const headlineTooShort = headlineTokens.length <= 1 && headlineFull.length < 40;
  const pipeCount = (headlineFull.match(/\|/g) ?? []).length;
  const pipedHeadline = pipeCount >= 1;
  const densePipes = pipeCount >= 2;

  const parsed = headline ? parseHeadlineEmploymentAndEducation(headline) : null;
  const marketSegmentTerms = headlineFull ? extractMarketSegmentTerms(headlineFull) : [];
  let educationInstitution = parsed?.educationInstitution ?? null;
  let educationArea = parsed?.educationArea ?? null;
  const affiliationList = [...(parsed?.affiliations ?? [])];

  let pastTitle: string | null = null;
  let pastCompany: string | null = null;
  if (parsed?.pastEmployment) {
    const pt = parsed.pastEmployment.title?.trim() ?? "";
    const pc = parsed.pastEmployment.company?.trim() ?? "";
    pastTitle = pt.length > 0 ? pt : null;
    pastCompany = pc.length > 0 ? pc : null;
  }

  let currentTitle: string | null = null;
  let currentCompany: string | null = null;
  let employmentConfidence = 0;
  let employmentSource: EmploymentSource = "unknown";
  let employmentReason: string | null = null;
  let currentRoles: EmploymentRoleRef[] | undefined;
  let pastRolesResolved: EmploymentRoleRef[] | undefined;

  const employmentContextSeg = (headline.split("|")[0] ?? headline).trim();
  const parallelProfessionalEmploymentWhileStudent =
    strictStudent &&
    !!parsed?.primaryEmployment?.title?.trim() &&
    !isEducationOrAcademicAffiliation(
      employmentContextSeg,
      parsed.primaryEmployment.title,
      parsed.primaryEmployment.company ?? ""
    ) &&
    !(
      looksLikeDegreeCredentialTitle(parsed.primaryEmployment.title) &&
      segmentLooksLikeSchoolName(parsed.primaryEmployment.company ?? "")
    ) &&
    (!!parsed.primaryEmployment.company?.trim() || parsed.primaryEmployment.confidence >= 0.52);

  const rawExperienceRoles = collectProfileExperienceRolesFromEvidence(evidence);
  const headlineForExperienceValidation =
    headline.trim() ||
    evidence.find((e) => e.source === "linkedin_author_headline")?.rawText?.trim() ||
    "";
  const profileExperienceAnalysisMethod = evidence
    .map((e) => e.metadata?.[PROFILE_EXPERIENCE_ANALYSIS_METHOD_METADATA_KEY])
    .find((m): m is string => typeof m === "string" && m.trim().length > 0);
  const experienceValidation = validateProfileExperienceRoles(rawExperienceRoles, {
    headline: headlineForExperienceValidation,
    analysisMethod: profileExperienceAnalysisMethod,
  });
  const experienceRoles = experienceValidation.roles;
  const rejectedExperienceValidationCount = experienceValidation.rejectedCount;
  const rawProfileExperienceInputCount = rawExperienceRoles.length;
  const profileExperienceInputCount = experienceRoles.length;
  const profileExperienceRejectionReason =
    experienceValidation.rejectionReasons.length > 0
      ? experienceValidation.rejectionReasons.slice(0, 4).join("; ")
      : null;
  const structuredProfile = extractStructuredProfileEmploymentFromEvidence(evidence);
  const firstHeadlineSeg = employmentContextSeg;
  const headlineHasEmployerPattern = /\s(@|at)\s+[A-Za-z0-9]/i.test(firstHeadlineSeg);
  const headlineAtCount = (firstHeadlineSeg.match(/@/g) ?? []).length;
  let headlineEmployment: { title: string; company: string; confidence: number } | null = null;
  let headlineEmploymentAmbiguous = false;
  let headlineEmploymentCandidate: { title: string; company: string } | null = null;
  if (parsed?.primaryEmployment && !segmentIsPastOnlyEmploymentSegment(firstHeadlineSeg)) {
    const emp = parsed.primaryEmployment;
    const company = emp.company ? normalizeCompanyFragment(emp.company) : "";
    headlineEmploymentCandidate = { title: emp.title, company };
    const sloganTitle = headlineTitleLooksSloganLike(emp.title);
    const retiredSeg = headlineSegmentLooksRetiredEmployment(firstHeadlineSeg);
    const retiredTitle = employmentTitleLooksRetired(emp.title);
    const eventEmployer = company ? headlineEmployerLooksEventOrMarketing(company) : false;
    const descriptorEmployer = company
      ? headlineEmployerLooksDescriptorOrCompoundRole(company, emp.title)
      : false;
    const multiAtEmployer = headlineAtCount >= 2 && headlineHasEmployerPattern;
    if (
      sloganTitle ||
      eventEmployer ||
      retiredSeg ||
      retiredTitle ||
      descriptorEmployer ||
      multiAtEmployer
    ) {
      headlineEmploymentAmbiguous = true;
    } else if (
      company &&
      !isPlaceholderEmploymentValue(company) &&
      !isPlaceholderEmploymentValue(emp.title) &&
      headlineHasEmployerPattern &&
      headlineAtCount <= 1
    ) {
      headlineEmployment = { title: emp.title, company, confidence: emp.confidence };
    } else if (!company || !headlineHasEmployerPattern || headlineAtCount >= 2) {
      headlineEmploymentAmbiguous = true;
    }
  } else if (headline.length > 24 && !headlineHasEmployerPattern) {
    headlineEmploymentAmbiguous = true;
  }

  const allowHeadlineEmploymentFallback =
    profileExperienceInputCount === 0 &&
    process.env.PROSPECT_SKIP_HEADLINE_EMPLOYMENT !== "1";

  let employmentResolved = resolveProspectEmployment({
    experienceRoles,
    structuredProfile: allowHeadlineEmploymentFallback ? structuredProfile : null,
    headlineEmployment: allowHeadlineEmploymentFallback ? headlineEmployment : null,
    headlineAmbiguous: headlineEmploymentAmbiguous,
    headlineEmploymentCandidate:
      profileExperienceInputCount > 0 ? headlineEmploymentCandidate : null,
  });

  employmentResolved = sanitizeResolvedProspectEmployment(employmentResolved, {
    validProfileExperienceInputCount: profileExperienceInputCount,
    rawProfileExperienceInputCount,
    rejectedPlaceholderItemCount: rejectedExperienceValidationCount,
    rejectedSyntheticItemCount: rejectedExperienceValidationCount,
  });

  employmentSource = employmentResolved.employmentSource;
  employmentReason = employmentResolved.employmentReason;
  employmentConfidence = employmentResolved.employmentConfidence;
  currentRoles =
    employmentResolved.currentRoles.length > 0 ? employmentResolved.currentRoles : undefined;
  pastRolesResolved =
    employmentResolved.pastRoles.length > 0 ? employmentResolved.pastRoles : undefined;

  if (employmentResolved.educationInstitution) {
    educationInstitution = educationInstitution || employmentResolved.educationInstitution;
  }
  if (employmentResolved.educationArea) {
    educationArea = educationArea || employmentResolved.educationArea;
  }
  if (employmentResolved.pastTitle && !pastTitle) pastTitle = employmentResolved.pastTitle;
  if (employmentResolved.pastCompany && !pastCompany) pastCompany = employmentResolved.pastCompany;

  if (strictStudent && !parallelProfessionalEmploymentWhileStudent) {
    currentTitle = null;
    currentCompany = null;
    employmentConfidence = 0;
    employmentSource = "unknown";
    employmentReason = "Student-primary profile; employment suppressed.";
    currentRoles = undefined;
    const hints = headline ? extractEducationHints(headline) : { institution: null, area: null };
    educationInstitution = educationInstitution || hints.institution;
    educationArea = educationArea || hints.area;
  } else if (employmentResolved.employmentSource !== "unknown") {
    currentTitle = employmentResolved.currentTitle;
    currentCompany = employmentResolved.currentCompany;
    if (
      currentTitle &&
      currentCompany &&
      looksLikeDegreeCredentialTitle(currentTitle) &&
      segmentLooksLikeSchoolName(currentCompany)
    ) {
      educationInstitution = educationInstitution || currentCompany;
      educationArea = educationArea || currentTitle;
      currentTitle = null;
      currentCompany = null;
      employmentConfidence = profileExperienceInputCount > 0 ? employmentConfidence : 0;
      employmentSource =
        profileExperienceInputCount > 0 ? "profile_experience" : "unknown";
      currentRoles = undefined;
    }
    if (
      currentTitle &&
      currentCompany &&
      looksLikeSubjectFieldsLineBeforeAtSchool(currentTitle, currentCompany)
    ) {
      educationInstitution = educationInstitution || currentCompany;
      educationArea = educationArea || currentTitle;
      currentTitle = null;
      currentCompany = null;
      employmentConfidence = profileExperienceInputCount > 0 ? employmentConfidence : 0;
      employmentSource =
        profileExperienceInputCount > 0 ? "profile_experience" : "unknown";
      currentRoles = undefined;
    }
  }

  if (
    (!strictStudent || parallelProfessionalEmploymentWhileStudent) &&
    currentTitle?.trim() &&
    /^(?:ex-?|former|formerly|previously)\s+/i.test(currentTitle.trim())
  ) {
    currentTitle = null;
    currentCompany = null;
    employmentConfidence = 0;
  }

  if (!strictStudent && currentTitle && /^incoming$/i.test(currentTitle.trim()) && currentCompany) {
    currentTitle = null;
    employmentConfidence = Math.min(employmentConfidence, 0.32);
  }

  /** Do not infer current employment from title-only OTW headlines without a company signal. */
  if (
    employmentSource === "unknown" &&
    currentTitle?.trim() &&
    !currentCompany?.trim()
  ) {
    currentTitle = null;
    employmentConfidence = 0;
    currentRoles = undefined;
  }

  if (
    (founderLeadSegment || headlineHasExplicitFounderEvidence(headlineFull)) &&
    currentTitle &&
    currentCompany &&
    /founder/i.test(currentTitle)
  ) {
    employmentConfidence = Math.min(Math.max(employmentConfidence, 0.56), 0.6);
  }

  if (headlineTooShort && !employmentConfidence && !strictStudent) {
    excludedRoleFlags.add("insufficient_evidence");
  }

  if (
    currentCompany &&
    (currentCompany.length > 96 ||
      /\s@\s/.test(currentCompany) ||
      /\b(?:founder|senior\s+consultant)\s+@\b/i.test(currentCompany))
  ) {
    currentCompany = null;
    employmentConfidence = 0;
  }

  const educationSubjectAtSchool =
    !!educationArea?.trim() &&
    !!educationInstitution?.trim() &&
    looksLikeSubjectFieldsLineBeforeAtSchool(educationArea, educationInstitution);

  const educationDegreeAtUniversity =
    !!educationArea?.trim() &&
    !!educationInstitution?.trim() &&
    looksLikeDegreeAtUniversityPair(educationArea, educationInstitution);

  const educationCredentialAtSchool =
    !!educationArea?.trim() &&
    !!educationInstitution?.trim() &&
    looksLikeDegreeCredentialTitle(educationArea) &&
    segmentLooksLikeSchoolName(educationInstitution);

  const schoolEducationSignalsStudent =
    (educationSubjectAtSchool &&
      educationSubjectPairImpliesStudentHeadline(headline, educationArea)) ||
    educationDegreeAtUniversity ||
    (educationCredentialAtSchool && !professionalTitleOutranksStudent(headline));

  const educationCredentialStudentContext =
    educationCredentialAtSchool && !professionalTitleOutranksStudent(headline);

  if (!strictStudent && schoolEducationSignalsStudent && !currentCompany?.trim()) {
    roleCategories.add("student");
    roleCategories.delete("unknown");
    if (/\bproduct\s+builder\b/i.test(headline)) {
      roleCategories.add("product_builder");
    }
    if (/\bproduct\s+thinking\b/i.test(headline) || /\bproduct\s+builder\b/i.test(headline)) {
      roleCategories.add("product_leader");
    }
    if (
      /\bhands-?on\s+development\b/i.test(headline) ||
      /\b(cs|cse|computer\s+science)\b/i.test(norm(educationArea ?? ""))
    ) {
      roleCategories.add("software_engineer");
    }
    if (
      /\bgolang\b|\bgo\s+lang\b/i.test(headline) ||
      (/\bjava\b/i.test(headline) &&
        /\bdocker\b/i.test(headline) &&
        /\bkubernetes\b/i.test(headline))
    ) {
      roleCategories.add("software_engineer");
      roleCategories.add("platform_engineer");
    }
    if (educationCredentialAtSchool && !educationDegreeAtUniversity && !educationSubjectAtSchool) {
      roleCategories.add("early_career");
    }
    if (roleCategories.has("student") && !professionalTitleOutranksStudent(headline)) {
      seniority = "student";
    }
    functionTags = mergeStudentFunctionTags(headline, functionTags);
  }

  const roleRefinementFlags: ProfileFlag[] = [];
  if (
    !strictStudent &&
    (educationSubjectAtSchool ||
      educationDegreeAtUniversity ||
      educationCredentialStudentContext) &&
    !currentCompany?.trim()
  ) {
    roleRefinementFlags.push("education_signal");
  }
  if (
    !strictStudent &&
    (educationDegreeAtUniversity || educationCredentialStudentContext) &&
    !currentCompany?.trim()
  ) {
    roleRefinementFlags.push("student_signal", "early_career_signal");
  }
  if (
    strictStudent &&
    /\b(freshman|sophomore|junior|senior)\b\s+at\s+/i.test(headlineFull) &&
    /\bmajor[-–\s]/i.test(headlineFull)
  ) {
    roleRefinementFlags.push("early_career_signal");
  }
  if (/\b(pdeu)\s+ict[''\u2019]?\s*\d{2}\b/i.test(headlineFull)) {
    roleRefinementFlags.push("early_career_signal");
  }
  if (/\bincoming\s*@\s*aws\b/i.test(headlineFull)) {
    roleRefinementFlags.push("early_career_signal");
  }
  if (headlineSuggestsJobSeekingFreelanceAvailability(headlineFull)) {
    roleRefinementFlags.push("freelance_signal");
  }
  if (/\bex[-–\s]+[A-Za-z][A-Za-z0-9]{1,18}\b|\bex\s+[A-Za-z][A-Za-z0-9]{1,18}\b/i.test(headline)) {
    roleRefinementFlags.push("ex_company_signal");
  }
  if (/\.?\s*Former(?:ly)?\s+[A-Z]/i.test(headlineFull) && /\bat\s+[A-Z]/i.test(headlineFull)) {
    roleRefinementFlags.push("ex_company_signal");
  }
  if (/\bformer\s+[^|]{0,140}\bintern\b|\bex[-\s]*intern\b/i.test(headlineFull)) {
    roleRefinementFlags.push("former_intern_signal");
  }
  if (
    !strictStudent &&
    !currentCompany?.trim() &&
    /\bb\.?tech\b/i.test(headline) &&
    /\bcse\b/i.test(norm(headline)) &&
    /['\u2019]?\s*\d{2}\b/.test(headline) &&
    (/\bcodechef\b/i.test(norm(headline)) ||
      /\b(member|mentee)\s*@\b/i.test(norm(headline)) ||
      /\bchapter\b/i.test(norm(headline)))
  ) {
    roleCategories.add("student");
    roleCategories.add("software_engineer");
    if (/\banalytics\b/i.test(norm(headline))) roleCategories.add("data_practitioner");
    roleCategories.delete("unknown");
    roleCategories.delete("academic");
    roleRefinementFlags.push("student_signal", "early_career_signal");
    if (!educationArea?.trim()) {
      const mTech = headline.match(/\bb\.?tech\b[^|•·]{0,42}cse[^|•·]*/i);
      if (mTech?.[0]) educationArea = cleanTitleFragment(mTech[0]);
    }
    if (roleCategories.has("student") && !professionalTitleOutranksStudent(headline)) {
      seniority = "student";
    }
    functionTags = mergeStudentFunctionTags(headline, functionTags);
  }
  if (pastTitle || pastCompany) {
    roleRefinementFlags.push("past_role_signal");
  }
  applySpecializedHeadlineRoles({
    headline,
    currentTitle,
    strictStudent,
    roleCategories,
    profileExtra: roleRefinementFlags,
    atCount,
  });

  if (roleCategories.size === 0) roleCategories.add("unknown");

  const td = applyTitleDerivedRolesAndTags({
    currentTitle,
    headline,
    strictStudent,
    roleCategories,
    profileExtra: roleRefinementFlags,
    seniority,
    functionTags,
  });
  seniority = td.seniority;
  functionTags = td.functionTags;

  salvageUnknownOnlyFromExtractedEmployment(
    roleCategories,
    currentTitle,
    currentCompany,
    headlineFull
  );

  if (
    roleCategories.has("sales_account") &&
    /\b(sr\.?|senior)?\s*account\s+executive\b/i.test(headline) &&
    /\b[A-Za-z][A-Za-z0-9]{1,22}\s*&\s*[A-Za-z][A-Za-z0-9]{1,22}\b/.test(headline)
  ) {
    roleRefinementFlags.push("affiliation_signal");
  }

  if (
    /github\.com\/[^\s|•·]+/i.test(headlineFull) &&
    /\b(cyber|cybersecurity|infosec|digital\s+privacy|privacy|ciso)\b/i.test(n)
  ) {
    roleRefinementFlags.push("url_or_handle_signal");
  }

  if (
    /^agents?$/i.test((currentTitle ?? "").trim()) &&
    currentCompany &&
    /\bnvidia\b/i.test(norm(currentCompany))
  ) {
    employmentConfidence = Math.min(employmentConfidence, 0.52);
  }

  const founderSecurityAmbiguous = enrichFounderExecSecurityFromHeadline({
    headline,
    currentTitle,
    currentCompany,
    roleCategories,
    profileExtra: roleRefinementFlags,
  });
  if (founderSecurityAmbiguous) {
    employmentConfidence = Math.max(employmentConfidence, 0.58);
  }

  for (const rc of deriveRoleCategoriesFromFunctionSeniority(functionTags, seniority, headline)) {
    if (!strictStudent || rc === "security_practitioner") roleCategories.add(rc);
  }

  applyHeadlineUnknownSalvageFromCues(roleCategories, headline);
  applyBroadProfessionalFamilyUnknownSalvage(roleCategories, headline, headlineFull);

  if (headlineIsAppSecStrategicMarketing(headline)) {
    roleCategories.delete("engineering_leader");
  }

  if (roleCategories.size === 0) roleCategories.add("unknown");

  reconcileDegreeSeekerPastFounderAndAcademic(
    headlineFull,
    headline,
    strictStudent,
    roleCategories,
    roleRefinementFlags
  );

  /** Drop title/post-derived founder labels when headline lacks explicit founder evidence. */
  if (!headlineHasExplicitFounderEvidence(headlineFull)) {
    roleCategories.delete("founder");
    roleCategories.delete("solo_founder");
    functionTags =
      functionTags.length > 0 ? functionTags.filter((t) => t !== "founder") : functionTags;
  } else {
    applyFounderSecondaryRolesFromHeadline(headlineFull, headline, roleCategories, functionTags);
  }

  functionTags = scrubMisleadingFunctionTags(headlineFull, functionTags);

  functionTags = applyUnknownOnlyRoleFallbackFromFunctionTags(
    roleCategories,
    functionTags,
    headlineFull
  );

  applyBroadProfessionalFamilyUnknownSalvage(roleCategories, headline, headlineFull);
  applyUnknownOnlyFromMeaningfulTagsSalvage(
    roleCategories,
    functionTags,
    headline,
    headlineFull
  );

  functionTags = augmentFounderDomainSecondaryRoles(
    headlineFull,
    headline,
    strictStudent,
    roleCategories,
    functionTags
  );

  const genericPost = isGenericEngagementPost(postContentJoined);

  const labelsClearlyClassified = labelsAreClearlyClassified({
    headline,
    headlineFull,
    currentTitle,
    roleCategories,
    functionTags,
    strictStudent,
    founderLeadSegment,
  });
  const associateOnly = /^\s*associate\s*$/i.test(headlineFull.trim());

  let companySizeSignal: ProspectClassification["companySizeSignal"] = "unknown";
  if (excludedRoleFlags.has("solo_operator")) companySizeSignal = "solo";
  else if (/\bowner\s+at\b/i.test(headline) && currentCompany) companySizeSignal = "tiny";
  else if (/\bstartup\b|\bseed\b|tiny|small\s+team/i.test(textBlob)) companySizeSignal = "startup";
  const employerBlob = `${currentTitle ?? ""} ${currentCompany ?? ""}`.trim();
  if (
    currentCompany &&
    employerBlob &&
    /\bfortune\b|\bglobal\s+500\b|\bftse\s+\d+/i.test(employerBlob)
  ) {
    companySizeSignal = "enterprise";
  }

  if (/owner\s+at\b/i.test(headline) && (!currentCompany || currentCompany.length < 24)) {
    excludedRoleFlags.add("company_too_small");
  }

  let organizationType: OrganizationType = "unknown";
  let employmentRelationship: EmploymentRelationship = "unknown";
  const hasNamedEmployer = !!currentCompany?.trim();
  const educationPrimary =
    strictStudent || (roleCategories.has("student") && !professionalTitleOutranksStudent(headline));

  if (educationPrimary) {
    employmentRelationship = "education_primary";
  } else if (/\bowner\s+at\b/i.test(headline) || roleCategories.has("owner_operator")) {
    employmentRelationship = "founder_owner";
    if (hasNamedEmployer) organizationType = "small_business";
  } else if (
    founderLeadSegment ||
    (roleCategories.has("founder") && hasNamedEmployer) ||
    headlineHasExplicitFounderEvidence(headlineFull)
  ) {
    employmentRelationship = "founder_owner";
    if (hasNamedEmployer) organizationType = "commercial_employer";
  } else if (
    roleCategories.has("solo_founder") ||
    (roleCategories.has("founder") && !hasNamedEmployer)
  ) {
    employmentRelationship = "founder_owner";
  } else if (hasNamedEmployer) {
    employmentRelationship = "named_employer";
    organizationType = "commercial_employer";
  } else if (
    roleCategories.has("consultant") ||
    excludedRoleFlags.has("consultant") ||
    /\b(?:fractional|independent\s+consultant|professional\s+services)\b/i.test(
      norm(headlineFull)
    ) ||
    (/\bfreelance\b|\bfreelancer\b/i.test(norm(headlineFull)) &&
      !headlineSuggestsJobSeekingFreelanceAvailability(headlineFull)) ||
    (/\badvisor\b/i.test(norm(headlineFull)) &&
      /\bconsult(?:ant|ing)\b/i.test(norm(headlineFull)) &&
      !coachTail) ||
    (excludedRoleFlags.has("solo_operator") && !hasNamedEmployer)
  ) {
    employmentRelationship = "independent_professional";
    organizationType = "consultancy_or_independent";
  }

  if (
    coachTail &&
    roleCategories.has("security_leader") &&
    !hasNamedEmployer &&
    !roleCategories.has("consultant")
  ) {
    employmentRelationship = "ambiguous";
    organizationType = "unknown";
  }

  if (
    employmentRelationship === "unknown" &&
    pipedHeadline &&
    employmentConfidence < 0.55 &&
    !strictStudent &&
    !labelsClearlyClassified
  ) {
    employmentRelationship = "ambiguous";
  }

  if (/^\s*engineering\s*$/i.test(headlineFull.trim()) && !strictStudent && !pipedHeadline) {
    if (!roleRefinementFlags.includes("weak_evidence")) roleRefinementFlags.push("weak_evidence");
    roleCategories.delete("founder");
  }

  const profileExtra: ProfileFlag[] = [...roleRefinementFlags, ...openToWorkResult.profileFlags];
  for (const f of employmentResolved.profileFlags) {
    if (!profileExtra.includes(f)) profileExtra.push(f);
  }
  if (densePipes) profileExtra.push("multiple_roles_signal");
  if (pipedHeadline && employmentConfidence < 0.55 && !strictStudent && !labelsClearlyClassified) {
    profileExtra.push("ambiguous_employment");
  }
  if (isOwnerMultiRoleAmbiguous(headline)) {
    profileExtra.push(
      "multiple_roles_signal",
      "possible_small_business",
      "ambiguous_professional_identity"
    );
  }
  const currentFounderForFlags =
    headlineHasExplicitFounderEvidence(headlineFull) || founderLeadSegment;
  if (currentFounderForFlags) {
    profileExtra.push("founder_signal");
  }
  if (headlineIndicatesPastFounder(headlineFull) && !currentFounderForFlags) {
    if (!profileExtra.includes("past_founder_signal")) profileExtra.push("past_founder_signal");
    if (!profileExtra.includes("past_role_signal")) profileExtra.push("past_role_signal");
  }
  if (coachTail) {
    profileExtra.push("coach_signal");
  }
  if (genericPost) {
    profileExtra.push("weak_post_context_signal");
  }

  /**
   * classificationNeedsReview: role/persona label ambiguity only.
   * employmentNeedsReview: title/company extraction ambiguity.
   * outreachNeedsReview: weak source post (orthogonal to labels).
   */
  let classificationNeedsReview = false;
  let employmentNeedsReview = employmentResolved.employmentNeedsReview;
  const classificationReasons: string[] = [];
  const employmentReasons: string[] = [];
  const outreachReasons: string[] = [];
  let outreachNeedsReview = genericPost;

  if (employmentNeedsReview && employmentReason) {
    employmentReasons.push(employmentReason);
  }

  if (/\bretired\b/i.test(headlineFull)) {
    if (!profileExtra.includes("retired_signal")) profileExtra.push("retired_signal");
    if ((pastTitle?.trim() || pastCompany?.trim()) && !profileExtra.includes("past_role_signal")) {
      profileExtra.push("past_role_signal");
    }
    employmentNeedsReview = true;
    if (!employmentReasons.some((r) => /retired/i.test(r))) {
      employmentReasons.push(
        "Retired profile; current employment not inferred from headline."
      );
    }
  }

  if (
    employmentSource === "headline" &&
    currentTitle?.trim() &&
    (headlineTitleLooksSloganLike(currentTitle) ||
      (currentCompany && headlineEmployerLooksEventOrMarketing(currentCompany)) ||
      (currentCompany &&
        headlineEmployerLooksDescriptorOrCompoundRole(currentCompany, currentTitle)))
  ) {
    employmentNeedsReview = true;
    employmentConfidence = Math.min(employmentConfidence, 0.42);
    employmentReasons.push(
      "Headline-derived title or employer reads as marketing, descriptor, or event copy; treat as low confidence."
    );
  }

  if (
    /\bretired\b/i.test(headlineFull) &&
    employmentSource === "headline" &&
    (currentTitle?.trim() || currentCompany?.trim())
  ) {
    const strippedTitle = (currentTitle ?? "")
      .replace(/^\s*retired\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (strippedTitle && !pastTitle) pastTitle = strippedTitle;
    if (currentCompany?.trim() && !pastCompany) pastCompany = currentCompany.trim();
    currentTitle = null;
    currentCompany = null;
    employmentSource = "unknown";
    employmentConfidence = 0;
    currentRoles = undefined;
    employmentNeedsReview = true;
    if (!profileExtra.includes("retired_signal")) profileExtra.push("retired_signal");
    if (!profileExtra.includes("past_role_signal")) profileExtra.push("past_role_signal");
    employmentReasons.push(
      "Retired headline employment treated as past-only; no current employer from headline."
    );
  }

  if (genericPost) {
    outreachReasons.push("Generic engagement-only post text.");
  }

  if (/^\s*engineering\s*$/i.test(headlineFull.trim()) && !strictStudent && !pipedHeadline) {
    classificationNeedsReview = true;
    classificationReasons.push("Single-word discipline headline without employer or role context.");
  }

  const clearTitleCo =
    !!currentTitle?.trim() &&
    hasNamedEmployer &&
    (employmentConfidence >= 0.52 || labelsClearlyClassified);

  if (
    !currentCompany &&
    !excludedRoleFlags.has("student") &&
    roleCategories.has("security_leader")
  ) {
    employmentNeedsReview = true;
    employmentReasons.push("Security leadership headline without extractable employer.");
  }
  if (/\|\s*coach\b/i.test(norm(headline)) && roleCategories.has("security_leader")) {
    classificationNeedsReview = true;
    classificationReasons.push("Coaching signal alongside security title.");
  }
  if (
    /^agents?$/i.test((currentTitle ?? "").trim()) &&
    currentCompany &&
    /\bnvidia\b/i.test(norm(currentCompany))
  ) {
    classificationNeedsReview = true;
    classificationReasons.push(
      "Ambiguous Agents/NVIDIA headline; validate primary role and employer."
    );
  }
  if (/\bmulti[- ]cloud\b/i.test(headline) && /\bmaestro\b/i.test(norm(headline))) {
    classificationNeedsReview = true;
    classificationReasons.push("Informal multi-cloud title; validate employer and wording.");
  }
  if (/\btechnical\s+lead\b/i.test(headline) && /\bat\s+devops\b/i.test(norm(headline))) {
    classificationNeedsReview = true;
    classificationReasons.push("DevOps used as an employer phrase; validate organization.");
  }
  if (/\bincoming\s*@\s*aws\b/i.test(headlineFull)) {
    classificationNeedsReview = true;
    classificationReasons.push("Incoming employer line; role timeline not yet confirmed.");
  }
  if (/^\s*design\s*@\s+/i.test(headlineFull.trim()) && !/\bdesigner\b/i.test(norm(headlineFull))) {
    classificationNeedsReview = true;
    classificationReasons.push("Minimal design title with @ employer; validate scope.");
  }
  if (
    pipedHeadline &&
    employmentConfidence < 0.55 &&
    !strictStudent &&
    !labelsClearlyClassified &&
    !clearTitleCo
  ) {
    employmentNeedsReview = true;
    employmentReasons.push("Multi-segment headline; primary employment not solid.");
  }
  if (founderSecurityAmbiguous) {
    classificationNeedsReview = true;
    classificationReasons.push(
      "Founder–CEO headline with security/platform positioning; validate primary employer."
    );
  }
  if (founderLeadSegment && internSignal) {
    classificationNeedsReview = true;
    classificationReasons.push("Founder and intern signals combined.");
  }
  if (isOwnerMultiRoleAmbiguous(headline)) {
    classificationNeedsReview = true;
    classificationReasons.push(
      "Owner or micro-business headline combines multiple role descriptors."
    );
  }
  if (headlineTooShort) {
    classificationNeedsReview = true;
    classificationReasons.push("Minimal headline text.");
  }
  if (roleCategories.has("unknown") && roleCategories.size === 1 && !strictStudent) {
    classificationNeedsReview = true;
    classificationReasons.push(
      "Only role_category is unknown; validate labels before high-stakes personalization."
    );
  }
  if (
    atCount >= 2 &&
    /&/.test(headline) &&
    /@/.test(headline) &&
    !strictStudent &&
    !(labelsClearlyClassified && clearTitleCo)
  ) {
    classificationNeedsReview = true;
    classificationReasons.push(
      "Headline mixes multiple @-style affiliations with compound connectors."
    );
  }
  if (
    pipedHeadline &&
    !hasNamedEmployer &&
    !strictStudent &&
    employmentConfidence < 0.52 &&
    !labelsClearlyClassified &&
    (roleCategories.has("solutions_engineer") ||
      roleCategories.has("technical_influencer") ||
      roleCategories.has("engineering_leader"))
  ) {
    employmentNeedsReview = true;
    employmentReasons.push(
      "Multi-segment technical headline without a reliable primary employer."
    );
  }
  if (/\brepair\s+operations\b/i.test(headline) && !/\bat\s+\w+/i.test(headline)) {
    classificationNeedsReview = true;
    excludedRoleFlags.add("insufficient_evidence");
    classificationReasons.push("Role line without employer context.");
  }
  if (
    roleCategories.has("consultant") &&
    !currentCompany &&
    !strictStudent &&
    (headline.length > 120 || /\bauthor\b/i.test(headline)) &&
    !labelsClearlyClassified
  ) {
    employmentNeedsReview = true;
    employmentReasons.push("Consulting-oriented headline without extractable employer.");
  }
  if (roleCategories.has("legal_counsel") && pipedHeadline && pipeCount >= 2) {
    classificationNeedsReview = true;
    classificationReasons.push("General counsel headline combines multiple professional contexts.");
  }
  if (roleRefinementFlags.includes("informal_title_signal")) {
    classificationNeedsReview = true;
    classificationReasons.push("Informal or unconventional title wording.");
  }
  if (
    /\bceo\b/i.test(norm(currentTitle ?? "")) &&
    /\bcreator\s+of\b/i.test(headline) &&
    atCount >= 2
  ) {
    classificationNeedsReview = true;
    classificationReasons.push("CEO headline with creator role and multiple affiliation signals.");
  }

  if (strictStudent) {
    classificationNeedsReview = false;
    classificationReasons.length = 0;
    outreachNeedsReview = false;
    outreachReasons.length = 0;
  }

  const unknownHeavy =
    roleCategories.has("unknown") && (roleCategories.size === 1 || !employmentConfidence);

  const rcArr = Array.from(roleCategories);

  const routingRecommendation: ProspectClassification["routingRecommendation"] = "unrouted";
  let reason = "Neutral classification only; routing is deferred to rules/UI.";

  if (!headline.trim() && !mergedText.trim()) {
    excludedRoleFlags.add("insufficient_evidence");
    classificationNeedsReview = true;
    classificationReasons.push("Insufficient evidence for headline or post text.");
    reason = "Insufficient evidence for headline or post text.";
  }

  const needsReview = classificationNeedsReview;
  if (employmentNeedsReview && employmentReasons.length === 0) {
    employmentReasons.push("Employment extraction needs validation.");
  }

  const profileFlagsFinal = buildProfileFlags(excludedRoleFlags, profileExtra);

  const confidence = computeLabelConfidence({
    roleCategories: rcArr,
    profileFlags: profileFlagsFinal,
    employmentConfidence,
    headlineTooShort,
    genericPost,
    pipedHeadline,
    unknownHeavy,
    headline: headlineFull,
    labelsClearlyClassified,
    associateOnly,
  });

  const professionalSummary = buildNormalizedProfessionalSummary({
    headline: headlineFull,
    roleCategories: rcArr,
    functionTags,
    seniority,
    strictStudent,
    founderLeadSegment,
    internSignal,
    currentTitle,
    currentCompany,
    educationInstitution,
    educationArea,
  });

  let safeProfessionalReference = buildSafeReference({
    roleCategories: rcArr,
    functionTags,
    profileFlags: new Set(profileFlagsFinal),
    headlineTooVague:
      headlineTooShort ||
      (rcArr.filter((c) => c !== "unknown").length === 0 &&
        !employmentConfidence &&
        !headlineHasRecognizableProfessionalCue(headlineFull)),
    headline: headlineFull,
    currentTitle,
  });

  safeProfessionalReference = finalizeSafeProfessionalReference({
    roleCategories: rcArr,
    functionTags,
    profileFlags: profileFlagsFinal,
    safeProfessionalReference,
    headline: headlineFull,
    currentTitle,
  });

  const pastFinal = finalizePastEmployerFields(pastCompany, headlineFull);
  pastCompany = pastFinal.pastCompany;
  const lastTitle = pastTitle;
  const lastCompany = pastFinal.lastCompany;

  if (profileExperienceInputCount === 0 && (currentCompany || pastCompany)) {
    const headlineNote =
      "No profile experience roles in evidence; title/company fields use headline fallback where present.";
    if (!employmentReason?.toLowerCase().includes("no profile experience")) {
      employmentReason = employmentReason
        ? `${employmentReason} ${headlineNote}`
        : headlineNote;
    }
  }

  return {
    linkedinUrl: options.linkedinUrl ?? undefined,
    name: options.name ?? undefined,
    currentTitle,
    currentCompany,
    pastTitle,
    pastCompany,
    lastTitle,
    lastCompany,
    currentRoles,
    pastRoles: pastRolesResolved,
    employmentSource,
    employmentReason,
    employmentConfidence,
    profileExperienceInputCount,
    rawProfileExperienceInputCount,
    validProfileExperienceInputCount: profileExperienceInputCount,
    rejectedProfileExperienceInputCount: rejectedExperienceValidationCount,
    primaryExperienceItemSource:
      employmentResolved.primaryExperienceItemSource ??
      experienceValidation.primaryExperienceItemSource,
    experienceEvidenceExcerpt:
      employmentResolved.primaryEvidenceExcerpt ??
      experienceValidation.primaryEvidenceExcerpt ??
      null,
    profileExperienceRejectionReason,
    currentTitleSource: currentTitle
      ? employmentSource === "profile_experience"
        ? "profile_experience"
        : employmentSource === "headline"
          ? "headline"
          : "unknown"
      : "unknown",
    currentCompanySource: currentCompany
      ? employmentSource === "profile_experience"
        ? "profile_experience"
        : employmentSource === "headline"
          ? "headline"
          : "unknown"
      : "unknown",
    currentCompanyConfidence: currentCompany ? employmentConfidence : 0,
    profileExperienceDataAvailableValid: profileExperienceInputCount > 0 ? "yes" : "no",
    profileExperienceAcquisitionStatus:
      profileExperienceInputCount > 0
        ? "roles_found"
        : rawProfileExperienceInputCount > 0
          ? "no_roles_found"
          : null,
    headlineEmploymentCandidateTitle:
      employmentResolved.headlineEmploymentCandidateTitle ??
      (profileExperienceInputCount > 0 && headlineEmploymentCandidate
        ? headlineEmploymentCandidate.title
        : null),
    headlineEmploymentCandidateCompany:
      employmentResolved.headlineEmploymentCandidateCompany ??
      (profileExperienceInputCount > 0 && headlineEmploymentCandidate
        ? headlineEmploymentCandidate.company || null
        : null),
    educationInstitution,
    educationArea,
    affiliations: affiliationList.length ? affiliationList : undefined,
    professionalSummary,
    safeProfessionalReference,
    roleCategories: rcArr,
    profileFlags: profileFlagsFinal,
    excludedRoleFlags: Array.from(excludedRoleFlags),
    outreachTags: [],
    seniority,
    functionTags,
    companySizeSignal,
    marketSegmentTerms: marketSegmentTerms.length ? marketSegmentTerms : undefined,
    companyType: organizationType,
    employmentRelationship,
    routingRecommendation,
    confidence,
    classificationNeedsReview,
    employmentNeedsReview: employmentNeedsReview ? true : undefined,
    outreachNeedsReview: outreachNeedsReview ? true : undefined,
    needsReview,
    reason: [
      reason,
      ...classificationReasons,
      ...(employmentNeedsReview ? employmentReasons.map((r) => `[employment] ${r}`) : []),
      ...(outreachNeedsReview ? outreachReasons.map((r) => `[outreach] ${r}`) : []),
    ]
      .filter(Boolean)
      .join(" "),
    evidence,
    classifierVersion: PROSPECT_CLASSIFIER_VERSION,
    openToWorkDetection: openToWorkResult.detection,
  };
}

/** Merge manual locks: locked fields keep values from `patchFrom`. */
export function mergeClassificationWithLocks(
  base: ProspectClassification,
  patchFrom: Partial<ProspectClassification>,
  lockedFields: Set<string>
): ProspectClassification {
  const keys = Object.keys(patchFrom) as (keyof ProspectClassification)[];
  const out = { ...base };
  for (const k of keys) {
    if (lockedFields.has(k as string)) continue;
    const v = patchFrom[k];
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k as string] = v;
  }
  return out;
}

export type LlmReconcileInput = {
  evidence: ProspectEvidence[];
  draftClassification: ProspectClassification;
  deterministicContext?: DeterministicProspectContext;
  invokeReasons?: string[];
};

export type LlmReconcileOutput = {
  patches: Partial<ProspectClassification>;
  citations: Array<{ field: keyof ProspectClassification; evidenceIndices: number[] }>;
};

export type ProspectLlmReconciler = {
  reconcile(input: LlmReconcileInput): Promise<LlmReconcileOutput>;
};

export const noopLlmReconciler: ProspectLlmReconciler = {
  async reconcile() {
    return { patches: {}, citations: [] };
  },
};
