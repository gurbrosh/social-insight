/**
 * Optional enrichment inputs; append as ProspectEvidence with source enrichment_vendor | search_snippet.
 * Phase 8: wire real vendors here without changing classifier contracts.
 */
import type { ProspectEvidence } from "./types";

export function enrichmentVendorEvidence(_params: {
  vendor: string;
  payloadText: string;
  confidence?: number;
}): ProspectEvidence[] {
  return [];
}

export function searchSnippetEvidence(_params: {
  snippet: string;
  url?: string;
}): ProspectEvidence[] {
  return [];
}
