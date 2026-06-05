import type { ExperienceItemSource, ProfileExperienceRole } from "./profile-experience-types";
import {
  headlineEmployerLooksDescriptorOrCompoundRole,
  headlineEmployerLooksEventOrMarketing,
} from "./employment-guardrails";
import {
  isPlaceholderEmploymentValue,
  sanitizeEmploymentField,
} from "./sanitize-employment-placeholders";

export type { ExperienceItemSource };

export const ACCEPTED_PROFILE_EXPERIENCE_SOURCES: ReadonlySet<ExperienceItemSource> = new Set([
  "scraper_payload_experience_array",
  "validation_profile_experience_text",
  "public_profile_html_experience_section",
  "structured_profile_metadata",
]);

/** Must never populate employment_source=profile_experience. */
export const REJECTED_PROFILE_EXPERIENCE_SOURCES: ReadonlySet<ExperienceItemSource> = new Set([
  "llm_inferred_from_headline",
  "model_generated_from_headline",
  "headline_candidate",
  "ambiguous_affiliation",
  "credential_or_community_affiliation",
  "slogan_or_topic_phrase",
  "source_unavailable",
]);

const FABRICATED_COMPANY_LITERALS = new Set([
  "tech innovations inc",
  "tech innovations inc.",
  "tech solutions inc",
  "tech solutions inc.",
  "code solutions ltd",
  "code solutions ltd.",
  "global tech solutions",
  "web solutions ltd",
  "web solutions ltd.",
  "web solutions llc",
  "web dynamics",
  "creative tech co",
  "creative tech co.",
  "xyz corp",
  "xyz corporation",
  "abc technologies",
  "abc hr solutions",
  "xyz marketing agency",
  "innovatech",
  "innovatech labs",
  "saas company",
  "current company name",
  "previous company 1",
  "previous company 2",
]);

const FABRICATED_COMPANY_PATTERNS = [
  /^abc\b/i,
  /^xyz\b/i,
  /tech\s+innovations/i,
  /global\s+tech\s+solutions/i,
  /creative\s+tech/i,
  /web\s+solutions/i,
  /\bsaas\s+company\b/i,
  /\btech\s+solutions\b/i,
  /\bcode\s+solutions\b/i,
  /\binnovatech\b/i,
];

const CREDENTIAL_OR_PROGRAM_COMPANY =
  /\b(cyberpro\+?|ccna|comptia|security\+|cissp|ceh|pmp|aws\s+certified|google\s+certified|microsoft\s+certified|elite\s+earners)\b/i;

const COMMUNITY_AFFILIATION_COMPANY =
  /\b(credly|owasp|elite\s+earners\s+network|cio\s+community|ciso\s+community|chicago\s+ciso)\b/i;

