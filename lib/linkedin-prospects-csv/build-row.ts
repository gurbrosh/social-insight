import { normalizePublicProfileUrl } from "./normalize-url";
import {
  firstLastFromInSlugPath,
  formatFirstNameForGreeting,
  givenNameAfterLeadingHonorifics,
  splitDisplayNameToParts,
  deriveMergedSubjectFromBody,
  isValidBody,
  isValidSubjectLine,
} from "./row-text";
import type { LinkedInProspectCsvRow } from "./types";
import { getLinkedInAuthorFromExtraJson } from "./extra-json";
/**
 * Assemble one CSV row for **LinkedIn sales pipeline** email (private outreach only).
 * Does not use the in-app theme `response_text` (public/comment-style reply)—those are separate.
 * Returns `null` if outreach body is missing or the row fails validation.
 */
export function buildRowFromSource(params: {
  outreach_email_subject: string | null | undefined;
  outreach_email_body: string | null | undefined;
  author_display_name: string | null;
  post_extraJson: unknown;
  /**
   * Person intelligence (optional): fills CSV enrichment columns and gates title/company.
   */
  prospect_intel?: {
    safeProfessionalReference: string | null;
    routingBucket: string;
    classificationConfidence: number;
    employmentConfidence: number;
    currentTitle: string | null;
    currentCompany: string | null;
  } | null;
  /** Optional Apify / enrichment first+last when known. */
  prospect_fields?: { first_name: string; last_name: string } | null;
}): LinkedInProspectCsvRow | null {
  const merged_body = String(params.outreach_email_body ?? "").trim();
  if (!isValidBody(merged_body)) return null;

  const fromSubj = params.outreach_email_subject?.trim();
  const merged_subject =
    fromSubj && isValidSubjectLine(fromSubj)
      ? fromSubj
      : (() => {
          const d = deriveMergedSubjectFromBody(merged_body);
          return d && isValidSubjectLine(d) ? d : null;
        })();
  if (merged_subject == null) return null;

  const { profileUrl } = getLinkedInAuthorFromExtraJson(params.post_extraJson);
  const href = profileUrl != null && profileUrl.trim() ? profileUrl : null;
  if (!href) return null;

  const public_profile_url = normalizePublicProfileUrl(href);
  if (public_profile_url == null) return null;

  const o = params.prospect_fields;
  let first_name: string;
  let last_name: string;
  if (o && (o.first_name || o.last_name)) {
    first_name = givenNameAfterLeadingHonorifics(o.first_name.trim());
    last_name = o.last_name.trim();
  } else {
    const split = splitDisplayNameToParts(params.author_display_name);
    first_name = split.first_name;
    last_name = split.last_name;
    if (!first_name.trim() && !last_name.trim()) {
      const fromSlug = firstLastFromInSlugPath(public_profile_url);
      first_name = fromSlug.first_name;
      last_name = fromSlug.last_name;
    }
  }

  first_name = formatFirstNameForGreeting(first_name.trim());
  last_name = last_name.trim();

  if (!first_name || !last_name) {
    return null;
  }

  const empGate = 0.6;
  const pi = params.prospect_intel;
  const titleCsv =
    pi &&
    pi.employmentConfidence >= empGate &&
    pi.currentTitle &&
    pi.currentTitle.trim()
      ? pi.currentTitle.trim()
      : "";
  const companyCsv =
    pi &&
    pi.employmentConfidence >= empGate &&
    pi.currentCompany &&
    pi.currentCompany.trim()
      ? pi.currentCompany.trim()
      : "";

  return {
    public_profile_url,
    first_name,
    last_name,
    title: titleCsv,
    company: companyCsv,
    merged_subject,
    merged_body,
    safe_professional_reference: (pi?.safeProfessionalReference ?? "").replace(/\r|\n/g, " ").trim(),
    routing_bucket: pi?.routingBucket ?? "",
    classification_confidence:
      pi != null ? String(Math.round(pi.classificationConfidence * 1000) / 1000) : "",
  };
}
