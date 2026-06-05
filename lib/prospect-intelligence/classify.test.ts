/**
 * Run: npx tsx lib/prospect-intelligence/classify.test.ts
 */
import assert from "node:assert/strict";
import {
  classifyProspectDeterministic,
  extractMarketSegmentTerms,
  extractTitleCompanyFromHeadline,
  normalizeCompanyFragment,
  parseHeadlineEmploymentAndEducation,
} from "./classify";
import { gatherProspectEvidence } from "./gather-evidence";
import { evaluateRoutingRules } from "./rule-engine";
import type { ProspectEvidence, ProspectRoutingRuleDefinition } from "./types";

function classifyHeadline(
  headline: string,
  postContent = "Detailed comment on agentic AI security practices in production."
) {
  const ev = gatherProspectEvidence({
    headline,
    authorDisplayName: "Test User",
    postContent,
    postUrl: "https://www.linkedin.com/posts/example",
    platform: "linkedin",
  });
  return classifyProspectDeterministic(ev, {
    linkedinUrl: "https://www.linkedin.com/in/example",
  });
}

function evidenceWithProfilePhotoAlt(headline: string, photoAlt: string): ProspectEvidence[] {
  const iso = new Date().toISOString();
  return [
    {
      source: "linkedin_author_headline",
      rawText: headline,
      extractedSignals: [],
      confidence: 0.85,
      observedAt: iso,
    },
    {
      source: "linkedin_author_metadata",
      rawText: "Pat Example",
      extractedSignals: ["display_name"],
      confidence: 0.8,
      observedAt: iso,
      metadata: { profilePhotoImageAlt: photoAlt },
    },
  ];
}

