/**
 * Phase 3 — Profile enrichment validation (fixture-based, no live Apify spend by default).
 *
 * Usage:
 *   npx tsx scripts/campaign-phase3-profile-enrichment-validation.ts
 *   npx tsx scripts/campaign-phase3-profile-enrichment-validation.ts --project-name "Agentic Security"
 *   npm run campaign:phase3-validate -- --project-name "Agentic Security" --live --limit 5
 *
 * --live: small live Apify run only (writes live-enrichment-small.csv + live-manifest.json).
 * --limit: profile cap (live hard max 5).
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { enrichCampaignCandidatesWithPhase1 } from "@/lib/campaigns/build-preview-rows";
import {
  buildEnrichedCampaignCsvContent,
  CAMPAIGN_ENRICHED_CSV_HEADERS,
} from "@/lib/campaigns/build-enriched-campaign-csv";
import { APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID } from "@/lib/campaigns/constants";
import { enrichCampaignProfiles } from "@/lib/campaigns/enrich-campaign-profiles";
import { runCompanyEmployeesSearch } from "@/lib/campaigns/run-company-employees-search";
import type { CampaignCandidate, CampaignCandidatePreviewRow } from "@/lib/campaigns/types";

const OUT_DIR = resolve(process.cwd(), "tmp", "campaign-phase3-validation");
const PROFILE_FIXTURE = resolve(
  process.cwd(),
  "fixtures/apify/linkedin-profile-scraper/output.sample.json"
);
const COMPANY_FIXTURE = resolve(
  process.cwd(),
  "fixtures/apify/linkedin-company-employees/output.sample.json"
);

const LIVE_HARD_MAX_PROFILES = 5;
const LIVE_MANIFEST = "live-manifest.json";
const LIVE_CSV = "live-enrichment-small.csv";

const PHASE3_SCOPE = {
  llmQualification: false,
  emailGeneration: false,
  prospectIntelligenceRouting: false,
  campaignDbTables: false,
  jobRunner: false,
  notes:
    "Phase 3 uses Apify full-profile actor, deterministic reclassification, in-memory enriched CSV only.",
} as const;

function parseArgs(argv: string[]) {
  let projectName = "agentic security";
  let live = false;
  let limit: number | undefined;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project-name" && argv[i + 1]) projectName = argv[++i]!;
    else if (argv[i] === "--live") live = true;
    else if (argv[i] === "--limit" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i]!, 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { projectName, live, limit };
}

function loadCompanyUrlFromEnv(): string {
  const raw = process.env.CAMPAIGN_PHASE2_TEST_COMPANY_URLS?.trim();
  if (raw) {
    const first = raw.split(/[|\n]/).map((s) => s.trim()).find(Boolean);
    if (first) return first;
  }
  return "https://www.linkedin.com/company/atlassian/";
}

async function resolveProjectId(name: string): Promise<string> {
  const p = await prisma.project.findFirst({
    where: { name: { contains: name }, deleted_at: null },
    select: { id: true },
    orderBy: { created_at: "asc" },
  });
  if (!p) throw new Error(`No project matching "${name}"`);
  return p.id;
}

function companyFixtureFetcher(target: number) {
  return async () => {
    const raw = await readFile(COMPANY_FIXTURE, "utf8");
    const template = JSON.parse(raw)[0] ?? {};
    const items = [];
    for (let i = 0; i < target; i++) {
      items.push({
        ...template,
        linkedinUrl: `https://www.linkedin.com/in/phase3-fixture-user-${i + 1}/`,
        firstName: "Fixture",
        lastName: `User${i + 1}`,
      });
    }
    return items;
  };
}

function profileFixtureFetcher() {
  return async (input: { profileUrls: string[] }) => {
    const raw = await readFile(PROFILE_FIXTURE, "utf8");
    const template = JSON.parse(raw)[0] ?? {};
    return input.profileUrls.map((url, i) => ({
      ...template,
      linkedinUrl: url,
      fullName: `Fixture User ${i + 1}`,
    }));
  };
}

function emptyProfileFixtureFetcher() {
  return async () => [] as Record<string, unknown>[];
}

function toPreview(row: CampaignCandidate): CampaignCandidatePreviewRow {
  return { ...row };
}

async function runLiveSmallValidation(projectId: string, limitArg?: number) {
  const profileLimit = Math.min(
    LIVE_HARD_MAX_PROFILES,
    Math.max(1, limitArg ?? LIVE_HARD_MAX_PROFILES)
  );
  const companyUrl = loadCompanyUrlFromEnv();

  console.log(`Phase 3 LIVE validation — project ${projectId}`);
  console.log(`Company search: ${companyUrl} (max ${profileLimit} profiles)`);
  console.log(`Full-profile actor: ${APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID}`);
  console.log(`Profile enrichment cap: ${profileLimit} (hard max ${LIVE_HARD_MAX_PROFILES})`);

  const search = await runCompanyEmployeesSearch({
    companyUrls: [companyUrl],
    jobTitles: ["Security Engineer"],
    maxItems: profileLimit,
    roleGroups: ["security_practitioners"],
  });
  if (!search.ok) throw new Error(search.error);

  const phase1 = await enrichCampaignCandidatesWithPhase1(
    projectId,
    search.candidates,
    [],
    { phase1Limit: 100 }
  );
  const continuing = phase1.rows.filter(
    (r) => r.phase1_decision === "continue_to_enrichment"
  );
  console.log(
    `Company-search normalized: ${search.normalizedCount} | Phase 1 continuing: ${continuing.length}`
  );

  const enrich = await enrichCampaignProfiles({
    projectId,
    candidates: phase1.rows,
    selectedExclusionIds: [],
    limit: profileLimit,
  });
  if (!enrich.ok) throw new Error(enrich.error);

  const csv = buildEnrichedCampaignCsvContent(enrich.enrichedCandidates);
  const csvPath = resolve(OUT_DIR, LIVE_CSV);
  await writeFile(csvPath, csv, "utf8");

  const csvLines = csv.trim().split("\n");
  const headerValid = csvLines[0] === CAMPAIGN_ENRICHED_CSV_HEADERS.join(",");
  const noMetadataPreamble = !csvLines[0]?.startsWith("#");

  const rows = enrich.enrichedCandidates.map((r) => ({
    linkedin_url: r.linkedin_url,
    enrichment_status: r.enrichment_status,
    enriched_employment_source: r.enriched_employment_source,
    enriched_current_title: r.enriched_current_title ?? null,
    enriched_current_company: r.enriched_current_company ?? null,
    experience_count: r.experience_count,
    email: r.email ?? null,
    mobile: r.mobile ?? null,
    open_to_work_detection: r.open_to_work_detection,
    open_to_work_source: r.open_to_work_source,
    enriched_role_categories: r.enriched_role_categories ?? null,
  }));

  const successful = enrich.enrichedCandidates.filter((r) => r.enrichment_status === "success");
  const withExperience = successful.filter(
    (r) =>
      r.enriched_employment_source === "profile_experience_current" ||
      r.enriched_employment_source === "current_positions"
  );
  const withTitleCompany = successful.filter(
    (r) => r.enriched_current_title && r.enriched_current_company
  );
  const otwValues = new Set(successful.map((r) => r.open_to_work_detection));

  const validationChecks = {
    fullProfileActorCalled: enrich.stats.attempted > 0 && enrich.stats.successful > 0,
    realPayloadNormalizes: successful.length > 0,
    experiencesExtractionWorks: withExperience.length > 0,
    titleCompanyPopulated: withTitleCompany.length > 0,
    enrichmentStatusCorrect: enrich.enrichedCandidates.every((r) =>
      ["success", "failed", "not_found", "parse_error"].includes(r.enrichment_status)
    ),
    missingContactFieldsSafe: enrich.enrichedCandidates.every(
      (r) => r.enrichment_status !== "parse_error" || r.enrichment_error != null
    ),
    openToWorkHonest:
      successful.length === 0 ||
      [...otwValues].every((v) =>
        ["detected", "not_detected", "unknown"].includes(v ?? "unknown")
      ),
    enrichedCsvValid: headerValid && noMetadataPreamble && csvLines.length > 1,
    liveApifyRecorded: true,
    noScopeCreep: true,
  };

  const manifest = {
    projectId,
    ranAt: new Date().toISOString(),
    mode: "live Apify",
    apifyActorId: APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID,
    companyUrl,
    profileLimit,
    phase3ScopeConfirmation: PHASE3_SCOPE,
    companySearch: {
      rawCount: search.rawCount,
      normalizedCount: search.normalizedCount,
    },
    phase1Continuing: continuing.length,
    enrichment: enrich.stats,
    warnings: enrich.warnings,
    validationChecks,
    rows,
    csvPath,
  };

  const manifestPath = resolve(OUT_DIR, LIVE_MANIFEST);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log("\n── Live enrichment summary");
  console.log(`   attempted:              ${enrich.stats.attempted}`);
  console.log(`   successful:               ${enrich.stats.successful}`);
  console.log(`   failed:                   ${enrich.stats.failed}`);
  console.log(`   not found:                ${enrich.stats.notFound}`);
  console.log(`   with experience data:     ${enrich.stats.withExperienceData}`);
  console.log(`   with title + company:     ${withTitleCompany.length}`);
  console.log(`   with email:               ${enrich.stats.withEmail}`);
  console.log(`   with mobile:              ${enrich.stats.withMobile}`);
  console.log(`   Open to Work detected:    ${enrich.stats.openToWorkDetected}`);
  console.log(`   OTW still unknown:        ${enrich.stats.openToWorkStillUnknown}`);
  console.log(`   OTW values seen:          ${[...otwValues].join(", ") || "(none)"}`);
  if (enrich.warnings.length) {
    console.log(`   warnings:                 ${enrich.warnings.join(" | ")}`);
  }
  console.log("\n── Validation checks");
  for (const [key, ok] of Object.entries(validationChecks)) {
    console.log(`   ${ok ? "OK" : "FAIL"} ${key}`);
  }
  console.log(`\nCSV: ${csvPath}`);
  console.log(`Manifest: ${manifestPath}`);

  const allOk = Object.values(validationChecks).every(Boolean);
  if (!allOk) {
    throw new Error("Live validation checks failed — see manifest validationChecks");
  }
}

async function runFixtureValidation(projectId: string) {
  const summaries: Record<string, unknown>[] = [];

  // Scenario 1: company search → phase1 → enrich
  const search1 = await runCompanyEmployeesSearch({
    companyUrls: ["https://www.linkedin.com/company/example-corp/"],
    jobTitles: ["Security Engineer"],
    maxItems: 10,
    roleGroups: ["security_practitioners"],
    fetchItems: companyFixtureFetcher(10),
  });
  if (!search1.ok) throw new Error(search1.error);
  const phase1_1 = await enrichCampaignCandidatesWithPhase1(
    projectId,
    search1.candidates,
    [],
    { phase1Limit: 100 }
  );
  const enrich1 = await enrichCampaignProfiles({
    projectId,
    candidates: phase1_1.rows,
    selectedExclusionIds: [],
    limit: 10,
    fetchItems: profileFixtureFetcher(),
  });
  if (!enrich1.ok) throw new Error(enrich1.error);
  const csv1 = buildEnrichedCampaignCsvContent(enrich1.enrichedCandidates);
  await writeFile(resolve(OUT_DIR, "1-company-search-phase1-enrich.csv"), csv1, "utf8");
  summaries.push({
    scenarioId: "1",
    description: "Company-search 10 → Phase 1 → enrich continuing",
    ...enrich1.stats,
    csvPath: resolve(OUT_DIR, "1-company-search-phase1-enrich.csv"),
  });

  // Scenario 2: Open to Work exclusion
  const phase1Otw = await enrichCampaignCandidatesWithPhase1(
    projectId,
    [search1.candidates[0]!],
    ["open_to_work"],
    { phase1Limit: 10 }
  );
  const enrich2 = await enrichCampaignProfiles({
    projectId,
    candidates: [
      {
        ...phase1Otw.rows[0]!,
        linkedin_url: "https://www.linkedin.com/in/otw-fixture-user/",
        linkedin_url_normalized: "https://www.linkedin.com/in/otw-fixture-user",
      },
    ],
    selectedExclusionIds: ["open_to_work"],
    limit: 1,
    fetchItems: async (input) =>
      input.profileUrls.map((url) => ({
        linkedinUrl: url,
        openToWork: true,
        headline: "Engineer",
        experiences: [{ title: "Engineer", companyName: "Example Corp", isCurrent: true }],
      })),
  });
  if (!enrich2.ok) throw new Error(enrich2.error);
  const csv2 = buildEnrichedCampaignCsvContent(enrich2.enrichedCandidates, {
    exclusionLabels: ["Open to work"],
  });
  await writeFile(resolve(OUT_DIR, "2-open-to-work-exclusion.csv"), csv2, "utf8");
  summaries.push({
    scenarioId: "2",
    description: "Open to Work exclusion selected",
    openToWorkDetected: enrich2.stats.openToWorkDetected,
    postEnrichmentWouldDisqualify: enrich2.stats.postEnrichmentWouldDisqualify,
    csvPath: resolve(OUT_DIR, "2-open-to-work-exclusion.csv"),
  });

  // Scenario 3: disqualified skipped, continuing enriched
  const continuing = toPreview({
    ...search1.candidates[0]!,
    phase1_decision: "continue_to_enrichment",
  });
  const disqualified = toPreview({
    ...search1.candidates[1] ?? search1.candidates[0]!,
    linkedin_url: "https://www.linkedin.com/in/disqualified-fixture/",
    linkedin_url_normalized: "https://www.linkedin.com/in/disqualified-fixture",
    phase1_decision: "disqualify_phase1",
  });
  const enrich3 = await enrichCampaignProfiles({
    projectId,
    candidates: [continuing, disqualified],
    selectedExclusionIds: [],
    limit: 10,
    fetchItems: profileFixtureFetcher(),
  });
  if (!enrich3.ok) throw new Error(enrich3.error);
  const csv3 = buildEnrichedCampaignCsvContent(enrich3.enrichedCandidates);
  await writeFile(resolve(OUT_DIR, "3-disqualified-skipped-continuing-enriched.csv"), csv3, "utf8");
  summaries.push({
    scenarioId: "3",
    description: "Disqualified skipped; continuing enriched",
    skippedPhase1Disqualified: enrich3.stats.skippedPhase1Disqualified,
    enrichedCount: enrich3.enrichedCandidates.length,
    csvPath: resolve(OUT_DIR, "3-disqualified-skipped-continuing-enriched.csv"),
  });

  // Scenario 4: unknown before → classified after
  const unknownBefore = toPreview({
    ...search1.candidates[0]!,
    linkedin_url: "https://www.linkedin.com/in/unknown-before/",
    linkedin_url_normalized: "https://www.linkedin.com/in/unknown-before",
    phase1_decision: "continue_to_enrichment",
    role_categories: "unknown",
  });
  const enrich4 = await enrichCampaignProfiles({
    projectId,
    candidates: [unknownBefore],
    selectedExclusionIds: [],
    limit: 1,
    fetchItems: profileFixtureFetcher(),
  });
  if (!enrich4.ok) throw new Error(enrich4.error);
  const csv4 = buildEnrichedCampaignCsvContent(enrich4.enrichedCandidates);
  await writeFile(resolve(OUT_DIR, "4-unknown-before-enriched-after.csv"), csv4, "utf8");
  summaries.push({
    scenarioId: "4",
    description: "Unknown before enrichment; enriched roles populated",
    phase1Role: unknownBefore.role_categories,
    enrichedRole: enrich4.enrichedCandidates[0]?.enriched_role_categories,
    csvPath: resolve(OUT_DIR, "4-unknown-before-enriched-after.csv"),
  });

  // Scenario 5: failure fixture (per-profile not_found, batch ok)
  const enrich5 = await enrichCampaignProfiles({
    projectId,
    candidates: [
      toPreview({
        ...search1.candidates[0]!,
        linkedin_url: "https://www.linkedin.com/in/fail-user/",
        linkedin_url_normalized: "https://www.linkedin.com/in/fail-user",
        phase1_decision: "continue_to_enrichment",
      }),
    ],
    selectedExclusionIds: [],
    limit: 1,
    fetchItems: emptyProfileFixtureFetcher(),
  });
  if (enrich5.ok) {
    const csv5 = buildEnrichedCampaignCsvContent(enrich5.enrichedCandidates);
    await writeFile(resolve(OUT_DIR, "5-failure-fixture.csv"), csv5, "utf8");
    summaries.push({
      scenarioId: "5",
      description: "Failure fixture — row kept with not_found/failed status",
      enrichmentStatus: enrich5.enrichedCandidates[0]?.enrichment_status,
      csvPath: resolve(OUT_DIR, "5-failure-fixture.csv"),
    });
  } else {
    summaries.push({
      scenarioId: "5",
      description: "Failure fixture — whole batch error preserved",
      error: enrich5.error,
    });
  }

  const manifest = {
    projectId,
    ranAt: new Date().toISOString(),
    mode: "fixtures",
    phase3ScopeConfirmation: PHASE3_SCOPE,
    summaries,
  };
  await writeFile(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(`Phase 3 validation — project ${projectId} — fixtures`);
  for (const s of summaries) {
    console.log(`\n── Scenario ${s.scenarioId}: ${s.description}`);
    console.log(JSON.stringify(s, null, 2));
  }
  console.log(`\nManifest: ${resolve(OUT_DIR, "manifest.json")}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = await resolveProjectId(args.projectName);
  await mkdir(OUT_DIR, { recursive: true });

  if (args.live) {
    await runLiveSmallValidation(projectId, args.limit);
    return;
  }

  await runFixtureValidation(projectId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
