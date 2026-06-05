import { stringify } from "csv-stringify/sync";
import { LINKEDIN_PROSPECTS_CSV_HEADERS } from "./constants";
import type { LinkedInProspectCsvRow } from "./types";

/**
 * Spec: `linkedin_prospects_YYYYMMDD.csv`, UTF-8 (no BOM), comma-separated, all fields
 * double-quoted (QUOTE_ALL), header row. Open in Excel via Data > From Text/CSV, UTF-8, if needed.
 */
/** QUOTE_ALL, comma, LF only — matches Python `csv.QUOTE_ALL`. */
export function buildLinkedInProspectsCsvContent(rows: LinkedInProspectCsvRow[]): string {
  if (rows.length === 0) {
    const headerLine = LINKEDIN_PROSPECTS_CSV_HEADERS.map(
      (h) => `"${String(h).replace(/"/g, '""')}"`
    ).join(",");
    return `${headerLine}\n`;
  }
  return stringify(
    rows.map((r) => ({
      public_profile_url: r.public_profile_url,
      first_name: r.first_name,
      last_name: r.last_name,
      title: r.title,
      company: r.company,
      merged_subject: r.merged_subject,
      merged_body: r.merged_body,
      safe_professional_reference: r.safe_professional_reference,
      routing_bucket: r.routing_bucket,
      classification_confidence: r.classification_confidence,
    })),
    {
      header: true,
      columns: [...LINKEDIN_PROSPECTS_CSV_HEADERS],
      quoted: true,
      quoted_empty: true,
      record_delimiter: "\n",
    }
  );
}
