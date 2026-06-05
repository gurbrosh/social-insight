/**
 * Probe whether LinkedIn profile Experience / role-list data is obtainable per URL.
 *
 * Usage:
 *   npx tsx scripts/diagnose-linkedin-profile-experience.ts
 *   npx tsx scripts/diagnose-linkedin-profile-experience.ts --urls url1,url2
 *   npx tsx scripts/diagnose-linkedin-profile-experience.ts --seed 42 --limit 10
 *   npx tsx scripts/diagnose-linkedin-profile-experience.ts --with-openai
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { probeProfileExperienceSources } from "@/lib/prospect-intelligence/probe-profile-experience-sources";
import { seedRng, shuffleInPlace } from "@/lib/prospect-intelligence/random-sample-seeded";

function escCsv(v: string): string {
  const s = v.replace(/\r?\n/g, " ").trim();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseArgs(argv: string[]) {
  let seed = 42;
  let limit = 10;
  let urls: string[] | undefined;
  let withOpenAi = false;
  let out = "tmp/linkedin-profile-experience-diagnostic.csv";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed" && argv[i + 1]) seed = parseInt(argv[++i]!, 10);
    else if (a === "--limit" && argv[i + 1]) limit = parseInt(argv[++i]!, 10);
    else if (a === "--urls" && argv[i + 1]) urls = argv[++i]!.split(",").map((u) => u.trim());
    else if (a === "--with-openai") withOpenAi = true;
    else if (a === "--out" && argv[i + 1]) out = argv[++i]!;
  }
  return { seed, limit, urls, withOpenAi, out: resolve(out) };
}

async function pickProjectWithMostLinkedInPosts(): Promise<string | null> {
  const grouped = await prisma.post.groupBy({
    by: ["project_id"],
    where: {
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      project_id: { not: null },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  return grouped[0]?.project_id ?? null;
}

async function sampleUrlsFromProject(seed: number, limit: number): Promise<string[]> {
  const projectId = await pickProjectWithMostLinkedInPosts();
  if (!projectId) throw new Error("No project with LinkedIn posts found");

  const posts = await prisma.post.findMany({
    where: {
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      project_id: projectId,
    },
    select: { extraJson: true },
    take: 15_000,
  });

  const rnd = seedRng(seed);
  const shuffled = [...posts];
  shuffleInPlace(shuffled, rnd);

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const post of shuffled) {
    const { profileUrl } = getLinkedInAuthorFromExtraJson(post.extraJson);
    const normalized = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= limit) break;
  }
  return urls;
}

async function main() {
  const { seed, limit, urls: urlArg, withOpenAi, out } = parseArgs(process.argv.slice(2));
  const urls = urlArg?.length ? urlArg : await sampleUrlsFromProject(seed, limit);

  console.log(`Probing ${urls.length} profile(s) (openai=${withOpenAi ? "yes" : "no"})…`);

  const employmentRows = await prisma.personEmployment.findMany({
    where: { linkedin_url: { in: urls } },
    select: { linkedin_url: true, validation_metadata: true },
  });
  const peByUrl = new Map(employmentRows.map((r) => [r.linkedin_url, r]));

  const projectId = await pickProjectWithMostLinkedInPosts();
  const posts = await prisma.post.findMany({
    where: {
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      ...(projectId ? { project_id: projectId } : {}),
    },
    select: { extraJson: true },
    take: 20_000,
  });
  const extraByUrl = new Map<string, unknown>();
  for (const post of posts) {
    const { profileUrl } = getLinkedInAuthorFromExtraJson(post.extraJson);
    const normalized = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (normalized && urls.includes(normalized) && !extraByUrl.has(normalized)) {
      extraByUrl.set(normalized, post.extraJson);
    }
  }

  const header = [
    "profile_url",
    "headline",
    "profile_fetch_attempted",
    "profile_fetch_status",
    "source_available",
    "source_type",
    "raw_profile_html_available",
    "experience_section_found",
    "structured_experience_array_found",
    "post_extra_json_role_count",
    "cached_db_raw_role_count",
    "cached_analysis_method",
    "openai_attempted",
    "openai_raw_role_count",
    "openai_analysis_method",
    "raw_profile_experience_input_count",
    "valid_profile_experience_input_count",
    "accepted_experience_items",
    "rejected_experience_items",
    "rejection_reason",
    "evidence_excerpt",
    "current_title",
    "current_company",
    "employment_source",
    "employment_confidence",
  ];

  const lines: string[] = [header.join(",")];
  let validRows = 0;

  for (const url of urls) {
    const pe = peByUrl.get(url);
    const extraJson = extraByUrl.get(url) ?? null;
    const headline = getLinkedInAuthorFromExtraJson(extraJson).headline?.trim() ?? "";

    const row = await probeProfileExperienceSources({
      profileUrl: url,
      extraJson,
      validationMetadata: pe?.validation_metadata,
      headlineHint: headline,
      tryOpenAi: withOpenAi,
    });

    if (row.validProfileExperienceInputCount > 0) validRows++;

    lines.push(
      [
        escCsv(row.profileUrl),
        escCsv(row.headline),
        row.profileFetchAttempted,
        row.profileFetchStatus,
        row.sourceAvailable,
        row.sourceType,
        row.rawProfileHtmlAvailable,
        row.experienceSectionFound,
        row.structuredExperienceArrayFound,
        String(row.postExtraJsonRoleCount),
        String(row.cachedDbRawRoleCount),
        escCsv(row.cachedAnalysisMethod),
        row.openaiAttempted,
        String(row.openaiRawRoleCount),
        escCsv(row.openaiAnalysisMethod),
        String(row.rawProfileExperienceInputCount),
        String(row.validProfileExperienceInputCount),
        escCsv(row.acceptedExperienceItems),
        escCsv(row.rejectedExperienceItems),
        escCsv(row.rejectionReason),
        escCsv(row.evidenceExcerpt),
        escCsv(row.currentTitle),
        escCsv(row.currentCompany),
        escCsv(row.employmentSource),
        row.employmentConfidence,
      ].join(",")
    );

    console.log(
      `  ${url.slice(-40)} fetch=${row.profileFetchStatus} html_exp=${row.experienceSectionFound} valid=${row.validProfileExperienceInputCount}/${row.rawProfileExperienceInputCount}`
    );
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nWrote ${out}`);

  console.log(`\n--- Summary ---`);
  console.log(`Rows with valid_profile_experience_input_count > 0: ${validRows}/${urls.length}`);
  if (validRows === 0) {
    console.log(
      "\nConclusion: Current pipeline does NOT surface accepted Experience-section roles for this sample."
    );
    console.log(
      "- Post extraJson: no experience arrays (typical Apify post scrape)."
    );
    console.log(
      "- Cached PersonEmployment: mostly OpenAI URL/headline inference (rejected at classify)."
    );
    console.log(
      "- Public HTML fetch: often auth_wall; when HTML exists, embedded JSON may be present but is not parsed into role arrays yet."
    );
    console.log("\nImplementation decision: add a richer profile scraper OR accept headline-only employment.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
