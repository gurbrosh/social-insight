import type { Prisma } from "@prisma/client";
import {
  ensureOpeningAuthorAddress,
  getPreferredAuthorLabel,
  resolveAuthorAddressingParts,
} from "@/lib/response-generator/author-addressing";
import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import { buildResponsePrompt } from "@/lib/response-generator/prompt-builder";

export type GeneratedResponse = {
  target_user: string;
  persona: string;
  response_text: string;
};

export async function generateResponseText(params: {
  platform: string;
  persona: string;
  belongToOrg: boolean;
  objectiveDescription: string;
  styleGuidelines: string;
  exampleResponsesJson: Prisma.JsonValue | null | undefined;
  fullText: string;
  /** Optional override; if omitted, derived from author fields (tag > username > first name). */
  targetUser?: string;
  projectBrandNames?: string[];
  authorName?: string | null;
  authorId?: string | null;
}): Promise<GeneratedResponse> {
  const parts = resolveAuthorAddressingParts({
    platform: params.platform,
    authorName: params.authorName,
    authorId: params.authorId,
  });
  const targetUserHint =
    params.targetUser != null && String(params.targetUser).trim() !== ""
      ? String(params.targetUser).trim()
      : getPreferredAuthorLabel(parts) ?? "Infer from the conversation context.";

  const { system, user } = buildResponsePrompt({
    ...params,
    targetUser: targetUserHint,
    authorName: params.authorName,
    authorId: params.authorId,
  });
  const json = await openaiChatJsonObject({
    modelKind: "response",
    system,
    user,
    temperature: 0.5,
    maxTokens: 1024,
  });

  const rawText = typeof json.response_text === "string" ? json.response_text : "";
  const response_text = ensureOpeningAuthorAddress(rawText, parts);

  return {
    target_user:
      typeof json.target_user === "string" ? json.target_user : targetUserHint,
    persona: typeof json.persona === "string" ? json.persona : params.persona,
    response_text,
  };
}
