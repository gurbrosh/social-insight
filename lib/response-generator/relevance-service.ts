import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import { buildRelevancePrompt } from "@/lib/response-generator/prompt-builder";

export type RelevanceResult = {
  relevance_score: number;
  reasoning: string;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export async function evaluateRelevance(params: {
  objectiveDescription: string;
  relevanceGuidelines: string;
  platform: string;
  fullText: string;
}): Promise<RelevanceResult> {
  const { system, user } = buildRelevancePrompt(params);
  const json = await openaiChatJsonObject({
    modelKind: "relevance",
    system,
    user,
    temperature: 0.2,
    maxTokens: 512,
  });

  const rawScore = json.relevance_score;
  const score =
    typeof rawScore === "number"
      ? clamp01(rawScore)
      : typeof rawScore === "string"
        ? clamp01(parseFloat(rawScore))
        : 0;

  const reasoning = typeof json.reasoning === "string" ? json.reasoning.trim().slice(0, 500) : "";

  return { relevance_score: score, reasoning };
}
