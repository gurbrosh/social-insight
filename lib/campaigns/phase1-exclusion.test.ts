/**
 * Run: npx tsx lib/campaigns/phase1-exclusion.test.ts
 */
import assert from "node:assert/strict";
import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import { matchCampaignExclusionCriteria } from "./campaign-criteria-mapping";
import { evaluatePhase1Exclusion } from "./phase1-exclusion";

function base(over: Partial<ProspectClassification>): ProspectClassification {
  return {
    employmentConfidence: 0.80,
    professionalSummary: null,
    safeProfessionalReference: "their work",
    roleCategories: [],
    profileFlags: [],
    excludedRoleFlags: [],
    outreachTags: [],
    seniority: "ic",
    functionTags: [],
    companySizeSignal: "mid_market",
    employmentRelationship: "named_employer",
    routingRecommendation: "linkedin_outreach",
    confidence: 0.80,
    classificationNeedsReview: false,
    needsReview: false,
    reason: "test",
    evidence: [],
    currentTitle: undefined,
    currentCompany: undefined,
    ...over,
  };
}

function run() {
  // ── DISQUALIFY cases ─────────────────────────────────────────────────────────

  // Founder only + Founder excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Founder", roleCategories: ["founder"], profileFlags: ["founder_signal"], seniority: "founder", confidence: 0.77 }),
      selectedExclusionIds: ["founder"],
    }).decision,
    "disqualify_phase1",
    "exact Founder → disqualify"
  );

  // CEO & Founder + Founder (and/or c_level) excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "CEO & Founder", roleCategories: ["founder", "executive_leader"], seniority: "founder", confidence: 0.80 }),
      selectedExclusionIds: ["founder", "c_level"],
    }).decision,
    "disqualify_phase1",
    "CEO & Founder → disqualify when Founder+C-level excluded"
  );

  // Founder title only (no role category from classifier) + Founder excluded
  const founderTitleOnly = base({ currentTitle: "Founder", roleCategories: [], seniority: "unknown", confidence: 0.65 });
  assert.ok(
    matchCampaignExclusionCriteria(founderTitleOnly, ["founder"]).includes("founder"),
    "title-only Founder matches founder exclusion"
  );
  assert.equal(
    evaluatePhase1Exclusion({ classification: founderTitleOnly, selectedExclusionIds: ["founder"] }).decision,
    "disqualify_phase1",
    "title-only Founder → disqualify"
  );

  // Recruiter only + Recruiter excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["recruiter"], profileFlags: ["recruiter_signal"], excludedRoleFlags: ["recruiter"] }),
      selectedExclusionIds: ["recruiter"],
    }).decision,
    "disqualify_phase1",
    "recruiter only → disqualify"
  );

  // Consultant only + Consultant excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["consultant"], profileFlags: ["consultant_signal"], excludedRoleFlags: ["consultant"] }),
      selectedExclusionIds: ["consultant"],
    }).decision,
    "disqualify_phase1",
    "consultant only → disqualify"
  );

  // Software Developer title + Software engineer excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Software Developer", roleCategories: ["software_engineer"], functionTags: ["software"] }),
      selectedExclusionIds: ["software_engineer"],
    }).decision,
    "disqualify_phase1",
    "Software Developer → disqualify"
  );

  // Full Stack Engineer + Software engineer excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Full Stack Engineer", roleCategories: ["full_stack_engineer"], functionTags: ["engineering"] }),
      selectedExclusionIds: ["software_engineer"],
    }).decision,
    "disqualify_phase1",
    "Full Stack Engineer → disqualify"
  );

  // SOC Analyst + Security role excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "SOC Analyst", roleCategories: ["analyst_security"], functionTags: ["cybersecurity"] }),
      selectedExclusionIds: ["security_role"],
    }).decision,
    "disqualify_phase1",
    "SOC Analyst → disqualify"
  );

  // Security Architect + Security role excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Security Architect", roleCategories: ["security_practitioner"], functionTags: ["cybersecurity"] }),
      selectedExclusionIds: ["security_role"],
    }).decision,
    "disqualify_phase1",
    "Security Architect → disqualify"
  );

  // Cybersecurity Manager title (title heuristic) + Security role excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Senior Manager - Cyber Security", roleCategories: ["security_leader"], functionTags: ["cybersecurity"] }),
      selectedExclusionIds: ["security_role"],
    }).decision,
    "disqualify_phase1",
    "Senior Manager - Cyber Security → disqualify"
  );

  // Product manager only + Product role excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Product Manager", roleCategories: ["product_manager"] }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "disqualify_phase1",
    "Product Manager → disqualify"
  );

  // Student only + student_academic excluded
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["student"], seniority: "student", profileFlags: ["student_signal"] }),
      selectedExclusionIds: ["student_academic"],
    }).decision,
    "disqualify_phase1",
    "student only → disqualify"
  );

  // ── CONTINUE cases ───────────────────────────────────────────────────────────

  // Unknown role — always continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["unknown"], employmentConfidence: 0.2, confidence: 0.3 }),
      selectedExclusionIds: ["recruiter", "consultant"],
    }).decision,
    "continue_to_enrichment",
    "unknown role → continue"
  );
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["unknown"], confidence: 0.3 }),
      selectedExclusionIds: ["recruiter"],
    }).reason,
    "unknown_role_category"
  );

  // Classification needs review — always continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["founder"], classificationNeedsReview: true }),
      selectedExclusionIds: ["founder"],
    }).decision,
    "continue_to_enrichment",
    "needs review → continue"
  );

  // Below confidence threshold (< 0.60) — continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Founder", roleCategories: ["founder"], confidence: 0.55, seniority: "founder" }),
      selectedExclusionIds: ["founder"],
    }).decision,
    "continue_to_enrichment",
    "low confidence Founder → continue"
  );
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ currentTitle: "Founder", roleCategories: ["founder"], confidence: 0.55, seniority: "founder" }),
      selectedExclusionIds: ["founder"],
    }).reason,
    "below_confidence_threshold"
  );

  // No exclusions selected — baseline
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["founder"], seniority: "founder", confidence: 0.80 }),
      selectedExclusionIds: [],
    }).decision,
    "continue_to_enrichment",
    "no exclusions selected → continue"
  );

  // No matched criteria — continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({ roleCategories: ["security_leader"], functionTags: ["cybersecurity"] }),
      selectedExclusionIds: ["recruiter"],
    }).decision,
    "continue_to_enrichment",
    "no criteria match → continue"
  );

  // Founder + security_leader, only Founder excluded, Security not excluded → continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Founder & Security Leader",
        roleCategories: ["founder", "security_leader"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
      }),
      selectedExclusionIds: ["founder"],
    }).decision,
    "continue_to_enrichment",
    "founder + security_leader, only Founder excluded → continue"
  );
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["founder", "security_leader"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
      }),
      selectedExclusionIds: ["founder"],
    }).reason,
    "mixed_excluded_and_non_excluded_signals"
  );

  // Consultant + security_leader, only Consultant excluded → continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["consultant", "security_leader"],
        profileFlags: ["consultant_signal"],
        excludedRoleFlags: ["consultant"],
      }),
      selectedExclusionIds: ["consultant"],
    }).decision,
    "continue_to_enrichment",
    "consultant + security_leader, only Consultant excluded → continue"
  );

  // Consultant + security_practitioner, Security role not excluded → continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["consultant", "security_practitioner"],
        profileFlags: ["consultant_signal"],
        excludedRoleFlags: ["consultant"],
      }),
      selectedExclusionIds: ["consultant"],
    }).decision,
    "continue_to_enrichment",
    "consultant + security_practitioner, only Consultant excluded → continue"
  );

  // Plain CEO with Set A exclusions (sales/marketing/recruiter/consultant/not_working) — continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "CEO",
        currentCompany: "Example Corp",
        roleCategories: ["executive_leader"],
        seniority: "c_level",
      }),
      selectedExclusionIds: ["sales_marketing", "open_to_work", "recruiter", "consultant", "not_working"],
    }).decision,
    "continue_to_enrichment",
    "plain CEO + Set A → continue"
  );

  // Plain CEO with Set C (technical/software/security/devops/engineering) — continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "CEO",
        roleCategories: ["executive_leader"],
        seniority: "c_level",
      }),
      selectedExclusionIds: ["technical", "software_engineer", "security_role", "devops_platform", "engineering_leader"],
    }).decision,
    "continue_to_enrichment",
    "plain CEO + Set C → continue"
  );

  // VP with no engineering role — should NOT match engineering_leader
  const vpProduct = base({ currentTitle: "VP of Product", roleCategories: ["product_leader"], seniority: "vp" });
  assert.equal(matchCampaignExclusionCriteria(vpProduct, ["engineering_leader"]).length, 0, "VP Product should not match engineering_leader");

  // Digital Consultant title — should NOT match contractor exclusion
  assert.equal(
    matchCampaignExclusionCriteria(
      base({ currentTitle: "Digital Consultant", roleCategories: ["consultant"], profileFlags: ["consultant_signal"] }),
      ["contractor"]
    ).length,
    0,
    "consultant title should not match contractor exclusion"
  );

  // CTO title → c_level matched via title heuristic
  assert.ok(
    matchCampaignExclusionCriteria(
      base({ currentTitle: "CTO at Example Co", roleCategories: [], seniority: "unknown" }),
      ["c_level"]
    ).includes("c_level"),
    "CTO title → c_level matched"
  );

  // ── Phase 1 semantic coverage (Set C style) ──────────────────────────────────
  const setC = [
    "technical",
    "software_engineer",
    "security_role",
    "devops_platform",
    "engineering_leader",
  ] as const;

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["software_engineer", "technical_influencer"],
        functionTags: ["engineering"],
        confidence: 0.82,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "disqualify_phase1",
    "Set C: SWE + technical_influencer → disqualify (influencer covered by technical umbrella)"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Full Stack Developer",
        roleCategories: ["full_stack_engineer"],
        confidence: 0.8,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "disqualify_phase1",
    "Set C: Full Stack (full_stack_engineer) → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["ai_engineer", "technical_influencer"],
        functionTags: ["ai_ml"],
        confidence: 0.8,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "disqualify_phase1",
    "Set C: AI Engineer + technical_influencer → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Security Architect",
        roleCategories: ["security_practitioner"],
        functionTags: ["cybersecurity"],
        confidence: 0.85,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "disqualify_phase1",
    "Set C: Security Architect + security_practitioner → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["founder", "security_practitioner"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
        confidence: 0.85,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "continue_to_enrichment",
    "Set C: Founder + Security Practitioner — Founder not excluded → continue (security not absorbed by Set C match if no founder rule)"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["founder", "security_practitioner"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
        confidence: 0.85,
      }),
      selectedExclusionIds: [...setC],
    }).reason,
    "mixed_excluded_and_non_excluded_signals",
    "founder survives as non-excluded when founder exclusion omitted"
  );

  // ── Phase 1 semantic coverage (Set D style) ─────────────────────────────────
  const setD = ["founder", "c_level", "product_role", "ai_ml_role", "advisor_board_member"] as const;

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "CEO & Founder",
        roleCategories: ["founder", "executive_leader"],
        seniority: "founder",
        confidence: 0.86,
      }),
      selectedExclusionIds: [...setD],
    }).decision,
    "disqualify_phase1",
    "Set D: Founder + C-level/exec → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["ai_engineer"],
        functionTags: ["ai_ml"],
        confidence: 0.8,
      }),
      selectedExclusionIds: [...setD],
    }).decision,
    "disqualify_phase1",
    "Set D: AI Engineer only → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Product Manager",
        roleCategories: ["product_manager"],
        confidence: 0.8,
      }),
      selectedExclusionIds: [...setD],
    }).decision,
    "disqualify_phase1",
    "Set D: Product Manager only → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["product_manager", "product_leader"],
        confidence: 0.82,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "disqualify_phase1",
    "Product Manager + product_leader — both under product exclusion umbrella"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["ai_engineer", "technical_architect"],
        functionTags: ["ai_ml"],
        confidence: 0.84,
      }),
      selectedExclusionIds: ["ai_ml_role"],
    }).decision,
    "disqualify_phase1",
    "AI Engineer + technical_architect — architect folded under AI when AI role present"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["founder", "security_practitioner"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
        confidence: 0.85,
      }),
      selectedExclusionIds: ["founder"],
    }).decision,
    "continue_to_enrichment",
    "Founder + Security Practitioner, only Founder excluded — continue"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["ai_engineer", "security_practitioner"],
        functionTags: ["ai_ml", "cybersecurity"],
        confidence: 0.85,
      }),
      selectedExclusionIds: ["ai_ml_role"],
    }).decision,
    "continue_to_enrichment",
    "AI Engineer + Security Practitioner, Security role not excluded — continue"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "CEO",
        roleCategories: ["executive_leader"],
        seniority: "c_level",
        confidence: 0.88,
      }),
      selectedExclusionIds: [...setD],
    }).decision,
    "disqualify_phase1",
    "Plain CEO + Set D — C-level criterion matches exec role category coverage"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["founder", "security_practitioner"],
        profileFlags: ["founder_signal"],
        seniority: "founder",
        confidence: 0.85,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "continue_to_enrichment",
    "Founder + Security Practitioner, Founder criterion not selected — continue"
  );

  // Product + security_leader, Product excluded, Security role not selected → continue
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["product_manager", "security_leader"],
        functionTags: ["cybersecurity"],
        confidence: 0.84,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "continue_to_enrichment",
    "Product + security_leader, only Product role excluded — continue"
  );

  // VP + executive_leader + Set D: exec labels are semantically folded under matched C-level / peer exclusions (no bogus mixed continue)
  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "VP of Corporate Development",
        roleCategories: ["executive_leader"],
        seniority: "vp",
        confidence: 0.82,
      }),
      selectedExclusionIds: [...setD],
    }).decision,
    "disqualify_phase1",
    "VP + executive_leader + Set D → disqualify (exec leadership folded under selected C-level when matched)"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Country Managing Director",
        roleCategories: ["executive_leader", "business_leader"],
        seniority: "director",
        confidence: 0.85,
      }),
      selectedExclusionIds: ["c_level"],
    }).decision,
    "disqualify_phase1",
    "Managing Director + exec/business_leader + C-level excluded → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "CTO FutureRange MSP",
        roleCategories: ["engineering_leader", "technical_influencer"],
        seniority: "c_level",
        confidence: 0.87,
      }),
      selectedExclusionIds: ["c_level"],
    }).decision,
    "disqualify_phase1",
    "CTO + engineering_leader + influencer + C-level excluded → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "AI Engineer",
        roleCategories: ["ai_engineer", "technical_influencer"],
        functionTags: ["ai_ml"],
        confidence: 0.84,
      }),
      selectedExclusionIds: ["ai_ml_role"],
    }).decision,
    "disqualify_phase1",
    "AI Engineer + influencer + AI/ML excluded → disqualify (influencer folded under AI semantics)"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Product Manager",
        roleCategories: ["product_manager"],
        confidence: 0.8,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "disqualify_phase1",
    "Product Manager + Product role excluded only → disqualify"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        currentTitle: "Product Security Leader",
        roleCategories: ["product_leader", "security_leader"],
        functionTags: ["cybersecurity"],
        confidence: 0.84,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "continue_to_enrichment",
    "Product Security Leader — Product excluded, Security not excluded → continue"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["product_manager", "product_marketing"],
        confidence: 0.81,
      }),
      selectedExclusionIds: ["product_role"],
    }).decision,
    "disqualify_phase1",
    "Product manager + product_marketing — both covered by Product role umbrella"
  );

  assert.equal(
    evaluatePhase1Exclusion({
      classification: base({
        roleCategories: ["security_practitioner", "technical_influencer"],
        functionTags: ["cybersecurity"],
        confidence: 0.83,
      }),
      selectedExclusionIds: [...setC],
    }).decision,
    "disqualify_phase1",
    "Set C: Security practitioner + technical_influencer → disqualify"
  );

  console.log("phase1-exclusion.test.ts: ok");
}

run();
