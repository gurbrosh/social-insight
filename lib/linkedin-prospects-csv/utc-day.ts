export function getUtcDayBounds(utcYmd: { year: number; month: number; day: number }): {
  start: Date;
  end: Date;
} {
  const start = new Date(Date.UTC(utcYmd.year, utcYmd.month - 1, utcYmd.day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(utcYmd.year, utcYmd.month - 1, utcYmd.day + 1, 0, 0, 0, 0));
  return { start, end };
}

function utcNowYmd(): { year: number; month: number; day: number } {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

/**
 * `null` or empty string → **today (UTC)**. Invalid format / impossible calendar day → `null` (invalid).
 */
export function tryParseUtcDateParam(yyyyMmDd: string | null | undefined): {
  year: number;
  month: number;
  day: number;
} | null {
  const s = (yyyyMmDd ?? "").trim();
  if (!s) {
    return utcNowYmd();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
    return null;
  }
  return { year: y, month: mo, day: d };
}

export function yyyymmddUtc(utcYmd: { year: number; month: number; day: number }): string {
  const y = String(utcYmd.year);
  const mo = String(utcYmd.month).padStart(2, "0");
  const d = String(utcYmd.day).padStart(2, "0");
  return `${y}${mo}${d}`;
}