const TOPIC_TECH_PHRASE =
  /\b(rag\b|agentic\s+systems?|llm\s+integration|azure\s+ai|depin\s+ai|open\s+source\s+contributor)\b/i;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function companyKey(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/\.$/, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isFabricatedOrGenericCompany(value: string | null | undefined): boolean {
  const v = companyKey(value ?? "");
  if (!v) return false;
  if (FABRICATED_COMPANY_LITERALS.has(v)) return true;
  if (FABRICATED_COMPANY_PATTERNS.some((p) => p.test(v))) return true;
  if (/^company\s+[ab]$/i.test(v)) return true;
  if (/^previous\s+company\s*\d*$/i.test(v)) return true;
  return false;
}

export function isAcceptedProfileExperienceSource(
  source: ExperienceItemSource | undefined
): boolean {
  if (!source) return false;
  return ACCEPTED_PROFILE_EXPERIENCE_SOURCES.has(source);
}

export function inferExperienceItemSourceFromAnalysisMethod(
  analysisMethod: string | undefined
): ExperienceItemSource {
  const m = (analysisMethod ?? "").toLowerCase();
  if (
    m.includes("apify") ||
    m.includes("scraper") ||
    m.includes("extra_json") ||
    m.includes("extrajson")
  ) {
    return "scraper_payload_experience_array";
  }
  if (m.includes("public_profile_html") || m === "public_profile_html_embed") {
    return "public_profile_html_experience_section";
  }
  if (
    (m.includes("validation") || m === "browser" || m.includes("profile_validation")) &&
    !m.includes("openai")
  ) {
    return "validation_profile_experience_text";
  }
  if (m.includes("structured")) return "structured_profile_metadata";
  if (m.includes("openai") || m.includes("url") || m.includes("headline")) {
    return "model_generated_from_headline";
  }
  if (m.includes("html") && !m.includes("openai")) {
    return "public_profile_html_experience_section";
  }
  return "source_unavailable";
}

/** Map stored/legacy source labels + analysis method to canonical provenance. */
export function normalizeExperienceItemSource(
  source: ExperienceItemSource | string | undefined,
  analysisMethod?: string,
  evidenceExcerpt?: string | null
): ExperienceItemSource {
  const fromMethod = inferExperienceItemSourceFromAnalysisMethod(analysisMethod);
  if (
    fromMethod === "model_generated_from_headline" ||
    fromMethod === "llm_inferred_from_headline"
  ) {
    return "model_generated_from_headline";
  }

  const s = (source ?? "").toLowerCase();
  if (s === "profile_validation_actual" || s === "validation_profile_experience_text") {
    return "validation_profile_experience_text";
  }
  if (s === "scraper_payload" || s === "scraper_payload_experience_array") {
    return "scraper_payload_experience_array";
  }
  if (s === "structured_profile_metadata") return "structured_profile_metadata";
  if (s === "public_profile_html" || s === "public_profile_html_experience_section") {
    const excerpt = (evidenceExcerpt ?? "").trim();
    if (excerpt.length >= 20 && !/headline hint only/i.test(excerpt)) {
      return "public_profile_html_experience_section";
    }
    return "model_generated_from_headline";
  }
  if (s === "llm_inferred_from_headline" || s === "model_generated_from_headline") {
    return "model_generated_from_headline";
  }
  if (ACCEPTED_PROFILE_EXPERIENCE_SOURCES.has(source as ExperienceItemSource)) {
    return source as ExperienceItemSource;
  }
  if (REJECTED_PROFILE_EXPERIENCE_SOURCES.has(source as ExperienceItemSource)) {
    return source as ExperienceItemSource;
  }
  return fromMethod;
}

export function parseAnalysisMethodFromMetadata(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const j = JSON.parse(raw) as { analysisMethod?: string };
    return typeof j.analysisMethod === "string" ? j.analysisMethod : undefined;
  } catch {
    return undefined;
  }
}

export function headlinePipeSegments(headline: string | null | undefined): string[] {
  return norm(headline ?? "")
    .split(/\s*[|·•]\s*|\s+·\s+/)
    .map((seg) => norm(seg))
    .filter(Boolean);
}

/** Company appears only as a headline pipe/topic segment, not as a verified @/at employer. */
export function companyDerivedOnlyFromHeadlineTopics(
  company: string,
  title: string,
  headline: string | null | undefined
): boolean {
  const h = norm(headline ?? "");
  const c = norm(company);
  const t = norm(title);
  if (!h || !c) return false;

  if (new RegExp(`\\s(@|at)\\s+${escapeRe(c)}\\b`, "i").test(h)) return false;
  if (new RegExp(`\\b${escapeRe(c)}\\s+(?:inc|llc|corp|ltd|gmbh|plc)\\b`, "i").test(h)) {
    return false;
  }

  const segments = headlinePipeSegments(h);
  if (segments.length < 2) return false;

  const cLower = c.toLowerCase();
  const companyInSegment = segments.some(
    (seg) => seg.toLowerCase() === cLower || seg.toLowerCase().includes(cLower)
  );
  if (!companyInSegment) return false;

  const tLower = t.toLowerCase();
  const titleInSegment = segments.some(
    (seg) => seg.toLowerCase() === tLower || (t.length >= 4 && seg.toLowerCase().includes(tLower))
  );
  if (titleInSegment || TOPIC_TECH_PHRASE.test(c)) return true;

  if (!/\s(@|at)\s+/.test(h) && segments.length >= 2) return true;
  return false;
}

export function titleLooksLikeAffiliation(title: string): boolean {
  const t = norm(title);
  if (!t) return false;
  if (/^member\s+of\b/i.test(t)) return true;
  if (/^incoming\s*@/i.test(t)) return true;
  if (/\bcommunity\s+builder\s+@/i.test(t)) return true;
  if (/\belite\s+earners\s+network\b/i.test(t)) return true;
  if (/\b(fellow|ambassador|volunteer)\s+(of|at)\b/i.test(t)) return true;
  return false;
}

