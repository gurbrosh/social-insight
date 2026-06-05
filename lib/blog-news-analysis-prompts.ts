/**
 * Prompts and extraction schema for blog/news analysis (OpenAI).
 * See docs/blog-news-analysis-schema-and-prompts.md for full field reference.
 */

export const BLOG_ANALYSIS_SYSTEM_PROMPT = `You are an expert analyst of company communications: blog posts, press releases, and newsroom content. Your task is to read the provided article text and produce only:
1. A concise summary (2–4 sentences). STATE THE CONTENT AS FACT — report what is true, what happened, what the trends are, what companies or people said or did. Do NOT describe the article; write as if you are reporting the facts directly.
   FORBIDDEN: Any reference to the article or piece as the subject. Never use: "The article discusses/examines/explains/analyzes/covers/looks at...", "The piece discusses/explores...", "It spotlights/discusses/identifies/emphasizes...", "This piece...", "The post discusses...". The reader must get facts only, not a description of what the article does.
   REQUIRED: Write as fact. State what is true, what happened, or what the trends/findings are, using concrete names from the article. Never make "the article" or "it" (referring to the article) the subject of a sentence.
2. Article date (YYYY-MM-DD or null).
3. Meta: signal_strength_score (1–5), relevance_score (1–5 when project context given), is_ad (boolean), affiliation (enum).

Do not fill the "ideas" array — leave as [null, null, null, null, null, null, null] or omit it. Do not evaluate or return any other dimensions (no audience, intent, evidence, competitive, sensitivity, temporal, strategic, cta, content_archetype, etc.).

Return only valid JSON matching the extraction schema. No markdown, no code fences, no explanation.`;

export const BLOG_ANALYSIS_EXTRACTION_SCHEMA = `
Output a single JSON object with this exact structure.

{
  "summary": "2–4 sentences. State the content AS FACT: report what is true, what happened, what the trends are, what was said or done. Do NOT describe the article. Write as fact using names from the article.",
  "article_date": "YYYY-MM-DD or null",
  "ideas": [null, null, null, null, null, null, null],
  "meta": {
    "signal_strength_score": 1,
    "affiliation": "COMPANY_OFFICIAL | AFFILIATED | INDEPENDENT | MEDIA_OUTLET | UNKNOWN",
    "relevance_score": 1,
    "is_ad": false
  }
}

signal_strength_score: integer 1–5 (1=weak, 5=very strong).
affiliation: COMPANY_OFFICIAL = company's own blog/newsroom, AFFILIATED = partner/subsidiary/sponsored, INDEPENDENT = independent blogger, MEDIA_OUTLET = news outlet, UNKNOWN when unclear.
relevance_score: integer 1–5 (5=highest). Apply the project's relevance rule in the project context (OR vs AND). When project context is missing use 3. Among qualifying items, prefer 5 when project keywords or brands are explicitly named in the article; use 4 (or 3) when fit is semantic/paraphrase without those explicit names.
is_ad: true if this post is effectively a paid ad (clear CTA and primary purpose to sell). False for editorial, thought leadership, or informational content.

summary: CRITICAL — state as fact only. Do NOT describe the article. Never use the article or "it" (meaning the article) as the subject of a sentence.
ideas: do not use; leave as [null, null, null, null, null, null, null].
`;

/** Max characters of article text to send for pre-check (is_ad + relevance). */
export const BLOG_ANALYSIS_PRECHECK_TEXT_LENGTH = 6000;

/**
 * When several items are all relevant, scores should favor explicit naming of project keywords/brands
 * over paraphrase-only or generic domain fit (semantic relevance still gates inclusion).
 */
export const RELEVANCE_SCORE_EXPLICIT_MENTION_BOOST = `When more than one relevance level could apply: prefer a higher relevance_score when the text explicitly names project keywords or project brands (or clear official abbreviations/variants). When the piece is relevant only by paraphrase or generic discussion without naming those terms, use a lower score within the qualifying range.`;

/** Build the relevance-rule sentence from project config (OR vs AND). */
function getRelevanceRuleSentence(requireKeywordsWithBrands: boolean): string {
  if (requireKeywordsWithBrands) {
    return "Relevance rule (AND): score as relevant (4–5) ONLY when keyword topics are related to at least one project brand AND the article matches at least one project keyword in that brand-related sense AND at least one project brand (or the focus); generic keyword-only, brand-only, or topics with no brand relationship do NOT qualify.";
  }
  return "Relevance rule (OR): score as relevant (4–5) if the article matches ANY listed brand OR ANY keyword OR the monitoring focus; no need to match more than one.";
}

