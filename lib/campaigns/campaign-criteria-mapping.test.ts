/**
 * Run: npx tsx lib/campaigns/campaign-criteria-mapping.test.ts
 */
import assert from "node:assert/strict";
import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import {
  CAMPAIGN_EXCLUSION_CRITERIA,
  listCampaignExclusionGroups,
  matchCampaignExclusionCriteria,
} from "./campaign-criteria-mapping";

function baseClassification(over: Partial<ProspectClassification>): ProspectClassification {
  return {
    employmentConfidence: 0.7,
    professionalSummary: null,
    safeProfessionalReference: "your work",
    roleCategories: [],
    profileFlags: [],
    excludedRoleFlags: [],
    outreachTags: [],
    seniority: "unknown",
    functionTags: [],
    companySizeSignal: "unknown",
    employmentRelationship: "named_employer",
    routingRecommendation: "linkedin_outreach",
    confidence: 0.75,
    classificationNeedsReview: false,
    needsReview: false,
    reason: "test",
    evidence: [],
    ...over,
  };
}

function run() {
  assert.ok(CAMPAIGN_EXCLUSION_CRITERIA.length >= 20, "expected full exclusion checklist");

  const recruiterOnly = baseClassification({
    roleCategories: ["recruiter"],
    profileFlags: ["recruiter_signal"],
    excludedRoleFlags: ["recruiter"],
  });
  assert.deepEqual(matchCampaignExclusionCriteria(recruiterOnly, ["recruiter"]), ["recruiter"]);

  const otw = baseClassification({
    roleCategories: ["job_seeker"],
    openToWorkDetection: { status: "text_signal_detected", confidence: 0.9 },
    profileFlags: ["job_seeker_signal"],
  });
  assert.ok(matchCampaignExclusionCriteria(otw, ["open_to_work"]).includes("open_to_work"));

  const investor = baseClassification({
    roleCategories: ["venture_capital"],
    profileFlags: ["investor_signal"],
  });
  assert.ok(matchCampaignExclusionCriteria(investor, ["investor"]).includes("investor"));

  const consultant = baseClassification({
    roleCategories: ["consultant"],
    profileFlags: ["consultant_signal"],
  });
  assert.ok(matchCampaignExclusionCriteria(consultant, ["consultant"]).includes("consultant"));

  const mixedFounderConsultant = baseClassification({
    roleCategories: ["founder", "consultant", "security_leader"],
    profileFlags: ["founder_signal", "consultant_signal"],
  });
  const matched = matchCampaignExclusionCriteria(mixedFounderConsultant, ["consultant"]);
  assert.deepEqual(matched, ["consultant"]);

  const common = listCampaignExclusionGroups().find((g) => g.group === "Common exclusions");
  assert.ok(common, "common exclusions group");
  assert.equal(common.sections[0]?.section, "role", "role types section first");
  assert.equal(common.sections[0]?.criteria[0]?.id, "sales_marketing");
  const commonStatus = common.sections.find((s) => s.section === "status");
  assert.ok(commonStatus, "status section present");
  assert.equal(commonStatus.criteria[0]?.id, "open_to_work");
  assert.ok(
    common.sections[0]!.criteria.every((c) => c.id !== "open_to_work"),
    "open to work not in role section"
  );

  const advanced = listCampaignExclusionGroups().find(
    (g) => g.group === "Advanced / technical exclusions"
  );
  assert.ok(advanced, "advanced exclusions group");
  assert.equal(advanced.sections[advanced.sections.length - 1]?.section, "status");
  assert.equal(advanced.sections[advanced.sections.length - 1]?.criteria[0]?.id, "c_level");

  console.log("campaign-criteria-mapping.test.ts: ok");
}

run();
