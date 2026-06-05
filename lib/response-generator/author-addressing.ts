/**
 * Build prompt text so the model can address the post author by tag, username, or first name
 * (priority: tag > username > first name).
 */

export type AuthorAddressingParts = {
  mentionTag: string | null;
  username: string | null;
  firstName: string | null;
};

function normalizePlatform(p: string): string {
  return (p || "").trim().toLowerCase();
}

function looksLikeXHandle(s: string): boolean {
  const t = s.replace(/\s+/g, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(t);
}

/**
 * Derive mention tag, username, and first name from theme/post author fields.
 */
export function resolveAuthorAddressingParts(params: {
  platform: string;
  authorName: string | null | undefined;
  authorId: string | null | undefined;
}): AuthorAddressingParts {
  const platform = normalizePlatform(params.platform);
  const rawName = (params.authorName ?? "").trim();
  const rawId = (params.authorId ?? "").trim();

  let mentionTag: string | null = null;
  let username: string | null = null;
  let firstName: string | null = null;

  if (rawName.startsWith("@")) {
    mentionTag = rawName;
    username = rawName.slice(1).trim() || null;
  } else if (rawName) {
    username = rawName;
  }

  if (!mentionTag && username) {
    const compact = username.replace(/\s+/g, "");
    if (["twitter", "x", "bluesky", "threads", "mastodon"].includes(platform)) {
      if (looksLikeXHandle(compact)) {
        mentionTag = `@${compact}`;
      }
    } else if (platform === "reddit") {
      const u = username.replace(/^u\//i, "").trim();
      if (u && !/\s/.test(u)) {
        mentionTag = `u/${u}`;
      }
    } else if (platform === "github") {
      if (looksLikeXHandle(compact)) {
        mentionTag = `@${compact}`;
      }
    }
  }

  const nameForFirst = rawName.replace(/^@/, "").trim();
  const tokens = nameForFirst.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0];
    if (/^[A-Za-z][a-zA-Z'-]*$/.test(first) && first.length >= 2) {
      firstName = first;
    }
  } else if (tokens.length === 1) {
    const t = tokens[0];
    if (
      t.length >= 2 &&
      /^[A-Za-z][a-zA-Z'-]+$/.test(t) &&
      !/[0-9_]/.test(t) &&
      platform !== "reddit"
    ) {
      firstName = t;
    }
  }

  if (!username && rawId && !/^\d+$/.test(rawId)) {
    username = rawId;
    if (
      !mentionTag &&
      ["twitter", "x", "bluesky", "threads", "mastodon", "github"].includes(platform)
    ) {
      const c = rawId.replace(/\s+/g, "");
      if (looksLikeXHandle(c)) {
        mentionTag = `@${c}`;
      }
    }
  }

  return { mentionTag, username, firstName };
}

/** Single label for JSON target_user / default hint (priority: tag > username > first name). */
export function getPreferredAuthorLabel(parts: AuthorAddressingParts): string | null {
  if (parts.mentionTag) return parts.mentionTag;
  if (parts.username) return parts.username;
  if (parts.firstName) return parts.firstName;
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, collapse spaces, strip leading @ for comparing display name vs @handle forms. */
function normAuthorLabel(s: string): string {
  return s.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();
}

function stripLeadingGreeting(s: string): string {
  return s.replace(/^(hi|hey|hello),?\s+/i, "").trim();
}

/** All distinct ways we might address the same person (tag, display name, first name). */
function authorAddressCandidates(parts: AuthorAddressingParts): string[] {
  const raw = [parts.mentionTag, parts.username, parts.firstName].filter(
    (x): x is string => typeof x === "string" && x.trim() !== ""
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const k = normAuthorLabel(x);
    if (k.length < 2) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

/**
 * True if the reply already opens by addressing the author (with or without @, with or without Hi).
 */
function alreadyOpensWithAuthorAddress(text: string, parts: AuthorAddressingParts): boolean {
  const t = text.trim();
  if (!t) return false;
  const candidates = authorAddressCandidates(parts);
  if (candidates.length === 0) return false;

  const lower = t.toLowerCase();
  for (const c of candidates) {
    const lab = c.toLowerCase();
    if (lower.startsWith(lab)) return true;
    const n = normAuthorLabel(t);
    const cn = normAuthorLabel(c);
    if (cn.length >= 2 && n.startsWith(cn)) return true;
  }

  const withoutGreeting = stripLeadingGreeting(t);
  const ng = withoutGreeting.toLowerCase();
  for (const c of candidates) {
    const lab = c.toLowerCase();
    if (ng.startsWith(lab)) return true;
    const n = normAuthorLabel(withoutGreeting);
    const cn = normAuthorLabel(c);
    if (cn.length >= 2 && n.startsWith(cn)) return true;
  }

  for (const c of candidates) {
    const firstToken = normAuthorLabel(c).split(/\s+/)[0] ?? "";
    if (firstToken.length >= 2) {
      const re = new RegExp(`^(hi|hey|hello),?\\s+@?${escapeRegExp(firstToken)}\\b`, "i");
      if (re.test(t)) return true;
    }
  }

  return false;
}

/**
 * Remove "Name, @Name," / "Name, Name," at the very start when both sides are the same person.
 * Runs until no leading duplicate pair remains (handles "A, A, A, …").
 */
function dedupeDuplicateOpeningAddress(text: string): string {
  let t = text.trim();
  for (let k = 0; k < 8; k += 1) {
    const i = t.indexOf(",");
    if (i < 0) return t;
    const first = t.slice(0, i).trim();
    const rest = t.slice(i + 1).trim();
    const j = rest.indexOf(",");
    const second = (j < 0 ? rest : rest.slice(0, j)).trim();
    if (first.length < 2 || second.length < 2) return t;
    if (normAuthorLabel(first) === normAuthorLabel(second)) {
      t = j < 0 ? rest : rest;
      continue;
    }
    return t;
  }
  return t;
}

/**
 * If we have a preferred label but the model omitted an opening address, prepend it.
 * Recognizes @handle vs display name so we do not double-address.
 */
export function ensureOpeningAuthorAddress(
  responseText: string,
  parts: AuthorAddressingParts
): string {
  const label = getPreferredAuthorLabel(parts);
  if (!label) return dedupeDuplicateOpeningAddress(responseText.trim());
  const t = responseText.trim();
  if (!t) return responseText;
  if (alreadyOpensWithAuthorAddress(t, parts)) {
    return dedupeDuplicateOpeningAddress(t);
  }
  return dedupeDuplicateOpeningAddress(`${label}, ${t}`);
}

export function buildAuthorAddressingBlock(params: {
  platform: string;
  authorName: string | null | undefined;
  authorId: string | null | undefined;
}): string {
  const { mentionTag, username, firstName } = resolveAuthorAddressingParts(params);

  const hasAny =
    (mentionTag != null && mentionTag !== "") ||
    (username != null && username !== "") ||
    (firstName != null && firstName !== "");

  const mandatory =
    hasAny &&
    [
      "REQUIRED: Start `response_text` with a short greeting or address to the author using exactly one of the options below (highest priority first that is not “(none)”):",
      "- Use (1) if not (none); else (2) if not (none); else (3).",
      "- Put this address at the very beginning of the reply (first words), before the rest of your message. Examples: “u/someone, …”, “@handle …”, “Hi Alex, …”.",
      "- Use only one address at the start — never repeat the same name twice (e.g. not “Name, @Name,” or “DisplayName, DisplayName,”).",
      "- Do not skip this opening when any of (1)–(3) is available.",
    ].join("\n");

  const optional =
    !hasAny && "No author label on record — you may open neutrally without a direct name.";

  return [
    "Author (address them in the reply — priority order below):",
    `1) Mention / tag (use when this platform supports @mentions or subreddit-style names): ${mentionTag ?? "(none)"}`,
    `2) Username / handle / display name: ${username ?? "(none)"}`,
    `3) First name (given name only, when clearly a person’s name): ${firstName ?? "(none)"}`,
    "",
    mandatory || optional,
  ].join("\n");
}