/**
 * Build prompt for pre-check only: return is_ad and relevance_score.
 * Used to skip full analysis when post is an ad or relevance < 3.
 */
export function buildBlogAnalysisPreCheckPrompt(params: {
  articleTitle: string | null;
  articleText: string;
  projectContext?: BlogAnalysisProjectContext | null;
}): string {
  const { articleTitle, articleText, projectContext } = params;
  const textSnippet =
    articleText.length > BLOG_ANALYSIS_PRECHECK_TEXT_LENGTH
      ? articleText.slice(0, BLOG_ANALYSIS_PRECHECK_TEXT_LENGTH) + "\n...[truncated]"
      : articleText;
  const requireAnd = projectContext?.requireKeywordsWithBrands ?? false;
  const relevanceRule = getRelevanceRuleSentence(requireAnd);
  const projectSection =
    projectContext &&
    (projectContext.brands?.length > 0 ||
      projectContext.monitoringFocus ||
      (projectContext.keywords?.length ?? 0) > 0)
      ? `\nProject context for relevance (${relevanceRule}) Brands: ${(projectContext.brands ?? []).join(", ") || "(none)"}. Focus: ${projectContext.monitoringFocus ?? "(none)"}. Keywords: ${(projectContext.keywords ?? []).join(", ") || "(none)"}.`
      : "";
  return `You are classifying a blog/news post. Return ONLY a JSON object with this exact structure, no other text:
{ "meta": { "is_ad": true or false, "relevance_score": 1 } }

Rules:
- is_ad: true only if there is a clear call-to-action AND the primary purpose is to sell a product or service. False for editorial, thought leadership, or informational content.
- relevance_score: integer 1–5. ${relevanceRule} 1 = no qualifying match (off-topic). 2 = tangential. 3 = same domain or neutral; use 3 if no project context. 4 = qualifying match per the rule above. 5 = directly about a monitored brand or the exact topic. ${RELEVANCE_SCORE_EXPLICIT_MENTION_BOOST} When uncertain, prefer the higher score.${projectSection} If no project context, use 3.

Article title: ${articleTitle ?? "unknown"}
--- Article text (excerpt) ---
${textSnippet}
--- End ---

Return only valid JSON: { "meta": { "is_ad": boolean, "relevance_score": number } }`;
}

/**
 * Build prompt for title-only pre-check: is_ad and relevance_score from article title.
 * When semanticScope is provided, relevance is judged by "is this what the user is curious about?" (semantic).
 * Otherwise falls back to projectContext (keyword/brand lists) for backward compatibility.
 */
