import { hardSuspiciousCompany, looksLikeEducationTitle } from "./employment-guardrails";
import { normalizeEmployerName, stripPastEmployerPrefix } from "./normalize-employer-name";
import { isAcceptedProfileExperienceSource } from "./validate-profile-experience";
import type {
  EmploymentRoleRef,
  EmploymentSource,
  ProfileExperienceRole,
  ResolvedProspectEmployment,
} from "./profile-experience-types";
import type { StructuredProfileEmployment } from "./extract-profile-experience";
import { sanitizeProfileExperienceRoles } from "./sanitize-employment-placeholders";

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeCompany(companyRaw: string): string {
  let s = normalizeEmployerName(companyRaw);
  if (!s) return "";
  return s.replace(/\s+at\s+scale\b/gi, "").trim();
}

function dateRangeIsActive(dateRange: string | null | undefined): boolean {
  if (!dateRange?.trim()) return false;
  return /\b(present|current)\b/i.test(dateRange);
}

function roleIsActive(role: ProfileExperienceRole): boolean {
  if (role.isCurrent === true) return true;
  if (role.isCurrent === false) return false;
  const end = (role.endDate ?? "").trim();
  if (end && !/^(present|current)$/i.test(end)) return false;
  if (dateRangeIsActive(role.dateRange)) return true;
  const dr = (role.dateRange ?? "").trim();
  if (dr && !/\b(present|current)\b/i.test(dr) && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(dr)) {
    return false;
  }
  if (!end && !dr) return true;
  if (!end && dr && !dateRangeIsActive(dr)) {
    const closed = dr.match(/\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/);
    if (closed) return false;
  }
  return !end;
}

function looksLikeEducationRole(role: ProfileExperienceRole): boolean {
  const title = role.title.trim();
  const company = role.company.trim();
  if (looksLikeEducationTitle(title)) return true;
  const blob = norm(`${title} ${company}`);
  if (/\b(university|college|institute|polytechnic|school)\b/i.test(blob)) return true;
  if (/\b(b\.?\s*tech|mca|ms[\s.]?cs|bachelor|master\s+of|mba|ph\.?d)\b/i.test(blob)) return true;
  if (/\bstudent\s+at\b/i.test(blob) || /\bsenior\s+at\b/i.test(title)) return true;
  if (/^\s*cs\s*$/i.test(title) || /^\s*ms\s+cs\s*$/i.test(title)) return true;
  return false;
}

function isSideAdvisoryTitle(title: string): boolean {
  return /\b(advisor|adviser|mentor|board\s+member|volunteer|angel\s+investor|independent\s+director|non[- ]?executive\s+director|adjunct\s+professor)\b/i.test(
    title
  );
}

function operatorRoleScore(title: string): number {
  const t = norm(title);
  let score = 0;
  if (/\b(founder|co[- ]?founder|owner|ceo|cto|coo|president)\b/i.test(t)) score += 40;
  if (/\b(vp|vice\s+president|general\s+manager|gm)\b/i.test(t)) score += 32;
  if (/\b(director|head\s+of)\b/i.test(t)) score += 24;
  if (/\b(manager|lead|principal|staff)\b/i.test(t)) score += 16;
  if (/\b(engineer|developer|architect|analyst|consultant|specialist)\b/i.test(t)) score += 12;
  if (isSideAdvisoryTitle(t)) score -= 28;
  if (/\b(freelance|part[- ]?time)\b/i.test(t)) score -= 8;
  return score;
}

function companySignalScore(company: string): number {
  const c = company.trim();
  if (!c) return -10;
  if (hardSuspiciousCompany(c)) return -40;
  if (c.length < 2) return -8;
  if (/\b(self[- ]?employed|stealth|independent)\b/i.test(c)) return 4;
  return 12;
}

function parseStartSortKey(role: ProfileExperienceRole): number {
  const candidates = [role.startDate, role.dateRange].filter(Boolean) as string[];
  for (const raw of candidates) {
    const m = raw.match(/\b(20\d{2}|19\d{2})\b/g);
    if (m?.length) return parseInt(m[m.length - 1]!, 10);
  }
  return 0;
}

