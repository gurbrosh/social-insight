import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import { loadCompetitorPatternsForProject } from "@/lib/prospect-intelligence/pipeline";
import type { ProspectClassification, ProspectEvidence } from "@/lib/prospect-intelligence/types";
import type { NormalizedProfileEnrichment } from "./normalize-profile-enrichment";
import type { CampaignCandidatePreviewRow } from "./types";

function buildEnrichedEvidence(
  candidate: CampaignCandidatePreviewRow,
  enriched: NormalizedProfileEnrichment
): ProspectEvidence[] {
  const observedAt = new Date().toISOString();
  const items: ProspectEvidence[] = [];

  if (enriched.enriched_current_title || enriched.enriched_current_company) {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: [enriched.enriched_current_title, enriched.enriched_current_company]
        .filter(Boolean)
        .join(" @ "),
      extractedSignals: ["profile_title", "profile_company", "profile_experience"],
      confidence: enriched.enriched_employment_confidence,
      observedAt,
      metadata: {
        analysisMethod: "campaign_phase3_profile_enrichment",
        employmentSource: enriched.enriched_employment_source,
      },
    });
  }

  if (enriched.headline?.trim()) {
    items.push({
      source: "linkedin_author_headline",
      sourceUrl: candidate.linkedin_url,
      rawText: enriched.headline,
      extractedSignals: ["headline"],
      confidence: 0.55,
      observedAt,
      metadata: { analysisMethod: "campaign_phase3_headline" },
    });
  }

  if (enriched.about?.trim()) {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: enriched.about.slice(0, 2000),
      extractedSignals: ["about", "profile_summary"],
      confidence: 0.5,
      observedAt,
      metadata: { analysisMethod: "campaign_phase3_about" },
    });
  }

  if (enriched.skills?.trim()) {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: enriched.skills,
      extractedSignals: ["skills"],
      confidence: 0.45,
      observedAt,
      metadata: { analysisMethod: "campaign_phase3_skills" },
    });
  }

  if (enriched.past_titles || enriched.past_companies) {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: [enriched.past_titles, enriched.past_companies].filter(Boolean).join("; "),
      extractedSignals: ["profile_experience", "past_roles"],
      confidence: 0.65,
      observedAt,
      metadata: { analysisMethod: "campaign_phase3_past_experience" },
    });
  }

  if (enriched.open_to_work_detection === "detected") {
    items.push({
      source: "enrichment_vendor",
      sourceUrl: candidate.linkedin_url,
      rawText: enriched.open_to_work_raw_value ?? "open_to_work",
      extractedSignals: ["open_to_work"],
      confidence: enriched.open_to_work_source === "inferred_text_weak" ? 0.4 : 0.85,
      observedAt,
      metadata: {
        analysisMethod:
          enriched.open_to_work_source === "inferred_text_weak"
            ? "campaign_phase3_otw_weak_text"
            : "campaign_phase3_otw_explicit",
      },
    });
  }

  return items;
}

export async function classifyEnrichedCandidateReadOnly(
  projectId: string,
  candidate: CampaignCandidatePreviewRow,
  enriched: NormalizedProfileEnrichment
): Promise<ProspectClassification> {
  const evidence = buildEnrichedEvidence(candidate, enriched);
  const competitorPatterns = await loadCompetitorPatternsForProject(projectId);

  return classifyProspectDeterministic(evidence, {
    linkedinUrl: candidate.linkedin_url,
    name: enriched.name || candidate.display_name || undefined,
    competitorPatterns,
  });
}
