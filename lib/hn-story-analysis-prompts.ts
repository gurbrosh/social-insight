/**
 * LLM prompts for Hacker News story comment-thread summarization.
 */

import { configService } from "@/lib/config-service";
import type { RankedCommentThread } from "@/lib/hackernews/story-comment-tree";

const MIN_TOTAL_CHARS = 200;

/**
 * True if the first sentence is setup-only (themes/revolves/forum/thread labels), not substance.
 * Do not use [^.]* across the whole sentence — domains like archive.today break naive "first sentence" regexes.
 */
function isMetaLeadSentence(sentence: string): boolean {
  const t = sentence.trim();
  if (t.length === 0) return false;
  if (/^Comments from HackerNews story\s+/i.test(t)) return true;
  if (/^The main themes in the (comments|forum discussion)\s+revolve around\b/i.test(t))
    return true;
  if (/^The main theme in the comments\s+revolves around\b/i.test(t)) return true;
  if (/^The forum discussion\s+primarily revolves around\b/i.test(t)) return true;
  if (/^The discussion\s+primarily revolves around\b/i.test(t)) return true;
  if (/^The discussion around the story\b/i.test(t)) return true;
  if (/^The discussion surrounding\b/i.test(t)) return true;
  if (/^The comments on the forum thread\b/i.test(t)) return true;
  if (/^The comments on this thread\b/i.test(t)) return true;
  if (/^In the comments\b/i.test(t)) return true;
  if (/^Commenters (focused on|discussed|debated)\b/i.test(t)) return true;
  if (/^Readers discussed\b/i.test(t)) return true;
  if (/^Users in the thread\b/i.test(t)) return true;
  if (/^The highlighted threads\b/i.test(t)) return true;
  if (/^These threads are noteworthy\b/i.test(t)) return true;
  if (/^Threads \d+ and \d+ garnered\b/i.test(t)) return true;
  return false;
}

function firstSentenceKey(s: string): string {
  const m = s.trim().match(/^([^.!?]+[.!?])/);
  return m ? m[1].trim().toLowerCase() : s.trim().toLowerCase();
}

/** Split on ". " so domains like archive.today stay inside one sentence. */
function stripMetaLeadSentencesFromParagraph(para: string): string {
  const p = para.trim();
  if (!p) return p;
  const parts = p.split(/\. +/);
  if (parts.length < 2) {
    const one = parts[0] ?? "";
    const withDot = one.endsWith(".") ? one : `${one}.`;
    if (isMetaLeadSentence(withDot)) return "";
    return p;
  }
  const first = parts[0]?.trim() ?? "";
  const withDot = first.endsWith(".") ? first : `${first}.`;
  if (!isMetaLeadSentence(withDot)) return p;
  const rest = parts.slice(1).join(". ").trim();
  return rest.endsWith(".") || rest.includes("\n") ? rest : `${rest}.`;
}

function stripMetaOpenersFromBody(body: string): string {
  const paras = body.split(/\n\n+/).map((p) => p.trim());
  const cleaned: string[] = [];
  for (const para of paras) {
    if (!para) continue;
    let s = stripMetaLeadSentencesFromParagraph(para);
    let prev = "";
    while (s !== prev && s.length > 0) {
      prev = s;
      const next = stripMetaLeadSentencesFromParagraph(s);
      if (next === s) break;
      s = next;
    }
    if (s) cleaned.push(s);
  }
  for (let i = 1; i < cleaned.length; i++) {
    const a = firstSentenceKey(cleaned[i - 1] ?? "");
    const b = firstSentenceKey(cleaned[i] ?? "");
    if (a.length >= 40 && b.length >= 40 && a === b) {
      const rest = (cleaned[i] ?? "").replace(/^\s*([^.!?]+[.!?])\s*/, "").trim();
      cleaned[i] = rest;
    }
  }
  return cleaned
    .filter((p) => p.trim().length > 0)
    .join("\n\n")
    .trim();
}

/**
 * Summarize comment threads; final text is `[title] — Comments on Hacker News: [body]` so the
 * story title is the first thing readers see. Returns null if not enough substantive text.
 */
export async function summarizeHnCommentThreadsWithLLM(params: {
  storyTitle: string | null;
  threads: RankedCommentThread[];
}): Promise<string | null> {
  const { threads } = params;
  if (threads.length === 0) return null;

  const combined = threads.map((t) => `${t.engagementNote}\n${t.excerpt}`).join("\n\n---\n\n");
  if (combined.trim().length < MIN_TOTAL_CHARS) return null;

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const titleLine = params.storyTitle?.trim() || "(no title)";
  const titleOneLine = titleLine.replace(/\s+/g, " ").trim();

  const userPrompt = `You summarize Hacker News comment-thread excerpts (nested replies). The story title is: ${titleOneLine}

Below are one or more thread excerpts. Each block may include a note about structural engagement (reply subtree size); that is context only—do not lecture about it unless needed for a single factual clause.

Rules for your reply (BODY only—the app will print the story title before your text, so readers always see which story this is):
• Do not repeat the story title at the start of your reply; the title is shown separately. Begin with what commenters say (names, claims, comparisons, topics).
• When excerpts name a product, brand, company, tool, library, framework, or service, use those names explicitly—do not summarize as "a product" or "one vendor" if the thread names something specific.
• These are Hacker News comments (not a generic forum). Never call them a "forum" or "forum thread".
• State what appears in the excerpts as plain facts, in declarative sentences. Avoid hedging or meta-framing.
• Do NOT start the body with setup phrases—go straight to substance. Banned openings include but are not limited to: "The main themes in the comments", "The discussion surrounding", "The comments on the forum thread", "The comments on this thread", "Readers discussed", "In the comments", "Commenters focused on", "primarily revolve around", "Users in the thread", or any sentence that only describes that people are discussing the topic.
• Do not repeat the same opening idea in a second paragraph; each sentence should add new detail.
• Cover the story’s comments, not the article body. If there are separate conversations, state them as separate factual points.
• If excerpts are too thin, garbled, or only noise, respond with exactly: EMPTY

Write 2–8 sentences for the body. No bullet list unless necessary. Do not quote usernames excessively.

--- Comment thread excerpts ---

${combined}`;

  const model =
    (typeof process.env.OPENAI_HN_MODEL === "string" && process.env.OPENAI_HN_MODEL.trim()) ||
    "gpt-4o-mini";

  const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You output only the comment-summary body for Hacker News: concrete facts from the excerpts; name specific products and brands when the excerpts do. The story title is added by the app before your text—do not repeat it. No meta setup (no 'forum thread', no 'the comments revolve around'). If input is not substantive, output exactly: EMPTY",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw || raw === "EMPTY" || /^empty$/i.test(raw)) return null;

  /** Title first so any UI or CSV shows the story before the comment summary. */
  const prefix = `${titleOneLine} — Comments on Hacker News:`;
  const legacyPrefix = `Comments from HackerNews story ${titleOneLine}:`;
  let body = raw.trim();
  if (body.toLowerCase().startsWith(prefix.toLowerCase())) {
    body = body.slice(prefix.length).trim();
  }
  if (body.toLowerCase().startsWith(legacyPrefix.toLowerCase())) {
    body = body.slice(legacyPrefix.length).trim();
  }
  // Model sometimes echoes the title as the first phrase despite instructions.
  const titleQuoted = titleOneLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  body = body.replace(new RegExp(`^["'“”]?${titleQuoted}["'“”]?\\s*[.:—\\-]\\s*`, "i"), "").trim();
  body = stripMetaOpenersFromBody(body);
  if (!body.trim()) return null;

  return `${prefix} ${body}`;
}
