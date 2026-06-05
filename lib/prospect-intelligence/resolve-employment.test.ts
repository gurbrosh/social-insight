/**
 * Run: npx tsx lib/prospect-intelligence/resolve-employment.test.ts
 */
import assert from "node:assert/strict";
import { resolveProspectEmployment } from "./resolve-employment";

function run() {
  const single = resolveProspectEmployment({
    experienceRoles: [
      {
        title: "VP Engineering",
        company: "Acme Security",
        dateRange: "2022 - Present",
        isCurrent: true,
      },
    ],
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: true,
  });
  assert.equal(single.employmentSource, "profile_experience");
  assert.equal(single.currentTitle, "VP Engineering");
  assert.equal(single.currentCompany, "Acme Security");

  const multi = resolveProspectEmployment({
    experienceRoles: [
      { title: "Advisor", company: "Collective", isCurrent: true },
      { title: "Co-Founder & CEO", company: "Platform Co", isCurrent: true },
    ],
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: false,
  });
  assert.equal(multi.currentCompany, "Platform Co");
  assert.ok(multi.profileFlags.includes("multiple_current_roles"));
  assert.ok(multi.currentRoles.length >= 2);

  const pastOnly = resolveProspectEmployment({
    experienceRoles: [
      { title: "Director", company: "BigCo", endDate: "2023-01", isCurrent: false },
      { title: "Head of Product", company: "Growth Inc", isCurrent: true },
    ],
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: false,
  });
  assert.equal(pastOnly.currentCompany, "Growth Inc");
  assert.equal(pastOnly.pastCompany, "BigCo");

  const headline = resolveProspectEmployment({
    experienceRoles: [],
    structuredProfile: null,
    headlineEmployment: {
      title: "Senior Data Engineer",
      company: "Example Labs",
      confidence: 0.65,
    },
    headlineAmbiguous: false,
  });
  assert.equal(headline.employmentSource, "headline");

  const headlineBlocked = resolveProspectEmployment({
    experienceRoles: [
      { title: "Product Manager", company: "Acme", isCurrent: true },
    ],
    structuredProfile: { title: "Wrong", company: "Other" },
    headlineEmployment: { title: "Headline Title", company: "Headline Co", confidence: 0.7 },
    headlineAmbiguous: false,
    headlineEmploymentCandidate: { title: "Headline Title", company: "Headline Co" },
  });
  assert.equal(headlineBlocked.employmentSource, "profile_experience");
  assert.equal(headlineBlocked.currentTitle, "Product Manager");
  assert.equal(headlineBlocked.headlineEmploymentCandidateTitle, "Headline Title");

  const pastOnlyNoActive = resolveProspectEmployment({
    experienceRoles: [
      { title: "MS CS", company: "State University", isCurrent: true },
      { title: "Engineer", company: "Tech Corp", endDate: "2024", isCurrent: false },
    ],
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: false,
  });
  assert.equal(pastOnlyNoActive.employmentSource, "profile_experience");
  assert.equal(pastOnlyNoActive.currentTitle, null);
  assert.equal(pastOnlyNoActive.pastTitle, "Engineer");

  console.log("resolve-employment tests: ok");
}

run();
