/**
 * Summarize a YouTube video transcript using OpenAI so the summary captures the transcript content.
 */

import { configService } from "@/lib/config-service";

const MAX_TRANSCRIPT_CHARS = 120_000; // ~30k tokens; leave room for prompt + response

/**
 * Summarize transcript with OpenAI. Returns a short summary that captures the main content.
 * When OPENAI_API_KEY is missing or API fails, returns null (caller can leave summary empty).
 */
export async function summarizeTranscriptWithOpenAI(transcript: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!transcript || transcript.trim().length === 0) return null;

  const truncated =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[Truncated for length...]"
      : transcript;

  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
  const requestBody = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'You are a concise summarizer. Summarize the following video transcript in 2–4 short paragraphs. Capture the main topics, key points, and conclusions. Write in clear, neutral prose. Do not add intros like "This video discusses"—start with the content.',
      },
      {
        role: "user",
        content: truncated,
      },
    ],
    temperature: 0.3,
    max_tokens: 600,
  };

  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const summary = data.choices?.[0]?.message?.content?.trim();
        return summary && summary.length > 0 ? summary : null;
      }

      if ([429, 502, 503, 504].includes(response.status) && attempt < maxRetries - 1) {
        const retryAfter = response.status === 429 ? response.headers.get("retry-after") : null;
        if (response.status === 429) {
          console.warn(
            `[OpenAI] Throttled (429) operation=youtube_summary retry=${attempt + 1}/${maxRetries} retryAfter=${retryAfter ?? "none"}`
          );
        }
        const waitMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 60000)
          : Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(
          `[youtube-summary] OpenAI ${response.status}, retry ${attempt + 1}/${maxRetries} in ${waitMs}ms...`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      console.error("[youtube-summary] OpenAI API error:", response.status, response.statusText);
      return null;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(
          `[youtube-summary] Error (attempt ${attempt + 1}/${maxRetries}), retry in ${waitMs}ms...`,
          error
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.error("[youtube-summary] Error summarizing transcript:", error);
      return null;
    }
  }

  return null;
}
