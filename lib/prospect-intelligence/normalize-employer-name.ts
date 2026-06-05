/** Strip past-role prefixes mistakenly stored as part of company name. */
export function stripPastEmployerPrefix(companyRaw: string): string {
  let s = companyRaw.replace(/\s+/g, " ").trim();
  if (!s) return s;
  s = s.replace(/^ex[-\s]+/i, "");
  s = s.replace(/^(former|previously|past)\s+/i, "");
  return s.trim();
}

/** Normalize employer/org names parsed from headlines or profile experience. */
export function normalizeEmployerName(companyRaw: string): string {
  let s = companyRaw.replace(/\s+/g, " ").trim();
  if (!s) return s;

  const akaSplit = s.split(/\s+aka\s+/i);
  if (akaSplit[0] && akaSplit[0].trim().length >= 2) {
    s = akaSplit[0].trim();
  }

  const colonIdx = s.indexOf(":");
  if (colonIdx > 0 && colonIdx <= 48) {
    const before = s.slice(0, colonIdx).trim();
    if (before.length >= 2 && /^[A-Za-z0-9]/.test(before)) {
      s = before;
    }
  }

  const parenIdx = s.search(/\s\(/);
  if (parenIdx !== -1) {
    const before = s.slice(0, parenIdx).trim();
    if (before.length >= 2) s = before;
  }

  s = s.split(/\s+—\s+/)[0]!.trim();
  s = s.split(/\s+Expert\s+in\b/i)[0]!.trim();
  s = s.split(/\s+Driving\b/i)[0]!.trim();
  s = s.split(/\s+Helping\b/i)[0]!.trim();
  s = s.split(/\s+Keep\b/i)[0]!.trim();
  s = s.split(/\s+Log\b/i)[0]!.trim();

  const hyphenClause = s.match(/^(.{2,48}?)\s*-\s*(?:Keep|Log|No\s|Pay\s|Build|Helping|Driving|Presales)\b/i);
  if (hyphenClause?.[1]) {
    s = hyphenClause[1].trim();
  }
  const hyphenTouch = s.match(/^(.{2,40}?)-\s*(?:Keep|Log|No\s|Pay)\b/i);
  if (hyphenTouch?.[1]) {
    s = hyphenTouch[1].trim();
  } else if (/\s*-\s+[A-Z]/.test(s)) {
    const first = s.split(/\s*-\s+/)[0]?.trim();
    if (first && first.length >= 2 && first.length <= 40 && !/\/|&\s*/.test(first.slice(-3))) {
      s = first;
    }
  }

  s = s.split(/\s+-\s+(?=[A-Z][a-z])/)[0]!.trim();
  s = s.split(/\s+l\s+(?=[A-Z])/i)[0]!.trim();

  const byDelim = s
    .split(/\s*🔹\s*|\s*[|•·]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  s = byDelim[0] ?? s;
  const commaParts = s.split(",").map((p) => p.trim());
  if (commaParts.length > 1 && commaParts[1]!.length > 20) {
    s = commaParts[0]!;
  }
  return s.replace(/[-–]+\s*$/g, "").trim();
}
