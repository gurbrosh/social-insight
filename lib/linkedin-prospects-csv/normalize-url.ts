import { PUBLIC_PROFILE_URL_REGEX } from "./constants";

/**
 * Canonical public LinkedIn profile URL per pipeline spec:
 * - https://www.linkedin.com/in/... (lowercase host)
 * - no query, no fragment, no trailing slash
 * - reject Sales Navigator URLs
 */
export function normalizePublicProfileUrl(input: string): string | null {
  if (input == null || typeof input !== "string") {
    return null;
  }
  const raw = input.trim();
  if (raw === "") return null;
  if (/linkedin\.com\/sales\//i.test(raw)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  let host = parsed.hostname.toLowerCase();
  if (host === "linkedin.com") {
    host = "www.linkedin.com";
  }
  if (host !== "www.linkedin.com") return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  if (/\/sales\//i.test(path)) return null;
  if (!path.startsWith("/in/") || path.length <= 4) return null;

  const withoutQuery = `https://www.linkedin.com${path}`;

  if (/linkedin\.com\/sales\/lead\//i.test(withoutQuery)) return null;

  if (!PUBLIC_PROFILE_URL_REGEX.test(withoutQuery)) return null;
  return withoutQuery;
}
