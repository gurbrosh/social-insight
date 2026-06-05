export type LinkedInProspectCsvRow = {
  public_profile_url: string;
  first_name: string;
  last_name: string;
  /** Populated only when employment confidence clears threshold; else empty. */
  title: string;
  /** Populated only when employment confidence clears threshold; else empty. */
  company: string;
  merged_subject: string;
  merged_body: string;
  safe_professional_reference: string;
  routing_bucket: string;
  classification_confidence: string;
};

export type BuildCandidate = {
  /** For dedup: highest wins */
  total_reactions: number;
  relevance_score: number;
  /** Stable tie-break */
  theme_item_response_id: string;
  row: LinkedInProspectCsvRow;
};
