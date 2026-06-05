export const LINKEDIN_PROSPECTS_CSV_HEADERS = [
  "public_profile_url",
  "first_name",
  "last_name",
  "title",
  "company",
  "merged_subject",
  "merged_body",
  "safe_professional_reference",
  "routing_bucket",
  "classification_confidence",
] as const;

export const PUBLIC_PROFILE_URL_REGEX = /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9\-_%]+$/;

export const DEFAULT_MAX_ROWS = 100;
