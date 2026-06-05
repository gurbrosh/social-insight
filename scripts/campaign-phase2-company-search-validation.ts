/**
 * Phase 2 — Company / role search validation utility.
 *
 * Runs five scenarios, writes CSVs under tmp/campaign-phase2-validation/, and prints console summaries.
 * No enrichment, no LLM, no Prospect Intelligence routing/templates/review queue.
 *
 * Usage:
 *   npx tsx scripts/campaign-phase2-company-search-validation.ts
 *   npx tsx scripts/campaign-phase2-company-search-validation.ts --project-name "Agentic Security"
 *   npx tsx scripts/campaign-phase2-company-search-validation.ts --fixtures
 *   npx tsx scripts/campaign-phase2-company-search-validation.ts --only 1,5
 *
 * Live Apify (default when APIFY_API_TOKEN is set):
 *   Set 1–3 LinkedIn company URLs (pipe- or newline-separated):
 *   CAMPAIGN_PHASE2_TEST_COMPANY_URLS=https://www.linkedin.com/company/example-a/|...
 *
 * Offline structure test (--fixtures): uses fixtures/apify/linkedin-company-employees/output.sample.json
 * with synthetic profile URLs (no Apify spend).
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { collectPostBasedCampaignCandidates } from "@/lib/campaigns/collect-post-based";
import { enrichCampaignCandidatesWithPhase1 } from "@/lib/campaigns/build-preview-rows";
import {
  buildPhase2ValidationCsvContent,
  type Phase2ValidationJobTitleMeta,
} from "@/lib/campaigns/build-phase2-validation-csv";
import type { CampaignCompanyRoleGroupId } from "@/lib/campaigns/company-role-search-mapping";
import { buildJobTitleExpansionMeta } from "@/lib/campaigns/phase2-job-title-expansion";
import { buildPhase2DedupeFixtureInput } from "@/lib/campaigns/phase2-dedupe-fixture";
import { investigatePostBasedZero } from "@/lib/campaigns/phase2-post-based-investigation";
import { mergeCampaignCandidates } from "@/lib/campaigns/merge-campaign-candidates";
import { postBasedListToCampaignCandidates } from "@/lib/campaigns/post-based-to-campaign-candidate";
import {
  PHASE2_VALIDATION_SCENARIOS,
  type Phase2ValidationScenario,
} from "@/lib/campaigns/phase2-validation-scenarios";
import { computePhase1SummaryCounts } from "@/lib/campaigns/phase1-summary";
import {
  runCompanyEmployeesSearch,
  type CompanyEmployeesApifyInput,
} from "@/lib/campaigns/run-company-employees-search";
import type { ApifyCompanyEmployeeRawItem } from "@/lib/campaigns/normalize-company-search-results";
import type { CampaignCandidate, CampaignCandidatePreviewRow } from "@/lib/campaigns/types";

const DEFAULT_OUT_DIR = resolve(process.cwd(), "tmp", "campaign-phase2-validation");
const DEFAULT_PROJECT_NAME = "agentic security";
const FIXTURE_PATH = resolve(
  process.cwd(),
  "fixtures/apify/linkedin-company-employees/output.sample.json"
);

type ScenarioRunSummary = {
  scenarioId: string;
  slug: string;
  description: string;
  rawCount: number;
  normalizedCount: number;
  droppedInvalid: number;
  postBasedLoaded: number;
  companySearchLoaded: number;
  duplicatesRemoved: number;
  totalLoaded: number;
  phase1Disqualified: number;
  continuingCount: number;
  unknownContinuing: number;
  rowsBySourceTypes: Record<string, number>;
  csvPath: string;
  warnings: string[];
  jobTitleExpansion?: Phase2ValidationJobTitleMeta;
  postBasedInvestigation?: Awaited<ReturnType<typeof investigatePostBasedZero>>;
  error?: string;
};

type DedupeFixtureSummary = {
  scenarioId: "dedupe-fixture";
  slug: string;
  description: string;
  inputRowCount: number;
  postBasedInputCount: number;
  companySearchInputCount: number;
  duplicatesRemoved: number;
  totalLoaded: number;
  sharedUrl: string;
  duplicateRowVerified: boolean;
  csvPath: string;
};

const PHASE2_SCOPE_CONFIRMATION = {
  fullProfileEnrichment: false,
  llmQualification: false,
  prospectIntelligenceRouting: false,
  campaignDbTables: false,
  emailGeneration: false,
  notes:
    "Validation uses Apify company-employees (short mode), merge/dedupe, and readonly Phase 1 classification only (deterministic; skipPublicProfileFetch defaults true).",
} as const;

function parseArgs(argv: string[]) {
  let projectName = DEFAULT_PROJECT_NAME;
  let projectId: string | undefined;
  let outDir = DEFAULT_OUT_DIR;
  let useFixtures = false;
  const onlyIds = new Set<string>();

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project-name" && argv[i + 1]) projectName = argv[++i]!;
    else if (a === "--project-id" && argv[i + 1]) projectId = argv[++i]!;
    else if (a === "--out-dir" && argv[i + 1]) outDir = resolve(argv[++i]!);
    else if (a === "--fixtures") useFixtures = true;
    else if (a === "--only" && argv[i + 1]) {
      for (const part of argv[++i]!.split(",")) {
        const id = part.trim();
        if (id) onlyIds.add(id);
      }
    }
  }

  return { projectName, projectId, outDir, useFixtures, onlyIds };
}

function loadCompanyUrlsFromEnv(): string[] {
  const raw = process.env.CAMPAIGN_PHASE2_TEST_COMPANY_URLS?.trim();
  if (!raw) return [];
  return raw
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function resolveProjectId(args: {
  projectId?: string;
  projectName: string;
}): Promise<string> {
  if (args.projectId) {
    const p = await prisma.project.findFirst({
      where: { id: args.projectId, deleted_at: null },
      select: { id: true },
    });
    if (!p) throw new Error(`Project not found: ${args.projectId}`);
    return p.id;
  }
  const p = await prisma.project.findFirst({
    where: { name: { contains: args.projectName }, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { created_at: "asc" },
  });
  if (!p) {
    throw new Error(
      `No project matching name "${args.projectName}". Use --project-id or --project-name.`
    );
  }
  return p.id;
}

async function buildFixtureFetcher(
  companyUrls: string[],
  targetCount: number
): Promise<(input: CompanyEmployeesApifyInput) => Promise<ApifyCompanyEmployeeRawItem[]>> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const template = JSON.parse(raw) as ApifyCompanyEmployeeRawItem[];
  const base = template[0] ?? {};

  return async (input: CompanyEmployeesApifyInput) => {
    const items: ApifyCompanyEmployeeRawItem[] = [];
    const jobTitle = input.jobTitles[0] ?? "Security Engineer";
    for (let i = 0; i < targetCount; i++) {
      const company = companyUrls[i % companyUrls.length] ?? companyUrls[0]!;
      items.push({
        ...base,
        linkedinUrl: `https://www.linkedin.com/in/phase2-fixture-user-${i + 1}/`,
        firstName: "Fixture",
        lastName: `User${i + 1}`,
        currentPositions: [
          {
            title: "Security Engineer",
            companyName: "Example Corp",
            startDate: "2022-01",
          },
        ],
        query: {
          company,
          jobTitle,
        },
      });
    }
    return items;
  };
}

function countRowsBySourceTypes(rows: CampaignCandidatePreviewRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const key = [...r.source_types].sort().join("+");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function runCompanySearchForScenario(
  scenario: Phase2ValidationScenario,
  companyUrls: string[],
  useFixtures: boolean
): Promise<{
  companyCandidates: CampaignCandidate[];
  rawCount: number;
  normalizedCount: number;
  droppedInvalid: number;
  warnings: string[];
  jobTitleExpansion?: Phase2ValidationJobTitleMeta;
  error?: string;
}> {
  const urls = companyUrls.slice(0, scenario.companyUrlsCount);
  const roleGroups = [...scenario.roleGroups] as CampaignCompanyRoleGroupId[];
  const jobTitleExpansion = buildJobTitleExpansionMeta(roleGroups);

  if (urls.length < scenario.companyUrlsCount) {
    return {
      companyCandidates: [],
      rawCount: 0,
      normalizedCount: 0,
      droppedInvalid: 0,
      warnings: [],
      jobTitleExpansion,
      error: `Need ${scenario.companyUrlsCount} company URL(s); got ${urls.length}.`,
    };
  }
  const jobTitles = [...jobTitleExpansion.jobTitlesSentToApify];

  const targetRaw = Math.min(
    scenario.maxItems * urls.length,
    100
  );

  const fetchItems = useFixtures
    ? await buildFixtureFetcher(urls, targetRaw)
    : undefined;

  const result = await runCompanyEmployeesSearch({
    companyUrls: urls,
    jobTitles,
    maxItems: scenario.maxItems,
    roleGroups,
    fetchItems,
  });

  if (!result.ok) {
    return {
      companyCandidates: [],
      rawCount: 0,
      normalizedCount: 0,
      droppedInvalid: 0,
      warnings: [],
      jobTitleExpansion,
      error: result.error,
    };
  }

  const warnings = [...result.warnings];
  if (jobTitleExpansion.droppedJobTitlesCount > 0) {
    warnings.push(jobTitleExpansion.warning);
  }

  return {
    companyCandidates: result.candidates,
    rawCount: result.rawCount,
    normalizedCount: result.normalizedCount,
    droppedInvalid: result.droppedInvalid,
    warnings,
    jobTitleExpansion,
  };
}

async function runScenario(
  scenario: Phase2ValidationScenario,
  projectId: string,
  companyUrls: string[],
  useFixtures: boolean,
  outDir: string
): Promise<ScenarioRunSummary> {
  const slug = `${scenario.id}-${scenario.slug}`;
  let postBased: CampaignCandidate[] = [];
  let rawCount = 0;
  let normalizedCount = 0;
  let droppedInvalid = 0;
  let warnings: string[] = [];
  let searchError: string | undefined;
  let postBasedInvestigation: ScenarioRunSummary["postBasedInvestigation"];
  let jobTitleExpansion: Phase2ValidationJobTitleMeta | undefined;

  if (scenario.loadPostBased) {
    const collected = await collectPostBasedCampaignCandidates({
      projectId,
      rangeAmount: 7,
      rangeUnit: "days",
      minRelevancePercent: 70,
      maxCandidates: scenario.postBasedLimit ?? 80,
    });
    if (!collected.ok) {
      searchError = collected.prerequisite.message;
      postBasedInvestigation = await investigatePostBasedZero(projectId);
    } else {
      postBased = postBasedListToCampaignCandidates(collected.candidates);
      if (postBased.length === 0) {
        postBasedInvestigation = await investigatePostBasedZero(projectId);
      }
    }
  }

  const search = await runCompanySearchForScenario(scenario, companyUrls, useFixtures);
  jobTitleExpansion = search.jobTitleExpansion;
  rawCount = search.rawCount;
  normalizedCount = search.normalizedCount;
  droppedInvalid = search.droppedInvalid;
  warnings = search.warnings;
  if (search.error) searchError = search.error;

  const companySearch = search.companyCandidates;
  const merged = mergeCampaignCandidates(postBased, companySearch);

  let previewRows: CampaignCandidatePreviewRow[] = merged.candidates.map((c) => ({ ...c }));

  if (!searchError && merged.candidates.length > 0) {
    const enriched = await enrichCampaignCandidatesWithPhase1(
      projectId,
      merged.candidates,
      scenario.selectedExclusionIds,
      { phase1Limit: 100 }
    );
    previewRows = enriched.rows;
    if (enriched.phase1Limited) {
      warnings.push("Phase 1 classification capped at 50 rows; remainder are source-only.");
    }
  }

  const phase1 = computePhase1SummaryCounts(previewRows);
  const csvPath = resolve(outDir, `${slug}.csv`);
  const csv = buildPhase2ValidationCsvContent({
    scenarioId: scenario.id,
    rows: previewRows,
    selectedExclusionIds: scenario.selectedExclusionIds,
    jobTitleMeta: scenario.id === "3" ? jobTitleExpansion : undefined,
  });
  await writeFile(csvPath, csv, "utf8");

  return {
    scenarioId: scenario.id,
    slug,
    description: scenario.description,
    rawCount,
    normalizedCount,
    droppedInvalid,
    postBasedLoaded: merged.stats.postBasedCount,
    companySearchLoaded: merged.stats.companySearchCount,
    duplicatesRemoved: merged.stats.duplicatesRemoved,
    totalLoaded: merged.stats.totalLoaded,
    phase1Disqualified: phase1.phase1Disqualified,
    continuingCount: phase1.continuingToLaterEnrichment,
    unknownContinuing: phase1.unknownContinuing,
    rowsBySourceTypes: countRowsBySourceTypes(previewRows),
    csvPath,
    warnings,
    jobTitleExpansion: scenario.id === "3" ? jobTitleExpansion : undefined,
    postBasedInvestigation,
    error: searchError,
  };
}

async function runDedupeFixtureScenario(outDir: string): Promise<DedupeFixtureSummary> {
  const slug = "dedupe-fixture-post-company-merge";
  const { postBased, companySearch, inputRowCount } = buildPhase2DedupeFixtureInput();
  const merged = mergeCampaignCandidates(postBased, companySearch);

  const dup = merged.candidates.find((c) => c.source_count === 2);
  const duplicateRowVerified =
    dup != null &&
    dup.source_types.includes("post_based_candidate") &&
    dup.source_types.includes("cold_company_search") &&
    dup.first_source_type === "post_based_candidate" &&
    dup.relevance_score === 88 &&
    dup.current_title === "Security Engineer";

  if (merged.stats.duplicatesRemoved !== 1 || merged.stats.totalLoaded !== 3) {
    throw new Error(
      `Dedupe fixture failed: expected 4 input → 3 merged (1 dup), got duplicatesRemoved=${merged.stats.duplicatesRemoved} total=${merged.stats.totalLoaded}`
    );
  }
  if (!duplicateRowVerified) {
    throw new Error("Dedupe fixture failed: merged duplicate row metadata mismatch");
  }

  const csvPath = resolve(outDir, `${slug}.csv`);
  const csv = buildPhase2ValidationCsvContent({
    scenarioId: "dedupe-fixture",
    rows: merged.candidates.map((c) => ({ ...c })),
  });
  await writeFile(csvPath, csv, "utf8");

  return {
    scenarioId: "dedupe-fixture",
    slug,
    description: "Deterministic fixture: 4 input rows (shared URL X + unique Y/Z) → 3 merged candidates",
    inputRowCount,
    postBasedInputCount: postBased.length,
    companySearchInputCount: companySearch.length,
    duplicatesRemoved: merged.stats.duplicatesRemoved,
    totalLoaded: merged.stats.totalLoaded,
    sharedUrl: postBased[0]!.linkedin_url,
    duplicateRowVerified,
    csvPath,
  };
}

function printJobTitleExpansion(meta: Phase2ValidationJobTitleMeta): void {
  console.log(`   job title expansion:`);
  console.log(`     role groups selected:     ${meta.roleGroupsSelected.join(", ")}`);
  console.log(`     expanded before cap:      ${meta.jobTitlesBeforeCap}`);
  console.log(`     sent to Apify:            ${meta.jobTitlesSentToApify.length}`);
  console.log(`     dropped (capped):         ${meta.droppedJobTitlesCount}`);
  console.log(`     warning:                  ${meta.warning}`);
}

function printSummary(s: ScenarioRunSummary): void {
  console.log(`\n── Scenario ${s.scenarioId}: ${s.description}`);
  if (s.jobTitleExpansion) {
    printJobTitleExpansion(s.jobTitleExpansion);
  }
  if (s.postBasedInvestigation) {
    const inv = s.postBasedInvestigation;
    console.log(`   post-based investigation (0 rows):`);
    console.log(`     prerequisites ok:         ${inv.prerequisitesOk}`);
    console.log(`     themes in 7d window:      ${inv.linkedInThemeRowsInWindow}`);
    console.log(`     themes relevance >= ${inv.minRelevancePercent}: ${inv.linkedInThemeRowsMeetingRelevanceFilter}`);
    console.log(`     likely reason:            ${inv.likelyReason}`);
  }
  if (s.error) {
    console.log(`   ERROR: ${s.error}`);
    return;
  }
  console.log(`   raw results:        ${s.rawCount}`);
  console.log(`   normalized count:   ${s.normalizedCount}`);
  if (s.droppedInvalid > 0) console.log(`   dropped invalid:    ${s.droppedInvalid}`);
  console.log(`   post-based loaded:  ${s.postBasedLoaded}`);
  console.log(`   company-search loaded: ${s.companySearchLoaded}`);
  console.log(`   duplicates removed: ${s.duplicatesRemoved}`);
  console.log(`   total loaded:       ${s.totalLoaded}`);
  console.log(`   excluded (Phase 1): ${s.phase1Disqualified}`);
  console.log(`   continuing:         ${s.continuingCount}`);
  console.log(`   unknown continuing: ${s.unknownContinuing}`);
  console.log(`   rows by source_types:`);
  for (const [key, n] of Object.entries(s.rowsBySourceTypes).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`     ${key || "(empty)"}: ${n}`);
  }
  if (s.warnings.length) {
    console.log(`   warnings: ${s.warnings.join(" | ")}`);
  }
  console.log(`   CSV: ${s.csvPath}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const scenarios = PHASE2_VALIDATION_SCENARIOS.filter(
    (s) => args.onlyIds.size === 0 || args.onlyIds.has(s.id)
  );

  if (scenarios.length === 0) {
    console.error("No scenarios matched --only filter.");
    process.exit(1);
  }

  const projectId = await resolveProjectId({
    projectId: args.projectId,
    projectName: args.projectName,
  });

  let companyUrls = loadCompanyUrlsFromEnv();
  if (companyUrls.length === 0 && !args.useFixtures) {
    console.error(
      "Set CAMPAIGN_PHASE2_TEST_COMPANY_URLS (1–3 LinkedIn /company/ URLs, pipe- or newline-separated) or pass --fixtures."
    );
    process.exit(1);
  }

  if (args.useFixtures && companyUrls.length === 0) {
    companyUrls = [
      "https://www.linkedin.com/company/example-corp/",
      "https://www.linkedin.com/company/example-corp-2/",
      "https://www.linkedin.com/company/example-corp-3/",
    ];
  }

  await mkdir(args.outDir, { recursive: true });

  const mode = args.useFixtures ? "fixtures (no Apify)" : "live Apify";
  console.log(`Phase 2 company-search validation — project ${projectId} — ${mode}`);
  console.log(`Output: ${args.outDir}`);

  const summaries: ScenarioRunSummary[] = [];
  let postBasedInvestigation: Awaited<ReturnType<typeof investigatePostBasedZero>> | undefined;

  for (const scenario of scenarios) {
    const summary = await runScenario(
      scenario,
      projectId,
      companyUrls,
      args.useFixtures,
      args.outDir
    );
    summaries.push(summary);
    if (summary.postBasedInvestigation) {
      postBasedInvestigation = summary.postBasedInvestigation;
    }
    printSummary(summary);
  }

  console.log("\n── Dedupe fixture (deterministic, no Apify)");
  const dedupeFixture = await runDedupeFixtureScenario(args.outDir);
  console.log(`   input rows:           ${dedupeFixture.inputRowCount}`);
  console.log(`   post-based inputs:    ${dedupeFixture.postBasedInputCount}`);
  console.log(`   company-search inputs: ${dedupeFixture.companySearchInputCount}`);
  console.log(`   duplicates removed:   ${dedupeFixture.duplicatesRemoved}`);
  console.log(`   total loaded:         ${dedupeFixture.totalLoaded}`);
  console.log(`   duplicate verified:   ${dedupeFixture.duplicateRowVerified}`);
  console.log(`   CSV: ${dedupeFixture.csvPath}`);

  const manifestPath = resolve(args.outDir, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        projectId,
        ranAt: new Date().toISOString(),
        mode,
        companyUrls: companyUrls.slice(0, 3),
        phase2ScopeConfirmation: PHASE2_SCOPE_CONFIRMATION,
        summaries,
        dedupeFixture,
        postBasedInvestigation,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nManifest: ${manifestPath}`);
  console.log("\nPhase 2 scope confirmation:");
  for (const [key, value] of Object.entries(PHASE2_SCOPE_CONFIRMATION)) {
    if (key === "notes") console.log(`  ${value}`);
    else console.log(`  ${key}: ${value}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
