import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import { formatFirstNameForGreeting, givenNameAfterLeadingHonorifics, singleLineText } from "@/lib/linkedin-prospects-csv/row-text";

export type LinkedinOutreachKind = "root_post" | "thread_comment";

export type LinkedinOutreachContext = {
  outreachKind: LinkedinOutreachKind;
  /** Conversation or single-post / orphan text the model can quote from */
  postOrThreadExcerpt: string;
  postUrl: string | null;
  authorFirstName: string;
  company: string;
  /** Job title / headline from profile (may be empty). */
  authorRole: string;
  themeLabel: string;
  productName: string;
  productFocus: string;
  productSummaryOneParagraph: string;
  productUrls: string[];
  objectiveName: string;
  objectiveDescription: string;
  /**
   * Exact closing of the body; may be multiple lines (e.g. "Thanks,\\nEran").
   * Nothing may follow this block in email_body.
   */
  signoffLine: string;
  /**
   * Comments only: verbatim token before English possessive **`'s post`** (subject line + Sentence A),
   * e.g. `"Robbie"` → `Robbie's post`; empty when genuinely unknown → model uses deterministic fallback wording.
   */
  originalPosterNameForPossessive?: string;
  /**
   * Comments only: short topic from the root post for the model to pick **one idea** in the body
   * (subject line is fixed in code; not used as the email title).
   */
  commentThreadTopicForSubject?: string;
};

/** Default sign-off block for generated LinkedIn outreach emails. */
export const DEFAULT_LINKEDIN_OUTREACH_SIGNOFF = "Thanks,\nEran";

/** Default public AgentSH URL in outbound LinkedIn outreach (no trailing slash). */
export const CANONICAL_OUTREACH_PRODUCT_URL = "https://www.agentsh.org";

/**
 * Any linked `agentsh.org` / `canyonroad.ai` reference URL is normalized to the canonical
 * public Agentsh URL used in outreach.
 */
export function normalizeProductUrlsForOutreach(urls: string[]): string[] {
  return urls.map((u) => {
    const t = (u || "").trim();
    if (!t) return t;
    try {
      const url = new URL(t);
      const host = url.hostname.toLowerCase();
      const isAgentsh =
        host === "agentsh.org" || host === "www.agentsh.org" || host.endsWith(".agentsh.org");
      const isCanyon =
        host === "canyonroad.ai" || host === "www.canyonroad.ai" || host.endsWith(".canyonroad.ai");
      if (isAgentsh || isCanyon) {
        return CANONICAL_OUTREACH_PRODUCT_URL;
      }
    } catch {
      if (/agentsh\.org|canyonroad\.ai/i.test(t)) {
        return CANONICAL_OUTREACH_PRODUCT_URL;
      }
    }
    return t;
  });
}

/** Rewrites canyonroad.agentsh product paths to canonical `agentsh.org`; strips trailing slash. */
function normalizeProductUrlsInText(s: string): string {
  const out = s
    .replace(/https?:\/\/(?:www\.)?agentsh\.org[^)\s]*/gi, CANONICAL_OUTREACH_PRODUCT_URL)
    .replace(
      /https?:\/\/(?:www\.)?canyonroad\.ai\/products\/agentsh[^)\s]*/gi,
      CANONICAL_OUTREACH_PRODUCT_URL
    )
    .replace(/https?:\/\/(?:www\.)?canyonroad\.ai[^)\s]*/gi, CANONICAL_OUTREACH_PRODUCT_URL);
  return stripTrailingSlashOnCanonicalUrl(out);
}

function stripTrailingSlashOnCanonicalUrl(s: string): string {
  const esc = CANONICAL_OUTREACH_PRODUCT_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return s.replace(new RegExp(`(${esc})\\/+(?=\\s|[).,;:!?\\]'"<]|$)`, "gi"), "$1");
}

