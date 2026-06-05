function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Headline title reads as marketing/slogan copy, not a stable role label. */
export function headlineTitleLooksSloganLike(title: string): boolean {
  const t = norm(title);
  if (!t) return false;
  if (
    /^(protecting|securing|empowering|enabling|helping|building|scaling|showcase|testing|driving|delivering|transforming)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\bshowcase\s*:/i.test(t)) return true;
  if (/\b(through|via)\s+(securing|protecting|enabling)\b/i.test(t)) return true;
  if (/\breal[- ]world\b/i.test(t) && /\b(testing|risks?|genai)\b/i.test(t)) return true;
  const words = t.split(/\s+/).length;
  if (words >= 7 && /\bthrough\b/i.test(t) && /\b(data|apis?|sensitive)\b/i.test(t)) return true;
  return false;
}

/**
 * Headline-parsed "company" is a role descriptor, remote-work phrase, topic list, or compound title — not an org.
 */
export function headlineEmployerLooksDescriptorOrCompoundRole(
  company: string,
  title?: string | null
): boolean {
  const c = norm(company);
  if (!c) return false;
  const t = norm(title ?? "");
  const blob = norm(`${t} ${c}`).toLowerCase();

  if (/^remote\s+work\b/i.test(c)) return true;
  if (/\bremote\s+work\s*&\b/i.test(c)) return true;
  if (/#\s*\w/.test(c) || /\b(rsac|defcon|bsides|speaker|blogger)\b/i.test(c)) return true;

  const looksLikeJobPhrase =
    /\b(specialist|engineer|developer|consultant|analyst|architect|designer|strategist)\b/i.test(
      c
    );
  const looksLikeDomainStack =
    /\b(cybersecurity|cyber\s+security|infosec|python|java|\.net|devops|cloud)\b/i.test(c);
  const hasOrgSuffix = /\b(inc|llc|ltd|corp|plc|gmbh|s\.?a\.?|ag|co\.)\b/i.test(c);

  if (looksLikeJobPhrase && looksLikeDomainStack && !hasOrgSuffix) return true;

  if (
    /\s&\s/.test(c) &&
    looksLikeJobPhrase &&
    !hasOrgSuffix &&
    c.split(/\s+/).length <= 8
  ) {
    return true;
  }

  if (
    /\b(certified|certification|expert|professional)\b/i.test(c) &&
    !hasOrgSuffix &&
    c.length < 72
  ) {
    return true;
  }

  if (/\b(slogan|mission|vision)\b/i.test(blob) && c.length < 48) return true;

  return false;
}

export function employmentTitleLooksRetired(title: string): boolean {
  return /^\s*retired\b/i.test(norm(title));
}

export function headlineSegmentLooksRetiredEmployment(segment: string): boolean {
  return /^\s*retired\b/i.test(norm(segment));
}

/** Parsed headline employer looks like an event or campaign, not an organization. */
export function headlineEmployerLooksEventOrMarketing(company: string): boolean {
  const c = norm(company);
  if (!c) return false;
  if (/\b(summit|conference|expo|symposium|showcase|hackathon)\b/i.test(c)) return true;
  if (/\b20\d{2}\b/.test(c) && c.split(/\s+/).length <= 5) return true;
  return false;
}

/** Hard regression signals on current_company (substring). */
export function hardSuspiciousCompany(company: string): boolean {
  const c = company;
  return (
    c.includes(". Former") ||
    c.includes(". Previously") ||
    c.includes(" at Scale") ||
    /(^|\s)(Former|Formerly|Previously)\b/i.test(c) ||
    /\bEx-/i.test(c)
  );
}

export function looksLikeEducationTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  const lc = t.toLowerCase();
  if (/^\s*cs\s*$/i.test(t)) return true;
  if (/^\s*ms[\s.]+cs\s*$/i.test(t)) return true;
  if (/\bms[\s.]?cs\b/i.test(lc)) return true;
  if (/\bmscs\b/i.test(lc)) return true;
  if (/\bmca\b/i.test(lc)) return true;
  if (/\bb\.?\s*tech\b/i.test(lc)) return true;
  if (/bachelor of computer science/i.test(lc)) return true;
  if (/^\s*senior at\b/i.test(lc)) return true;
  if (/^\s*senior\s*$/i.test(t)) return true;
  return false;
}