function rankActiveRoles(roles: ProfileExperienceRole[]): ProfileExperienceRole[] {
  return [...roles].sort((a, b) => {
    const scoreA = operatorRoleScore(a.title) + companySignalScore(a.company);
    const scoreB = operatorRoleScore(b.title) + companySignalScore(b.company);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return parseStartSortKey(b) - parseStartSortKey(a);
  });
}

function toRef(role: ProfileExperienceRole, opts?: { past?: boolean }): EmploymentRoleRef {
  let company = normalizeCompany(role.company);
  if (opts?.past && company) company = stripPastEmployerPrefix(company);
  return { title: norm(role.title), company };
}

function roleHasSourceBackedEvidence(role: ProfileExperienceRole): boolean {
  const source = role.experienceItemSource;
  if (!isAcceptedProfileExperienceSource(source)) return false;
  const excerpt = (role.evidenceExcerpt ?? "").trim();
  if (source === "public_profile_html_experience_section") return excerpt.length >= 20;
  return true;
}

function confidenceForProfileExperienceRole(
  role: ProfileExperienceRole,
  base: number
): { confidence: number; needsReview: boolean; reasonSuffix: string } {
  if (!roleHasSourceBackedEvidence(role)) {
    return {
      confidence: Math.min(base, 0.35),
      needsReview: true,
      reasonSuffix: " Missing evidence excerpt for accepted source.",
    };
  }
  const excerpt = (role.evidenceExcerpt ?? "").trim();
  if (excerpt.length >= 20) {
    return { confidence: base, needsReview: false, reasonSuffix: "" };
  }
  return {
    confidence: Math.min(base, 0.72),
    needsReview: true,
    reasonSuffix: " Accepted source without excerpt; lowered confidence.",
  };
}

function emptyResolved(reason: string): ResolvedProspectEmployment {
  return {
    currentTitle: null,
    currentCompany: null,
    pastTitle: null,
    pastCompany: null,
    currentRoles: [],
    pastRoles: [],
    employmentSource: "unknown",
    employmentConfidence: 0,
    employmentReason: reason,
    educationInstitution: null,
    educationArea: null,
    profileFlags: [],
    employmentNeedsReview: false,
  };
}

export type ResolveProspectEmploymentInput = {
  experienceRoles: ProfileExperienceRole[];
  structuredProfile: StructuredProfileEmployment | null;
  /** Headline fallback: pre-parsed title/company from clear "Title at Company" patterns only. */
  headlineEmployment: { title: string; company: string; confidence: number } | null;
  headlineAmbiguous: boolean;
  /** When set, headline/structured sources must not populate current_title/current_company. */
  headlineEmploymentCandidate?: { title: string; company: string } | null;
};

function withHeadlineCandidates(
  base: ResolvedProspectEmployment,
  input: ResolveProspectEmploymentInput
): ResolvedProspectEmployment {
  const c = input.headlineEmploymentCandidate;
  if (!c?.title?.trim()) return base;
  return {
    ...base,
    headlineEmploymentCandidateTitle: norm(c.title) || null,
    headlineEmploymentCandidateCompany: c.company ? normalizeCompany(c.company) || null : null,
  };
}

function experiencePastOnlyResolved(args: {
  pastRefs: EmploymentRoleRef[];
  educationInstitution: string | null;
  educationArea: string | null;
  profileFlags: ResolvedProspectEmployment["profileFlags"];
  reason: string;
}): ResolvedProspectEmployment {
  return {
    currentTitle: null,
    currentCompany: null,
    pastTitle: args.pastRefs[0]?.title ?? null,
    pastCompany: args.pastRefs[0]?.company ?? null,
    currentRoles: [],
    pastRoles: args.pastRefs,
    employmentSource: "profile_experience",
    employmentConfidence: 0.22,
    employmentReason: args.reason,
    educationInstitution: args.educationInstitution,
    educationArea: args.educationArea,
    profileFlags: args.profileFlags,
    employmentNeedsReview: true,
  };
}

