import { prisma } from "@/lib/prisma";
import { resolveThreadRootPostDbId } from "@/lib/linkedin-outreach/resolve-thread-root-post-id";
import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";

const MAX_CHARS = 6000;

function clipForModel(text: string, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(no text)";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/**
 * Minimal obvious supportive-only replies (no LLM). Full-string anchored, short texts only.
 */
function quickRejectSupportiveComment(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 3) return true;
  if (t.length > 200) return false;

  /** Heart / clap emoji only */
  if (/^[\u{1F495}\u{1F496}\u{2764}\u{1F44F}\u{1F973}\u{1F929}\u{2728}\s]+$/u.test(t)) {
    return true;
  }

  const patterns: RegExp[] = [
    /^(thanks?|thank you|ty)\b[!.\s]*$/i,
    /^(thanks?|thank you)\s+for\s+sharing\b[!.\s]*$/i,
    /^great post\b[!.\s]*$/i,
    /^great (share|article|read|content|insights?)\b[!.\s]*$/i,
    /^love this\b[!.\s]*$/i,
    /^well said\b[!.\s]*$/i,
    /^so true\b[!.\s]*$/i,
    /^congrats!?|congratulations\b[!.\s]*$/i,
    /^this(!|\.|,)?\s*$/i,
    /^interesting(!|\.|,)?$/i,
    /^agreed!?$/i,
    /^\+1\b[!.\s]*$/i,
  ];
  return patterns.some((re) => re.test(t.trim())) || /^👏+[!.]*$/u.test(t);
}

/**
 * For LinkedIn themes anchored on **thread replies**: keep only comments that materially engage with
 * the root post substance (ideas, caveat, objection, analogy, organisational angle, substantive question…).
 *
 * Drops generic praise/support with no tether to core ideas ("Great post!", "Thanks for sharing!").
 *
 * Root posts (`threadRefId` unset) bypass this elsewhere by not calling here.
 *
 * Returns true = include for prospecting/export; **on API failure returns true** (fail-open).
 */
export async function qualifiesLinkedInThreadCommentForProspecting(params: {
  rootPostText: string;
  commentText: string;
}): Promise<boolean> {
  const root = clipForModel(params.rootPostText, MAX_CHARS);

  if (quickRejectSupportiveComment(params.commentText)) return false;

  const comment = clipForModel(params.commentText, MAX_CHARS);

  try {
    const json = await openaiChatJsonObject({
      modelKind: "response",
      temperature: 0.12,
      maxTokens: 120,
      system: `You triage ONE reply on a LinkedIn thread for outbound prospect CSV inclusion.

Respond with JSON ONLY: { "include": boolean }

Set **include** to **true** when the COMMENT does at least one of:
- Engages substantive claims/tactics/topics in the ROOT (extends, critiques, qualifies, contrasts, organisational angle)
- Offers a differentiated perspective or risk not already obvious from reacting with praise alone
- Nontrivial problem framing, caveat, tooling angle, measurable concern, substantive question tied to ROOT content

Set **include** to **false** when the COMMENT is **only** congratulatory/supportive/social tone with **no meaningful tie** to ROOT substance (mere thanks, applause, tagging, vague cheerleading, emoji-only affirmation, shallow agreement **without WHY** tied to ROOT ideas).

Bias: Borderline fluff → **false**. Substantive but brief → **true**.`,

      user: `--- ROOT POST (opening of thread) ---
${root}

--- COMMENT (different person replied) ---
${comment}

Answer with JSON only: { "include": true|false }`,
    });

    const v = (json as Record<string, unknown>).include;
    if (typeof v === "boolean") return v;

    console.warn("[linkedin-comment-prospect-filter] Missing boolean include — default include");
    return true;
  } catch (e) {
    console.warn("[linkedin-comment-prospect-filter] OpenAI classify failed — default include:", e);
    return true;
  }
}

/** True when outreach/export should proceed. Root/original rows (no threadRefId) always pass. */
export async function linkedInMatchedPostPassesProspectSubstanceGate(params: {
  projectId: string;
  matchedPostDbId: number;
  threadRefId: string | null | undefined;
  matchedPostContent: string | null | undefined;
  themePostContentFallback: string | null | undefined;
}): Promise<boolean> {
  if (!String(params.threadRefId ?? "").trim()) return true;

  const rootDbId = await resolveThreadRootPostDbId(params.projectId, params.matchedPostDbId);
  const root = await prisma.post.findUnique({
    where: { id: rootDbId },
    select: { content: true },
  });

  const commentBody =
    (params.matchedPostContent ?? "").trim() ||
    (params.themePostContentFallback ?? "").trim();

  const rootTxt = root?.content ?? "";

  return qualifiesLinkedInThreadCommentForProspecting({
    rootPostText: rootTxt,
    commentText: commentBody,
  });
}
