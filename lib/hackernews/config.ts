import { readFileSync, existsSync } from "fs";

/**
 * Comma-separated canonical keywords, e.g. `cybersecurity,agents`.
 */
export function parseCanonicalKeywords(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Optional JSON map: `{ "canonicalKeyword": ["variant1", "variant2"] }`.
 * Inline JSON (starts with `{`) or path to a UTF-8 `.json` file.
 */
export function loadKeywordVariants(raw: string | undefined): Record<string, string[]> {
  if (!raw?.trim()) return {};
  const trimmed = raw.trim();
  let jsonStr = trimmed;
  if (!trimmed.startsWith("{")) {
    if (existsSync(trimmed)) {
      jsonStr = readFileSync(trimmed, "utf8");
    } else {
      console.warn(
        `[hn-ingest] HN_KEYWORD_VARIANTS_JSON must be a JSON object string or an existing file path`
      );
      return {};
    }
  }
  try {
    const o = JSON.parse(jsonStr) as unknown;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        out[k] = v as string[];
      }
    }
    return out;
  } catch (e) {
    console.warn(`[hn-ingest] Failed to parse keyword variants JSON:`, e);
    return {};
  }
}

export function expandVariants(canonical: string, variantsMap: Record<string, string[]>): string[] {
  const v = variantsMap[canonical];
  if (v && v.length > 0) return v;
  return [canonical];
}

export function envTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
