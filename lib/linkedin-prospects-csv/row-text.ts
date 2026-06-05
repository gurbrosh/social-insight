/** Single line for title / optional fields: collapse newlines. */
export function singleLineText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `merged_subject` at export: one line, no newlines, non-empty, trimmed — not truncated
 * (per pipeline spec).
 */
export function deriveMergedSubjectFromBody(body: string): string | null {
  const t = String(body)
    .replace(/\r\n|\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  const oneLine = t.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine;
}

/**
 * Company from a LinkedIn **headline** (when Experience is unavailable): use text after
 * the last ` at `, else the segment right of the last `@`, else the rightmost `|` segment.
 */
export function parseCompanyFromHeadline(headline: string | null | undefined): string {
  const t = (headline ?? "").trim();
  if (!t) return "";
  const single = singleLineText(t);
  const atParts = single.split(/\s+at\s+/i);
  if (atParts.length >= 2) {
    const after = (atParts[atParts.length - 1] ?? "").trim();
    return (after.split(/[|·]/)[0] ?? after).trim();
  }
  if (/@/.test(single)) {
    const atSeg = (single.split("@").pop() ?? "").trim();
    if (atSeg) return (atSeg.split(/[|·]/)[0] ?? atSeg).trim();
  }
  if (/\|/.test(single)) {
    const segs = single.split("|").map((p) => p.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const right = (segs[segs.length - 1] ?? "").trim();
      return (right.split(/[·]/)[0] ?? right).trim();
    }
  }
  return "";
}

export type NameParts = { first_name: string; last_name: string };

/** Normalize head-of-token for comparisons (handles `Dr.` → `dr`). */
function normalizedHonorificKeyword(token: string): string {
  return token.replace(/\.+$/g, "").trim().toLowerCase();
}

const LEADING_NAME_PREFIXES = new Set([
  "mx",
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "doctor",
  "sir",
  "madam",
  "madame",
  "prof",
  "professor",
  "rev",
  "reverend",
  "rabbi",
  "imam",
  "sheikh",
  "father",
  "fr",
  "sister",
  "brother",
  "monsignor",
  "lord",
  "lady",
  "dame",
  "hon",
  "honorable",
  "honourable",
]);

function isHonorificLeadingToken(raw: string): boolean {
  return LEADING_NAME_PREFIXES.has(normalizedHonorificKeyword(raw));
}

/** True when the token is a lone title (same set used when skipping display-name prefixes). */
export function isHonorificNamePrefixOnly(raw: string | null | undefined): boolean {
  return isHonorificLeadingToken(raw ?? "");
}

/**
 * Tokens that aren't usable as a conversational first name — skip toward the next substantive word,
 * mainly after stripping Dr./Mr.-style prefixes.
 */
function looksLikePersonalFirstNameToken(raw: string): boolean {
  const t = raw.replace(/^[\s,]+|[\s,]+$/g, "").trim();
  if (!t) return false;
  const coreForInitial = t.replace(/\.+$/g, "").trim();
  if (/^[A-Za-z]\.?$/i.test(coreForInitial)) return false;
  if (t.length < 2) return false;

  const lower = normalizedHonorificKeyword(t);
  if (["jr", "sr", "ii", "iii", "iv"].includes(lower)) return false;

  const asciiLetters = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return asciiLetters.length >= 2;
}

const capitalizeGreetingNameToken = (token: string): string => {
  if (!token) return "";
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
};

/**
 * First/given name for salutations: first letter uppercase, rest lowercase (fixes ALL CAPS from LinkedIn).
 * Hyphenated and apostrophe forms (e.g. Anne-Marie, O'Brien) get that rule per segment.
 */
export function formatFirstNameForGreeting(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t
    .split("-")
    .map((hyphenPart) =>
      hyphenPart
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.split("'").map(capitalizeGreetingNameToken).join("'"))
        .join(" ")
    )
    .join("-");
}

/** From display "First Last" or "First M. Last". */
export function splitDisplayNameToParts(display: string | null | undefined): NameParts {
  const s = (display ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { first_name: "", last_name: "" };
  const parts = s.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < parts.length && isHonorificLeadingToken(parts[i] ?? "")) {
    i += 1;
  }
  const remainder = parts.slice(i);
  if (remainder.length === 0) {
    return { first_name: "", last_name: "" };
  }
  if (remainder.length === 1) {
    return { first_name: remainder[0] ?? "", last_name: "" };
  }

  const prefixStripped = i > 0;
  let firstIdx = 0;
  if (prefixStripped) {
    const idx = remainder.findIndex((tok) => looksLikePersonalFirstNameToken(tok ?? ""));
    if (idx !== -1) firstIdx = idx;
  }

  const firstRaw = remainder[firstIdx] ?? "";
  const lastRaw = [...remainder.slice(0, firstIdx), ...remainder.slice(firstIdx + 1)]
    .join(" ")
    .trim();

  return {
    first_name: firstRaw,
    last_name: lastRaw,
  };
}

/**
 * Single given name after leading honorifics (Dr./Sir/…) for greetings or `{ authorFirstName }` hints.
 */
export function givenNameAfterLeadingHonorifics(raw: string | null | undefined): string {
  const split = splitDisplayNameToParts(singleLineText(raw ?? "").trim());
  return split.first_name.trim();
}

/**
 * From /in/ slug (after normalization) without network calls.
 * e.g. jordan-chen-a1b2 → first: Jordan, last: Chen a1b2 or split first/last on hyphens
 */
export function firstLastFromInSlugPath(canonicalInUrl: string): NameParts {
  const m = canonicalInUrl.match(/\/in\/([A-Za-z0-9\-_%]+)$/);
  if (!m?.[1]) return { first_name: "", last_name: "" };
  const slug = m[1];
  const segments = slug.split("-").filter((p) => p && !/^\d+$/.test(p));
  if (segments.length >= 2) {
    const titleCase = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    if (segments.length === 2) {
      return { first_name: titleCase(segments[0] ?? ""), last_name: titleCase(segments[1] ?? "") };
    }
    return {
      first_name: titleCase(segments[0] ?? ""),
      last_name: titleCase(segments[segments.length - 1] ?? ""),
    };
  }
  if (segments.length === 1) {
    const p = segments[0] ?? "";
    return { first_name: p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(), last_name: "" };
  }
  return { first_name: "", last_name: "" };
}

/**
 * Headline: `title` = full line (one line) for context; `company` via {@link parseCompanyFromHeadline}.
 */
export function titleAndCompanyFromHeadline(headline: string | null | undefined): {
  title: string;
  company: string;
} {
  const t = (headline ?? "").trim();
  if (!t) return { title: "", company: "" };
  const single = singleLineText(t);
  return { title: single, company: parseCompanyFromHeadline(headline) };
}

export function isValidSubjectLine(s: string): boolean {
  if (!s || !s.trim()) return false;
  return !/[\r\n]/.test(s);
}

export function isValidBody(s: string): boolean {
  return s != null && String(s).trim() !== "";
}
