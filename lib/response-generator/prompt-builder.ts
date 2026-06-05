import type { Prisma } from "@prisma/client";
import { buildAuthorAddressingBlock } from "@/lib/response-generator/author-addressing";
import { normalizePlatformForDisplay } from "@/lib/utils/platform";

export type ExampleResponseEntry = {
  platform: string;
  examples: string[];
};

function parseExampleResponses(raw: Prisma.JsonValue | null | undefined): ExampleResponseEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: ExampleResponseEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const platform = typeof o.platform === "string" ? o.platform : "";
    const examples = Array.isArray(o.examples)
      ? o.examples.filter((e): e is string => typeof e === "string")
      : [];
    if (platform) out.push({ platform, examples });
  }
  return out;
}

function examplesForPlatform(entries: ExampleResponseEntry[], platform: string): string {
  const display = normalizePlatformForDisplay(platform);
  const lower = display.toLowerCase();
  const merged: string[] = [];
  for (const e of entries) {
    const ep = normalizePlatformForDisplay(e.platform).toLowerCase();
    if (ep === lower || ep === (platform || "").toLowerCase()) {
      merged.push(...e.examples);
    }
  }
  if (merged.length === 0) return "(none provided for this platform)";
  return merged.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

export function buildRelevancePrompt(params: {
  objectiveDescription: string;
  relevanceGuidelines: string;
  platform: string;
  fullText: string;
}): { system: string; user: string } {
  const system = `You are evaluating whether a social media conversation is relevant for a specific response objective.

Be strict and conservative.`;

  const user = `Response Objective:
${params.objectiveDescription}

Relevance Guidelines:
${params.relevanceGuidelines || "(none)"}

Platform:
${params.platform}

Conversation:
${params.fullText}

Instructions:
- Score from 0.0 to 1.0
- Be conservative
- Only assign high scores if clearly relevant
- If unclear, score low

Return JSON:
{
  "relevance_score": number,
  "reasoning": "string (max 1 sentence)"
}`;

  return { system, user };
}

export function buildResponsePrompt(params: {
  platform: string;
  persona: string;
  /** Identify as Org — insider voice when true; outsider when false. */
  belongToOrg: boolean;
  objectiveDescription: string;
  styleGuidelines: string;
  exampleResponsesJson: Prisma.JsonValue | null | undefined;
  fullText: string;
  targetUser: string;
  /** Selected project brands (ProjectBrand) — names the reply may use when introducing the offering. */
  projectBrandNames?: string[];
  /** ThemesAnalysis.author_name / author_id — used to @mention or greet by name when possible. */
  authorName?: string | null;
  authorId?: string | null;
}): { system: string; user: string } {
  const system = `You are crafting a reply to a real social media post.

Goals:
- Sound natural and human
- Match platform style and typical reply length for the platform
- Engage with what the author actually said
- When the user prompt lists any author option that is not “(none)” (tag, username, or first name), you MUST begin \`response_text\` with a brief address to that person (first words of the reply). Use priority: tag > username > first name. Never omit this opening when any of those fields is available. Use a single address form only—do not stack two names for the same person (e.g. avoid “Display name, @same name,”).
- When naming what you offer, use a single identifier from the project brand names below—usually the product or offering name users would recognize. Briefly tie value to the thread; match the tone of the examples, not generic marketing filler

Avoid:
- Naming both a parent company and a product in the same sentence (e.g. "at [Company], we built [Product]")—that reads sales-heavy; use one name from the list, typically the product/offering
- Cold-call sales tone, empty slogans, or off-topic self-promotion
- Adding links unless the style guidelines or examples expect them`;

  const entries = parseExampleResponses(params.exampleResponsesJson);
  const platformExamples = examplesForPlatform(entries, params.platform);

  const brandNames = (params.projectBrandNames ?? []).map((s) => s.trim()).filter(Boolean);
  const brandBlock =
    brandNames.length > 0
      ? `${brandNames.join(", ")}\n(If several appear: introduce the offering with one name only—prefer the product or service name, not company + product in the same breath.)`
      : "(none configured in project brands — follow names and phrasing in the Response Objective and Examples; still avoid pairing a company name with a product name in one sentence unless Style Guidelines require it.)";

  const hasAuthorHint =
    (params.authorName != null && String(params.authorName).trim() !== "") ||
    (params.authorId != null && String(params.authorId).trim() !== "");
  const authorAddressingBlock = hasAuthorHint
    ? buildAuthorAddressingBlock({
        platform: params.platform,
        authorName: params.authorName,
        authorId: params.authorId,
      })
    : "Author addressing: (no author name or id on record — if the conversation names someone, you may address them; otherwise a neutral reply is fine.)";

  const voiceBlock = params.belongToOrg
    ? `Identify as Org: true (official or org-linked account).

Draft as an insider: first-person / "we" is fine. When you name what you built, use one product or offering name from the project brand list—do not stack a legal entity and a product name in the same sentence.`
    : `Identify as Org: false (personal or unaffiliated account).

Draft as an outsider: third-person—refer to the offering by a single name from the project brand list (the product or service), not as "we" inside the company. Do not pair parent company + product in one sentence.`;

  const user = `Platform:
${params.platform}

Persona:
${params.persona}

Reply voice (this channel):
${voiceBlock}

Response Objective:
${params.objectiveDescription}

Project brand names (configured for this project—use one name when introducing the offering; see system rules about not combining company + product):
${brandBlock}

Style Guidelines:
${params.styleGuidelines || "(none)"}

Examples:
${platformExamples}

Conversation:
${params.fullText}

${authorAddressingBlock}

Target User (for JSON — who you are replying to, e.g. the handle or first name you used):
${params.targetUser}

Instructions:
- Match platform tone and length
- Personalize to the conversation. If "Author addressing" lists any non-(none) option, the first words of \`response_text\` must address that author (see REQUIRED block above). If every line is (none), a neutral opening is fine.
- When naming your offering, mirror the examples in spirit but follow the project brand list: one identifier (typically the product/service), not company plus product in the same sentence

Return JSON:
{
  "target_user": "string",
  "persona": "string",
  "response_text": "string"
}`;

  return { system, user };
}
