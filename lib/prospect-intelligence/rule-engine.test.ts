/**
 * Run: npx tsx lib/prospect-intelligence/rule-engine.test.ts
 */
import assert from "node:assert/strict";
import { evaluateRoutingRules } from "./rule-engine";
import type { ProspectClassification, ProspectRoutingRuleDefinition } from "./types";

function baseClassification(over: Partial<ProspectClassification>): ProspectClassification {
  return {
    employmentConfidence: 0,
    professionalSummary: null,
    safeProfessionalReference: null,
    roleCategories: [],
    profileFlags: [],
    excludedRoleFlags: [],
    outreachTags: [],
    seniority: "unknown",
    functionTags: [],
    companySizeSignal: "unknown",
    employmentRelationship: "unknown",
    routingRecommendation: "linkedin_outreach",
    confidence: 0.7,
    classificationNeedsReview: false,
    needsReview: false,
    reason: "test",
    evidence: [],
    ...over,
  };
}

function run() {
  const cl = baseClassification({
    roleCategories: ["recruiter"],
    excludedRoleFlags: ["recruiter"],
    routingRecommendation: "linkedin_outreach",
  });

  const rules: ProspectRoutingRuleDefinition[] = [
    {
      id: "r1",
      projectId: "p",
      name: "Exclude recruiters",
      enabled: true,
      priority: 10,
      conditionLogic: "all",
      conditions: [{ field: "roleCategory", op: "in", values: ["recruiter"] }],
      actions: [{ type: "exclude_from_outreach" }],
    },
  ];

  const out = evaluateRoutingRules(rules, {
    classification: cl,
    platform: "linkedin",
    themeRelevancePercent: 80,
    headlineText: "",
    competitorMatched: false,
  });

  assert.equal(out.bucket, "excluded");
  assert.equal(out.routingRecommendation, "exclude");
  assert.equal(out.stoppedEarly, true);
  assert.equal(out.matchedRuleId, "r1");

  const cl2 = baseClassification({
    roleCategories: ["engineering_leader"],
    seniority: "vp",
    confidence: 0.72,
    employmentConfidence: 0.7,
    routingRecommendation: "email_outreach",
  });

  const rules2: ProspectRoutingRuleDefinition[] = [
    {
      id: "r2",
      projectId: "p",
      name: "VP eng to email",
      enabled: true,
      priority: 5,
      conditionLogic: "all",
      conditions: [
        { field: "roleCategory", op: "in", values: ["engineering_leader"] },
        { field: "seniority", op: "in", values: ["vp", "director", "c_level"] },
        { field: "classificationConfidence", op: "gte", value: 0.65 },
      ],
      actions: [{ type: "set_bucket", bucket: "email" }, { type: "route", target: "email_outreach" }],
    },
  ];

  const out2 = evaluateRoutingRules(rules2, {
    classification: cl2,
    platform: "linkedin",
    themeRelevancePercent: 90,
    headlineText: "VP Engineering at Acme",
    competitorMatched: false,
  });

  assert.equal(out2.bucket, "email");
  assert.equal(out2.routingRecommendation, "email_outreach");

  console.log("prospect-intelligence rule-engine tests: ok");
}

// fix typo - I used out2.bucket_email by mistake
run();
