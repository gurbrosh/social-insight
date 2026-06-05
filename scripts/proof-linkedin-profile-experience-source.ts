/**
 * 20-profile proof: acquire real LinkedIn Experience roles (Apify / HTML embed only).
 *
 * Usage:
 *   npx tsx scripts/proof-linkedin-profile-experience-source.ts --seed 42 --limit 20
 *   npx tsx scripts/proof-linkedin-profile-experience-source.ts --persist
 *
 * Requires for Apify path:
 *   APIFY_API_TOKEN
 *   LINKEDIN_PROFILE_EXPERIENCE_APIFY_ACTOR_ID
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { LINKEDIN_DB_PLATFORM_IN } from "@/lib/utils/platform";
import { gatherEvidenceFromPostRow } from "@/lib/prospect-intelligence/gather-evidence";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import { mergeProfileExperienceRoles } from "@/lib/prospect-intelligence/load-profile-employment";
import {
  acquireLinkedInProfileExperience,
  persistProfileExperienceAcquisition,
} from "@/lib/prospect-intelligence/linkedin-profile-experience-acquisition";
import { parseAnalysisMethodFromMetadata } from "@/lib/prospect-intelligence/validate-profile-experience";
import { seedRng, shuffleInPlace } from "@/lib/prospect-intelligence/random-sample-seeded";

function escCsv(v: string): string {
  const s = v.replace(/\r?\n/g, " ").trim();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseArgs(argv: string[]) {
  let seed = 42;
  let limit = 20;
  let persist = false;
  let out = "tmp/linkedin-profile-experience-proof-20.csv";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed" && argv[i + 1]) seed = parseInt(argv[++i]!, 10);
    else if (a === "--limit" && argv[i + 1]) limit = parseInt(argv[++i]!, 10);
    else if (a === "--persist") persist = true;
    else if (a === "--out" && argv[i + 1]) out = resolve(argv[++i]!);
  }
  return { seed, limit, persist, out };
}

async function sampleUrls(seed: number, limit: number): Promise<string[]> {
  const grouped = await prisma.post.groupBy({
    by: ["project_id"],
    where: { platform: { in: [...LINKEDIN_DB_PLATFORM_IN] }, project_id: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  const projectId = grouped[0]?.project_id;
  if (!projectId) throw new Error("No LinkedIn posts");

  const posts = await prisma.post.findMany({
    where: { platform: { in: [...LINKEDIN_DB_PLATFORM_IN] }, project_id: projectId },
    select: { extraJson: true },
    take: 15_000,
  });

  const rnd = seedRng(seed);
  shuffleInPlace(posts, rnd);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const { profileUrl } = getLinkedInAuthorFromExtraJson(post.extraJson);
    const n = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    urls.push(n);
    if (urls.length >= limit) break;
  }
  return urls;
}

async function main() {
  const { seed, limit, persist, out } = parseArgs(process.argv.slice(2));
  const urls = await sampleUrls(seed, limit);

  console.log(`Proof-of-source: ${urls.length} profiles (seed=${seed})`);
  console.log(
    `Apify configured: ${Boolean(process.env.APIFY_API_TOKEN && process.env.LINKEDIN_PROFILE_EXPERIENCE_APIFY_ACTOR_ID)}`
  );

  const header = [
    "profile_url",
    "headline",
    "source_used",
    "profile_fetch_status",
    "structured_experience_array_found",
    "raw_experience_items",
    "valid_experience_items",
    "rejected_experience_items",
    "current_title",
    "current_company",
    "last_title",
    "last_company",
    "evidence_excerpt",
    "employment_source",
    "confidence",
    "acquisition_cost_estimate_usd",
    "enrichment_status",
    "rejection_reason",
  ];

  const grouped = await prisma.post.groupBy({
    by: ["project_id"],
    where: { platform: { in: [...LINKEDIN_DB_PLATFORM_IN] }, project_id: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  const projectId = grouped[0]?.project_id;
  const allPosts = projectId
    ? await prisma.post.findMany({
        where: { platform: { in: [...LINKEDIN_DB_PLATFORM_IN] }, project_id: projectId },
        select: { extraJson: true },
        take: 15_000,
      })
    : [];
  const byUrl = new Map<string, { extraJson: unknown; headline: string }>();
  for (const p of allPosts) {
    const { profileUrl, headline: h } = getLinkedInAuthorFromExtraJson(p.extraJson);
    const n = profileUrl ? normalizePublicProfileUrl(profileUrl) : null;
    if (!n || byUrl.has(n)) continue;
    byUrl.set(n, { extraJson: p.extraJson, headline: h?.trim() ?? "" });
  }

  const lines: string[] = [header.join(",")];
  let validCount = 0;

  for (const url of urls) {
    const row = byUrl.get(url);
    const extraJson = row?.extraJson ?? null;
    const headline = row?.headline ?? "";

    const pe = await prisma.personEmployment.findUnique({
      where: { linkedin_url: url },
      select: { validation_metadata: true },
    });

    const acquisition = await acquireLinkedInProfileExperience({
      profileUrl: url,
      headline,
    });

    if (persist) {
      await persistProfileExperienceAcquisition(prisma, acquisition);
    }

    const mergedRoles = mergeProfileExperienceRoles({
      fromExtraJson: extraJson,
      validationMetadata: pe?.validation_metadata,
      headline,
    });

    const ev = gatherEvidenceFromPostRow({
      extraJson,
      authorName: null,
      content: null,
      url: null,
      platform: "linkedin",
      themePostContent: null,
      postUrlFromTheme: null,
      profileExperienceRoles: mergedRoles.length ? mergedRoles : acquisition.validRoles,
      profileExperienceAnalysisMethod:
        acquisition.analysisMethod || parseAnalysisMethodFromMetadata(pe?.validation_metadata),
    });

    const classified = classifyProspectDeterministic(ev, { linkedinUrl: url });

    if (acquisition.validRoles.length > 0) validCount++;

    const rawBrief = acquisition.rawRoles
      .map((r) => `${r.title} @ ${r.company}`)
      .join(" | ");
    const validBrief = acquisition.validRoles
      .map((r) => `${r.title} @ ${r.company}`)
      .join(" | ");
    const rejectedBrief = acquisition.rawRoles
      .filter(
        (r) =>
          !acquisition.validRoles.some(
            (v) => v.title === r.title && v.company === r.company
          )
      )
      .map((r) => `${r.title} @ ${r.company}`)
      .join(" | ");

    lines.push(
      [
        escCsv(url),
        escCsv(headline),
        acquisition.sourceUsed,
        acquisition.profileFetchStatus,
        acquisition.structuredExperienceArrayFound ? "yes" : "no",
        escCsv(rawBrief),
        escCsv(validBrief),
        escCsv(rejectedBrief),
        escCsv(classified.currentTitle ?? acquisition.resolved?.current_title ?? ""),
        escCsv(classified.currentCompany ?? acquisition.resolved?.current_company ?? ""),
        escCsv(classified.lastTitle ?? acquisition.resolved?.past_title ?? ""),
        escCsv(classified.lastCompany ?? acquisition.resolved?.past_company ?? ""),
        escCsv(acquisition.evidenceExcerpt ?? ""),
        classified.employmentSource ?? "unknown",
        String(classified.employmentConfidence ?? 0),
        acquisition.acquisitionCostEstimateUsd != null
          ? String(acquisition.acquisitionCostEstimateUsd)
          : "",
        acquisition.enrichmentStatus,
        escCsv(acquisition.rejectionReasons.slice(0, 3).join("; ")),
      ].join(",")
    );

    console.log(
      `  ${url.slice(-36)} src=${acquisition.sourceUsed} valid=${acquisition.validRoles.length} emp=${classified.employmentSource}`
    );
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nWrote ${out}`);
  console.log(`Rows with valid experience items: ${validCount}/${urls.length}`);

  if (validCount === 0) {
    console.log(
      "\nNo evidence-backed roles in this run. Configure LINKEDIN_PROFILE_EXPERIENCE_APIFY_ACTOR_ID + APIFY_API_TOKEN, or ensure public HTML is reachable."
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
