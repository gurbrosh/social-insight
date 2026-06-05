import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyProspectDeterministic } from "../classify";
import { gatherProspectEvidence } from "../gather-evidence";
import type { ProspectClassification } from "../types";
import { FUNCTION_TAG_VALUES, ROLE_CATEGORY_VALUES } from "../types";
import type { GoldenExpect, GoldenFixture, GoldenSuiteFile } from "./golden-types";

const roleSet = new Set<string>(ROLE_CATEGORY_VALUES);
const functionTagSet = new Set<string>(FUNCTION_TAG_VALUES);

function assertExpect(fx: GoldenFixture, c: ProspectClassification): string | null {
  const e: GoldenExpect = fx.expect;
  const rc = c.roleCategories;
  const pf = c.profileFlags;
  const ft = c.functionTags;
  const errs: string[] = [];
  const fail = (msg: string) => errs.push(msg);

  for (const x of e.roleCategoriesIncludes ?? []) {
    if (!roleSet.has(x)) fail(`Invalid role category in fixture ${fx.id}: ${x}`);
    else if (!rc.includes(x as ProspectClassification["roleCategories"][number]))
      fail(`role_categories must include ${x}`);
  }
  const anyOf = e.roleCategoriesIncludesAnyOf;
  if (anyOf?.length) {
    for (const k of anyOf) {
      if (!roleSet.has(k)) fail(`Invalid role category in fixture ${fx.id} (includesAnyOf): ${k}`);
    }
    const ok = anyOf.some((k) =>
      rc.includes(k as ProspectClassification["roleCategories"][number])
    );
    if (!ok) fail(`role_categories must include at least one of: ${anyOf.join(", ")}`);
  }
  for (const x of e.roleCategoriesExcludes ?? []) {
    if (rc.includes(x as ProspectClassification["roleCategories"][number]))
      fail(`role_categories must not include ${x}`);
  }
  for (const x of e.profileFlagsIncludes ?? []) {
    if (!pf.includes(x as ProspectClassification["profileFlags"][number]))
      fail(`profile_flags must include ${x}`);
  }
  const pfAny = e.profileFlagsIncludesAnyOf;
  if (pfAny?.length) {
    const ok = pfAny.some((f) => pf.includes(f as ProspectClassification["profileFlags"][number]));
    if (!ok) fail(`profile_flags must include at least one of: ${pfAny.join(", ")}`);
  }
  for (const x of e.profileFlagsExcludes ?? []) {
    if (pf.includes(x as ProspectClassification["profileFlags"][number]))
      fail(`profile_flags must not include ${x}`);
  }
  for (const x of e.functionTagsIncludes ?? []) {
    if (!functionTagSet.has(x)) fail(`Invalid function tag in fixture ${fx.id}: ${x}`);
    else if (!ft.includes(x as ProspectClassification["functionTags"][number]))
      fail(`function_tags must include ${x}`);
  }
  const ftAny = e.functionTagsIncludesAnyOf;
  if (ftAny?.length) {
    for (const t of ftAny) {
      if (!functionTagSet.has(t))
        fail(`Invalid function tag in fixture ${fx.id} (includesAnyOf): ${t}`);
    }
    const ok = ftAny.some((t) => ft.includes(t as ProspectClassification["functionTags"][number]));
    if (!ok) fail(`function_tags must include at least one of: ${ftAny.join(", ")}`);
  }
  for (const x of e.functionTagsExcludes ?? []) {
    if (ft.includes(x as ProspectClassification["functionTags"][number]))
      fail(`function_tags must not include ${x}`);
  }
  if (e.openToWorkStatus !== undefined && c.openToWorkDetection?.status !== e.openToWorkStatus) {
    fail(
      `openToWorkDetection.status expected ${e.openToWorkStatus}, got ${c.openToWorkDetection?.status ?? "undefined"}`
    );
  }
  if (
    e.openToWorkEvidenceSource !== undefined &&
    c.openToWorkDetection?.evidenceSource !== e.openToWorkEvidenceSource
  ) {
    fail(
      `openToWorkDetection.evidenceSource expected ${e.openToWorkEvidenceSource}, got ${c.openToWorkDetection?.evidenceSource ?? "undefined"}`
    );
  }
  if (e.currentTitleIsNull && (c.currentTitle ?? "").trim()) {
    fail("current_title should be null/empty");
  }
  if (e.currentTitleEquals !== undefined && (c.currentTitle ?? null) !== e.currentTitleEquals) {
    fail(`current_title equals: expected ${e.currentTitleEquals}, got ${c.currentTitle ?? null}`);
  }
  if (e.currentTitleContains !== undefined) {
    if (!(c.currentTitle ?? "").toLowerCase().includes(e.currentTitleContains.toLowerCase())) {
      fail(`current_title must contain ${e.currentTitleContains}`);
    }
  }
  if (
    e.currentTitleNotEquals !== undefined &&
    (c.currentTitle ?? "").trim() === e.currentTitleNotEquals.trim()
  ) {
    fail(`current_title must not equal "${e.currentTitleNotEquals}"`);
  }
  const tex = e.currentTitleExcludes;
  if (tex !== undefined) {
    const t = (c.currentTitle ?? "").toLowerCase();
    const list = Array.isArray(tex) ? tex : [tex];
    for (const frag of list) {
      if (t.includes(frag.toLowerCase())) fail(`current_title must not contain "${frag}"`);
    }
  }
  if (e.currentCompanyIsNull && (c.currentCompany ?? "").trim()) {
    fail("current_company should be null/empty");
  }
  if (
    e.currentCompanyEquals !== undefined &&
    (c.currentCompany ?? null) !== e.currentCompanyEquals
  ) {
    fail(
      `current_company equals: expected ${e.currentCompanyEquals}, got ${c.currentCompany ?? null}`
    );
  }
  if (e.currentCompanyContains !== undefined) {
    if (!(c.currentCompany ?? "").toLowerCase().includes(e.currentCompanyContains.toLowerCase())) {
      fail(`current_company must contain ${e.currentCompanyContains}`);
    }
  }
  const cex = e.currentCompanyExcludes;
  if (cex !== undefined) {
    const co = (c.currentCompany ?? "").toLowerCase();
    const list = Array.isArray(cex) ? cex : [cex];
    for (const frag of list) {
      if (co.includes(frag.toLowerCase())) fail(`current_company must not contain "${frag}"`);
    }
  }
  if (e.educationAreaContains !== undefined) {
    if (!(c.educationArea ?? "").toLowerCase().includes(e.educationAreaContains.toLowerCase())) {
      fail(`education_area must contain ${e.educationAreaContains}`);
    }
  }
  if (e.educationInstitutionContains !== undefined) {
    if (
      !(c.educationInstitution ?? "")
        .toLowerCase()
        .includes(e.educationInstitutionContains.toLowerCase())
    ) {
      fail(`education_institution must contain ${e.educationInstitutionContains}`);
    }
  }
  if (e.pastTitleContains !== undefined) {
    if (!(c.pastTitle ?? "").toLowerCase().includes(e.pastTitleContains.toLowerCase())) {
      fail(`past_title must contain ${e.pastTitleContains}`);
    }
  }
  if (e.pastCompanyContains !== undefined) {
    if (!(c.pastCompany ?? "").toLowerCase().includes(e.pastCompanyContains.toLowerCase())) {
      fail(`past_company must contain ${e.pastCompanyContains}`);
    }
  }
  const pca = e.pastCompanyContainsAll;
  if (pca?.length) {
    const pc = (c.pastCompany ?? "").toLowerCase();
    for (const frag of pca) {
      if (!pc.includes(frag.toLowerCase())) fail(`past_company must contain "${frag}"`);
    }
  }
  if (e.safeProfessionalReferenceContains !== undefined) {
    if (
      !(c.safeProfessionalReference ?? "")
        .toLowerCase()
        .includes(e.safeProfessionalReferenceContains.toLowerCase())
    ) {
      fail(`safe_professional_reference must contain ${e.safeProfessionalReferenceContains}`);
    }
  }
  if (e.needsReview !== undefined && c.needsReview !== e.needsReview) {
    fail(`needsReview expected ${e.needsReview}, got ${c.needsReview}`);
  }
  if (
    e.classificationNeedsReview !== undefined &&
    c.classificationNeedsReview !== e.classificationNeedsReview
  ) {
    fail(
      `classificationNeedsReview expected ${e.classificationNeedsReview}, got ${c.classificationNeedsReview}`
    );
  }
  if (
    e.employmentNeedsReview !== undefined &&
    Boolean(c.employmentNeedsReview) !== e.employmentNeedsReview
  ) {
    fail(
      `employmentNeedsReview expected ${e.employmentNeedsReview}, got ${Boolean(c.employmentNeedsReview)}`
    );
  }
  if (e.seniorityEquals !== undefined && c.seniority !== e.seniorityEquals) {
    fail(`seniority expected ${e.seniorityEquals}, got ${c.seniority}`);
  }
  if (e.employmentSourceEquals !== undefined && c.employmentSource !== e.employmentSourceEquals) {
    fail(
      `employment_source expected ${e.employmentSourceEquals}, got ${c.employmentSource ?? "undefined"}`
    );
  }
  if (e.currentRolesMinCount !== undefined) {
    const n = c.currentRoles?.length ?? 0;
    if (n < e.currentRolesMinCount) {
      fail(`current_roles length expected >= ${e.currentRolesMinCount}, got ${n}`);
    }
  }

  return errs.length ? errs.join("; ") : null;
}

