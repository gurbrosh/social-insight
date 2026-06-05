/**
 * Cleans strings persisted through Prisma to SQLite/libSQL. Some drivers choke during JSON wire
 * encoding when payloads contain malformed escape tails ("unexpected end of hex escape"). We strip
 * all backslashes, C0/C1 controls, BOM/ZW characters, unpaired surrogates, then trim / truncate by
 * Unicode code points (`for…of` over the string preserves supplementary-plane characters correctly).
 */

function stripUnpairedUtf16Surrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const hi = s.charCodeAt(i);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        out += s.slice(i, i + 2);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (hi >= 0xdc00 && hi <= 0xdfff) {
      i += 1;
      continue;
    }
    out += s[i] as string;
    i += 1;
  }
  return out;
}

function truncateUnicodeCodePoints(s: string, maxLen: number): string {
  if (maxLen < 0) return s;
  let n = 0;
  let out = "";
  for (const ch of s) {
    if (n >= maxLen) break;
    out += ch;
    n++;
  }
  return out;
}

export function sanitizeTextForDbStorage(value: unknown, maxLen?: number): string | null {
  if (value == null) return null;
  let v = typeof value === "string" ? value : String(value);
  if (v.trim() === "") return null;

  v = v.replace(/\\/g, "");
  v = v.replace(/[\x00-\x1F\x7F]/g, "");
  v = v.replace(/[\u0080-\u009F]/g, "");
  v = v.replace(/[\u200B-\u200D\uFEFF]/g, "");
  v = stripUnpairedUtf16Surrogates(v);
  if (maxLen != null && Number.isFinite(maxLen)) {
    v = truncateUnicodeCodePoints(v, Math.floor(maxLen));
  }

  const t = v.trim();
  return t === "" ? null : t;
}
