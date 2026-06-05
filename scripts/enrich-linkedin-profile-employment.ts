import "dotenv/config";

/**
 * Enrich LinkedIn profiles with Experience/employment data before classification.
 *
 * Uses OpenAI (same stack as POST /api/projects/validate-linkedin-profiles) and stores
 * experienceItems + resolved employment on PersonEmployment.validation_metadata.
 *
 * The HTTP endpoint additionally requires auth, projectId, and organizationName for
 * org-membership validation; this script only performs employment enrichment.
 *
 * Usage:
 *   npx tsx scripts/enrich-linkedin-profile-employment.ts --csv tmp/sample.csv --max 20
 *   npx tsx scripts/enrich-linkedin-profile-employment.ts --csv tmp/sample.csv --proof
 *   npx tsx scripts/enrich-linkedin-profile-employment.ts --urls "https://linkedin.com/in/foo" --dry-run
 *   npx tsx scripts/enrich-linkedin-profile-employment.ts --csv tmp/sample.csv --concurrency 25
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { parseCsv } from "@/lib/prospect-intelligence/eval/parse-csv";
import {
  enrichProfileUrls,
  type ProfileEmploymentEnrichmentResult,
} from "@/lib/prospect-intelligence/enrich-linkedin-profile-employment";

function parseArgs(argv: string[]) {
  let csvPath: string | undefined;
  let maxProfiles = 50;
  let concurrency = 25;
  let dryRun = false;
  let forceRefresh = false;
  let tryPublicHtml = true;
  let proof = false;
  let delayMs = 600;
  let projectId: string | undefined;
  const urlList: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv" && argv[i + 1]) {
      csvPath = resolve(process.cwd(), argv[++i] ?? "");
    } else if (a === "--max" && argv[i + 1]) {
      maxProfiles = Math.max(1, parseInt(argv[++i] ?? "50", 10) || 50);
    } else if (
      (a === "--concurrency" || a === "--batch-size") &&
      argv[i + 1]
    ) {
      concurrency = Math.max(1, Math.min(50, parseInt(argv[++i] ?? "25", 10) || 25));
    } else if (a === "--delay-ms" && argv[i + 1]) {
      delayMs = Math.max(0, parseInt(argv[++i] ?? "600", 10) || 600);
    } else if (a === "--project-id" && argv[i + 1]) {
      projectId = argv[++i]?.trim();
    } else if (a === "--urls" && argv[i + 1]) {
      urlList.push(...(argv[++i] ?? "").split(",").map((u) => u.trim()).filter(Boolean));
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--force-refresh") {
      forceRefresh = true;
    } else if (a === "--no-public-html") {
      tryPublicHtml = false;
    } else if (a === "--proof") {
      proof = true;
      maxProfiles = Math.min(maxProfiles, 20);
    }
  }

  return {
    csvPath,
    maxProfiles,
    concurrency,
    dryRun,
    forceRefresh,
    tryPublicHtml,
    proof,
    delayMs,
    projectId,
    urlList,
  };
}

function parseCsvUrls(content: string): string[] {
  const { headers, rows } = parseCsv(content);
  if (!headers.includes("profile_url")) throw new Error("CSV missing profile_url column");
  const urls = rows
    .map((r) => (r.profile_url ?? "").trim())
    .filter((u) => u.startsWith("http"));
  return [...new Set(urls.map((u) => normalizePublicProfileUrl(u) ?? u))];
}

async function loadHeadlinesByUrl(
  profileUrls: string[],
  projectId?: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const where = projectId
    ? { project_id: projectId, platform: { in: [...LINKEDIN_DB_PLATFORM_IN] } }
    : { platform: { in: [...LINKEDIN_DB_PLATFORM_IN] } };

  const posts = await prisma.post.findMany({
    where,
    select: { extraJson: true },
    take: 50_000,
  });

  const urlSet = new Set(profileUrls);
  for (const post of posts) {
    const { profileUrl, headline } = getLinkedInAuthorFromExtraJson(post.extraJson);
    const normalized = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (!normalized || !urlSet.has(normalized)) continue;
    const h = headline?.trim();
    if (h && !map.has(normalized)) map.set(normalized, h);
  }
  return map;
}

function esc(v: string): string {
  return v.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

function printProofTable(
  rows: Array<{
    profileUrl: string;
    headline: string;
    oldCurrentCompany: string;
    result: ProfileEmploymentEnrichmentResult;
  }>
): void {
  console.log("\n--- Before / after enrichment (proof) ---\n");
  const header = [
    "profile_url",
    "headline",
    "old_current_company",
    "profile_experience_input_count",
    "experienceItems",
    "new_current_title",
    "new_current_company",
    "last_company",
    "employment_source",
    "employment_confidence",
    "employment_reason",
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(Math.min(header.length, 120)));

  for (const row of rows) {
    const r = row.result;
    const expJson = r.experienceRoles
      .map((e) => `${e.title}@${e.company}${e.isCurrent ? "*" : ""}`)
      .join("; ");
    console.log(
      [
        esc(row.profileUrl),
        esc(row.headline.slice(0, 80)),
        esc(row.oldCurrentCompany),
        String(r.experienceItemCount),
        esc(expJson.slice(0, 120)),
        esc(r.resolved?.current_title ?? ""),
        esc(r.resolved?.current_company ?? ""),
        esc(r.resolved?.past_company ?? ""),
        esc(r.resolved?.employment_source ?? ""),
        String(r.resolved?.employment_confidence ?? ""),
        esc((r.resolved?.employment_reason ?? "").slice(0, 80)),
      ].join(" | ")
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY is required for profile employment enrichment.");
    process.exit(1);
  }

  let profileUrls = args.urlList;
  if (args.csvPath) {
    const content = await readFile(args.csvPath, "utf8");
    profileUrls = parseCsvUrls(content);
  }

  profileUrls = [...new Set(profileUrls)].slice(0, args.maxProfiles);

  if (!profileUrls.length) {
    console.error("No profile URLs. Use --csv <path> or --urls <url,...>");
    process.exit(1);
  }

  const existingRows = await prisma.personEmployment.findMany({
    where: { linkedin_url: { in: profileUrls } },
    select: { linkedin_url: true, current_company: true, validation_metadata: true },
  });
  const oldCompanyByUrl = new Map(
    existingRows.map((r) => [r.linkedin_url, r.current_company ?? ""])
  );

  const headlineByUrl = await loadHeadlinesByUrl(profileUrls, args.projectId);

  console.log(
    `Enriching ${profileUrls.length} profile(s) (concurrency=${args.concurrency}, dryRun=${args.dryRun}, forceRefresh=${args.forceRefresh}, publicHtml=${args.tryPublicHtml})`
  );

  const proofRows: Array<{
    profileUrl: string;
    headline: string;
    oldCurrentCompany: string;
    result: ProfileEmploymentEnrichmentResult;
  }> = [];

  const summary = await enrichProfileUrls(prisma, profileUrls, {
    dryRun: args.dryRun,
    forceRefresh: args.forceRefresh,
    tryPublicHtml: args.tryPublicHtml,
    concurrency: args.concurrency,
    delayMs: args.delayMs,
    headlineByUrl,
    onProgress: (done, total) => {
      process.stdout.write(`\r  progress ${done}/${total}`);
    },
  });
  process.stdout.write("\n");
  const allResults = summary.results;
  console.log(
    `Done: total=${summary.total} already=${summary.alreadyEnriched} ok=${summary.enrichedSuccessfully} headline_fb=${summary.headlineFallback} no_data=${summary.noData} blocked=${summary.blocked} api_errors=${summary.apiErrors}`
  );

  if (args.proof) {
    for (const r of allResults) {
      proofRows.push({
        profileUrl: r.profileUrl,
        headline: headlineByUrl.get(r.profileUrl) ?? "",
        oldCurrentCompany: oldCompanyByUrl.get(r.profileUrl) ?? "",
        result: r,
      });
    }
  }

  const totals = allResults.reduce(
    (acc, r) => {
      acc.total++;
      if (r.status === "already_enriched") acc.already++;
      else if (r.status === "success") acc.ok++;
      else if (r.status === "headline_fallback") acc.headlineFb++;
      else if (r.status === "no_data") acc.noData++;
      else if (r.status === "blocked") acc.blocked++;
      else if (r.status === "api_error") acc.apiErrors++;
      return acc;
    },
    { total: 0, already: 0, ok: 0, headlineFb: 0, noData: 0, blocked: 0, apiErrors: 0 }
  );
  console.log(
    `\nTotals: profiles=${profileUrls.length} already_enriched=${totals.already} enriched_ok=${totals.ok} headline_fallback=${totals.headlineFb} no_data=${totals.noData} blocked=${totals.blocked} api_errors=${totals.apiErrors}`
  );

  if (args.proof && proofRows.length) {
    printProofTable(proofRows);
  }

  console.log("\nDone. Re-run classification with --enrich-employment or classify after enrichment.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