function run() {
  const emp1 = extractTitleCompanyFromHeadline("Senior Service Delivery Manager at Exos IT");
  assert.equal(emp1?.title, "Senior Service Delivery Manager");
  assert.equal(emp1?.company, "Exos IT");

  const emp2 = extractTitleCompanyFromHeadline(
    "Owner at IT-Necessity • AI Inovator • Cyber security analyst"
  );
  assert.equal(emp2?.title, "Owner");
  assert.equal(emp2?.company, "IT-Necessity");

  const emp3 = extractTitleCompanyFromHeadline(
    "Head of R&D @ Pensar | Adjunct Professor of Computer Science @ Fordham University"
  );
  assert.equal(emp3?.title, "Head of R&D");
  assert.ok(emp3?.company?.includes("Pensar"));

  const emp4 = extractTitleCompanyFromHeadline(
    "Account Director @ Forrester | Driving Revenue Growth"
  );
  assert.ok(emp4?.title?.toLowerCase().includes("account"));
  assert.ok(emp4?.company?.toLowerCase().includes("forrester"));

  assert.equal(normalizeCompanyFragment("Acme • Division B"), "Acme");
  assert.equal(
    normalizeCompanyFragment("Homerun: Presales software for high performing teams"),
    "Homerun"
  );
  assert.equal(
    normalizeCompanyFragment("Imply- Keep Splunk, log everything, no waitng, pay less."),
    "Imply"
  );

  const exPast = classifyHeadline("Security Leader | Ex-Siemens, Ex-Wipro, Ex-NIIT");
  assert.equal(exPast.pastCompany, "Siemens; Wipro; NIIT");
  assert.equal(exPast.lastCompany, null);

  const exTwo = classifyHeadline("Engineer | ex-Microsoft, ex-Intuit");
  assert.equal(exTwo.pastCompany, "Microsoft; Intuit");
  assert.equal(exTwo.lastCompany, null);

  const ea = classifyHeadline(
    "Executive Assistant | C-Suite Partner | Passionate About Tech & Empowering Team Success"
  );
  assert.ok(ea.roleCategories.includes("executive_assistant"));
  assert.ok(ea.roleCategories.includes("operations_support"));
  assert.ok((ea.safeProfessionalReference ?? "").includes("executive support"));

  const sm = classifyHeadline(
    "Helping brands & creators grow with high-converting social media design"
  );
  assert.ok(sm.roleCategories.includes("designer"));
  assert.ok((sm.safeProfessionalReference ?? "").includes("social media design"));

  const ent = extractMarketSegmentTerms("Enterprise Software Sales Leader | B2B SaaS");
  assert.ok(ent.includes("enterprise_software"));
  assert.ok(ent.includes("b2b"));
  assert.ok(ent.includes("saas"));

  const c1 = classifyHeadline("Senior Service Delivery Manager at Exos IT");
  assert.ok(c1.roleCategories.includes("it_operations"));
  assert.equal(c1.needsReview, false);
  assert.equal(c1.routingRecommendation, "unrouted");

  const c2 = classifyHeadline("Repair Operations & Supply Chain Management");
  assert.ok(c2.needsReview);
  assert.equal(c2.routingRecommendation, "unrouted");

  const c3 = classifyHeadline("Chief Information Security Officer | Coach");
  assert.ok(c3.roleCategories.includes("security_leader"));
  assert.ok(c3.roleCategories.includes("coach_or_advisor"));
  assert.equal(c3.seniority, "c_level");
  assert.ok(c3.functionTags.includes("security"));
  assert.ok(!c3.currentCompany || c3.currentCompany.length === 0);
  assert.equal(c3.companyType, "unknown");
  assert.equal(c3.employmentRelationship, "ambiguous");
  assert.equal(c3.needsReview, true);
  assert.equal(c3.routingRecommendation, "unrouted");

  const c4 = classifyHeadline("Enterprise Software Sales Leader");
  assert.ok(c4.functionTags.includes("sales"));
  assert.ok(c4.profileFlags.includes("non_target_function_signal"));
  assert.ok(c4.marketSegmentTerms?.includes("enterprise_software"));
  assert.equal(c4.companySizeSignal, "unknown");
  assert.equal(c4.routingRecommendation, "unrouted");
  assert.equal(c4.needsReview, false);

  const c5 = classifyHeadline(
    "Aspiring Frontend Developer & UI/UX Designer | 1st Year CSE Student | Learning Cloud & DevOps | Creative Video Editor"
  );
  assert.ok(c5.roleCategories.includes("student"));
  assert.equal(c5.seniority, "student");
  assert.ok(c5.functionTags.includes("frontend") || c5.functionTags.includes("design"));
  assert.ok(c5.profileFlags.includes("student_signal"));
  assert.equal(c5.routingRecommendation, "unrouted");
  assert.ok(!c5.roleCategories.includes("engineering_leader"));
  assert.equal(c5.currentTitle, null);
  assert.equal(c5.currentCompany, null);
  assert.equal(c5.employmentConfidence, 0);
  assert.ok((c5.safeProfessionalReference ?? "").length < 120);
  assert.ok(!(c5.safeProfessionalReference ?? "").includes("Aspiring Frontend"));

  const c6 = classifyHeadline(
    "AUTHOR | Cyber Security GRC Advisor I Enterprise IT-OT Security Technology Solution Architect I Cyber CXO Strategist"
  );
  assert.ok(
    c6.roleCategories.includes("consultant") || c6.profileFlags.includes("consultant_signal")
  );
  assert.ok(
    c6.needsReview === true || c6.classificationNeedsReview === true || c6.employmentNeedsReview === true,
    "expected at least one review flag for multi-hat GRC/architect headline"
  );
  assert.equal(c6.routingRecommendation, "unrouted");
  assert.ok(c6.confidence >= 0.58);

  const c7 = classifyHeadline("Founder @Outri| NASA intern ’26 | IEEE’26 | ICCCN ’26");
  assert.ok(c7.roleCategories.includes("founder"));
  assert.ok(c7.roleCategories.includes("intern_or_student"));
  if (c7.employmentSource === "headline" && c7.currentTitle) {
    assert.equal(c7.currentTitle, "Founder");
    assert.equal(c7.currentCompany, "Outri");
    assert.ok(c7.employmentConfidence >= 0.55 && c7.employmentConfidence <= 0.62);
  }
  assert.ok(
    (c7.safeProfessionalReference ?? "").includes("founder") ||
      (c7.safeProfessionalReference ?? "").includes("early-career")
  );
  assert.equal(c7.routingRecommendation, "unrouted");
  assert.equal(c7.needsReview, true);
  assert.ok(c7.confidence >= 0.52);

  const c8 = classifyHeadline(
    "System Administrator | I Help Companies Optimize IT Systems & Ensure Seamless Operations Through Proactive Solutions."
  );
  assert.ok(c8.functionTags.includes("operations") || c8.roleCategories.includes("it_operations"));
  assert.equal(c8.needsReview, false);
  assert.equal(c8.routingRecommendation, "unrouted");
  assert.ok(c8.confidence >= 0.52);

  const c9 = classifyHeadline(
    "Head of R&D @ Pensar | Adjunct Professor of Computer Science @ Fordham University"
  );
  assert.ok(
    c9.roleCategories.includes("engineering_leader") ||
      c9.roleCategories.includes("technical_influencer")
  );
  assert.ok(c9.roleCategories.includes("academic"));
  assert.ok(c9.currentCompany?.includes("Pensar"));
  assert.ok(c9.affiliations?.some((a) => /fordham/i.test(a)));
  assert.ok(c9.functionTags.includes("research"));
  assert.ok(c9.functionTags.includes("academic"));
  assert.ok(c9.functionTags.includes("computer_science"));

  const c10 = classifyHeadline(
    "Graduated 2026 from SMAK 1 PENABUR Jakarta , Study Financial Engineering @ CUHK"
  );
  assert.ok(c10.roleCategories.includes("student"));
  assert.equal(c10.routingRecommendation, "unrouted");
  assert.equal(c10.currentTitle, null);
  assert.equal(c10.currentCompany, null);
  assert.equal(c10.employmentConfidence, 0);
  assert.ok(c10.educationInstitution?.toLowerCase().includes("cuhk"));

  const c11 = classifyHeadline(
    "Security operations center SOC Analyst /Skilled in SIEM Tools/ Threat Hunting/ Incident Response/Experienced in monitori…"
  );
  assert.ok(c11.roleCategories.includes("security_practitioner"));
  assert.ok(!c11.roleCategories.includes("media_analyst"));
  assert.equal(c11.seniority, "ic");

  const c12 = classifyHeadline(
    "Computer Science Student @ KNUST | Web development | Visual Designer & Front-End Developer | Freelance Design · Astrolab"
  );
  assert.ok(c12.roleCategories.includes("student"));
  assert.equal(c12.routingRecommendation, "unrouted");
  assert.equal(c12.currentTitle, null);
  assert.equal(c12.employmentConfidence, 0);

  const c12b = classifyHeadline("CS student at Al Baha University");
  assert.ok(c12b.roleCategories.includes("student"));
  assert.equal(c12b.currentTitle, null);
  assert.equal(c12b.currentCompany, null);
  assert.ok(c12b.educationInstitution?.toLowerCase().includes("al baha"));

  const c13 = classifyHeadline("Owner at IT-Necessity • AI Inovator • Cyber security analyst");
  assert.equal(c13.currentTitle, "Owner");
  assert.equal(c13.currentCompany, "IT-Necessity");
  assert.ok(c13.roleCategories.includes("owner_operator"));
  assert.ok(c13.roleCategories.includes("security_practitioner"));
  assert.equal(c13.seniority, "owner");
  assert.equal(c13.companySizeSignal, "tiny");
  assert.equal(c13.companyType, "small_business");
  assert.equal(c13.employmentRelationship, "founder_owner");
  assert.equal(c13.needsReview, true);
  assert.ok(c13.profileFlags.includes("possible_small_business"));
  assert.ok(c13.profileFlags.includes("ambiguous_professional_identity"));

  const c14 = classifyHeadline("Associate");
  assert.ok(c14.profileFlags.includes("weak_evidence"));
  assert.equal(c14.needsReview, true);

  const c15 = classifyHeadline("Masters in Computer Applications/data analytics");
  assert.ok(c15.roleCategories.includes("student"));
  assert.equal(c15.routingRecommendation, "unrouted");
  assert.equal(c15.needsReview, false);
  assert.equal(c15.employmentRelationship, "education_primary");

  const c16 = classifyHeadline("VP, Product Marketing");
  assert.ok(c16.roleCategories.includes("product_marketing"));
  assert.ok(c16.roleCategories.includes("marketing_leader"));
  assert.ok(c16.functionTags.includes("product_marketing"));
  assert.ok(c16.functionTags.includes("go_to_market"));
  assert.ok(c16.profileFlags.includes("non_target_function_signal"));
  assert.equal(c16.needsReview, false);
  assert.ok(c16.confidence >= 0.55, "clear VP PM headline should have medium+ label confidence");

  const c17 = classifyHeadline(
    "Account Director @ Forrester | Driving Revenue Growth, Simplifying Operations"
  );
  assert.ok(c17.roleCategories.includes("sales_account"));
  assert.ok(c17.roleCategories.includes("sales_leader"));
  assert.ok(c17.functionTags.includes("account_management"));
  assert.ok(c17.functionTags.includes("revenue"));
  assert.equal(c17.routingRecommendation, "unrouted");
  assert.equal(c17.needsReview, false);
  assert.ok(c17.confidence >= 0.55);

  const c18 = classifyHeadline("AWS/Azure Solutions Engineer | Efficiency Enablement Engineer");
  assert.equal(c18.routingRecommendation, "unrouted");
  assert.ok(
    c18.needsReview === true ||
      c18.classificationNeedsReview === true ||
      c18.employmentNeedsReview === true,
    "expected a review flag for multi-hat solutions engineer headline"
  );

  const c19 = classifyHeadline(
    "General Counsel | SaaS & Private Equity | Driving Growth, Risk Strategy & Transformation"
  );
  assert.ok(c19.roleCategories.includes("legal_counsel"));
  assert.equal(c19.routingRecommendation, "unrouted");
  assert.equal(c19.needsReview, true);

  const evRec = gatherProspectEvidence({
    headline: "Recruiter helping startups hire engineers",
    authorDisplayName: "Pat",
    postContent: "Great thread on hiring",
    postUrl: "https://www.linkedin.com/posts/example",
    platform: "linkedin",
  });
  const rec = classifyProspectDeterministic(evRec, {});
  assert.ok(rec.roleCategories.includes("recruiter"));

  const rules: ProspectRoutingRuleDefinition[] = [
    {
      id: "x",
      projectId: "p",
      name: "exclude recruiters",
      enabled: true,
      priority: 1,
      conditionLogic: "all",
      conditions: [{ field: "roleCategory", op: "in", values: ["recruiter"] }],
      actions: [{ type: "exclude_from_outreach" }],
    },
  ];
  const r = evaluateRoutingRules(rules, {
    classification: rec,
    platform: "linkedin",
    themeRelevancePercent: 80,
    headlineText: evRec[0]?.rawText ?? "",
    competitorMatched: false,
  });
  assert.equal(r.bucket, "excluded");

  const ev2 = gatherProspectEvidence({
    headline: "VP Engineering at Acme Corp",
    authorDisplayName: "Sam",
    postContent: "We are scaling infra with clear ownership and observability.",
    postUrl: "https://www.linkedin.com/posts/foo",
    platform: "linkedin",
  });
  const cEng = classifyProspectDeterministic(ev2, {});
  assert.ok(cEng.roleCategories.includes("engineering_leader"));
  assert.ok(cEng.currentTitle?.includes("VP") || cEng.currentTitle?.includes("Engineering"));
  assert.ok(cEng.currentCompany?.includes("Acme"));

  const confSpread = new Set([
    c1.confidence,
    c4.confidence,
    c10.confidence,
    c14.confidence,
    cEng.confidence,
  ]);
  assert.ok(confSpread.size >= 3, "confidence scores should vary across profile types");

  const idcHeadline =
    "Making Sense of Application Security, One Insight at a Time | IDC Industry Analyst";
  const idcEmp = extractTitleCompanyFromHeadline(idcHeadline);
  assert.equal(idcEmp?.title, "Industry Analyst");
  assert.equal(idcEmp?.company, "IDC");
  const idcCls = classifyHeadline(idcHeadline);
  assert.ok(idcCls.roleCategories.includes("analyst_security"));
  assert.ok(idcCls.safeProfessionalReference?.includes("application security analyst"));

  const gh =
    "Cybersecurity veteran, digital privacy pilgrim, best practice frameworks fanboy @ GitHub.com/CISOgeek";
  const ghEmp = extractTitleCompanyFromHeadline(gh);
  assert.equal(ghEmp, null);
  const ghCls = classifyHeadline(gh);
  assert.ok(ghCls.profileFlags.includes("url_or_handle_signal"));
  assert.ok(ghCls.roleCategories.includes("security_practitioner"));

  const aiEng =
    "AI Engineer | Multi-Agent Systems | MCP Architecture | Production Agentic Workflows | Security Domain Depth";
  const aiEngCls = classifyHeadline(aiEng);
  assert.ok(aiEngCls.roleCategories.includes("ai_engineer"));
  assert.ok(!aiEngCls.roleCategories.includes("recruiter"));

  const appSecM = "Driving AppSec and DevOps convergence through strategic marketing engagement.";
  const appSecCls = classifyHeadline(appSecM);
  assert.ok(appSecCls.roleCategories.includes("product_marketing"));
  assert.ok(appSecCls.roleCategories.includes("security_practitioner"));
  assert.ok(!appSecCls.roleCategories.includes("engineering_leader"));

  const weakAg = classifyHeadline("Preparing Enterprises for the Agentic Future");
  assert.ok(!weakAg.roleCategories.includes("recruiter"));
  assert.ok(weakAg.roleCategories.includes("ai_strategy"));

  const nvidia = classifyHeadline("Agents @ NVIDIA");
  assert.ok(nvidia.needsReview);
  assert.ok(nvidia.roleCategories.includes("ai_practitioner"));

  const itil = classifyHeadline("ITIL & Continuous Improvement Advocate | Service Management");
  assert.ok(itil.roleCategories.includes("it_operations"));
  assert.ok(itil.roleCategories.includes("operations_leader"));
  assert.ok(itil.functionTags.includes("it_service_management"));

  const agentsPath = classifyHeadline("Keeping AI agents on the right path");
  assert.ok(agentsPath.roleCategories.includes("ai_strategy"));
  assert.ok(agentsPath.profileFlags.includes("weak_evidence"));
  assert.ok(agentsPath.functionTags.includes("agentic_ai"));

  const typoFE = classifyHeadline("Senior FullstSack Developer with an eye for design.");
  assert.ok(typoFE.roleCategories.includes("frontend_engineer"));
  assert.ok(typoFE.profileFlags.includes("typo_signal"));
  assert.ok(typoFE.functionTags.includes("design"));

  const cyberEv = classifyHeadline(
    "Cybersecurity | Tech Evangelist | Podcaster | Storytelling for builders"
  );
  assert.ok(cyberEv.roleCategories.includes("technical_evangelist"));
  assert.ok(cyberEv.roleCategories.includes("media_creator"));
  assert.ok(cyberEv.safeProfessionalReference?.includes("evangelism"));

  const neutralPost = "Follow-up notes from the thread.";

  const otwHash = classifyHeadline("#OpenToWork | Software Engineer", neutralPost);
  assert.equal(otwHash.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(otwHash.openToWorkDetection?.evidenceSource, "headline");
  assert.ok(!otwHash.profileFlags.includes("open_to_work_public_signal"));
  assert.ok(otwHash.profileFlags.includes("open_to_work_text_signal"));

  const otwPlain = classifyHeadline("Open to work — Product Manager", neutralPost);
  assert.equal(otwPlain.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(otwPlain.openToWorkDetection?.evidenceSource, "headline");
  assert.ok(otwPlain.profileFlags.includes("open_to_work_text_signal"));
  assert.ok(!otwPlain.profileFlags.includes("open_to_work_public_signal"));

  const nextRole = classifyHeadline("Looking for my next role in cybersecurity", neutralPost);
  assert.equal(nextRole.openToWorkDetection?.status, "text_signal_detected");
  assert.ok(nextRole.profileFlags.includes("job_search_signal"));

  const laidOff = classifyHeadline("Recently laid off, seeking opportunities", neutralPost);
  assert.equal(laidOff.openToWorkDetection?.status, "text_signal_detected");
  assert.ok(laidOff.profileFlags.includes("career_transition_signal"));
  assert.ok(laidOff.profileFlags.includes("job_search_signal"));

  const hire = classifyHeadline("Available for hire: frontend engineer", neutralPost);
  assert.equal(hire.openToWorkDetection?.status, "text_signal_detected");
  assert.ok(hire.profileFlags.includes("job_search_signal"));

  const studentOnly = classifyHeadline("Student at KNUST", neutralPost);
  assert.equal(studentOnly.openToWorkDetection?.status, "not_observed");
  assert.equal(studentOnly.openToWorkDetection?.confidence, 0);
  assert.ok(!studentOnly.profileFlags.includes("open_to_work_public_signal"));
  assert.ok(!studentOnly.profileFlags.includes("open_to_work_text_signal"));

  const indie = classifyHeadline("Independent consultant", neutralPost);
  assert.equal(indie.openToWorkDetection?.status, "not_observed");
  assert.ok(!indie.profileFlags.includes("open_to_work_text_signal"));

  const advisorFrac = classifyHeadline("Advisor / fractional CTO", neutralPost);
  assert.equal(advisorFrac.openToWorkDetection?.status, "not_observed");
  assert.ok(!advisorFrac.profileFlags.includes("open_to_work_text_signal"));

  const altEv = evidenceWithProfilePhotoAlt(
    "Software Engineer",
    "Profile photo with Open to Work banner"
  );
  const altCls = classifyProspectDeterministic(altEv, { linkedinUrl: "https://linkedin.com/in/x" });
  assert.equal(altCls.openToWorkDetection?.status, "public_signal_detected");
  assert.equal(altCls.openToWorkDetection?.evidenceSource, "image_alt_text");
  assert.ok(altCls.profileFlags.includes("open_to_work_public_signal"));
  const altEvidence = altCls.openToWorkDetection?.evidence ?? "";
  assert.ok(/open to work|#opentowork/i.test(altEvidence));
  assert.ok(
    altEvidence.length < 100,
    "badge evidence should be a compact token, not the full alt sentence"
  );

  const iso = new Date().toISOString();
  const dualBadgeHeadline: ProspectEvidence[] = [
    {
      source: "linkedin_author_headline",
      rawText: "Software Engineer | Open to Work",
      extractedSignals: [],
      confidence: 0.85,
      observedAt: iso,
    },
    {
      source: "linkedin_extra_json",
      rawText: "",
      extractedSignals: [],
      confidence: 0.5,
      observedAt: iso,
      metadata: { linkedinBadgeUiStrings: ["#OpenToWork public profile frame"] },
    },
  ];
  const dualCls = classifyProspectDeterministic(dualBadgeHeadline, {
    linkedinUrl: "https://linkedin.com/in/dual",
  });
  assert.equal(dualCls.openToWorkDetection?.status, "public_signal_detected");
  assert.equal(dualCls.openToWorkDetection?.evidenceSource, "badge_metadata");
  assert.ok((dualCls.openToWorkDetection?.evidence ?? "").length < 80);
  assert.ok(/#opentowork|opentowork/i.test(dualCls.openToWorkDetection?.evidence ?? ""));
  assert.ok((dualCls.openToWorkDetection?.evidenceSupporting ?? "").includes("Open to Work"));

  const pranjali = classifyHeadline(
    "Frontend Developer (React.js · Next.js · TypeScript) · 40% Faster Page Loads · 2+ YOE · Immediate Joiner · Open to Full-time & Freelance",
    neutralPost
  );
  assert.equal(pranjali.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(pranjali.openToWorkDetection?.evidenceSource, "headline");
  assert.ok(pranjali.profileFlags.includes("job_search_signal"));
  assert.ok(pranjali.profileFlags.includes("open_to_work_text_signal"));
  assert.ok(
    pranjali.openToWorkDetection?.confidence != null &&
      pranjali.openToWorkDetection.confidence >= 0.74
  );
  assert.ok(pranjali.roleCategories.includes("frontend_engineer"));
  assert.ok(pranjali.roleCategories.includes("software_engineer"));
  assert.ok(!pranjali.roleCategories.includes("consultant"));
  assert.ok(pranjali.profileFlags.includes("freelance_signal"));

  const internOtw = classifyHeadline(
    "Cybersecurity-Focused Full Stack Developer | Building Secure Web Apps (AES-256, Web Security) | Open to Internship Opportunities",
    neutralPost
  );
  assert.equal(internOtw.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(internOtw.openToWorkDetection?.evidenceSource, "headline");
  assert.ok(/\binternship/i.test(internOtw.openToWorkDetection?.evidence ?? ""));
  assert.ok(
    internOtw.openToWorkDetection?.confidence != null &&
      internOtw.openToWorkDetection.confidence >= 0.7 &&
      internOtw.openToWorkDetection.confidence <= 0.82
  );
  assert.ok(internOtw.profileFlags.includes("job_seeker_signal"));

  const openSrc = classifyHeadline("Open Source Maintainer | React Contributor", neutralPost);
  assert.equal(openSrc.openToWorkDetection?.status, "not_observed");

  const roustabout = classifyHeadline(
    "Roustabout | Field Operations | Seeking Opportunities in Oil & Gas",
    neutralPost
  );
  assert.ok(roustabout.roleCategories.includes("field_operations"));
  assert.ok(roustabout.roleCategories.includes("job_seeker"));

  const hiringPostOnly = classifyHeadline(
    "Staff Engineer at Acme Corp",
    "We are hiring senior engineers — submit your CV today. Looking for candidates who love distributed systems."
  );
  assert.equal(hiringPostOnly.openToWorkDetection?.status, "not_observed");

  const layoffComment = classifyHeadline(
    "Principal Architect | Security",
    "Cloudflare announced layoffs again. Companies are cutting thousands of engineers this quarter."
  );
  assert.equal(layoffComment.openToWorkDetection?.status, "not_observed");

  const selfComment = classifyHeadline(
    "Engineer",
    "I was laid off last month and I am looking for my next role in backend engineering."
  );
  assert.equal(selfComment.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(selfComment.openToWorkDetection?.evidenceSource, "source_post_text");

  const qaOtw = classifyHeadline(
    "Quality Assurance Engineer | Open to Work | Immediate Joiner",
    neutralPost
  );
  assert.ok(qaOtw.roleCategories.includes("job_seeker"));
  assert.ok(qaOtw.roleCategories.includes("quality_engineering"));
  assert.ok(!qaOtw.roleCategories.includes("student"));
  assert.ok(!qaOtw.profileFlags.includes("student_signal"));

  const gtmOtw = classifyHeadline(
    "Partnerships & Ecosystem Growth | GTM Strategy | BD | Open to New Opportunities",
    neutralPost
  );
  assert.ok(gtmOtw.roleCategories.includes("job_seeker"));
  assert.ok(
    gtmOtw.roleCategories.includes("gtm_leader") || gtmOtw.functionTags.includes("go_to_market")
  );
  assert.ok(!gtmOtw.roleCategories.includes("student"));

  const seniorOpsOtw = classifyHeadline(
    "Senior Admin, Operations & Logistics Manager | Open to Work",
    neutralPost
  );
  assert.ok(seniorOpsOtw.roleCategories.includes("job_seeker"));
  assert.ok(!seniorOpsOtw.roleCategories.includes("student"));
  assert.ok(!seniorOpsOtw.profileFlags.includes("student_signal"));

  const mscsFs = classifyHeadline(
    "Full Stack Engineer | Spring Boot + Next.js | Scaling | Open to Work | MSCS @ University of Fairfax",
    neutralPost
  );
  assert.ok(mscsFs.roleCategories.includes("job_seeker"));
  assert.ok(mscsFs.roleCategories.includes("software_engineer"));
  assert.ok(mscsFs.roleCategories.includes("full_stack_engineer"));
  assert.equal(mscsFs.currentCompany, null);
  assert.ok(!mscsFs.currentTitle || !/^msc/i.test(mscsFs.currentTitle.trim()));
  assert.ok(mscsFs.educationInstitution?.toLowerCase().includes("fairfax"));
  assert.ok((mscsFs.educationArea ?? "").toLowerCase().includes("msc"));
  assert.ok(mscsFs.employmentConfidence < 0.52 || !mscsFs.currentCompany);

  const ceoOtwRoles = classifyHeadline(
    "CEO ChannelAI.TV - Open to AI GTM CMO Channel Marketing roles - Owner Largest Linkedin Group",
    neutralPost
  );
  assert.equal(ceoOtwRoles.openToWorkDetection?.status, "text_signal_detected");
  assert.equal(ceoOtwRoles.openToWorkDetection?.evidenceSource, "headline");
  assert.ok((ceoOtwRoles.openToWorkDetection?.evidence ?? "").toLowerCase().includes("open to"));
  assert.ok((ceoOtwRoles.openToWorkDetection?.evidence ?? "").toLowerCase().includes("roles"));
  assert.ok(ceoOtwRoles.profileFlags.includes("open_to_work_text_signal"));
  assert.ok(ceoOtwRoles.profileFlags.includes("job_search_signal"));

  const phpDev = classifyHeadline("PHP Developer | Backend APIs", neutralPost);
  assert.ok(phpDev.roleCategories.includes("software_engineer"));
  assert.ok(phpDev.functionTags.includes("php"));
  assert.ok((phpDev.safeProfessionalReference ?? "").toLowerCase().includes("php"));

  const aiTrain = classifyHeadline(
    "AI Trainer @ Prompt Anatomy | Analyzing Data with Python and SQL",
    neutralPost
  );
  assert.ok(aiTrain.roleCategories.includes("ai_trainer"));
  assert.ok(aiTrain.roleCategories.includes("educator"));
  assert.ok(
    aiTrain.functionTags.includes("analytics") || aiTrain.functionTags.includes("data_analysis")
  );

  const econNyu = classifyHeadline("Economics & CS @ NYU", neutralPost);
  assert.ok(econNyu.roleCategories.includes("student"));
  assert.equal(econNyu.currentTitle, null);
  assert.equal(econNyu.currentCompany, null);
  assert.ok((econNyu.educationInstitution ?? "").toLowerCase().includes("nyu"));

  const csUmd = classifyHeadline("CS + Statistics @ UMD", neutralPost);
  assert.ok(csUmd.roleCategories.includes("student"));
  assert.equal(csUmd.currentTitle, null);
  assert.ok((csUmd.educationInstitution ?? "").toLowerCase().includes("umd"));

  const pdeuLine = classifyHeadline("PDEU ICT'28 | Tech Enthusiast | AI & ML Learner", neutralPost);
  assert.ok(pdeuLine.roleCategories.includes("student"));
  assert.ok(pdeuLine.roleCategories.includes("ai_ml_practitioner"));

  const atScale = classifyHeadline("Helping Enterprises Secure Identities at Scale", neutralPost);
  assert.equal(atScale.currentCompany, null);
  assert.ok(
    atScale.roleCategories.includes("security_practitioner") ||
      atScale.functionTags.includes("identity_access")
  );

  const martinrea = classifyHeadline(
    "Supply Chain Operation Leader at Martinrea International 🔹 Expert in Strategic Sourcing",
    neutralPost
  );
  assert.ok((martinrea.currentCompany ?? "").toLowerCase().includes("martinrea"));
  assert.ok(!(martinrea.currentCompany ?? "").toLowerCase().includes("expert"));
  assert.ok(martinrea.roleCategories.includes("operations_leader"));
  assert.ok(martinrea.roleCategories.includes("supply_chain"));
  assert.ok((martinrea.safeProfessionalReference ?? "").toLowerCase().includes("supply chain"));

  const cooUpwind = classifyHeadline("COO @ Upwind", neutralPost);
  assert.ok(cooUpwind.roleCategories.includes("operations_leader"));
  assert.equal(cooUpwind.seniority, "c_level");
  assert.ok((cooUpwind.safeProfessionalReference ?? "").toLowerCase().includes("operating"));

  const retiredCro = classifyHeadline(
    "Retired Chief Revenue Officer (CRO) at Adlumin, Inc.",
    neutralPost
  );
  assert.ok(retiredCro.roleCategories.includes("revenue_leader"));
  assert.ok(retiredCro.profileFlags.includes("retired_signal"));
  assert.equal(retiredCro.currentTitle, null);
  assert.equal(retiredCro.currentCompany, null);
  assert.ok(retiredCro.employmentNeedsReview);
  assert.ok(retiredCro.profileFlags.includes("past_role_signal"));

  const remoteWorkEng = classifyHeadline(
    "Python Engineer at Remote Work & Cybersecurity Specialist",
    neutralPost
  );
  assert.ok(
    remoteWorkEng.employmentNeedsReview ||
      !remoteWorkEng.currentCompany?.trim() ||
      remoteWorkEng.employmentConfidence < 0.55
  );

  const biDev = classifyHeadline(
    "BI Developer | Power BI, SQL, Python | Architecting End-to-End Data Models & Automated ETL Pipelines",
    neutralPost
  );
  assert.ok(biDev.roleCategories.includes("bi_developer"));
  assert.ok(biDev.functionTags.includes("power_bi"));

  const itSvcPresident = classifyHeadline(
    "President, CMIT Solutions of Glendale | Helping Law Firms & Healthcare Groups Reduce Downtime | Ex-Datadog",
    neutralPost
  );
  assert.ok(itSvcPresident.roleCategories.includes("security_practitioner"));
  assert.ok(itSvcPresident.functionTags.includes("cybersecurity"));
  assert.ok(itSvcPresident.profileFlags.includes("ex_company_signal"));
  assert.ok((itSvcPresident.safeProfessionalReference ?? "").toLowerCase().includes("it services"));

  const exCsoZscaler = classifyHeadline("Ex- Chief Strategy Officer at Zscaler Inc.", neutralPost);
  assert.equal(exCsoZscaler.currentTitle, null);
  assert.equal(exCsoZscaler.currentCompany, null);
  assert.ok(exCsoZscaler.employmentConfidence === 0);
  assert.ok((exCsoZscaler.pastTitle ?? "").toLowerCase().includes("chief strategy"));
  assert.ok((exCsoZscaler.pastCompany ?? "").toLowerCase().includes("zscaler"));
  assert.ok(exCsoZscaler.roleCategories.includes("executive_leader"));
  assert.ok(exCsoZscaler.roleCategories.includes("strategy_leader"));
  assert.ok(exCsoZscaler.profileFlags.includes("past_role_signal"));

  const incomingAws = classifyHeadline("Incoming @ AWS", neutralPost);
  assert.ok(
    incomingAws.roleCategories.includes("early_career") ||
      incomingAws.roleCategories.includes("intern_or_student")
  );
  assert.equal(incomingAws.currentTitle, null);
  assert.ok((incomingAws.currentCompany ?? "").toLowerCase().includes("aws"));
  assert.ok(incomingAws.needsReview);

  const penTest = classifyHeadline("Penetration Tester | Red Teamer | ECPPTV3", neutralPost);
  assert.ok(penTest.roleCategories.includes("security_practitioner"));
  assert.ok(penTest.functionTags.includes("penetration_testing"));
  assert.ok((penTest.safeProfessionalReference ?? "").toLowerCase().includes("offensive security"));

  const productBuilderCs = classifyHeadline(
    "Product Builder | Bridging product thinking and hands-on development | CS @ Reichman",
    neutralPost
  );
  assert.equal(productBuilderCs.currentTitle, null);
  assert.equal(productBuilderCs.currentCompany, null);
  assert.ok(productBuilderCs.employmentConfidence === 0);
  assert.ok((productBuilderCs.educationArea ?? "").toLowerCase().includes("cs"));
  assert.ok((productBuilderCs.educationInstitution ?? "").toLowerCase().includes("reichman"));
  assert.ok(productBuilderCs.roleCategories.includes("student"));
  assert.ok(productBuilderCs.roleCategories.includes("product_builder"));
  assert.ok(productBuilderCs.roleCategories.includes("software_engineer"));
  assert.ok(productBuilderCs.functionTags.includes("computer_science"));
  assert.ok(
    (productBuilderCs.safeProfessionalReference ?? "").toLowerCase().includes("product-building")
  );
  assert.ok(productBuilderCs.profileFlags.includes("education_signal"));
  assert.equal(productBuilderCs.needsReview, false);

  const dataMlOps = classifyHeadline("Data | Analytical Eng | Data Ops | LLM/ML Ops", neutralPost);
  assert.ok(dataMlOps.roleCategories.includes("data_engineer"));
  assert.ok(dataMlOps.roleCategories.includes("analytics_engineer"));
  assert.ok(dataMlOps.roleCategories.includes("mlops_engineer"));
  assert.ok(dataMlOps.functionTags.includes("analytics_engineering"));
  assert.ok(dataMlOps.functionTags.includes("data_ops"));

  const genaiHealth = classifyHeadline(
    "GenAI - Oracle Health and Life-sciences | Ex-AWS",
    neutralPost
  );
  assert.ok(genaiHealth.roleCategories.includes("healthtech"));
  assert.ok(genaiHealth.roleCategories.includes("ai_practitioner"));
  assert.ok(genaiHealth.functionTags.includes("genai"));
  assert.ok(genaiHealth.functionTags.includes("life_sciences"));

  const msCsUb = classifyHeadline(
    "AI Engineer | Open Source Contributor | Software Engineer | MS CS @ UB",
    neutralPost
  );
  assert.equal(msCsUb.currentTitle, null);
  assert.equal(msCsUb.currentCompany, null);
  assert.ok(msCsUb.employmentConfidence === 0);
  assert.ok((msCsUb.educationInstitution ?? "").toLowerCase().includes("ub"));
  assert.ok(msCsUb.roleCategories.includes("ai_engineer"));
  assert.ok(msCsUb.roleCategories.includes("software_engineer"));
  assert.ok(!msCsUb.roleCategories.includes("student"));
  assert.ok((msCsUb.safeProfessionalReference ?? "").toLowerCase().includes("ai and software"));

  const bachelorTelkom = classifyHeadline(
    "ALP'26 | McKinsey Forward'26 | Bachelor of Computer Science at Telkom University",
    neutralPost
  );
  assert.ok(bachelorTelkom.roleCategories.includes("student"));
  assert.ok(!bachelorTelkom.roleCategories.includes("academic"));
  assert.equal(bachelorTelkom.currentTitle, null);
  assert.equal(bachelorTelkom.currentCompany, null);
  assert.ok(
    (bachelorTelkom.safeProfessionalReference ?? "").toLowerCase().includes("computer science")
  );

  const btechCodechef = classifyHeadline(
    "B.Tech CSE'28 | Member @CodeChef-BV chapter | Top 25%ile @IITG Summer Analytics | Mentee @Codess.Cafe | Ex-Mentee @Microsoft CWB",
    neutralPost
  );
  assert.ok(btechCodechef.roleCategories.includes("student"));
  assert.ok(btechCodechef.roleCategories.includes("software_engineer"));
  assert.ok(btechCodechef.roleCategories.includes("data_practitioner"));
  assert.ok(!btechCodechef.roleCategories.includes("academic"));
  assert.equal(btechCodechef.currentTitle, null);
  assert.equal(btechCodechef.currentCompany, null);

  const stylizedIt = classifyHeadline(
    "Sᴇɴɪᴏʀ IT Mᴀɴᴀɢᴇʀ • Cʏʙᴇʀꜱᴇᴄᴜʀɪᴛʏ Pᴀꜱꜱɪᴏɴᴀᴛᴇ • Oᴋᴛᴀ Cᴇʀᴛɪꜰɪᴇᴅ Pʀᴏꜰᴇꜱꜱɪᴏɴᴀʟ",
    neutralPost
  );
  assert.ok(stylizedIt.roleCategories.includes("it_operations"));
  assert.ok(stylizedIt.roleCategories.includes("security_practitioner"));
  assert.ok(stylizedIt.functionTags.includes("okta"));
  assert.ok(
    (stylizedIt.safeProfessionalReference ?? "").toLowerCase().includes("it and cybersecurity")
  );

  const rvpHashi = classifyHeadline("RVP, UKI HashiCorp an IBM Company", neutralPost);
  assert.ok(rvpHashi.roleCategories.includes("sales_leader"));
  assert.ok(rvpHashi.roleCategories.includes("regional_leader"));
  assert.ok((rvpHashi.currentCompany ?? "").toLowerCase().includes("hashicorp"));
  assert.ok((rvpHashi.safeProfessionalReference ?? "").toLowerCase().includes("regional sales"));

  const formerlyPartner = classifyHeadline(
    "Formerly Partner @ NEA | Early Stage Investor in Category Creating Companies",
    neutralPost
  );
  assert.equal(formerlyPartner.currentTitle, null);
  assert.equal(formerlyPartner.currentCompany, null);
  assert.ok((formerlyPartner.pastTitle ?? "").toLowerCase().includes("partner"));
  assert.ok(formerlyPartner.roleCategories.includes("investor"));

  const identityAtScale = classifyHeadline(
    "Enterprise, Cloud & Workload Identity at Scale",
    neutralPost
  );
  assert.equal(identityAtScale.currentCompany, null);
  assert.ok(
    identityAtScale.roleCategories.includes("security_practitioner") ||
      identityAtScale.roleCategories.includes("security_leader")
  );

  const dualHatItStudent = classifyHeadline(
    "End User Services @ The Hartford | Freshman Cybersecurity Major @ WNE",
    neutralPost
  );
  assert.ok((dualHatItStudent.currentCompany ?? "").toLowerCase().includes("hartford"));
  assert.ok(dualHatItStudent.roleCategories.includes("student"));
  assert.ok(dualHatItStudent.roleCategories.includes("it_operations"));
  assert.ok(dualHatItStudent.roleCategories.includes("security_practitioner"));

  const dwhAnalyst = classifyHeadline(
    "DWH & BI Data Analyst at Zakat, Tax and Customs Authority | Data Analyst | Business Intelligence",
    neutralPost
  );
  assert.ok(dwhAnalyst.roleCategories.includes("data_practitioner"));
  assert.ok(dwhAnalyst.roleCategories.includes("bi_developer"));

  const vpProduct = classifyHeadline("VP Product at Adyen", neutralPost);
  assert.ok(vpProduct.roleCategories.includes("product_leader"));
  assert.equal(vpProduct.seniority, "vp");

  const formerEmployers = extractTitleCompanyFromHeadline(
    "VP, Head of Channels & Alliances, Europe at Acme Corp. Former Beta Co, Gamma LLC, Delta Inc executive."
  );
  assert.equal(formerEmployers?.company, "Acme Corp");
  const formerParsed = parseHeadlineEmploymentAndEducation(
    "VP, Head of Channels & Alliances, Europe at Acme Corp. Former Beta Co, Gamma LLC, Delta Inc executive."
  );
  assert.ok((formerParsed.pastEmployment?.company ?? "").includes("Beta Co"));

  const prevAt = parseHeadlineEmploymentAndEducation("CS @ State University | Prev @ OtherCo");
  assert.ok((prevAt.pastEmployment?.company ?? "").toLowerCase().includes("otherco"));

  const founderNoisePost =
    "This founder is building a startup product every day. Great discussion.";
  const productMarketingIndeed = classifyHeadline(
    "Product Marketing Lead @ Indeed | Go-To-Market Launches for Enterprise, Ads & AI Products",
    founderNoisePost
  );
  assert.ok(!productMarketingIndeed.roleCategories.includes("founder"));
  assert.ok(!productMarketingIndeed.profileFlags.includes("founder_signal"));

  const ventureInv = classifyHeadline("Venture Investor", neutralPost);
  assert.ok(ventureInv.roleCategories.includes("investor"));
  assert.ok(ventureInv.roleCategories.includes("venture_capital"));
  assert.ok(!ventureInv.roleCategories.includes("founder"));

  const pressWhizz = parseHeadlineEmploymentAndEducation(
    "Partner and advisor at PressWhizz.com. Previously co-founder of SleepAdvisor.org (acq)."
  );
  assert.ok((pressWhizz.primaryEmployment?.company ?? "").toLowerCase().includes("presswhizz"));
  assert.ok((pressWhizz.pastEmployment?.title ?? "").toLowerCase().includes("founder"));
  assert.ok((pressWhizz.pastEmployment?.company ?? "").toLowerCase().includes("sleepadvisor"));

  const kennesaw = classifyHeadline(
    "Senior at Kennesaw State University | Major- Information Systems | Minor-Information Security",
    neutralPost
  );
  assert.equal(kennesaw.currentTitle, null);
  assert.equal(kennesaw.currentCompany, null);
  assert.ok((kennesaw.educationInstitution ?? "").toLowerCase().includes("kennesaw"));
  assert.ok(kennesaw.roleCategories.includes("student"));
  assert.ok(kennesaw.roleCategories.includes("security_practitioner"));
  assert.ok(kennesaw.profileFlags.includes("early_career_signal"));
  assert.equal(kennesaw.employmentConfidence, 0);

  const soloEngineering = classifyHeadline("Engineering", neutralPost);
  assert.ok(soloEngineering.needsReview);
  assert.ok(soloEngineering.profileFlags.includes("weak_evidence"));
  assert.ok(!soloEngineering.profileFlags.includes("founder_signal"));

  const nvidiaTa = classifyHeadline("Talent Acquisition - NVIDIA Networking", neutralPost);
  assert.ok(nvidiaTa.roleCategories.includes("technical_recruiter"));
  assert.ok(!nvidiaTa.profileFlags.includes("founder_signal"));

  const degreeTechStack = classifyHeadline(
    "GoLang && Java || Docker && Kubernetes || MCA @ Example Institute of Technology 2020",
    neutralPost
  );
  assert.equal(degreeTechStack.currentTitle, null);
  assert.equal(degreeTechStack.currentCompany, null);
  assert.ok(degreeTechStack.roleCategories.includes("software_engineer"));

  const founderComma = classifyHeadline(
    "Founder, Example Labs | AI & Security Principal Architect",
    neutralPost
  );
  assert.ok(founderComma.roleCategories.includes("founder"));
  assert.ok(founderComma.profileFlags.includes("founder_signal"));

  const founderProductPipe = classifyHeadline("Founder | Product Leader | Creative | Builder", neutralPost);
  assert.ok(founderProductPipe.roleCategories.includes("founder"));
  assert.ok(founderProductPipe.roleCategories.includes("product_leader"));

  const cofounderCro = classifyHeadline("Co-Founder/CRO @ ExampleCo | Revenue", neutralPost);
  assert.ok(cofounderCro.roleCategories.includes("founder"));
  assert.ok(cofounderCro.roleCategories.includes("revenue_leader"));

  const ceoCofounderOkta = classifyHeadline("CEO & Co-Founder at Okta", neutralPost);
  assert.ok(ceoCofounderOkta.roleCategories.includes("founder"));
  assert.ok(ceoCofounderOkta.roleCategories.includes("executive_leader"));

  const partnerDeloitte = parseHeadlineEmploymentAndEducation(
    "Partner at Deloitte, Founder Chairman - ICAI - Los Angeles Chapter"
  );
  assert.equal(partnerDeloitte.primaryEmployment?.title, "Partner");
  assert.equal(partnerDeloitte.primaryEmployment?.company, "Deloitte");
  assert.ok(
    partnerDeloitte.affiliations.some((a) => /founder\s+chairman/i.test(a))
  );

  const partnerDeloitteClass = classifyHeadline(
    "Partner at Deloitte, Founder Chairman - ICAI - Los Angeles Chapter",
    neutralPost
  );
  assert.ok(partnerDeloitteClass.roleCategories.includes("consultant"));
  assert.equal(partnerDeloitteClass.currentCompany, "Deloitte");

  const openRelocation = classifyHeadline(
    "Principal .NET & Cloud Engineer | Azure | Open to Relocation",
    neutralPost
  );
  assert.equal(openRelocation.openToWorkDetection?.status, "not_observed");

  const openSourceMs = classifyHeadline(
    "AI Engineer | Open Source Contributor | Software Engineer | MS CS @ UB",
    neutralPost
  );
  assert.equal(openSourceMs.openToWorkDetection?.status, "not_observed");

  const nflAgent = classifyHeadline(
    "NFL Agent | Silicon Valley Business Journal 40 Under 40 Honoree",
    neutralPost
  );
  assert.ok(!nflAgent.functionTags.includes("ai_ml"));
  assert.ok(nflAgent.roleCategories.includes("unknown"));

  const aiAgentsBiz = classifyHeadline(
    "I homeschool my daughter. And AI agents. | 30 years of Systems and Business Expertise | Raising Agents for Business",
    neutralPost
  );
  assert.ok(aiAgentsBiz.roleCategories.includes("ai_practitioner"));
  assert.ok(aiAgentsBiz.roleCategories.includes("consultant"));
  assert.equal(aiAgentsBiz.safeProfessionalReference, "your AI agents and business systems work");

  const qualityMgr = classifyHeadline(
    "Quality Manager, Calidad proceso, Six Sigma Green Belt, Consultor.",
    neutralPost
  );
  assert.ok(qualityMgr.roleCategories.includes("quality_engineering"));
  assert.ok(
    qualityMgr.safeProfessionalReference?.includes("quality management") ||
      qualityMgr.safeProfessionalReference?.includes("process improvement")
  );

  const productInnovation = classifyHeadline(
    "Product & Innovation Lead | Building Scalable, Customer-First Platforms",
    neutralPost
  );
  assert.ok(productInnovation.roleCategories.includes("product_leader"));
  assert.equal(productInnovation.safeProfessionalReference, "your product and innovation leadership");

  const crm = classifyHeadline(
    "High-Tech Customer Relationship Manager At Leumi Tech",
    neutralPost
  );
  assert.ok(!crm.roleCategories.includes("unknown"));
  assert.ok(crm.roleCategories.includes("customer_success_leader"));
  assert.equal(
    crm.safeProfessionalReference,
    "your high-tech customer relationship management work"
  );

  const dataStrategist = classifyHeadline(
    "Lead Strategist, Data and Innovation @ VML | WPP",
    neutralPost
  );
  assert.ok(!dataStrategist.roleCategories.includes("unknown"));
  assert.ok(dataStrategist.roleCategories.includes("strategy_leader"));
  assert.equal(dataStrategist.safeProfessionalReference, "your data and innovation strategy work");

  const vpPayments = classifyHeadline("VP/GM, Payments at Google", neutralPost);
  assert.ok(!vpPayments.roleCategories.includes("unknown"));
  assert.ok(vpPayments.roleCategories.includes("executive_leader"));
  assert.equal(vpPayments.safeProfessionalReference, "your payments leadership work");

  const weakHeadline = classifyHeadline("Do you love Tofu? Me too!", neutralPost);
  assert.equal(weakHeadline.safeProfessionalReference, "your perspective shared on the thread");

  const sloganHeadline = classifyHeadline(
    "Slowing down and starting to read the code!",
    neutralPost
  );
  assert.equal(sloganHeadline.safeProfessionalReference, "your perspective shared on the thread");
  assert.ok(!sloganHeadline.safeProfessionalReference?.includes("slowing down"));

  const vaguePipe = classifyHeadline("Leadership| Motivational", neutralPost);
  assert.equal(vaguePipe.safeProfessionalReference, "your perspective shared on the thread");

  const blankHeadline = classifyHeadline("--", neutralPost);
  assert.equal(blankHeadline.safeProfessionalReference, "your perspective shared on the thread");

  const starsHeadline = classifyHeadline("*****", neutralPost);
  assert.equal(starsHeadline.safeProfessionalReference, "your perspective shared on the thread");

  const techLeadPlatforms = classifyHeadline(
    "Tech Lead | AI Platforms, Distributed Systems & Product Engineering | HubSpot",
    neutralPost
  );
  assert.notEqual(
    techLeadPlatforms.safeProfessionalReference,
    "your perspective shared on the thread"
  );
  assert.ok(
    (techLeadPlatforms.safeProfessionalReference ?? "").includes("AI platform") ||
      (techLeadPlatforms.safeProfessionalReference ?? "").includes("distributed systems")
  );

  const cisoInfra = classifyHeadline(
    "CISO | Cloud Security & Infrastructure Leadership",
    neutralPost
  );
  assert.notEqual(cisoInfra.safeProfessionalReference, "your perspective shared on the thread");
  assert.ok((cisoInfra.safeProfessionalReference ?? "").toLowerCase().includes("security"));

  const agentSec = classifyHeadline(
    "Founder | Agent Security Posture Management (ASPM) | AI Security",
    neutralPost
  );
  assert.notEqual(agentSec.safeProfessionalReference, "your perspective shared on the thread");
  assert.ok((agentSec.safeProfessionalReference ?? "").toLowerCase().includes("agent security"));

  const cyberFounder = classifyHeadline(
    "Founder, CyberSecAI Ltd | AI & Cyber Security Principal Architect | IETF | OWASP | SC Cleared | Fintech | AI Security Researcher",
    neutralPost
  );
  assert.ok(
    (cyberFounder.safeProfessionalReference ?? "").includes("AI cybersecurity founder") ||
      (cyberFounder.safeProfessionalReference ?? "").includes("cybersecurity founder")
  );
  assert.ok(!(cyberFounder.safeProfessionalReference ?? "").includes("founder/operator"));

  const owaspPhd = classifyHeadline(
    "Ph.D. in Information Security | OWASP PwnzzAI Project Lead",
    neutralPost
  );
  assert.ok((owaspPhd.safeProfessionalReference ?? "").toLowerCase().includes("owasp"));

  const laravelAi = classifyHeadline(
    "Senior Software Engineer · Laravel & Shopify Architect · AI-Augmented Systems",
    neutralPost
  );
  assert.ok((laravelAi.safeProfessionalReference ?? "").toLowerCase().includes("ai-augmented"));

  const execSupport = classifyHeadline(
    "Founder & Principal | TSS Executive Support Execution Infrastructure for Leaders",
    neutralPost
  );
  assert.ok((execSupport.safeProfessionalReference ?? "").toLowerCase().includes("executive support"));

  const gtmOpenAi = classifyHeadline("GTM Leadership at OpenAI", neutralPost);
  assert.equal(gtmOpenAi.safeProfessionalReference, "your GTM leadership work");

  const gtmVega = classifyHeadline("GTM - Vega", neutralPost);
  assert.equal(gtmVega.safeProfessionalReference, "your GTM work");

  const successGuide = classifyHeadline("Senior Success Guide @ Salesforce", neutralPost);
  assert.equal(successGuide.safeProfessionalReference, "your customer success work");

  const gtmPartnerships = classifyHeadline(
    "Enterprise Browser // GTM // Partnerships",
    neutralPost
  );
  assert.equal(gtmPartnerships.safeProfessionalReference, "your GTM and partnerships work");

  const aeBarracuda = classifyHeadline("Account Executive at Barracuda Networks", neutralPost);
  assert.equal(aeBarracuda.safeProfessionalReference, "your enterprise sales work");

  const aeServiceNow = classifyHeadline(
    "Senior Enterprise Account Executive @ ServiceNow",
    neutralPost
  );
  assert.equal(aeServiceNow.safeProfessionalReference, "your enterprise sales work");

  const techAssociate = classifyHeadline(
    "Senior Associate Technology at Synechron Technologies Pvt. Ltd",
    neutralPost
  );
  assert.equal(techAssociate.safeProfessionalReference, "your technology consulting work");

  const machineVision = classifyHeadline(
    "Industrial Machine Vision Specialist | HALCON MVtec | Vision System Integration | Smart Factory & Automation",
    neutralPost
  );
  assert.equal(
    machineVision.safeProfessionalReference,
    "your industrial automation and machine vision work"
  );

  const studentEsprit = classifyHeadline(
    "Student at Ecole Supérieure Privée d'Ingénierie et de Technologies - ESPRIT",
    neutralPost
  );
  assert.equal(studentEsprit.safeProfessionalReference, "your engineering studies");

  const itSecurityCerts = classifyHeadline("IT Security | CSCUv3 | CTIA | CEHv12", neutralPost);
  assert.equal(itSecurityCerts.safeProfessionalReference, "your IT security work");

  console.log("classify tests: ok");
}

run();