export function companyLooksLikeCredentialOrCommunity(company: string, title?: string): boolean {
  const c = norm(company);
  const blob = norm(`${title ?? ""} ${c}`);
  if (CREDENTIAL_OR_PROGRAM_COMPANY.test(c) || CREDENTIAL_OR_PROGRAM_COMPANY.test(blob)) {
    return true;
  }
  if (COMMUNITY_AFFILIATION_COMPANY.test(c) || COMMUNITY_AFFILIATION_COMPANY.test(blob)) {
    return true;
  }
  if (/\+\s*$/.test(c) || /\b(certified|certification|credential)\b/i.test(c)) return true;
  return false;
}

export function companyLooksLikeSloganOrTopic(company: string, title?: string): boolean {
  const c = norm(company);
  if (!c) return false;
  if (headlineEmployerLooksDescriptorOrCompoundRole(c, title)) return true;
  if (headlineEmployerLooksEventOrMarketing(c)) return true;
  if (/\b(in\s+\d+\s+days?|transformation\s+for|intelligent\s+in)\b/i.test(c)) return true;
  if (c.split(/\s+/).length >= 5 && !/\b(inc|llc|corp|ltd|gmbh)\b/i.test(c)) return true;
  if (/\b(primal|axiom|eternal|servant|humility)\b/i.test(c) && /\s&\s/.test(c)) return true;
  return false;
}

export function isSparseNonEmploymentHeadline(headline: string | null | undefined): boolean {
  const h = norm(headline ?? "");
  if (!h) return true;
  if (/^[-–—]{1,3}$/.test(h)) return true;
  if (h.length <= 14 && !/\s(@|at)\s+[A-Za-z0-9]/i.test(h)) {
    if (/^(engineering|leadership|motivational|consulting|technology)$/i.test(h)) return true;
    if (/^leadership\s*\|\s*motivational$/i.test(h)) return true;
  }
  if (h.length < 8) return true;
  const hasEmployerCue = /\s(@|at)\s+[A-Za-z0-9]/i.test(h);
  const pipeSegments = h.split(/\s*\|\s*/).filter(Boolean);
  if (pipeSegments.length >= 2 && !hasEmployerCue && h.length < 55) {
    const credentialOnly = pipeSegments.every(
      (seg) =>
        /\b(student|intern|graduate|alumni|member|contributor|open source)\b/i.test(seg) ||
        seg.length < 22
    );
    if (credentialOnly) return true;
  }
  if (/\bsaas\s+company\s*\?/i.test(h) && !hasEmployerCue) return true;
  return false;
}

export type ExperienceRoleValidationResult = {
  role: ProfileExperienceRole | null;
  rejectionReason?: string;
  rejectedSource?: ExperienceItemSource;
};

export function validateProfileExperienceRole(
  role: ProfileExperienceRole,
  opts?: { headline?: string | null }
): ExperienceRoleValidationResult {
  const source = normalizeExperienceItemSource(
    role.experienceItemSource,
    undefined,
    role.evidenceExcerpt
  );

  if (REJECTED_PROFILE_EXPERIENCE_SOURCES.has(source)) {
    return {
      role: null,
      rejectionReason: `Rejected source (${source}); not evidence-backed profile experience.`,
      rejectedSource: source,
    };
  }

  if (!isAcceptedProfileExperienceSource(source)) {
    return {
      role: null,
      rejectionReason: `Source not accepted for profile_experience (${source}).`,
      rejectedSource: source === "source_unavailable" ? source : "source_unavailable",
    };
  }

  if (source === "public_profile_html_experience_section") {
    const excerpt = (role.evidenceExcerpt ?? "").trim();
    if (excerpt.length < 20) {
      return {
        role: null,
        rejectionReason:
          "public_profile_html_experience_section requires evidence_excerpt from Experience section.",
        rejectedSource: "model_generated_from_headline",
      };
    }
  }

  const title = sanitizeEmploymentField(role.title);
  let company = sanitizeEmploymentField(role.company);

  if (company && isFabricatedOrGenericCompany(company)) {
    return {
      role: null,
      rejectionReason: `Fabricated/generic company rejected: ${company}`,
      rejectedSource: "model_generated_from_headline",
    };
  }

  if (!title && !company) {
    return { role: null, rejectionReason: "Empty role after sanitization." };
  }

  if (title && titleLooksLikeAffiliation(title)) {
    return {
      role: null,
      rejectionReason: `Affiliation-style title rejected: ${title}`,
      rejectedSource: "ambiguous_affiliation",
    };
  }

  if (company && companyLooksLikeCredentialOrCommunity(company, title ?? undefined)) {
    return {
      role: null,
      rejectionReason: `Credential/community employer rejected: ${company}`,
      rejectedSource: "credential_or_community_affiliation",
    };
  }

  if (company && companyLooksLikeSloganOrTopic(company, title ?? undefined)) {
    return {
      role: null,
      rejectionReason: `Slogan/topic phrase rejected as employer: ${company}`,
      rejectedSource: "slogan_or_topic_phrase",
    };
  }

  if (company && opts?.headline && companyDerivedOnlyFromHeadlineTopics(company, title ?? "", opts.headline)) {
    return {
      role: null,
      rejectionReason: `Company matches headline topic segment only: ${company}`,
      rejectedSource: "slogan_or_topic_phrase",
    };
  }

  if (company && /\bsaas\s+company\b/i.test(company) && opts?.headline) {
    if (/\bsaas\s+company\s*\?/i.test(opts.headline)) {
      return {
        role: null,
        rejectionReason: "SaaS Company is audience phrasing in headline, not an employer.",
        rejectedSource: "slogan_or_topic_phrase",
      };
    }
  }

  return {
    role: {
      ...role,
      title: title ?? company ?? "",
      company: company ?? "",
      experienceItemSource: source,
    },
  };
}

