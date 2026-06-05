import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import { fetchUrlPlainText } from "./fetch-url-text";
import { extractTextFromBuffer } from "./extract-text-from-buffer";
import { readStorageFileToBuffer } from "./read-storage-file";
import type { MyProductSummaryJson } from "./summary-types";
import { stringifyMyProductSummaryJson } from "./summary-types";

const CORPUS_MAX_CHARS = 100_000;

export type SummarizeProductInput = {
  /** Official or preferred product name(s), as entered by the user */
  productName: string | null;
  focusText: string | null;
  referenceUrls: string[];
  documents: Array<{
    storage_key: string;
    original_filename: string;
    content_type: string | null;
  }>;
};

function truncateCorpus(s: string): string {
  if (s.length <= CORPUS_MAX_CHARS) return s;
  return s.slice(0, CORPUS_MAX_CHARS) + "\n\n[Corpus truncated for model context]";
}

function mapJsonToSummary(record: Record<string, unknown>): MyProductSummaryJson {
  const highLevelDescription =
    typeof record.high_level_description === "string" ? record.high_level_description : "";
  const ideasRaw = record.key_innovative_ideas;
  const keyInnovativeIdeas = Array.isArray(ideasRaw)
    ? ideasRaw.filter((x): x is string => typeof x === "string")
    : [];
  const diff = record.product_differentiators;
  const differentiators =
    diff === null || diff === undefined ? null : typeof diff === "string" ? diff : null;
  const clients = record.intended_clients;
  const intendedClients =
    clients === null || clients === undefined ? null : typeof clients === "string" ? clients : null;
  return {
    highLevelDescription,
    keyInnovativeIdeas,
    differentiators,
    intendedClients,
  };
}

/**
 * Build corpus text from focus, URLs, and document files; then call OpenAI for structured summary.
 */
export async function summarizeProductFromSources(input: SummarizeProductInput): Promise<{
  summaryJson: string;
  summary: MyProductSummaryJson;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const parts: string[] = [];

  const productName = (input.productName || "").trim();
  if (productName) {
    parts.push("--- Product name (as provided) ---\n" + productName);
  }

  const focus = (input.focusText || "").trim();
  if (focus) {
    parts.push("--- User-provided focus ---\n" + focus);
  }

  const urls = input.referenceUrls.map((u) => u.trim()).filter(Boolean);
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const fetched = await fetchUrlPlainText(url);
    if (!fetched.ok) {
      warnings.push(`URL ${i + 1} (${url}): ${fetched.error}`);
      continue;
    }
    parts.push(`--- Reference URL ${i + 1}: ${url} ---\n${fetched.text}`);
  }

  for (const doc of input.documents) {
    try {
      const buf = await readStorageFileToBuffer(doc.storage_key);
      if (buf.length > 15 * 1024 * 1024) {
        warnings.push(`File "${doc.original_filename}" skipped: too large`);
        continue;
      }
      const ext = await extractTextFromBuffer(buf, doc.original_filename, doc.content_type);
      if (!ext.ok) {
        warnings.push(`File "${doc.original_filename}": ${ext.error}`);
        continue;
      }
      parts.push(`--- Uploaded file: ${doc.original_filename} ---\n${ext.text}`);
    } catch (e) {
      warnings.push(
        `File "${doc.original_filename}": ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const corpus = truncateCorpus(parts.join("\n\n"));
  if (corpus.trim().length < 20) {
    throw new Error(
      "Not enough material to summarize. Add a description, at least one URL, or upload a document."
    );
  }

  const system = `You are a concise product analyst. Given raw materials about a product (user notes, web page text, document text), produce a structured JSON summary. Use only information supported by the materials; if something is unclear, use null or empty arrays. Do not invent company names or features not present in the materials.`;

  const user = `Materials:

${corpus}

Return a single JSON object with exactly these keys:
- "high_level_description": string — short overview of what the product is and does.
- "key_innovative_ideas": string[] — bullet ideas (array of short strings); use [] if none are clear.
- "product_differentiators": string | null — what makes the product different, or null if unclear.
- "intended_clients": string | null — who the product is for, or null if unclear.

Return only valid JSON, no markdown fences.`;

  const json = await openaiChatJsonObject({
    modelKind: "summarize",
    system,
    user,
    temperature: 0.35,
    maxTokens: 4096,
  });

  const summary = mapJsonToSummary(json);
  return {
    summary,
    summaryJson: stringifyMyProductSummaryJson(summary),
    warnings,
  };
}