export function buildBlogAnalysisPreCheckTitleOnlyPrompt(params: {
  articleTitle: string | null;
  projectContext?: BlogAnalysisProjectContext | null;
  semanticScope?: string | null;
}): string {
  const { articleTitle, projectContext, semanticScope } = params;

  const projectSection = (() => {
    if (semanticScope && semanticScope.trim()) {
      return `

What this user is curious about (project scope — use this for relevance, not word matching):
---
${semanticScope.trim()}
---

Relevance: Score 1–5 by whether the title indicates content that is DIRECTLY about what this user cares about (the scope above). Be STRICT: only score 4–5 when the title clearly fits the scope. Score 2 or 1 when the content is only tangentially related: same broad industry but different focus. Judge by meaning: "Would someone who cares about this scope consider this title clearly relevant, or is it a stretch?"
- Score 1 = clearly off-topic (different industry or nothing to do with the scope).
- Score 2 = tangential or adjacent: shares words/industry but the focus is not what the scope is about. Use 2 when the title is not clearly directly about the scope.
- Score 3 = borderline; could be relevant but not clearly so. When uncertain, use 3 or 2.
- Score 4 = clearly about the scope (same domain and focus). Only when the title indicates content directly aligned with the scope.
- Score 5 = directly about a listed brand or the exact topic from the scope, or the title explicitly names brands/keywords from the scope.
Use the scope and "Broader definition of keywords" to judge—but only score 4–5 when the title is clearly about that scope, not merely touching adjacent topics. When choosing between 4 and 5, prefer 5 when the title explicitly names a monitored brand or keyword; prefer 4 when clearly on-topic by meaning but generic. When uncertain whether it is directly about the scope, prefer the LOWER score (2 or 3). If no scope above, use 3.`;
    }
    const requireAnd = projectContext?.requireKeywordsWithBrands ?? false;
    const relevanceRule = getRelevanceRuleSentence(requireAnd);
    return projectContext &&
      (projectContext.brands?.length > 0 ||
        projectContext.monitoringFocus ||
        (projectContext.keywords?.length ?? 0) > 0)
      ? `\nProject context for relevance (${relevanceRule}) Brands: ${(projectContext.brands ?? []).join(", ") || "(none)"}. Focus: ${projectContext.monitoringFocus ?? "(none)"}. Keywords: ${(projectContext.keywords ?? []).join(", ") || "(none)"}.`
      : "";
  })();

  const relevanceInstruction = semanticScope?.trim()
    ? "Score by fit to the scope above. Only 4–5 when the title is clearly directly about the scope. Use 2–3 when tangential or uncertain. When uncertain, prefer the lower score."
    : `Score 1 = off-topic. 2 = tangential (same industry but not the focus). 3 = same domain but no clear match. 4 = qualifying match. 5 = clearly about a monitored brand or exact topic. ${RELEVANCE_SCORE_EXPLICIT_MENTION_BOOST} When uncertain, prefer the LOWER score.${projectSection} If no project context, use 3.`;

  return `You are classifying a blog/news post using ONLY its title. Return ONLY a JSON object with this exact structure, no other text:
{ "meta": { "is_ad": true or false, "relevance_score": 1 } }

Rules:
- is_ad: Judge by the title's PRIMARY PURPOSE. Set true if the title is primarily promotional: its main intent is to recommend, sell, or drive sign-up for a specific product, service, or offer. This includes (by meaning, not by wording): recommendation or buying-guide framing ("who should get X", "is X worth it", "best X for Y"), limited-time or deadline-driven offers, deal or bonus alerts, sign-up incentives, or content that is conversion-oriented rather than informational. Set false when the title is primarily news, analysis, investigation, or editorial that informs without a primary commercial aim. When the title could reasonably be either, lean toward true if a reader would perceive it as "this is trying to get me to buy or sign up."
- relevance_score: integer 1–5 based on title only. ${relevanceInstruction}${semanticScope?.trim() ? projectSection : ""}

Article title: ${articleTitle ?? "unknown"}

Return only valid JSON: { "meta": { "is_ad": boolean, "relevance_score": number } }`;
}

export interface BlogAnalysisProjectContext {
  /** Brand names the project monitors */
  brands: string[];
  /** What the user is monitoring / project focus */
  monitoringFocus?: string | null;
  /** Project keywords (e.g. from ProjectKeyword) */
  keywords?: string[];
  /** When true, keyword topics must relate to a project brand AND content must match both keyword (in that sense) and brand (AND). When false, matching ANY of brand/keyword/focus qualifies (OR). From project.require_keywords_with_brands. */
  requireKeywordsWithBrands?: boolean;
}

export function buildBlogAnalysisUserPrompt(params: {
  articleUrl: string;
  articleTitle: string | null;
  articleDate: string | null;
  articleText: string;
  /** When provided, the model will score relevance_score 1–5 against these ideas and brands. */
  projectContext?: BlogAnalysisProjectContext | null;
}): string {
  const { articleUrl, articleTitle, articleDate, articleText, projectContext } = params;
  const requireAnd = projectContext?.requireKeywordsWithBrands ?? false;
  const relevanceRule = getRelevanceRuleSentence(requireAnd);
  const projectSection =
    projectContext &&
    (projectContext.brands?.length > 0 ||
      projectContext.monitoringFocus ||
      (projectContext.keywords?.length ?? 0) > 0)
      ? `
--- Project context (use this to set meta.relevance_score 1–5). ${relevanceRule} ---
Brands: ${(projectContext.brands ?? []).join(", ") || "(none)"}
Monitoring focus: ${projectContext.monitoringFocus ?? "(none)"}
Keywords: ${(projectContext.keywords ?? []).join(", ") || "(none)"}

Relevance: ${relevanceRule} Scale: 1 = no qualifying match (off-topic). 2 = tangential. 3 = same domain/neutral. 4 = qualifying match per the rule above. 5 = directly about a monitored brand or the exact topic. ${RELEVANCE_SCORE_EXPLICIT_MENTION_BOOST} When uncertain, prefer the higher score.
--- End project context ---
`
      : "";

  return `Analyze the following blog/news item and return a single JSON object that conforms to the extraction schema. Return only: summary, article_date, ideas (leave as [null, null, null, null, null, null, null]), and meta (signal_strength_score, affiliation, relevance_score, is_ad). Use only the enum values listed in the schema for meta fields.

Summary rule: State the content AS FACT. Report what is true, what happened, what the trends are, what was said or done. Do NOT describe the article. Never use "The article analyzes/discusses...", "It spotlights...", "The piece discusses...", or "It identifies/emphasizes...". Write as fact using names from the article (e.g. "[Topic] trends show X." "[Entity] will Y.").

Article URL: ${articleUrl}
Article title: ${articleTitle ?? "unknown"}
Publication date (if known): ${articleDate ?? "unknown"}
${projectSection}
--- Article text ---
${articleText}
--- End ---

${BLOG_ANALYSIS_EXTRACTION_SCHEMA}`;
}

