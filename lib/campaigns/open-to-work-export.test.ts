/**
 * Run: npx tsx lib/campaigns/open-to-work-export.test.ts
 */
import assert from "node:assert/strict";
import {
  apifyCompanyItemHasOpenToWorkSignal,
  deriveCampaignOpenToWorkFields,
} from "./open-to-work-export";
import type { CampaignCandidate } from "./types";
import type { ProspectClassification } from "@/lib/prospect-intelligence/types";

function companyCandidate(over: Partial<CampaignCandidate> = {}): CampaignCandidate {
  return {
    linkedin_url: "https://www.linkedin.com/in/example-user/",
    linkedin_url_normalized: "https://www.linkedin.com/in/example-user",
    first_name: "Alex",
    last_name: "Example",
    display_name: "Alex Example",
    headline: "Security Engineer",
    current_title: "Security Engineer",
    current_company: "Example Corp",
    location: null,
    employment_source: "current_positions",
    source_types: ["cold_company_search"],
    first_source_type: "cold_company_search",
    source_count: 1,
    source_company_url: null,
    source_role_group: null,
    source_job_title_query: null,
    raw_source: "apify_company_employees",
    relevance_score: null,
    theme_name: null,
    post_url: null,
    total_reactions: null,
    themes_analysis_id: null,
    post_id: null,
    platform: null,
    ...over,
  };
}

function run() {
  assert.equal(apifyCompanyItemHasOpenToWorkSignal({ openToWork: true }), true);
  assert.equal(
    apifyCompanyItemHasOpenToWorkSignal({ headline: "Engineer at Example" }),
    false
  );

  const classification: ProspectClassification = {
    roleCategories: ["unknown"],
    functionTags: [],
    profileFlags: [],
    seniority: "ic",
    confidence: 0.2,
    classificationNeedsReview: true,
    openToWorkDetection: { status: "not_observed", confidence: 0, evidence: "", reason: "" },
  };

  const fields = deriveCampaignOpenToWorkFields({
    candidate: companyCandidate(),
    classification,
    hadCachedEmployment: false,
    apifyHadOpenToWork: false,
  });
  assert.equal(fields.open_to_work_detection, "unknown");
  assert.equal(fields.open_to_work_source, "unavailable");

  console.log("open-to-work-export.test.ts: ok");
}

run();