export function validateProfileExperienceRoles(
  roles: ProfileExperienceRole[],
  opts?: { headline?: string | null; analysisMethod?: string }
): {
  roles: ProfileExperienceRole[];
  rejectedCount: number;
  rejectionReasons: string[];
  primaryExperienceItemSource?: ExperienceItemSource;
  primaryEvidenceExcerpt?: string | null;
} {
  const defaultSource = inferExperienceItemSourceFromAnalysisMethod(opts?.analysisMethod);
  const withSource = roles.map((r) => ({
    ...r,
    experienceItemSource: normalizeExperienceItemSource(
      r.experienceItemSource ?? defaultSource,
      opts?.analysisMethod,
      r.evidenceExcerpt
    ),
  }));

  if (
    isSparseNonEmploymentHeadline(opts?.headline) &&
    withSource.length >= 2 &&
    withSource.every(
      (r) =>
        r.experienceItemSource === "model_generated_from_headline" ||
        r.experienceItemSource === "llm_inferred_from_headline"
    )
  ) {
    return {
      roles: [],
      rejectedCount: withSource.length,
      rejectionReasons: [
        "Sparse/non-employment headline with model-generated multi-role history rejected.",
      ],
    };
  }

  const out: ProfileExperienceRole[] = [];
  const rejectionReasons: string[] = [];
  let rejectedCount = 0;

  for (const role of withSource) {
    const result = validateProfileExperienceRole(role, opts);
    if (result.role) {
      out.push(result.role);
    } else {
      rejectedCount++;
      if (result.rejectionReason) rejectionReasons.push(result.rejectionReason);
    }
  }

  const primary = out[0];
  return {
    roles: out,
    rejectedCount,
    rejectionReasons,
    primaryExperienceItemSource: primary?.experienceItemSource,
    primaryEvidenceExcerpt: primary?.evidenceExcerpt ?? null,
  };
}

export function fieldHasSyntheticEmploymentLeakage(value: string | null | undefined): boolean {
  const v = norm(value ?? "");
  if (!v) return false;
  if (isPlaceholderEmploymentValue(v)) return true;
  const parts = v.split(/\s*@\s*|\s*\|\s*/);
  for (const part of parts) {
    const p = part.trim();
    if (isPlaceholderEmploymentValue(p)) return true;
    if (isFabricatedOrGenericCompany(p)) return true;
  }
  if (isFabricatedOrGenericCompany(v)) return true;
  if (/\bnull\s*@\s*null\b/i.test(v)) return true;
  if (/\b@\s*null\b/i.test(v)) return true;
  return false;
}

/** @deprecated use isAcceptedProfileExperienceSource */
export function isTrustedProfileExperienceSource(source: ExperienceItemSource | undefined): boolean {
  return isAcceptedProfileExperienceSource(source);
}

/** @deprecated */
export const TRUSTED_PROFILE_EXPERIENCE_SOURCES = ACCEPTED_PROFILE_EXPERIENCE_SOURCES;
/** @deprecated */
export const UNTRUSTED_PROFILE_EXPERIENCE_SOURCES = REJECTED_PROFILE_EXPERIENCE_SOURCES;