export function resolveProspectEmployment(
  input: ResolveProspectEmploymentInput
): ResolvedProspectEmployment {
  const { roles: experienceRoles } = sanitizeProfileExperienceRoles(input.experienceRoles);
  const hasExperienceInput = experienceRoles.length > 0;
  const educationRoles: ProfileExperienceRole[] = [];
  const activeRoles: ProfileExperienceRole[] = [];
  const pastRoles: ProfileExperienceRole[] = [];

  for (const role of experienceRoles) {
    if (looksLikeEducationRole(role)) {
      educationRoles.push(role);
      continue;
    }
    if (roleIsActive(role)) activeRoles.push(role);
    else pastRoles.push(role);
  }

  let educationInstitution: string | null = null;
  let educationArea: string | null = null;
  if (educationRoles.length > 0) {
    const ed = educationRoles[0]!;
    if (looksLikeEducationTitle(ed.title) || /^\s*cs\s*$/i.test(ed.title)) {
      educationArea = norm(ed.title);
      educationInstitution = normalizeCompany(ed.company) || null;
    } else {
      educationArea = norm(ed.title);
      educationInstitution = normalizeCompany(ed.company) || null;
    }
  }

  const profileFlags: ResolvedProspectEmployment["profileFlags"] = [];
  const pastRefs = pastRoles.map((r) => toRef(r, { past: true })).filter((r) => r.title && r.company);
  if (pastRefs.length > 0) profileFlags.push("past_role_signal");

  if (activeRoles.length > 0) {
    const ranked = rankActiveRoles(activeRoles);
    const currentRoles = ranked.map((r) => toRef(r)).filter((r) => r.title);
    const primary = ranked[0]!;
    const primaryRef = toRef(primary);
    const title = primaryRef.title;
    const company = primaryRef.company;
    const missingParts = !title || !company;
    const suspicious = company ? hardSuspiciousCompany(company) : false;

    const confBase = confidenceForProfileExperienceRole(primary, 0.88);
    let employmentConfidence = confBase.confidence;
    let employmentNeedsReview = confBase.needsReview;
    let employmentReason = `Single active profile experience role (${primary.experienceItemSource ?? "source_unknown"}).${confBase.reasonSuffix}`;

    if (activeRoles.length > 1) {
      profileFlags.push("multiple_current_roles");
      employmentNeedsReview = true;
      employmentReason = `Multiple active profile roles (${activeRoles.length}); primary chosen by operator/advisory ranking.`;
      const top = operatorRoleScore(ranked[0]!.title);
      const second = operatorRoleScore(ranked[1]!.title);
      if (top - second < 8) {
        employmentConfidence = 0.62;
        employmentReason += " Primary vs secondary score close.";
      } else {
        employmentConfidence = 0.76;
      }
    }
    if (missingParts) {
      employmentConfidence = Math.min(employmentConfidence, 0.48);
      employmentNeedsReview = true;
      employmentReason = "Active profile role missing title or company.";
    }
    if (suspicious) {
      employmentConfidence = 0;
      employmentNeedsReview = true;
      employmentReason = "Active profile company failed validation.";
      return withHeadlineCandidates(
        {
          ...emptyResolved(employmentReason),
          employmentSource: "profile_experience",
          educationInstitution,
          educationArea,
          pastRoles: pastRefs,
          pastTitle: pastRefs[0]?.title ?? null,
          pastCompany: pastRefs[0]?.company ?? null,
          profileFlags,
        },
        input
      );
    }

    return withHeadlineCandidates(
      {
        currentTitle: title || null,
        currentCompany: company || null,
        pastTitle: pastRefs[0]?.title ?? null,
        pastCompany: pastRefs[0]?.company ?? null,
        currentRoles,
        pastRoles: pastRefs,
        employmentSource: "profile_experience",
        employmentConfidence,
        employmentReason,
        educationInstitution,
        educationArea,
        profileFlags,
        employmentNeedsReview,
        primaryExperienceItemSource: primary.experienceItemSource,
        primaryEvidenceExcerpt: primary.evidenceExcerpt ?? null,
      },
      input
    );
  }

  if (hasExperienceInput) {
    const reason =
      pastRefs.length > 0
        ? "Profile experience present; no active non-education role — most recent ended roles only."
        : educationRoles.length > 0
          ? "Profile experience present; only education entries — current employment not inferred."
          : "Profile experience present; no resolvable current or past employment roles.";
    return withHeadlineCandidates(
      experiencePastOnlyResolved({
        pastRefs,
        educationInstitution,
        educationArea,
        profileFlags,
        reason,
      }),
      input
    );
  }

  if (input.structuredProfile) {
    const title = norm(input.structuredProfile.title);
    const company = normalizeCompany(input.structuredProfile.company);
    if (title && company && !hardSuspiciousCompany(company) && !looksLikeEducationTitle(title)) {
      return {
        currentTitle: title,
        currentCompany: company,
        pastTitle: pastRefs[0]?.title ?? null,
        pastCompany: pastRefs[0]?.company ?? null,
        currentRoles: [{ title, company }],
        pastRoles: pastRefs,
        employmentSource: "structured_profile",
        employmentConfidence: 0.72,
        employmentReason: "Structured public profile metadata (title and company).",
        educationInstitution,
        educationArea,
        profileFlags,
        employmentNeedsReview: false,
      };
    }
  }

  if (input.headlineEmployment) {
    const title = norm(input.headlineEmployment.title);
    let company = normalizeCompany(input.headlineEmployment.company);
    if (company && hardSuspiciousCompany(company)) company = "";
    const educationTitle = looksLikeEducationTitle(title);
    if (title && !educationTitle) {
      if (!input.headlineAmbiguous && company) {
        const conf = Math.min(0.55, input.headlineEmployment.confidence);
        return {
          currentTitle: title,
          currentCompany: company,
          pastTitle: pastRefs[0]?.title ?? null,
          pastCompany: pastRefs[0]?.company ?? null,
          currentRoles: [{ title, company }],
          pastRoles: pastRefs,
          employmentSource: "headline",
          employmentConfidence: conf,
          employmentReason:
            "Headline fallback: clear title-at-company pattern (no profile experience).",
          educationInstitution,
          educationArea,
          profileFlags,
          employmentNeedsReview: conf < 0.55,
        };
      }
      if (input.headlineAmbiguous || !company) {
        return {
          currentTitle: null,
          currentCompany: null,
          pastTitle: pastRefs[0]?.title ?? null,
          pastCompany: pastRefs[0]?.company ?? null,
          currentRoles: [],
          pastRoles: pastRefs,
          employmentSource: input.headlineAmbiguous ? "unknown" : "headline",
          employmentConfidence: input.headlineAmbiguous ? 0 : 0.32,
          employmentReason: input.headlineAmbiguous
            ? "Headline employment ambiguous (multiple employers or unclear company); no profile experience."
            : "Headline title without confident employer; no profile experience.",
          educationInstitution,
          educationArea,
          profileFlags,
          employmentNeedsReview: true,
          headlineEmploymentCandidateTitle: title,
          headlineEmploymentCandidateCompany: company || null,
        };
      }
    }
  }

  if (input.headlineAmbiguous) {
    const cand = input.headlineEmploymentCandidate;
    return {
      ...emptyResolved("Headline employment ambiguous; no profile experience."),
      educationInstitution,
      educationArea,
      pastRoles: pastRefs,
      pastTitle: pastRefs[0]?.title ?? null,
      pastCompany: pastRefs[0]?.company ?? null,
      profileFlags,
      employmentNeedsReview: true,
      headlineEmploymentCandidateTitle: cand?.title ? norm(cand.title) : null,
      headlineEmploymentCandidateCompany: cand?.company
        ? normalizeCompany(cand.company) || null
        : null,
    };
  }

  return {
    ...emptyResolved("No profile experience, structured profile, or clear headline employment."),
    educationInstitution,
    educationArea,
    pastRoles: pastRefs,
    pastTitle: pastRefs[0]?.title ?? null,
    pastCompany: pastRefs[0]?.company ?? null,
    profileFlags,
  };
}

export type { EmploymentSource };
