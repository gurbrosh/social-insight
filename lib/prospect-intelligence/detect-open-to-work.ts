import type {
  OpenToWorkDetection,
  OpenToWorkEvidenceSource,
  ProfileFlag,
  ProspectEvidence,
} from "./types";

const NEGATED_OTW_RE =
  /\bnot\s+(?:actively\s+looking|open\s+to\s+work|open\s+for\s+work|seeking(?:\s+(?:new\s+)?role|\s+opportunities)?|available\s+for\s+hire|looking\s+for\s+(?:work|opportunities|my\s+next\s+role))\b/i;

/** Visible public badge / frame copy only (metadata, badge UI strings — not headline prose). */
const PUBLIC_BADGE_FRAME_RE =
  /#opentowork\b|\bopen\s+to\s+work\b|\bopen-to-work\b|\bopentowork\b/i;

const OPEN_TO_WORK_EXPLICIT_HEADLINE =
  /#opentowork\b|\bopen\s+to\s+work\b|\bopen\s+for\s+work\b/i;

const HEADLINE_OPEN_TO_OPPS =
  /\bopen\s+to\s+(?:new\s+)?opportunities\b|\bopen\s+to\s+new\s+opportunities\b|\bseeking\s+opportunities\b/i;

const HEADLINE_OPEN_TO_MODES =
  /\bopen\s+to\s+full[-\s]?time\b|\bopen\s+to\s+freelance\b|\bopen\s+to\s+full[-\s]?time\s*(?:&|and)\s*freelance\b|\bopen\s+to\s+freelance\s*(?:&|and|,)?\s*project(?:\s+work)?\b/i;

const HEADLINE_IMMEDIATE =
  /\bimmediate\s+joiner\b|\bavailable\s+immediately\b|\bavailable\s+for\s+immediate\s+joining\b/i;

const HEADLINE_JOB_SEARCH =
  /\blooking\s+for\s+work\b|\blooking\s+for\s+opportunities\b|\bseeking\s+new\s+role\b|\bavailable\s+for\s+hire\b|\bactively\s+looking\b|\blooking\s+for\s+my\s+next\s+role\b/i;

const OPEN_TO_ROLES_FALSE_INNER =
  /^source\b|\bopen\s+source\b|^openai\b|\bopen\s+for\s+collaboration\b|\bopen\s+for\s+collaborations\b|\bopen\s+for\s+paid\s+engagement\b/i;

/**
 * Headline job-search phrasing: "Open to [role area] roles".
 * Avoids open-source / OpenAI product adjacency and collaboration CTAs (handled elsewhere).
 */
export function matchHeadlineOpenToRolesPhrase(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 12 || containsNegatedOtw(t)) return null;
  const tn = normLower(t);
  if (/\bopen\s+for\s+collaboration\b|\bopen\s+for\s+collaborations\b|\bopen\s+for\s+paid\s+engagement\b/i.test(
    tn
  )) {
    return null;
  }
  const m = t.match(/\bopen\s+to\s+(.+?)\s+roles\b/i);
  if (!m?.[0]) return null;
  const inner = (m[1] ?? "").trim();
  const innerN = normLower(inner);
  if (inner.length < 2 || OPEN_TO_ROLES_FALSE_INNER.test(innerN)) return null;
  if (/\bopen\s+source\b/.test(innerN)) return null;
  if (/\bopenai\b/i.test(inner)) return null;
  return m[0].replace(/\s+/g, " ").trim();
}

/** Internship availability — explicit phrases only (avoids "open source", "open to relocation", product names). */
export const HEADLINE_INTERNSHIP_OTW =
  /\bopen\s+to\s+internship\s+opportunities\b|\bopen\s+to\s+internships?\b|\bopen\s+for\s+internships?\b|\bseeking\s+internship\s+opportunities\b|\blooking\s+for\s+internship\b|\blooking\s+for\s+internships\b/i;

/** Job-seeking availability language: freelance here is not consultant positioning. */
export function headlineSuggestsJobSeekingFreelanceAvailability(headline: string): boolean {
  if (!headline.trim()) return false;
  const n = normLower(headline.replace(/\s+/g, " "));
  return HEADLINE_OPEN_TO_MODES.test(n);
}

const HEADLINE_TRANSITION = /\bin\s+transition\b|\bbetween\s+roles\b|\brecently\s+laid\s+off\b|\blaid\s+off\b/i;

const JOB_SEEKER_LEGACY = /\bjob\s+seeker\b/i;

