/**
 * Centralized OpenAI chat model selection via env (per-step overrides fall back to OPENAI_MODEL).
 * Embeddings stay on OPENAI_EMBEDDING_MODEL where applicable.
 */

const DEFAULT_CHAT = "gpt-4o-mini";

function trimEnv(key: string): string | undefined {
  const v = process.env[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Default chat model for analysis (OPENAI_MODEL or OPENAI_DEFAULT_MODEL). */
export function openaiDefaultChatModel(): string {
  return trimEnv("OPENAI_MODEL") ?? trimEnv("OPENAI_DEFAULT_MODEL") ?? DEFAULT_CHAT;
}

export type OpenAIChatModelKind =
  | "default"
  | "sentiment"
  | "themes"
  | "chatter"
  | "network"
  | "brand"
  | "news"
  | "relevance"
  | "summarize"
  | "response";

const KIND_TO_ENV: Record<OpenAIChatModelKind, string | undefined> = {
  default: undefined,
  sentiment: "OPENAI_SENTIMENT_MODEL",
  themes: "OPENAI_THEMES_MODEL",
  chatter: "OPENAI_CHATTER_MODEL",
  network: "OPENAI_NETWORK_MODEL",
  brand: "OPENAI_BRAND_MODEL",
  news: "OPENAI_NEWS_MODEL",
  relevance: "OPENAI_RELEVANCE_MODEL",
  summarize: "OPENAI_SUMMARIZE_MODEL",
  response: "OPENAI_RESPONSE_MODEL",
};

/**
 * Chat Completions model for a logical step. Unset per-step env uses {@link openaiDefaultChatModel}.
 */
export function openaiChatModel(kind: OpenAIChatModelKind = "default"): string {
  if (kind === "default") return openaiDefaultChatModel();
  const envKey = KIND_TO_ENV[kind];
  if (envKey) {
    const override = trimEnv(envKey);
    if (override) return override;
  }
  return openaiDefaultChatModel();
}

/** text-embedding-* model for embeddings API. */
export function openaiEmbeddingModel(): string {
  return trimEnv("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
}
