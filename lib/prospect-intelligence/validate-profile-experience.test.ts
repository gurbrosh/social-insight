import assert from "node:assert/strict";
import test from "node:test";

import {
  companyDerivedOnlyFromHeadlineTopics,
  companyLooksLikeCredentialOrCommunity,
  isFabricatedOrGenericCompany,
  isSparseNonEmploymentHeadline,
  titleLooksLikeAffiliation,
  validateProfileExperienceRoles,
} from "./validate-profile-experience";

test("rejects fabricated company names", () => {
  assert.equal(isFabricatedOrGenericCompany("Tech Innovations Inc."), true);
  assert.equal(isFabricatedOrGenericCompany("XYZ Corp"), true);
  assert.equal(isFabricatedOrGenericCompany("HubSpot"), false);
});

test("rejects model_generated_from_headline for profile_experience", () => {
  const { roles, rejectedCount } = validateProfileExperienceRoles(
    [
      {
        title: "Senior Software Engineer",
        company: "Tech Innovations Inc.",
        isCurrent: true,
        experienceItemSource: "model_generated_from_headline",
      },
    ],
    { headline: "Slowing down and starting to read the code!", analysisMethod: "openai_url" }
  );
  assert.equal(roles.length, 0);
  assert.equal(rejectedCount, 1);
});

test("rejects headline pipe topic as employer", () => {
  const headline = "AI Engineer | RAG · Agentic Systems · LLM Integration · Azure AI";
  const { roles } = validateProfileExperienceRoles(
    [
      {
        title: "AI Engineer",
        company: "Agentic Systems",
        experienceItemSource: "validation_profile_experience_text",
        evidenceExcerpt: "Experience section: AI Engineer at Agentic Systems 2022-present",
      },
    ],
    { headline, analysisMethod: "browser" }
  );
  assert.equal(roles.length, 0);
  assert.equal(
    companyDerivedOnlyFromHeadlineTopics("Agentic Systems", "AI Engineer", headline),
    true
  );
});

test("rejects openai_url stored roles via analysisMethod", () => {
  const { roles } = validateProfileExperienceRoles(
    [
      {
        title: "AI Engineer",
        company: "OpenAI",
        experienceItemSource: "public_profile_html",
      },
    ],
    {
      headline: "AI Engineer | Open Source Contributor | Software Engineer | MS CS @ UB",
      analysisMethod: "openai_url",
    }
  );
  assert.equal(roles.length, 0);
});

test("rejects affiliation titles", () => {
  const { roles } = validateProfileExperienceRoles(
    [
      {
        title: "Member of Credly Elite Earners Network",
        company: "Credly",
        experienceItemSource: "validation_profile_experience_text",
        evidenceExcerpt: "Member of Credly Elite Earners Network",
      },
    ],
    { headline: "Credly Elite Earners Network", analysisMethod: "browser" }
  );
  assert.equal(roles.length, 0);
  assert.equal(titleLooksLikeAffiliation("Member of Credly Elite Earners Network"), true);
});

test("rejects credential program as company", () => {
  assert.equal(companyLooksLikeCredentialOrCommunity("CyberPro+", "SOC Analyst"), true);
});

test("isSparseNonEmploymentHeadline", () => {
  assert.equal(isSparseNonEmploymentHeadline("--"), true);
  assert.equal(isSparseNonEmploymentHeadline("Engineering"), true);
  assert.equal(isSparseNonEmploymentHeadline("VP Engineering at Acme Corp"), false);
});