/** System prompt for extracting key ideas from article paragraphs (run after qualification). */
export const KEY_IDEAS_EXTRACTION_SYSTEM_PROMPT = `You extract the main idea from each substantial paragraph or section of a blog/news article. Output up to 7 ideas (idea_1 through idea_7).

ONE RULE (apply to every idea, every sentence type):

The reader sees only this one sentence. They have not read the article, the summary, or any other idea. So for them there is no prior context.

Therefore: every referent in the sentence that is central to the idea (who did it, what thing it is about, which event, which group, which document, etc.) must be fully identified in this same sentence. If the reader could ask "which one?" or "who?" or "what thing?" about any main noun in the sentence, you have failed — name it explicitly, using only names or identifiers from the article. Do not assume the reader can infer the referent from context; there is no context.

Before you return each idea, apply this test: "If someone read only this sentence with zero prior context, would they know exactly who and what it is about?" If not, rewrite so they would.

CRITICAL — Judge by MEANING, not by a list of phrases. Each idea must:
- NOT present the article, post, or piece as the source of the information (in any wording). State the substance directly — what is true, what happened, what was said or done — as if reporting facts, not describing the article.
- NOT attribute a statement to a person or source without naming who. Use the speaker's name or role from the article or state the fact without attribution.
- NOT describe how the article concludes or refer to the writer or reader. Only statements of opinion, story, or fact.

Only create an idea when it provides new, distinct information. Do not create an idea for a paragraph or section that only summarizes the article's conclusion, structure, or effect on the reader without adding a new fact or point. Fewer, substantive ideas are better than filler.

Do NOT ever refer to the writer, the author of the post, or the reader of the post. Each idea must be only a statement of opinion, story, or fact—nothing else. No meta-commentary about who wrote it, who is reading, or the author's role. If a paragraph does not yield a clear statement of opinion, story, or fact, omit it.

STANDALONE — NEVER begin a sentence with "The [noun]" when that noun is a referent the reader cannot identify (they see only this sentence). This is the most common failure mode.
- FORBIDDEN: Starting with "The " + a common noun that has not been identified in the sentence. The reader has no prior context. Either name the entity first (use the actual name from the article) or use "A [noun]..." with minimal context.
- Rule of thumb: If the sentence starts with "The " + a common noun and that referent is not identified earlier in the sentence, it is WRONG. Rewrite to lead with the named entity from the article or "A [noun]...".
- For rumors/leaks: state the substance first, not "The leaked information suggested that...".

BAD: Any sentence that begins with "The " + an unidentified referent (the reader could ask "which one?" or "who?").
GOOD: Lead with the named entity from the article or "A [noun]..." so a reader with zero context knows who and what it is about.

PRODUCTS, BRANDS, AND TOOLS: When the source names a specific product, brand, company, tool, library, framework, API, or service, keep that name in the idea. Do not substitute vague wording ("the product", "the vendor", "a competitor", "one library", "a cloud provider") when the source already names the entity—readers need that specificity.

Identify natural paragraphs or sections in order. For each that yields a statement of opinion, story, or fact, write one concise, self-contained sentence. Return a JSON object with an "ideas" array of strings (max 7). Omit or use null for unused slots. No markdown, no code fences.`;