function safeJsonText(s: string | null | undefined, max: number): string {
  const t = (s ?? "").trim();
  if (!t) return "(not configured)";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/**
 * LLMs often emit typographic quotes/dashes (U+2013, U+2019, …). Those are valid UTF-8 but
 * look broken if a tool mis-decodes, and plain email reads cleaner with ASCII punctuation.
 */
function normalizeOutreachPlainText(s: string): string {
  return (
    s
      .replace(/\u00a0/g, " ")
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u2033\u2036]/g, '"')
      .replace(/\u2013/g, "-")
      .replace(/\u2014/g, " - ")
      .replace(/\u2026/g, "...")
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      // "work email--hope" or "work email - hope" -> must read "work email - I hope"
      .replace(
        /(I did my best to track down )your work email\s*-{2,}\s*I?\s*hope this finds you/gi,
        "$1your work email - I hope this finds you"
      )
      .replace(
        /(I did my best to track down )your work email\s*-\s*hope this finds you/gi,
        "$1your work email - I hope this finds you"
      )
      .replace(
        /your work email\s*-{2,}\s*I?\s*hope this finds you/gi,
        "your work email - I hope this finds you"
      )
      .replace(
        /your work email\s*-\s*hope this finds you/gi,
        "your work email - I hope this finds you"
      )
      .replace(
        /(I tried my best to find )your work email\s*-{2,}\s*I?\s*hope this reaches you/gi,
        "$1your work email - I hope this reaches you"
      )
      .replace(
        /(I tried my best to find )your work email\s*-\s*hope this reaches you/gi,
        "$1your work email - I hope this reaches you"
      )
      .replace(
        /your work email\s*-\s*hope this reaches you/gi,
        "your work email - I hope this reaches you"
      )
      .replace(/\bI this reaches you\b/gi, "I hope this reaches you")
  );
}

