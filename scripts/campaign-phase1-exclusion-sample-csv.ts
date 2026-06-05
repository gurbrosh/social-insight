import "dotenv/config";

/**
 * Sample LinkedIn profiles for a project, classify with campaign Phase 1 logic,
 * and write baseline + exclusion permutation CSVs with full debug columns.
 *
 * Usage:
 *   npx tsx scripts/campaign-phase1-exclusion-sample-csv.ts
 *   npx tsx scripts/campaign-phase1-exclusion-sample-csv.ts --project-name "Agentic Security" --limit 500 --seed 42
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyPostBasedCandidateReadOnly } from "@/lib/campaigns/classify-readonly";
import { getCampaignExclusionCriterion } from "@/lib/campaigns/campaign-criteria-mapping";
import {
  buildPhase1DebugCsvRow,
  evaluatePhase1Exclusion,
  PHASE1_DEBUG_CSV_HEADERS,
  type Phase1DebugCsvRow,
} from "@/lib/campaigns/phase1-exclusion";
import type { CampaignExclusionCriterionId, PostBasedCampaignCandidate } from "@/lib/campaigns/types";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import {
  firstLastFromInSlugPath,
  singleLineText,
  splitDisplayNameToParts,
} from "@/lib/linkedin-prospects-csv/row-text";
import { LINKEDIN_DB_PLATFORM_IN, isLinkedInPlatform } from "@/lib/utils/platform";
import { getRollingWindowStart } from "@/lib/report-window";
import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import { seedRng, shuffleInPlace } from "@/lib/prospect-intelligence/random-sample-seeded";

const DEFAULT_PROJECT_NAME = "agentic security";
const DEFAULT_LIMIT = 500;
const DEFAULT_SEED = 42;
const OUT_DIR = resolve(process.cwd(), "tmp", "campaign-exclusion-samples");

const EXCLUSION_PERMUTATIONS: readonly (readonly CampaignExclusionCriterionId[])[] = [
  ["sales_marketing", "open_to_work", "recruiter", "consultant", "not_working"],
  ["investor", "finance", "operations", "student_academic", "contractor"],
  ["technical", "software_engineer", "security_role", "devops_platform", "engineering_leader"],
  ["founder", "c_level", "product_role", "ai_ml_role", "advisor_board_member"],
] as const;

function parseArgs(argv: string[]) {
  let projectName = DEFAULT_PROJECT_NAME;
  let limit = DEFAULT_LIMIT;
  let seed = DEFAULT_SEED;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-name" && argv[i + 1]) {
      projectName = argv[++i] ?? projectName;
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Math.min(10_000, parseInt(argv[++i] ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    } else if (a === "--seed" && argv[i + 1]) {
      seed = parseInt(argv[++i] ?? String(DEFAULT_SEED), 10) || DEFAULT_SEED;
    }
  }
  return { projectName, limit, seed };
}

function escCsv(v: string): string {
  const s = v.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exclusionLabels(ids: readonly CampaignExclusionCriterionId[]): string[] {
  return ids.map((id) => getCampaignExclusionCriterion(id)?.label ?? id);
}

function bestTitle(
  classification: ProspectClassification,
  headlineFallback: string | null | undefined
): string {
  const t =
    classification.currentTitle?.trim() ||
    classification.headlineEmploymentCandidateTitle?.trim() ||
    headlineFallback?.trim() ||
    classification.pastTitle?.trim() ||
    "";
  return t || "(no title)";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

type ClassifiedProfile = {
  linkedin_url: string;
  title: string;
  classification: ProspectClassification;
};

async function buildPostBasedPoolFast(projectId: string): Promise<PostBasedCampaignCandidate[]> {
  const windowStart = getRollingWindowStart(31, "months");
  const inWindow: Prisma.Enumerable<Prisma.ThemesAnalysisWhereInput> = [
    { posted_at: { gte: windowStart } },
    { AND: [{ posted_at: null }, { created_at: { gte: windowStart } }] },
  ];

  const themeRows = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      platform: { in: [...LINKEDIN_DB_PLATFORM_IN] },
      OR: inWindow,
    },
    orderBy: [{ posted_at: "desc" }, { created_at: "desc" }],
    take: 12_000,
    include: {
      themeItemResponses: {
        where: { deleted_at: null },
        orderBy: { relevance_score: "desc" },
        take: 1,
        select: {
          id: true,
          relevance_score: true,
          responseObjective: { select: { deleted_at: true } },
        },
      },
    },
  });

  const postIds = [...new Set(themeRows.map((r) => r.post_id))];
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, extraJson: true, authorName: true, content: true, url: true },
  });
  const postById = new Map(posts.map((p) => [p.id, p]));

  const byUrl = new Map<string, PostBasedCampaignCandidate>();

  for (const ta of themeRows) {
    if (!isLinkedInPlatform(ta.platform)) continue;
    const post = postById.get(ta.post_id);
    const { profileUrl, headline: ingestHeadline } = getLinkedInAuthorFromExtraJson(post?.extraJson);
    const canonical = profileUrl ? normalizePublicProfileUrl(String(profileUrl)) : null;
    if (!canonical) continue;

    const bestItem = ta.themeItemResponses[0] ?? null;
    if (bestItem?.responseObjective?.deleted_at) continue;

    const displayName = (ta.author_name?.trim() || post?.authorName?.trim() || null) as string | null;
    let { first_name, last_name } = splitDisplayNameToParts(displayName);
    if (!first_name.trim() && !last_name.trim()) {
      const fromSlug = firstLastFromInSlugPath(canonical);
      first_name = fromSlug.first_name;
      last_name = fromSlug.last_name;
    }
    if (!first_name.trim() || !last_name.trim()) continue;

    const total_reactions = ta.total_reactions ?? 0;
    const rel = ta.relevance_score ?? (bestItem?.relevance_score != null ? bestItem.relevance_score * 100 : 80);
    const row: PostBasedCampaignCandidate = {
      linkedin_url: canonical,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      display_name: displayName,
      headline: singleLineText(ingestHeadline) || null,
      candidate_source_type: "post_based_candidate",
      relevance_score: rel,
      theme_name: ta.theme_name,
      post_url: ta.post_url,
      total_reactions,
      themes_analysis_id: ta.id,
      post_id: ta.post_id,
      platform: ta.platform,
    };

    const prev = byUrl.get(canonical);
    if (!prev || total_reactions > prev.total_reactions || rel > prev.relevance_score) {
      byUrl.set(canonical, row);
    }
  }

  return Array.from(byUrl.values());
}

async function resolveProjectId(nameSubstring: string): Promise<{ id: string; name: string }> {
  const needle = nameSubstring.trim().toLowerCase();
  const projects = await prisma.project.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true },
    orderBy: { created_at: "desc" },
  });
  const match =
    projects.find((p) => p.name.toLowerCase() === needle) ??
    projects.find((p) => p.name.toLowerCase().includes(needle));
  if (!match) {
    throw new Error(
      `No project matching "${nameSubstring}". Available: ${projects.map((p) => p.name).join(", ")}`
    );
  }
  return match;
}

function buildCsvLines(rows: Phase1DebugCsvRow[]): string {
  const lines: string[] = [];
  lines.push(PHASE1_DEBUG_CSV_HEADERS.join(","));
  for (const r of rows) {
    lines.push(PHASE1_DEBUG_CSV_HEADERS.map((h) => escCsv(String(r[h] ?? ""))).join(","));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const { projectName, limit, seed } = parseArgs(process.argv);
  const project = await resolveProjectId(projectName);
  console.log(`Project: ${project.name} (${project.id})`);

  console.log("Building post-based profile pool…");
  const pool = await buildPostBasedPoolFast(project.id);
  console.log(`Post-based pool: ${pool.length} candidates (deduped)`);

  if (pool.length === 0) {
    console.error("No candidates in pool — check project LinkedIn themes data.");
    process.exit(1);
  }

  const rnd = seedRng(seed);
  const shuffled = [...pool];
  shuffleInPlace(shuffled, rnd);
  const sample = shuffled.slice(0, Math.min(limit, shuffled.length));
  console.log(`Sample size: ${sample.length} (seed=${seed})`);

  const themeIds = [...new Set(sample.map((c) => c.themes_analysis_id))];
  const themes = await prisma.themesAnalysis.findMany({
    where: { id: { in: themeIds }, project_id: project.id, deleted_at: null },
    select: { id: true, post_content: true },
  });
  const themeContentById = new Map(themes.map((t) => [t.id, t.post_content]));

  const postIds = [...new Set(sample.map((c) => c.post_id))];
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, extraJson: true, authorName: true, content: true, url: true },
  });
  const postById = new Map(posts.map((p) => [p.id, p]));

  console.log("Classifying sample (campaign Phase 1 readonly, no public fetch)…");
  let done = 0;
  const classified = await mapWithConcurrency(sample, 16, async (candidate) => {
    const post = postById.get(candidate.post_id);
    const classification = await classifyPostBasedCandidateReadOnly(
      project.id,
      candidate,
      post ?? { extraJson: null, authorName: null, content: null, url: null },
      themeContentById.get(candidate.themes_analysis_id) ?? null,
      { skipPublicProfileFetch: true }
    );
    done += 1;
    if (done % 50 === 0 || done === sample.length) {
      console.log(`  classified ${done}/${sample.length}`);
    }
    return {
      linkedin_url: candidate.linkedin_url,
      title: bestTitle(classification, candidate.headline),
      classification,
    } satisfies ClassifiedProfile;
  });

  classified.sort((a, b) => a.linkedin_url.localeCompare(b.linkedin_url));

  await mkdir(OUT_DIR, { recursive: true });
  const slug = project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

  const baselineRows = classified.map((p) =>
    buildPhase1DebugCsvRow({
      linkedin_url: p.linkedin_url,
      title: p.title,
      exclusionsApplied: "none",
      classification: p.classification,
      phase1: evaluatePhase1Exclusion({
        classification: p.classification,
        selectedExclusionIds: [],
      }),
    })
  );
  const baselinePath = resolve(OUT_DIR, `${slug}-${sample.length}-baseline.csv`);
  await writeFile(baselinePath, buildCsvLines(baselineRows), "utf8");
  console.log(`Wrote ${baselinePath}`);

  for (let i = 0; i < EXCLUSION_PERMUTATIONS.length; i++) {
    const exclusionIds = EXCLUSION_PERMUTATIONS[i]!;
    const labels = exclusionLabels(exclusionIds);
    const exclusionsApplied = labels.join("; ");
    const rows = classified.map((p) =>
      buildPhase1DebugCsvRow({
        linkedin_url: p.linkedin_url,
        title: p.title,
        exclusionsApplied,
        classification: p.classification,
        phase1: evaluatePhase1Exclusion({
          classification: p.classification,
          selectedExclusionIds: exclusionIds,
        }),
      })
    );
    const excludedCount = rows.filter((r) => r.status === "EXCLUDED").length;
    const outPath = resolve(OUT_DIR, `${slug}-exclusions-set-${String.fromCharCode(97 + i)}.csv`);
    await writeFile(outPath, buildCsvLines(rows), "utf8");
    console.log(
      `Wrote ${outPath} (${excludedCount} EXCLUDED / ${rows.length} total) — ${exclusionsApplied}`
    );
  }

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
