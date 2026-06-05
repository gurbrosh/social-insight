/** Minimal RFC4180-style CSV parser (handles quoted fields; no multiline cells). */

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < norm.length; j++) {
      row[norm[j]!] = (cells[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers: norm, rows };
}

export function rowGet(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k.toLowerCase().replace(/\s+/g, "_")];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}
