/**
 * LinkedIn ingested posts store author fields on `Post.extraJson` (see `transformLinkedInPost`).
 */
export function getLinkedInAuthorFromExtraJson(extra: unknown): {
  profileUrl: string | null;
  headline: string | null;
} {
  if (extra == null || typeof extra !== "object" || Array.isArray(extra)) {
    return { profileUrl: null, headline: null };
  }
  const o = extra as Record<string, unknown>;

  const fromAuthor =
    o.author && typeof o.author === "object" && !Array.isArray(o.author)
      ? (o.author as Record<string, unknown>)
      : null;

  const rawUrl =
    (typeof o.authorProfileUrl === "string" && o.authorProfileUrl.trim()
      ? o.authorProfileUrl
      : null) ??
    (fromAuthor && typeof fromAuthor.profile_url === "string" && fromAuthor.profile_url.trim()
      ? (fromAuthor.profile_url as string)
      : null) ??
    (fromAuthor && typeof fromAuthor.url === "string" && fromAuthor.url.trim()
      ? (fromAuthor.url as string)
      : null);

  const rawHeadline =
    (typeof o.authorHeadline === "string" && o.authorHeadline.trim() ? o.authorHeadline : null) ??
    (fromAuthor && typeof fromAuthor.headline === "string" && fromAuthor.headline.trim()
      ? (fromAuthor.headline as string)
      : null);

  return {
    profileUrl: rawUrl,
    headline: rawHeadline,
  };
}

/**
 * Raw display line for who published a LinkedIn post (for "Name's post" in outreach), when DB
 * `authorName` might be unset but the scraper stored `extraJson.author`.
 */
export function linkedinOriginalPosterRawDisplayFromPostExtra(extra: unknown): string {
  if (extra == null || typeof extra !== "object" || Array.isArray(extra)) return "";
  const o = extra as Record<string, unknown>;

  const fromAuthor =
    o.author && typeof o.author === "object" && !Array.isArray(o.author)
      ? (o.author as Record<string, unknown>)
      : null;

  const assembledFromParts =
    fromAuthor &&
    (typeof fromAuthor.firstName === "string" ||
      typeof fromAuthor.lastName === "string")
      ? `${typeof fromAuthor.firstName === "string" ? fromAuthor.firstName.trim() : ""} ${
          typeof fromAuthor.lastName === "string" ? fromAuthor.lastName.trim() : ""
        }`.trim()
      : "";

  const candidate =
    (typeof fromAuthor?.name === "string" && fromAuthor.name.trim()) ||
    (assembledFromParts.trim() !== "" ? assembledFromParts.trim() : "") ||
    (typeof o.authorName === "string" && o.authorName.trim()) ||
    "";

  return candidate.trim();
}

/**
 * Collect short string fields from LinkedIn post `extraJson` for classifier evidence
 * (e.g. profile UI hints, badges) without embedding the full raw JSON.
 */
export function extractLinkedInSupplementaryEvidenceText(extra: unknown): string {
  if (extra == null || typeof extra !== "object") return "";
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 7 || out.length > 80) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length >= 2 && s.length <= 600 && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    }
  };
  walk(extra, 0);
  return out.join("\n");
}

const BADGE_UI_KEY_RE =
  /badge|frame|ring|decoration|open[-_]?to[-_]?work|opentowork|profilephoto|photo|image|aria|alt|overlay|stamp|mask|accompaniment|emphasis|profileframe/i;

/**
 * Strings from LinkedIn `extraJson` under keys that typically indicate public profile UI
 * (badge, frame, image alt, etc.) — used for Open-to-Work public labeling only.
 */
export function extractLinkedInBadgeUiStrings(extra: unknown): string[] {
  if (extra == null || typeof extra !== "object") return [];
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number, underUiKey: boolean) => {
    if (depth > 12 || out.length > 60) return;
    if (typeof node === "string") {
      const s = node.trim();
      if (s.length < 2 || s.length > 600 || seen.has(s)) return;
      if (
        underUiKey ||
        /#opentowork\b|\bopen\s+to\s+work\b|\bopen-to-work\b|\bopentowork\b/i.test(s)
      ) {
        seen.add(s);
        out.push(s);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1, underUiKey);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const nextUi = underUiKey || BADGE_UI_KEY_RE.test(k);
      walk(v, depth + 1, nextUi);
    }
  };

  walk(extra, 0, false);
  return out;
}