export function loadGoldenSuitePath(path: string): GoldenSuiteFile {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as GoldenSuiteFile;
}

export function runGoldenEval(args: { suitePath: string; soft: boolean }): {
  blockingFailures: { id: string; message: string }[];
  warnings: { id: string; message: string; tier: GoldenFixture["tier"] }[];
  passed: number;
  total: number;
} {
  const suite = loadGoldenSuitePath(args.suitePath);
  const blockingFailures: { id: string; message: string }[] = [];
  const warnings: { id: string; message: string; tier: GoldenFixture["tier"] }[] = [];
  let passed = 0;

  for (const fx of suite.fixtures) {
    const post = (fx.postContent ?? suite.neutralPostDefault).trim();
    const goldenExperienceRoles = fx.profileExperienceRoles?.map((r) => ({
      ...r,
      experienceItemSource: r.experienceItemSource ?? "validation_profile_experience_text",
      evidenceExcerpt:
        r.evidenceExcerpt ?? `Golden fixture experience: ${r.title} @ ${r.company}`,
    }));
    const ev = gatherProspectEvidence({
      headline: fx.headline,
      authorDisplayName: "Eval User",
      postContent: post,
      postUrl: "https://www.linkedin.com/posts/eval",
      platform: "linkedin",
      profileExperienceRoles: goldenExperienceRoles,
      profileExperienceAnalysisMethod: goldenExperienceRoles?.length
        ? "profile_validation_actual"
        : undefined,
    });
    const c = classifyProspectDeterministic(ev, {
      linkedinUrl: "https://www.linkedin.com/in/eval",
    });
    const err = assertExpect(fx, c);
    const tier = fx.tier ?? "blocking";

    if (!err) {
      passed++;
      continue;
    }

    if (tier === "informational" || args.soft) {
      warnings.push({ id: fx.id, message: err, tier });
    } else {
      blockingFailures.push({ id: fx.id, message: err });
    }
  }

  return {
    blockingFailures,
    warnings,
    passed,
    total: suite.fixtures.length,
  };
}

export function defaultGoldenPath(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  return join(dir, "golden-fixtures.json");
}

export function mainGolden(): void {
  const argv = process.argv.slice(2);
  const soft = argv.includes("--soft");
  const pathArg = argv.find((a) => !a.startsWith("--"));
  const suitePath = pathArg ?? defaultGoldenPath();

  const { blockingFailures, warnings, passed, total } = runGoldenEval({ suitePath, soft });

  console.log(
    `Golden eval: ${passed}/${total} passed, ${blockingFailures.length} blocking failures, ${warnings.length} warnings (informational or --soft).`
  );
  for (const w of warnings) {
    console.warn(`  [warn] ${w.id}: ${w.message}`);
  }
  for (const f of blockingFailures) {
    console.error(`  [fail] ${f.id}: ${f.message}`);
  }

  if (blockingFailures.length > 0 && !soft) process.exit(1);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) mainGolden();