/** One spaced hyphen, never two in a row (fixes "post--topic" → "post - topic"). */
function normalizeSubjectLineHyphens(s: string): string {
  return s
    .replace(/--+/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Subject line for threaded comments (deterministic — does not rely on model).
 * Pattern: `Re: your LinkedIn comment to [original poster]'s post`.
 */
export function fixedLinkedinCommentEmailSubject(originalPosterNameForSubject: string): string {
  const name = formatFirstNameForGreeting(
    originalPosterNameForSubject
      .replace(/\r|\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  if (!name) {
    return normalizeSubjectLineHyphens("Re: your LinkedIn comment to the original post");
  }
  const clipped = name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name;
  return normalizeSubjectLineHyphens(`Re: your LinkedIn comment to ${clipped}'s post`);
}

/** Short topic snippet from root post text or theme label — **body** opener hint only (not the email subject). */
export function buildLinkedinCommentSubjectTopic(
  rootPostContent: string | null | undefined,
  themeLabel: string | null | undefined
): string {
  const content = singleLineText(rootPostContent ?? "")
    .replace(/^["'`""]+/, "")
    .trim();
  let phrase = "";
  if (content.length >= 10) {
    const head = content.slice(0, 100);
    const punct = head.search(/[.!?](\s|$)/);
    phrase = (punct >= 12 ? head.slice(0, punct) : head).trim();
    if (phrase.length > 72) {
      phrase = phrase.slice(0, 72);
      const sp = phrase.lastIndexOf(" ");
      if (sp > 36) phrase = phrase.slice(0, sp);
    }
  }
  if (!phrase.trim()) {
    phrase = singleLineText(themeLabel ?? "").trim();
    if (phrase.length > 72) {
      phrase = phrase.slice(0, 72);
      const sp = phrase.lastIndexOf(" ");
      if (sp > 36) phrase = phrase.slice(0, sp);
    }
  }
  return phrase.trim() || "discussion";
}

/** Model sometimes echoes the full appreciation sentence; keep only words that belong after "... about ". */
function stripEchoedAppreciationAboutFragment(phrase: string): string {
  let t = phrase.replace(/\s+/g, " ").trim();

  const patterns: RegExp[] = [
    /^I\s+appreciated\s+your\s+LinkedIn\s+post\s+about\s+/i,
    /^I\s+appreciated\s+your\s+LinkedIn\s+comment\s+on\s+the\s+author'?s\s+post\s+about\s+/i,
    /^I\s+appreciated\s+your\s+LinkedIn\s+comment\s+on\s+.+\s+post\s+about\s+/i,
    /^your\s+LinkedIn\s+post\s+about\s+/i,
    /^LinkedIn\s+post\s+about\s+/i,
  ];

  for (let round = 0; round < 4; round++) {
    const before = t;
    for (const re of patterns) {
      t = t.replace(re, "").trim();
    }
    if (t === before) break;
  }

  const needle = "I appreciated your LinkedIn post about ";
  const lower = t.toLowerCase();
  let idx = lower.indexOf(needle.toLowerCase());
  while (idx >= 0) {
    t = t.slice(idx + needle.length).replace(/\s+/g, " ").trim();
    const l2 = t.toLowerCase();
    idx = l2.indexOf(needle.toLowerCase());
  }

  return t.trim();
}

type LinkedInOutreachPhraseExtract = {
  about_phrase: string;
  /** 2-4 words for email subject after "Your LinkedIn post about …" */
  subject_essence: string;
};

/** Strip fluff for subject-line fallback when the model omits subject_essence. */
function fallbackSubjectEssenceFromAbout(aboutPhrase: string): string {
  let s = aboutPhrase.replace(/\.\s*$/, "").trim().toLowerCase();
  s = s.replace(/^(the|a|an)\s+/i, "");
  s = s.replace(/^(the\s+)?(importance|role|need|value)\s+of\s+/i, "");
  s = s.replace(/\b(securing|protecting|improving)\s+/gi, "");
  s = s.replace(
    /\s+(in|for|within|across)\s+(ai\s+)?(workloads|organizations?|teams?|operations|practice|security)\s*$/i,
    ""
  );
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(/\s+/).filter(Boolean);
  const core = words.slice(0, 4).join(" ");
  return core.length >= 3 ? core : "what you shared";
}

async function extractLinkedInOutreachPhrases(
  excerpt: string,
  combinedThemeHint: string
): Promise<LinkedInOutreachPhraseExtract> {
  const hint = singleLineText(combinedThemeHint).trim().replace(/\.\s*$/, "");
  const defaultPair = (): LinkedInOutreachPhraseExtract => {
    const raw = hint.length >= 3 ? hint.slice(0, 180) : "what you shared";
    const fb = stripEchoedAppreciationAboutFragment(raw);
    const about = fb.length >= 3 ? fb : raw;
    return { about_phrase: about, subject_essence: fallbackSubjectEssenceFromAbout(about) };
  };

  try {
    const json = await openaiChatJsonObject({
      modelKind: "response",
      system: `Reply with JSON only:
{ "about_phrase": "string", "subject_essence": "string" }

about_phrase (ONLY the topical phrase inserted after fixed text "I appreciated your LinkedIn post about **…**"):
- **Must NOT** include "I appreciated", "your LinkedIn post", "comment on", or the word-combo "LinkedIn post about" — output **only** the topic, like: "non-human identities as a security frontier"
- 5-16 words, sentence case, ASCII apostrophe only, no quotes, no trailing period

subject_essence (for email subject line **only** — author already knows their post; be minimal):
- **2-4 words** (5 only if unavoidable), **lowercase** except real proper nouns (product/company names)
- Core topic kernel only — e.g. "non-human identities" or "supply chain trust"
- **Omit** filler: "the", "importance of", "securing", "why", trailing "in ai workloads", "in organizations", "in physical security teams", "for teams", etc.
- **No** hyphen. **No** period. **Do not** start with "about" (the template adds "about").`,
      user: `Theme/context hint (may be empty):\n${hint || "(none)"}

Excerpt:\n${safeJsonText(excerpt, 10_000)}`,
      temperature: 0.15,
      maxTokens: 220,
    });
    const rawAbout = typeof json.about_phrase === "string" ? json.about_phrase.trim() : "";
    const cleanedAbout = stripEchoedAppreciationAboutFragment(
      rawAbout
        .replace(/^[\"']+|[\"']+$/g, "")
        .replace(/\.\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );

    const rawEssence =
      typeof json.subject_essence === "string" ? json.subject_essence.trim() : "";
    let essence = rawEssence
      .replace(/^[\"']+|[\"']+$/g, "")
      .replace(/\.\s*$/g, "")
      .replace(/^about\s+/i, "")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const aboutOk = cleanedAbout.length >= 3 && cleanedAbout.length <= 220;
    if (!aboutOk) return defaultPair();

    const wc = essence ? essence.split(/\s+/).filter(Boolean).length : 0;
    if (essence.length < 2 || wc < 2 || wc > 6) {
      essence = fallbackSubjectEssenceFromAbout(cleanedAbout);
    }

    return { about_phrase: cleanedAbout, subject_essence: essence };
  } catch {
    return defaultPair();
  }
}

/** Fixed AgentSH body block after the appreciation paragraph. */
export function buildAgentshLinkedInOutreachBodyParts(params: {
  greetingStem: string;
  appreciationParagraph: string;
  productUrl: string;
  signoffBlock: string;
}): string {
  const { greetingStem, appreciationParagraph, productUrl, signoffBlock } = params;
  const g = greetingStem.trim().endsWith(",") ? greetingStem.trim() : `${greetingStem.trim()},`;
  const introBlock =
    `${appreciationParagraph.trim()} It really resonated with what we're seeing as agentic workflows become more autonomous.\n` +
    `I tried my best to find your work email - I hope this reaches you :)`;
  return [
    g,
    introBlock,
    `I'm building AgentSH (${productUrl}): an execution-layer guardrail for agents (policy + audit + runtime controls around the tools/ commands they run).`,
    "If you're open to it, I'd love to hop on a quick call to get your feedback on AgentSH and learn more about how you're thinking about using agents in practice - and where you see the biggest risks/ pain points.",
    "Would you be up for a 20-30 min chat sometime soon?",
    signoffBlock.trim(),
  ].join("\n\n");
}

/**
 * Builds LinkedIn outreach from a fixed AgentSH body template plus LLM `about_phrase` and
 * `subject_essence` (2-4 words for the post subject line).
 */
export async function generateLinkedinOutreachEmail(
  ctx: LinkedinOutreachContext
): Promise<{ email_subject: string; email_body: string }> {
  const urls = normalizeProductUrlsForOutreach(
    ctx.productUrls.filter((u) => /^https?:\/\//i.test(u))
  );
  const productUrl = urls[0] ?? CANONICAL_OUTREACH_PRODUCT_URL;

  const isComment = ctx.outreachKind === "thread_comment";
  const opNameLit = formatFirstNameForGreeting(
    givenNameAfterLeadingHonorifics(ctx.originalPosterNameForPossessive ?? "")
  );

  const themeHintMerged = singleLineText(
    [ctx.themeLabel?.trim(), ctx.commentThreadTopicForSubject?.trim()]
      .filter(Boolean)
      .join(" — ")
  );

  const { about_phrase: aboutPhrase, subject_essence: subjectEssence } =
    await extractLinkedInOutreachPhrases(
      ctx.postOrThreadExcerpt ?? "",
      themeHintMerged || ctx.themeLabel || ""
    );

  const aboutPhraseSanitized = stripEchoedAppreciationAboutFragment(aboutPhrase);

  const first = formatFirstNameForGreeting(givenNameAfterLeadingHonorifics(ctx.authorFirstName || ""));
  const greetingStem = first ? `Hi ${first}` : "Hi there";

  let appreciationParagraph: string;
  if (isComment) {
    appreciationParagraph = opNameLit
      ? `I appreciated your LinkedIn comment on ${opNameLit}'s post about ${aboutPhraseSanitized}.`
      : `I appreciated your LinkedIn comment on the author's post about ${aboutPhraseSanitized}.`;
  } else {
    appreciationParagraph = `I appreciated your LinkedIn post about ${aboutPhraseSanitized}.`;
  }

  const email_body = buildAgentshLinkedInOutreachBodyParts({
    greetingStem,
    appreciationParagraph,
    productUrl,
    signoffBlock: ctx.signoffLine ?? DEFAULT_LINKEDIN_OUTREACH_SIGNOFF,
  });

  const essenceForSubject = subjectEssence.replace(/\s+/g, " ").trim() || "your update";
  const email_subject = isComment
    ? fixedLinkedinCommentEmailSubject(opNameLit)
    : normalizeSubjectLineHyphens(`Your LinkedIn post about ${essenceForSubject}`);

  return {
    email_subject: normalizeProductUrlsInText(
      normalizeSubjectLineHyphens(normalizeOutreachPlainText(email_subject))
    ),
    email_body: normalizeProductUrlsInText(normalizeOutreachPlainText(email_body)),
  };
}

/**
 * One paragraph from my_product_summary_json (best-effort); never invents.
 */
export function myProductSummaryParagraph(summaryJson: string | null | undefined): string {
  if (!summaryJson?.trim()) return "";
  try {
    const o = JSON.parse(summaryJson) as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of [
      "highLevelDescription",
      "keyInnovativeIdeas",
      "differentiators",
      "intendedClients",
    ]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
    }
    return parts.join(" ").slice(0, 3000);
  } catch {
    return "";
  }
}

export function parseReferenceUrlsList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return v.map((x) => String(x).trim()).filter((u) => u.startsWith("http"));
    }
  } catch {
    if (raw.trim().startsWith("http")) return [raw.trim()];
  }
  return [];
}
