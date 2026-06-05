import { openaiChatModel, type OpenAIChatModelKind } from "@/lib/openai-chat-model";
import { configService } from "@/lib/config-service";

function stripCodeFences(content: string): string {
  return content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

const MAX_RETRIES = 5;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isTransientNetworkError(e: unknown): boolean {
  if (e == null) return false;
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket/i.test(msg)) {
    return true;
  }
  let c: unknown = e;
  for (let depth = 0; depth < 4 && c && typeof c === "object"; depth++) {
    const cause = (c as { cause?: unknown }).cause;
    if (!cause) break;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      const code = String((cause as { code?: unknown }).code ?? "");
      if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes(code)) return true;
    }
    const cmsg =
      cause instanceof Error
        ? cause.message
        : typeof cause === "object" &&
            cause !== null &&
            "message" in cause &&
            typeof (cause as { message: unknown }).message === "string"
          ? String((cause as { message: string }).message)
          : "";
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE/i.test(cmsg)) return true;
    c = cause;
  }
  return false;
}

/**
 * Chat completion that expects a single JSON object in the assistant message.
 */
export async function openaiChatJsonObject(params: {
  modelKind: OpenAIChatModelKind;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const model = openaiChatModel(params.modelKind);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
          temperature: params.temperature ?? 0.3,
          max_tokens: params.maxTokens ?? 1024,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429 || status === 502 || status === 503 || status === 504) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt + 1), 10000);
          console.warn(
            `[response-generator] OpenAI ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`
          );
          await sleep(waitMs);
          lastError = new Error(`OpenAI API error: ${status}`);
          continue;
        }
        const errText = await response.text().catch(() => "");
        throw new Error(`OpenAI API error: ${status} ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      let content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("OpenAI returned empty content");
      }
      content = stripCodeFences(content);
      try {
        const parsed = JSON.parse(content) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        throw new Error("Response JSON is not an object");
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.warn(
          `[response-generator] JSON parse failed attempt ${attempt + 1}:`,
          lastError.message
        );
        await sleep(500);
      }
    } catch (e) {
      if (isTransientNetworkError(e) && attempt < MAX_RETRIES - 1) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt + 1), 15000);
        console.warn(
          `[response-generator] OpenAI fetch transient (${e instanceof Error ? e.message : String(e)}), retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`
        );
        await sleep(waitMs);
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      throw e;
    }
  }

  throw lastError ?? new Error("OpenAI JSON parse failed");
}