/** Max article length sent for key-ideas extraction. */
export const KEY_IDEAS_ARTICLE_MAX_LENGTH = 60000;

/**
 * Build user prompt for key-ideas extraction (paragraph-level main ideas, standalone sentences).
 */
export function buildKeyIdeasExtractionUserPrompt(articleText: string): string {
  const text =
    articleText.length > KEY_IDEAS_ARTICLE_MAX_LENGTH
      ? articleText.slice(0, KEY_IDEAS_ARTICLE_MAX_LENGTH) + "\n...[truncated]"
      : articleText;
  return `Extract the main idea from each substantial paragraph or section of the following article. Return a JSON object with exactly: { "ideas": ["sentence 1", "sentence 2", ...] }

Rules:
- Up to 7 ideas. Each idea = one sentence.
- If the article names a product, brand, company, tool, library, or service, use that name in the idea—do not vague it down to "the product" or "a vendor" when the source is specific.
- The reader has zero prior context. NEVER start a sentence with "The " + a common noun when that referent is not identified in the sentence. Rewrite to lead with the named entity from the article or "A [noun]...". Every central referent must be identified — if the reader could ask "which one?" or "who?", name it explicitly. Before returning, ask: "Would someone with zero context know exactly who and what this is about?" If not, rewrite.
- Do not talk about the article or the post. Never mention the article, the post, or the piece. Write only the substance (opinion, story, or fact) directly.
- Never call out conclusions or reader framing (no "The article concludes with", "leaving readers to", "readers are left to ponder"). State the actual point or quote only.
- Only include an idea if it provides new, distinct information. Skip paragraphs/sections that only summarize the article's conclusion or structure without adding a new fact.
- Never refer to the writer, author of the post, or the reader. Each idea must be only a statement of opinion, story, or fact—if it's not one of those, don't write it.
- One main idea per paragraph/section that adds substance, in order.

--- Article text ---
${text}
--- End ---

Return only valid JSON: { "ideas": [ "string", ... ] }`;
}

/** System prompt for the batched "needs rewrite?" gate. Judge by MEANING, not by matching phrases. */
export const IDEAS_NEED_REWRITE_SYSTEM = `You judge whether each sentence is fully standalone and free of meta-framing. Judge by MEANING only — do not rely on a fixed list of words or phrases.

For each sentence, set needs_rewrite: true if ANY of the following is true BY MEANING:

1. **Unresolved referents / "The [noun]" openings**: A reader with zero context could ask "who?" or "which one?" or "whose?" → needs_rewrite: true. CRITICAL: If the sentence BEGINS with "The " followed by a common noun and that referent is not identified earlier in the sentence, ALWAYS set needs_rewrite: true. The only "The X" openings that are acceptable are when X is a well-known proper name that needs no prior context.

2. **Article/post as source**: The sentence presents the article, post, piece, or report as the SOURCE of the information — i.e. it frames the content as something the article says, reports, notes, discusses, highlights, or similar. Interpret semantically: if the sentence is about what the article does or says (in any wording), → needs_rewrite: true.

3. **Unnamed attribution**: The sentence attributes a statement or claim to a person or source without naming who they are (so the reader cannot identify the speaker). Interpret semantically: any phrasing that attributes to an unnamed source → needs_rewrite: true. If the speaker is named or the fact is stated without attribution → needs_rewrite: false for this criterion.

4. **Conclusion/reader framing**: The sentence describes how the article concludes or what it leaves readers with, instead of stating the actual point or quote.

5. **Writer/reader meta**: The sentence refers to who wrote the piece or who is reading it, rather than being only a statement of opinion, story, or fact.

NEEDS REWRITE is false only when the sentence is a standalone statement of opinion, story, or fact, with all referents identified and no meta-framing (by meaning). When in doubt, set needs_rewrite: true.

Return only a JSON array of objects with keys: "index" (1-based) and "needs_rewrite" (boolean). One object per sentence. No markdown, no explanation.`;

/**
 * Build user prompt for the batched gate: list sentences, get back which need rewriting.
 */
