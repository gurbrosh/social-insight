import * as cheerio from "cheerio";
import { assertUrlSafeForFetch } from "./ssrf";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type FetchUrlTextResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string };

/**
 * Fetch a public URL and return plain text (HTML stripped). SSRF-safe.
 */
export async function fetchUrlPlainText(rawUrl: string): Promise<FetchUrlTextResult> {
  const safe = await assertUrlSafeForFetch(rawUrl);
  if (!safe.ok) {
    return { ok: false, error: safe.reason };
  }
  const u = safe.url;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "SocialInsightBot/1.0 (product-summary; +https://example.invalid)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return { ok: false, error: "Response too large" };
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/plain")) {
      const text = buf.toString("utf8");
      return { ok: true, text: truncateText(text, 200_000), truncated: text.length > 200_000 };
    }
    const html = buf.toString("utf8");
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    $("body").find("script, style").remove();
    const text = $("body").text() || $.root().text();
    const cleaned = text.replace(/\s+/g, " ").trim();
    return { ok: true, text: truncateText(cleaned, 200_000), truncated: cleaned.length > 200_000 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      return { ok: false, error: "Request timed out" };
    }
    return { ok: false, error: msg || "Fetch failed" };
  } finally {
    clearTimeout(t);
  }
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…[truncated]";
}
