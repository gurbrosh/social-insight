/**
 * Run: npx tsx lib/campaigns/campaign-phase1-integration.test.ts
 */
import assert from "node:assert/strict";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import type { ProspectClassification, ProspectEvidence } from "@/lib/prospect-intelligence/types";
import { mergeCampaignCandidates } from "./merge-campaign-candidates";
import { postBasedToCampaignCandidate } from "./post-based-to-campaign-candidate";
import { evaluatePhase1Exclusion } from "./phase1-exclusion";
import { computePhase1SummaryCounts } from "./phase1-summary";
import type { CampaignCandidatePreviewRow, CampaignExclusionCriterionId, PostBasedCampaignCandidate } from "./types";

function companyEvidence(title: string, company: string): ProspectEvidence[] {
  const observedAt = new Date().toISOString();
  return [
    {
      source: "enrichment_vendor",
      sourceUrl: "https://www.linkedin.com/in/example-profile/",
      rawText: `${title} @ ${company}`,
      extractedSignals: ["profile_title", "profile_company"],
      confidence: 0.75,
      observedAt,
      metadata: {
        analysisMethod: "company_search_current_position",
        employmentSource: "current_positions",
      },
    },
  ];
}

function applyPhase1(
  classification: ProspectClassification,
  selectedExclusionIds: CampaignExclusionCriterionId[]
) {
  const phase1 = evaluatePhase1Exclusion({ classification, selectedExclusionIds });
  return {
    phase1_decision: phase1.decision,
    matched_exclusion_criteria: phase1.matchedExclusionCriteria,
    role_categories: classification.roleCategories.join(";"),
    classification_confidence: classification.confidence,
    classification_needs_review: classification.classificationNeedsReview,
  };
}

function run() {
  const engineerClassification = classifyProspectDeterministic(
    companyEvidence("Security Engineer", "Example Corp"),
    {
      linkedinUrl: "https://www.linkedin.com/in/example-engineer/",
      name: "Example Person",
    }
  );
  const engineerPhase1 = applyPhase1(engineerClassification, ["c_level"]);
  assert.equal(engineerPhase1.phase1_decision, "continue_to_enrichment");

  const executiveClassification: ProspectClassification = {
    roleCategories: ["executive_leader"],
    functionTags: [],
    profileFlags: [],
    seniority: "c_level",
    confidence: 0.85,
    classificationNeedsReview: false,
    employmentConfidence: 0.8,
  };
  const executivePhase1 = applyPhase1(executiveClassification, ["c_level"]);
  assert.equal(executivePhase1.phase1_decision, "disqualify_phase1");
  assert.ok(executivePhase1.matched_exclusion_criteria?.includes("c_level"));

  const companyRow: CampaignCandidatePreviewRow = {
    linkedin_url: "https://www.linkedin.com/in/example-ceo/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-ceo",
    first_name: "Example",
    last_name: "Person",
    display_name: "Example Person",
    headline: "Chief Executive Officer",
    current_title: "Chief Executive Officer",
    current_company: "Example Corp",
    location: null,
    employment_source: "current_positions",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: "https://www.linkedin.com/company/example-corp/",
    source_role_group: "security_leaders",
    source_job_title_query: "Chief Executive Officer",
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    ...executivePhase1,
  };

  const postRow: PostBasedCampaignCandidate = {
    linkedin_url: "https://www.linkedin.com/in/example-ceo/",
    first_name: "Example",
    last_name: "Person",
    display_name: "Example Person",
    headline: "Commenter",
    candidate_source_type: "post_based_candidate",
    relevance_score: 90,
    theme_name: "Theme A",
    post_url: "https://linkedin.com/post/1",
    total_reactions: 5,
    themes_analysis_id: "ta1",
    post_id: 1,
    platform: "linkedin",
  };

  const merged = mergeCampaignCandidates(
    [postBasedToCampaignCandidate(postRow)],
    [companyRow]
  );
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.candidates[0]!.source_count, 2);
  assert.deepEqual(merged.candidates[0]!.source_types.sort(), [
    "cold_company_search",
    "post_based_candidate",
  ]);

  const engineerRow: CampaignCandidatePreviewRow = {
    ...companyRow,
    linkedin_url: "https://www.linkedin.com/in/example-engineer/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-engineer",
    ...engineerPhase1,
  };
  const summary = computePhase1SummaryCounts([companyRow, engineerRow]);
  assert.equal(summary.companySearchCount, 2);
  assert.equal(summary.postBasedCount, 0);

  console.log("campaign-phase1-integration.test.ts: ok");
}

run();