export function buildIdeasNeedRewriteUserPrompt(sentences: string[]): string {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
  return `Judge each sentence by MEANING (not by matching specific phrases). Set needs_rewrite: true if: (1) any referent is unresolved (reader could ask "who?" or "which one?"), (2) the sentence presents the article/post/piece as the source of the information (in any wording), (3) the sentence attributes to an unnamed person or source (in any wording), (4) it describes how the article concludes or what it leaves readers with, or (5) it refers to the writer or reader. Otherwise needs_rewrite: false. When unsure, use true.

Sentences:
${numbered}

Return only a JSON array. Example: [{"index": 1, "needs_rewrite": true}, {"index": 2, "needs_rewrite": false}]`;
}

/** Semantic check: does the sentence treat the article/post as source or attribute to an unnamed person/source? No word lists — judge by meaning. */
export const SEMANTIC_META_FRAMING_SYSTEM = `You judge each sentence by MEANING only, not by matching specific words or phrases.

For each sentence, answer: Does it (1) treat the article, post, piece, or report as the SOURCE of information (i.e. the sentence presents the article/post as the one saying or reporting something), or (2) attribute a statement or claim to a person or source WITHOUT naming who they are (so a reader could not identify the speaker)?

- If the sentence presents the article/post/piece/report as the source (in any wording) → has_meta: true.
- If the sentence attributes something to "someone", "a person", "the person", "the author", "the writer", "the source", or any unnamed source (in any wording) → has_meta: true.
- If the sentence names the speaker or states a fact without attribution → has_meta: false.
- If the sentence only discusses the topic and does not frame the article as source or use unnamed attribution → has_meta: false.

Do not rely on a fixed list of phrases. Interpret semantically. Return only a JSON array of objects: { "index": 1-based, "has_meta": boolean }.`;

export function buildSemanticMetaFramingUserPrompt(sentences: string[]): string {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
  return `For each sentence below, decide by MEANING: does it treat the article/post as the source of information, or attribute to an unnamed person/source? Return JSON array: [{"index": 1, "has_meta": true/false}, ...].

Sentences:
${numbered}

Return only valid JSON array.`;
}

/** System prompt for rewriting a single idea so it stands alone. Apply by MEANING — do not rely on a fixed list of phrases to remove. */
export const REWRITE_IDEA_STANDALONE_SYSTEM = `You rewrite one sentence so that a reader who sees only that sentence knows exactly who and what it is about. You have the original sentence and the article text. Apply rules by MEANING, not by matching specific words.

RULES (interpret semantically):

1. **No article/post as source**: If the sentence presents the article, post, or piece as the source of the information (in any wording), remove that framing and state only the substance — the subject must be the content, people, or entities, never the article or post.

2. **No unnamed attribution**: If the sentence attributes a statement to a person or source without naming who, replace with the actual speaker's name or role from the article or state the fact directly. The reader must know who said it or see only the stated fact. Interpret by meaning: any attribution to an unnamed source must be fixed.

3. **No conclusion/reader framing**: If the sentence describes how the article concludes or what it leaves readers with, state only the actual point or quote.

4. **No writer/reader meta**: If the sentence refers to the writer, author, or reader, remove that and state only the opinion, story, or fact.

5. **Resolve "The [noun]" openings**: If the sentence BEGINS with "The " + a common noun and that referent is not identified, REWRITE so the subject is identified. Use the named entity from the article first or "A [noun]..." with minimal context. Output only the single rewritten sentence.

6. Use only information from the article. Preserve meaning. Output only the single rewritten sentence. No preamble. The output must not present the article as source and must not attribute to an unnamed person/source — judge by meaning.`;

/**
 * Build user prompt for rewriting one idea to be standalone (second pass).
 */
export function buildRewriteIdeaStandaloneUserPrompt(
  sentence: string,
  articleContext: string
): string {
  const articleSnippet =
    articleContext.length > 8000
      ? articleContext.slice(0, 8000) + "\n...[truncated]"
      : articleContext;
  return `Rewrite this sentence so a reader with zero context knows who and what it is about. (1) If it presents the article/post as the source, state only the substance. (2) If it attributes to an unnamed person or source, use the speaker's name or role from the article or state the fact directly. (3) If it describes how the article concludes or refers to the writer/reader, state only the fact or quote. (4) Make every vague referent explicit. (5) CRITICAL: If the sentence STARTS with "The " + a common noun that is not identified, REWRITE to lead with the named entity from the article or "A [noun]...". Use only information from the article. Output only the single rewritten sentence.

Sentence to rewrite:
${sentence}

Article (for names and identifiers):
---
${articleSnippet}
---`;
}
