import assert from "node:assert/strict";
import test from "node:test";

import {
  fieldHasPlaceholderLeakage,
  formatEmploymentRolesForCsv,
  isPlaceholderEmploymentValue,
  sanitizeProfileExperienceRoles,
  sanitizeResolvedProspectEmployment,
} from "./sanitize-employment-placeholders";
import { resolveProspectEmployment } from "./resolve-employment";

test("isPlaceholderEmploymentValue detects template strings", () => {
  assert.equal(isPlaceholderEmploymentValue("Current Company Name"), true);
  assert.equal(isPlaceholderEmploymentValue("Previous Company 1"), true);
  assert.equal(isPlaceholderEmploymentValue("Current Job Title"), true);
  assert.equal(isPlaceholderEmploymentValue("null"), true);
  assert.equal(isPlaceholderEmploymentValue("HubSpot"), false);
});

test("sanitizeProfileExperienceRoles drops placeholder items", () => {
  const { roles, rejectedCount } = sanitizeProfileExperienceRoles([
    { title: "DevOps Engineer", company: "Current Company Name", isCurrent: true },
    { title: "Current Job Title", company: "Current Company Name", isCurrent: true },
    { title: "Engineer", company: "Acme Corp", isCurrent: false },
  ]);
  assert.equal(rejectedCount, 1);
  assert.equal(roles.length, 2);
  assert.equal(roles.some((r) => r.company === "Acme Corp"), true);
  assert.equal(roles.find((r) => r.title === "DevOps Engineer")?.company, "");
});

test("resolve + sanitize clears placeholder profile_experience company", () => {
  const raw = resolveProspectEmployment({
    experienceRoles: [
      { title: "DevOps Engineer", company: "Current Company Name", isCurrent: true },
    ],
    structuredProfile: null,
    headlineEmployment: null,
    headlineAmbiguous: true,
  });
  const sanitized = sanitizeResolvedProspectEmployment(raw, {
    validProfileExperienceInputCount: 0,
    rawProfileExperienceInputCount: 1,
    rejectedPlaceholderItemCount: 1,
  });
  assert.equal(sanitized.currentCompany, null);
  assert.equal(sanitized.employmentSource, "unknown");
  assert.equal(sanitized.employmentNeedsReview, true);
  assert.ok(sanitized.employmentConfidence <= 0.35);
});

test("formatEmploymentRolesForCsv omits @ null", () => {
  const s = formatEmploymentRolesForCsv([
    { title: "Senior Executive Assistant", company: "null" },
    { title: "Engineer", company: "Real Co" },
  ]);
  assert.ok(s.includes("Engineer @ Real Co"));
  assert.ok(s.includes("Senior Executive Assistant"));
  assert.ok(!s.includes("@ null"));
});

test("fieldHasPlaceholderLeakage on role strings", () => {
  assert.equal(fieldHasPlaceholderLeakage("null @ null"), true);
  assert.equal(fieldHasPlaceholderLeakage("Title @ null"), true);
  assert.equal(fieldHasPlaceholderLeakage("Previous Job Title @ Previous Company 1"), true);
});