function normLower(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function containsNegatedOtw(s: string): boolean {
  return NEGATED_OTW_RE.test(normLower(s));
}

/** Compact badge/frame token for `open_to_work_evidence` (not full headline or long UI blobs). */
export function compactBadgeEvidenceSnippet(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const frameEq = t.match(
    /\b(?:profile[_\s.-]*photo[_\s.-]*frame|photo[_\s.-]*frame|badge[_\s.-]*type|frame)\s*=\s*([\w#.-]{1,64})/i
  );
  if (frameEq?.[1]) return frameEq[1].trim();

  const m = t.match(PUBLIC_BADGE_FRAME_RE);
  if (m) return m[0].replace(/\s+/g, " ").trim();

  const n = normLower(t);
  const needle = /#opentowork\b|\bopen\s+to\s+work\b|\bopen-to-work\b|\bopentowork\b/;
  const idx = n.search(needle);
  if (idx >= 0) {
    const slice = t.slice(idx).trim();
    return slice.length <= 72 ? slice : `${slice.slice(0, 69)}…`;
  }
  if (/\bopentowork\b/i.test(t) && t.length <= 48) return t;
  return t.length <= 64 ? t : `${t.slice(0, 61)}…`;
}

/**
 * Short textual evidence for `text_signal_detected` (matched job-search phrase, not whole headline).
 */
export function compactTextOtwEvidence(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const n = normLower(t);

  const intern = t.match(HEADLINE_INTERNSHIP_OTW);
  if (intern?.[0]) return intern[0].replace(/\s+/g, " ").trim();

  if (OPEN_TO_WORK_EXPLICIT_HEADLINE.test(n)) {
    const m = t.match(OPEN_TO_WORK_EXPLICIT_HEADLINE);
    if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  }
  if (HEADLINE_OPEN_TO_OPPS.test(n)) {
    const m = t.match(HEADLINE_OPEN_TO_OPPS);
    if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  }
  if (HEADLINE_OPEN_TO_MODES.test(n)) {
    const m = t.match(HEADLINE_OPEN_TO_MODES);
    if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  }
  if (HEADLINE_IMMEDIATE.test(n)) {
    const m = t.match(HEADLINE_IMMEDIATE);
    if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  }
  const otrPhrase = matchHeadlineOpenToRolesPhrase(t);
  if (otrPhrase) return otrPhrase;
  if (HEADLINE_JOB_SEARCH.test(n)) {
    const m = t.match(HEADLINE_JOB_SEARCH);
    if (m?.[0]) return m[0].replace(/\s+/g, " ").trim();
  }

  return t.length <= 120 ? t : `${t.slice(0, 117)}…`;
}

/**
 * Pipe segment is only job-search / availability (no professional title) — safe to drop for role parsing.
 */
export function isOpenToWorkOnlyPipeSegment(seg: string): boolean {
  const t = seg.replace(/\s+/g, " ").trim();
  if (!t || t.length > 160) return false;
  if (containsNegatedOtw(t)) return false;
  const n = normLower(t);
  if (
    /\b(engineer|developer|analyst|manager|director|lead\b|architect|consultant|specialist|admin|executive|officer|head\b|president|partner|strategist|designer|scientist|coach|founder|ceo|cto|cfo|\bvp\b|associate|coordinator|administrator)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (/^\s*#opentowork\b/i.test(t)) return true;
  if (OPEN_TO_WORK_EXPLICIT_HEADLINE.test(n)) return true;
  if (HEADLINE_OPEN_TO_OPPS.test(n)) return true;
  if (HEADLINE_OPEN_TO_MODES.test(n)) return true;
  if (HEADLINE_IMMEDIATE.test(n)) return true;
  if (HEADLINE_INTERNSHIP_OTW.test(t)) return true;
  if (/^available\s+for\s+hire\b/i.test(t)) return true;
  if (JOB_SEEKER_LEGACY.test(n)) return true;
  if (HEADLINE_JOB_SEARCH.test(n) && t.length < 90) return true;
  if (HEADLINE_TRANSITION.test(n) && t.length < 96) return true;
  if (matchHeadlineOpenToRolesPhrase(t)) return true;
  return false;
}

function stripMiddleDotOtwTail(s: string): string {
  return s
    .replace(
      /\s*[·•]\s*(?:immediate\s+joiner|available\s+immediately|available\s+for\s+immediate\s+joining|open\s+to\s+[^·|]+?)(?:\s*[·•]\s*(?:immediate\s+joiner|available\s+immediately|open\s+to\s+[^·|]+?))*$/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Headline with Open-to-Work-only tails removed so titles/roles parse beside `job_seeker`. */
export function headlineForRoleAndEmploymentParsing(headline: string): string {
  if (!headline.trim()) return headline;
  const parts = headline.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  let core =
    parts.length >= 2
      ? (() => {
          const kept = parts.filter((p) => !isOpenToWorkOnlyPipeSegment(p));
          return kept.length ? kept.join(" | ") : headline;
        })()
      : headline;
  core = stripMiddleDotOtwTail(core);
  return core.replace(/\s+/g, " ").trim();
}

function textSourceRank(s: OpenToWorkEvidenceSource): number {
  const order: OpenToWorkEvidenceSource[] = [
    "headline",
    "author_metadata",
    "badge_metadata",
    "image_alt_text",
    "profile_metadata",
    "source_post_text",
    "source_comment_text",
  ];
  const i = order.indexOf(s);
  return i === -1 ? 50 : i;
}

function publicSourceRank(s: OpenToWorkEvidenceSource): number {
  const order: OpenToWorkEvidenceSource[] = [
    "badge_metadata",
    "image_alt_text",
    "profile_metadata",
    "headline",
    "author_metadata",
    "source_post_text",
    "source_comment_text",
  ];
  const i = order.indexOf(s);
  return i === -1 ? 50 : i;
}

export type OpenToWorkDetectResult = {
  profileFlags: ProfileFlag[];
  detection: OpenToWorkDetection;
  markJobSeekerExclusion: boolean;
};

type PrimaryHit = { semantic: OpenToWorkEvidenceSource; snip: string };

type Acc = {
  publicBadgeUi: boolean;
  openToWorkText: boolean;
  jobSearch: boolean;
  transition: boolean;
  jobSeekerLegacy: boolean;
  publicPrimary: PrimaryHit | null;
  textPrimary: PrimaryHit | null;
};

function considerPublic(acc: Acc, semantic: OpenToWorkEvidenceSource, snip: string): void {
  const t = snip.replace(/\s+/g, " ").trim();
  if (t.length < 2) return;
  if (
    !acc.publicPrimary ||
    publicSourceRank(semantic) < publicSourceRank(acc.publicPrimary.semantic)
  ) {
    acc.publicPrimary = { semantic, snip: t.slice(0, 220) };
  }
  acc.publicBadgeUi = true;
}

function considerText(acc: Acc, semantic: OpenToWorkEvidenceSource, snip: string): void {
  const t = snip.replace(/\s+/g, " ").trim();
  if (t.length < 2) return;
  if (!acc.textPrimary || textSourceRank(semantic) < textSourceRank(acc.textPrimary.semantic)) {
    acc.textPrimary = { semantic, snip: t.slice(0, 220) };
  }
}

/** Hiring / third-party layoff commentary — never alone for OTW on post/comment. */
function postCommentLooksLikeNonSelfHiringOrThirdPartyLayoffs(text: string): boolean {
  const n = normLower(text);
  if (/\bwe(?:'re|\s+are)\s+(?:hiring|looking\s+to\s+hire|looking\s+for)\b/.test(n)) return true;
  if (/\bwe\s+are\s+hiring\b/.test(n)) return true;
  if (/\bhiring\s*[:\s]/i.test(text)) return true;
  if (/\blooking\s+for\s+(?:candidates?|talent|the\s+right\s+people|engineers?|developers?)\b/.test(n))
    return true;
  if (/\bsubmit\s+(?:your\s+)?(?:cv|resume|résumé)\b/i.test(text)) return true;
  if (/\bjoin\s+our\s+team\b/.test(n)) return true;
  if (/\brecruiting\s+for\b/.test(n)) return true;
  if (/\bhelp(?:ing)?\s+.{0,60}\s+(?:hire|hiring)\b/.test(n)) return true;
  if (/\btalent\s+acquisition\b/.test(n) && /\b(?:role|opening|hiring|position)\b/.test(n)) return true;
  if (/\bcandidates?\b/.test(n) && /\bactively\s+looking\b/.test(n) && !/\b(?:^|\s)(?:i|i'm|i am)\s+/i.test(n))
    return true;
  if (
    /\bactively\s+looking\b/.test(n) &&
    !/\b(?:^|[.!?]\s*)(?:i|i'm|i am)\b/i.test(n) &&
    /\b(?:candidates?|roles?|positions?|applicants?)\b/.test(n)
  )
    return true;
  if (/\b(?:companies|firms|corporations)\s+(?:are\s+)?(?:laying\s+off|cutting)\b/.test(n)) return true;
  if (/\blayoffs?\s+(?:at|hit|rock|continue)\b/.test(n)) return true;
  if (/\b\d[\d,]*\s+(?:people|employees?|workers?|staff)\s+(?:laid\s+off|cut|impacted)\b/i.test(text))
    return true;
  if (/\b\w+\s+lays?\s+off\b/.test(n)) return true;
  if (/\blayoffs?\s+(?:at|from)\s+\w+/i.test(text) && !/\b(?:i|i'm|i am)\b/.test(n)) return true;
  return false;
}

function postHasSelfReferentialOtw(text: string): boolean {
  if (containsNegatedOtw(text)) return false;
  const n = normLower(text);
  if (/\b(?:i|i'm|i am|i’ve|i've)\s+(?:am\s+)?open\s+to\s+work\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+open\s+to\s+new\s+opportunities\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+looking\s+for\s+my\s+next\s+role\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+available\s+for\s+hire\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+seeking\s+opportunities\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+(?:an\s+)?immediate\s+joiner\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+actively\s+looking\b/.test(n)) return true;
  if (/\b(?:i|i'm|i am)\s+(?:was\s+)?(?:recently\s+)?laid\s+off\b/.test(n)) return true;
  if (/\b(?:i|i’ve|i've)\s+been\s+laid\s+off\b/.test(n)) return true;
  if (
    /\b(?:i|i'm|i was)\s+.*\blaid\s+off\b/.test(n) &&
    /\b(?:looking|seeking|open\s+to)\b/.test(n)
  )
    return true;
  return false;
}

function evidenceSourceForProfileTextSource(src: ProspectEvidence["source"]): OpenToWorkEvidenceSource {
  if (src === "linkedin_author_metadata") return "author_metadata";
  if (src === "linkedin_author_headline") return "headline";
  return "headline";
}

function scanMetadataForPublicBadge(
  meta: Record<string, unknown> | undefined,
  acc: Acc
): void {
  if (!meta) return;
  const visit = (obj: unknown, depth: number, inherited: OpenToWorkEvidenceSource | null) => {
    if (depth > 10) return;
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const x of obj) visit(x, depth + 1, inherited);
      return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const kl = k.toLowerCase();
      let semantic: OpenToWorkEvidenceSource | null = inherited;
      if (/alt|aria|imagealt|photoalt|screenreader|screenread/i.test(kl)) semantic = "image_alt_text";
      else if (
        /badge|frame|ring|decoration|opentowork|open_to_work|overlay|stamp|mask|profileframe/i.test(kl)
      )
        semantic = "badge_metadata";
      else if (semantic === null) semantic = "profile_metadata";

      if (typeof v === "string" && v.trim().length >= 2) {
        const t = v.replace(/\s+/g, " ").trim();
        if (containsNegatedOtw(t)) continue;
        if (PUBLIC_BADGE_FRAME_RE.test(normLower(t))) {
          considerPublic(acc, semantic ?? "profile_metadata", t);
        }
      } else if (v && typeof v === "object") {
        visit(v, depth + 1, semantic ?? inherited);
      }
    }
  };
  visit(meta, 0, null);
}

/** Headline wording that must not be treated as self Open-to-Work (Open Source, relocation, product names). */
export function headlineHasOpenToWorkFalsePositivePhrase(headline: string): boolean {
  const n = normLower(headline.replace(/\s+/g, " ").trim());
  if (!/\bopen\b/i.test(n)) return false;
  if (/\bopen\s+to\s+work\b|\bopen\s+for\s+work\b|\bopentowork\b|#\s*opentowork\b/i.test(n)) {
    return false;
  }
  if (/\bopen\s+to\s+(?:new\s+)?opportunities\b/.test(n)) return false;
  if (/\b(?:looking|seeking)\s+for\s+(?:work|opportunities|my\s+next\s+role)\b/.test(n)) {
    return false;
  }
  if (/\bopen\s+source\b/.test(n)) return true;
  if (/\bopen\s+to\s+relocation\b/.test(n)) return true;
  if (/\bopen\s+for\s+collaboration\b/.test(n)) return true;
  if (/\bopenai\b/.test(n)) return true;
  if (/\bopenalgo\b/.test(n)) return true;
  return false;
}

function scanHeadlineStyleText(raw: string, acc: Acc, semantic: OpenToWorkEvidenceSource): void {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 4 || containsNegatedOtw(t)) return;
  const n = normLower(t);
  if (headlineHasOpenToWorkFalsePositivePhrase(t)) return;

  let matched = false;

  if (HEADLINE_INTERNSHIP_OTW.test(t)) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
  }
  if (OPEN_TO_WORK_EXPLICIT_HEADLINE.test(n)) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
  }
  if (HEADLINE_OPEN_TO_OPPS.test(n)) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
  }
  if (HEADLINE_OPEN_TO_MODES.test(n)) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
  }
  if (HEADLINE_IMMEDIATE.test(n)) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
  }
  if (HEADLINE_JOB_SEARCH.test(n)) {
    acc.jobSearch = true;
    matched = true;
    if (/\bopen\s+to\b/.test(n) || /\b(?:hire|role|opportunities)\b/.test(n)) acc.openToWorkText = true;
  }
  if (HEADLINE_TRANSITION.test(n)) {
    acc.transition = true;
    matched = true;
  }
  if (JOB_SEEKER_LEGACY.test(n)) {
    acc.jobSeekerLegacy = true;
    acc.openToWorkText = true;
    matched = true;
  }

  const otr = matchHeadlineOpenToRolesPhrase(t);
  if (otr) {
    acc.openToWorkText = true;
    acc.jobSearch = true;
    matched = true;
    considerText(acc, semantic, otr);
  } else if (matched) {
    considerText(acc, semantic, t);
  }
}

function scanPostOrCommentSelfOnly(
  raw: string,
  acc: Acc,
  semantic: "source_post_text" | "source_comment_text"
): void {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 8 || containsNegatedOtw(t)) return;

  if (postCommentLooksLikeNonSelfHiringOrThirdPartyLayoffs(t) && !postHasSelfReferentialOtw(t)) {
    return;
  }
  if (!postHasSelfReferentialOtw(t)) return;

  acc.openToWorkText = true;
  acc.jobSearch = true;
  if (/\blaid\s+off\b/.test(normLower(t))) acc.transition = true;
  considerText(acc, semantic, t);
}

/**
 * Neutral Open-to-Work / job-search labeling. `public_signal_detected` only from badge/frame/image-alt
 * style evidence — not from headline wording.
 */
export function detectOpenToWorkFromEvidence(args: {
  evidence: ProspectEvidence[];
  mergedTextBlob: string;
  linkedinProfileUiText?: string | null;
}): OpenToWorkDetectResult {
  const defaults: OpenToWorkDetection = {
    status: "not_observed",
    confidence: 0,
    reason:
      "No public badge/frame or self-attributed job-search wording in evidence; recruiters-only Open to Work is not observable from public data.",
  };

  const acc: Acc = {
    publicBadgeUi: false,
    openToWorkText: false,
    jobSearch: false,
    transition: false,
    jobSeekerLegacy: false,
    publicPrimary: null,
    textPrimary: null,
  };

  for (const ev of args.evidence) {
    const src = ev.source;

    scanMetadataForPublicBadge(ev.metadata as Record<string, unknown> | undefined, acc);

    const badgeList = (ev.metadata as Record<string, unknown> | undefined)?.linkedinBadgeUiStrings;
    if (src === "linkedin_extra_json" && Array.isArray(badgeList)) {
      for (const s of badgeList) {
        if (typeof s !== "string" || !s.trim()) continue;
        const t = s.replace(/\s+/g, " ").trim();
        if (containsNegatedOtw(t)) continue;
        if (PUBLIC_BADGE_FRAME_RE.test(normLower(t))) {
          considerPublic(acc, "badge_metadata", t);
        }
      }
    }

    if (!ev.rawText?.trim()) continue;

    if (src === "linkedin_author_headline") {
      scanHeadlineStyleText(ev.rawText, acc, "headline");
    } else if (src === "linkedin_author_metadata") {
      if (ev.rawText.trim().length >= 15) {
        scanHeadlineStyleText(ev.rawText, acc, "author_metadata");
      }
    } else if (src === "source_post_text") {
      scanPostOrCommentSelfOnly(ev.rawText, acc, "source_post_text");
    } else if (src === "source_comment_text") {
      scanPostOrCommentSelfOnly(ev.rawText, acc, "source_comment_text");
    } else if (
      src === "public_profile_fetch" ||
      src === "existing_db_record" ||
      src === "search_snippet" ||
      src === "enrichment_vendor" ||
      src === "manual_override" ||
      src === "llm_reconciler"
    ) {
      scanHeadlineStyleText(ev.rawText, acc, evidenceSourceForProfileTextSource(src));
    }
  }

  if (args.linkedinProfileUiText?.trim()) {
    const ui = args.linkedinProfileUiText.trim();
    const n = normLower(ui);
    if (!containsNegatedOtw(ui) && PUBLIC_BADGE_FRAME_RE.test(n)) {
      considerPublic(acc, "badge_metadata", ui);
    }
  }

  const profileFlags: ProfileFlag[] = [];
  if (acc.publicBadgeUi) profileFlags.push("open_to_work_public_signal");
  if (acc.openToWorkText || acc.jobSearch || acc.transition || acc.jobSeekerLegacy) {
    profileFlags.push("open_to_work_text_signal");
    if (acc.jobSearch || acc.jobSeekerLegacy) profileFlags.push("job_search_signal");
    if (acc.transition) profileFlags.push("career_transition_signal");
  }

  const dedupeFlags = Array.from(new Set(profileFlags)).sort();

  const anySignal =
    acc.publicBadgeUi ||
    acc.openToWorkText ||
    acc.jobSearch ||
    acc.transition ||
    acc.jobSeekerLegacy;

  if (!anySignal) {
    return {
      profileFlags: [],
      detection: defaults,
      markJobSeekerExclusion: false,
    };
  }

  const status = acc.publicBadgeUi ? "public_signal_detected" : "text_signal_detected";
  const evidenceSource =
    acc.publicBadgeUi && acc.publicPrimary
      ? acc.publicPrimary.semantic
      : acc.textPrimary?.semantic;

  let confidence = 0.72;
  if (acc.publicBadgeUi && acc.textPrimary) confidence = 0.9;
  else if (acc.publicBadgeUi) confidence = 0.88;
  else if (acc.textPrimary?.semantic === "headline") {
    const h = acc.textPrimary.snip;
    const n = normLower(h);
    if (HEADLINE_INTERNSHIP_OTW.test(h)) confidence = 0.76;
    else if (HEADLINE_IMMEDIATE.test(n) && HEADLINE_OPEN_TO_MODES.test(n)) confidence = 0.76;
    else if (OPEN_TO_WORK_EXPLICIT_HEADLINE.test(n) || HEADLINE_OPEN_TO_OPPS.test(n)) confidence = 0.84;
    else if (acc.transition && acc.jobSearch) confidence = 0.8;
    else if (acc.openToWorkText) confidence = 0.82;
    else if (acc.jobSearch || acc.transition) confidence = 0.78;
  } else if (acc.openToWorkText) confidence = 0.8;
  else if (acc.jobSearch || acc.transition) confidence = 0.76;

  const evidenceSupporting =
    acc.publicBadgeUi && acc.textPrimary ? acc.textPrimary.snip.slice(0, 360) : undefined;

  const evidencePrimary = acc.publicBadgeUi
    ? compactBadgeEvidenceSnippet(acc.publicPrimary?.snip ?? "") || "open_to_work"
    : compactTextOtwEvidence(acc.textPrimary?.snip ?? "");

  let detection: OpenToWorkDetection = {
    status,
    confidence,
    source: evidenceSource,
    evidence: evidencePrimary,
    evidenceSource,
    evidenceSupporting,
    reason: acc.publicBadgeUi
      ? "LinkedIn public badge, frame, or image/UI metadata consistent with Open to Work visibility."
      : "Self-attributed or headline job-search / availability wording observed in profile text.",
  };

  if (status === "text_signal_detected" && !acc.publicBadgeUi) {
    const headlineEv = args.evidence.find((e) => e.source === "linkedin_author_headline")?.rawText ?? "";
    if (headlineEv.trim() && headlineHasOpenToWorkFalsePositivePhrase(headlineEv)) {
      detection = { ...defaults };
      return {
        profileFlags: [],
        detection,
        markJobSeekerExclusion: false,
      };
    }
  }

  const globalNeg = containsNegatedOtw(args.mergedTextBlob);
  const markJobSeekerExclusion =
    !globalNeg &&
    (acc.openToWorkText ||
      acc.jobSearch ||
      acc.transition ||
      acc.jobSeekerLegacy ||
      acc.publicBadgeUi);

  return {
    profileFlags: dedupeFlags,
    detection,
    markJobSeekerExclusion,
  };
}
