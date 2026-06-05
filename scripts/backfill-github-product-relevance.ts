/**
 * Backfill `Post.github_product_relevance_score` for all GitHub repo rows in a project by
 * scoring each repo against the project's My Product / description (same LLM prompt as ingest).
 *
 * Rules:
 * - If the listening project has no product summary/description context (no description,
 *   monitoring focus, My Product fields, or structured summary), every GitHub row is set to 0%.
 * - If a GitHub repo row has no readme title, description excerpt, about text, and no topics,
 *   it is set to 0% without calling the LLM.
 *
 * Run:
 *   npx tsx scripts/backfill-github-product-relevance.ts
 *   npx tsx scripts/backfill-github-product-relevance.ts --project-name "Agentic Security"
 *   npx tsx scripts/backfill-github-product-relevance.ts --project-id 01ABC...
 *
 * Requires: OPENAI_API_KEY (unless only zeroing rows).
 */

import "dotenv/config";

import { prisma } from "../lib/prisma";
import { parseMyProductSummaryJson } from "../lib/my-product/summary-types";
import {
  buildProductDescriptionForEmailReport,
  scoreGithubReposAgainstProduct,
} from "../lib/email-report-github-relevance";
import {
  buildGithubRepoForScoring,
  parseGithubExtraFromPostJson,
} from "../lib/github/github-product-relevance";
import { GITHUB_POST_PLATFORM } from "../lib/github/upsert-github-repo-post";
import type { GithubRepoStructuredExtraJson } from "../lib/github/repo-structured-summary";

const DEFAULT_PROJECT_NAME_SUBSTRING = "agentic security";
const BATCH_SIZE = 12;

type ProjectProductFields = {
  id: string;
  name: string;
  description: string | null;
  monitoring_focus: string | null;
  my_product_name: string | null;
  my_product_focus_text: string | null;
  my_product_summary_json: string | null;
};

function parseArgs(): { projectId: string | null; projectName: string | null } {
  const argv = process.argv.slice(2);
  let projectId: string | null = null;
  let projectName: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id" && argv[i + 1]) {
      projectId = argv[++i]!;
    } else if (a === "--project-name" && argv[i + 1]) {
      projectName = argv[++i]!;
    } else if (a.startsWith("--project-id=")) {
      projectId = a.split("=", 2)[1] ?? null;
    } else if (a.startsWith("--project-name=")) {
      projectName = a.split("=", 2)[1] ?? null;
    }
  }
  return { projectId, projectName };
}

function hasProjectProductSummaryOrDescription(project: {
  description: string | null;
  monitoring_focus: string | null;
  my_product_name: string | null;
  my_product_focus_text: string | null;
  my_product_summary_json: string | null;
}): boolean {
  if (project.description?.trim()) return true;
  if (project.monitoring_focus?.trim()) return true;
  if (project.my_product_name?.trim()) return true;
  if (project.my_product_focus_text?.trim()) return true;
  const s = parseMyProductSummaryJson(project.my_product_summary_json);
  if (s?.highLevelDescription?.trim()) return true;
  if (s?.keyInnovativeIdeas?.some((x) => x.trim())) return true;
  if (s?.differentiators?.trim()) return true;
  if (s?.intendedClients?.trim()) return true;
  return false;
}

/** Repo has no title, description, about, or topics — score 0% per instructions. */
function githubRepoHasNoSummaryOrDescription(extra: GithubRepoStructuredExtraJson): boolean {
  const title = (extra.readme_title || "").trim();
  const desc = (extra.readme_description_excerpt || "").trim();
  const about = (extra.about || "").trim();
  const topics = extra.topics?.length ?? 0;
  return !title && !desc && !about && topics === 0;
}

function bucketScore(score: number | null): string {
  if (score === null) return "null";
  if (score === 0) return "0";
  if (score <= 10) return "1-10";
  if (score <= 20) return "11-20";
  if (score <= 40) return "21-40";
  if (score <= 60) return "41-60";
  if (score <= 80) return "61-80";
  return "81-100";
}

function printDistribution(scores: (number | null)[]) {
  const total = scores.length;
  console.log("\n--- Relevance score distribution ---");
  console.log(`Total GitHub Post rows: ${total}`);
  if (total === 0) return;

  const exact = new Map<number, number>();
  const buckets = new Map<string, number>();
  let sum = 0;
  let nNonNull = 0;
  for (const s of scores) {
    const b = bucketScore(s);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
    if (s != null) {
      sum += s;
      nNonNull++;
      exact.set(s, (exact.get(s) ?? 0) + 1);
    }
  }

  console.log("\nBy bucket:");
  for (const key of ["0", "1-10", "11-20", "21-40", "41-60", "61-80", "81-100", "null"]) {
    const c = buckets.get(key) ?? 0;
    if (c > 0) {
      console.log(`  ${key.padEnd(8)} ${c} (${((100 * c) / total).toFixed(1)}%)`);
    }
  }

  if (nNonNull > 0) {
    console.log(`\nMean (non-null): ${(sum / nNonNull).toFixed(2)}`);
  }

  const sorted = scores.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (sorted.length > 0) {
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    console.log(`Median (non-null): ${median}`);
  }

  console.log("\nPer-score counts (non-zero scores only, top 20 by frequency):");
  const entries = [...exact.entries()].filter(([k]) => k !== 0).sort((a, b) => b[1] - a[1]);
  const zeroCount = exact.get(0) ?? 0;
  if (zeroCount > 0) console.log(`  score 0: ${zeroCount}`);
  for (const [score, count] of entries.slice(0, 20)) {
    console.log(`  score ${score}: ${count}`);
  }
}

async function main() {
  const { projectId: argProjectId, projectName: argProjectName } = parseArgs();

  const selectProduct = {
    id: true,
    name: true,
    description: true,
    monitoring_focus: true,
    my_product_name: true,
    my_product_focus_text: true,
    my_product_summary_json: true,
  } as const;

  let project: ProjectProductFields;

  if (argProjectId) {
    const row = await prisma.project.findFirst({
      where: { id: argProjectId, deleted_at: null },
      select: selectProduct,
    });
    if (!row) {
      console.error(`Project not found: ${argProjectId}`);
      process.exit(1);
    }
    project = row;
  } else {
    const needle = (argProjectName ?? DEFAULT_PROJECT_NAME_SUBSTRING).trim().toLowerCase();
    const projects = await prisma.project.findMany({
      where: {
        deleted_at: null,
        name: { contains: needle },
      },
      select: selectProduct,
    });
    if (projects.length === 0) {
      console.error(`No project whose name contains "${needle}".`);
      process.exit(1);
    }
    if (projects.length > 1) {
      console.error(
        `Multiple projects match "${needle}". Use --project-id.\n` +
          projects.map((p) => `  ${p.id}  ${p.name}`).join("\n")
      );
      process.exit(1);
    }
    project = projects[0]!;
  }

  console.log(`Project: ${project.name} (${project.id})`);

  const posts = await prisma.post.findMany({
    where: {
      project_id: project.id,
      platform: GITHUB_POST_PLATFORM,
      isTest: false,
    },
    select: { id: true, extraJson: true },
    orderBy: { id: "asc" },
  });

  console.log(`GitHub Post rows: ${posts.length}`);

  const hasProduct = hasProjectProductSummaryOrDescription(project);
  if (!hasProduct) {
    console.log(
      "Project has no summary/description (or My Product) context — setting all GitHub rows to 0%."
    );
    for (const p of posts) {
      await prisma.post.update({
        where: { id: p.id },
        data: { github_product_relevance_score: 0 },
      });
    }
    const finalScores = await prisma.post.findMany({
      where: {
        project_id: project.id,
        platform: GITHUB_POST_PLATFORM,
        isTest: false,
      },
      select: { github_product_relevance_score: true },
    });
    printDistribution(finalScores.map((r) => r.github_product_relevance_score ?? null));
    process.exit(0);
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY is required when the project has product context.");
    process.exit(1);
  }

  const productText = buildProductDescriptionForEmailReport(project);
  let llmScored = 0;
  let zeroedNoRepoText = 0;
  let zeroedNoExtra = 0;

  const toScore: Array<{ postId: number; extra: GithubRepoStructuredExtraJson }> = [];

  for (const p of posts) {
    const extra = parseGithubExtraFromPostJson(p.extraJson);
    if (!extra) {
      await prisma.post.update({
        where: { id: p.id },
        data: { github_product_relevance_score: 0 },
      });
      zeroedNoExtra++;
      continue;
    }
    if (githubRepoHasNoSummaryOrDescription(extra)) {
      await prisma.post.update({
        where: { id: p.id },
        data: { github_product_relevance_score: 0 },
      });
      zeroedNoRepoText++;
      continue;
    }
    toScore.push({ postId: p.id, extra });
  }

  console.log(`Set to 0 (missing github extraJson): ${zeroedNoExtra}`);
  console.log(`Set to 0 (repo has no title/description/about/topics): ${zeroedNoRepoText}`);

  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    const batch = toScore.slice(i, i + BATCH_SIZE);
    const repos = batch.map((b) => buildGithubRepoForScoring(b.postId, b.extra));
    const scores = await scoreGithubReposAgainstProduct(productText, repos);
    for (const b of batch) {
      const s = scores.get(b.postId);
      const value = s != null ? s : 0;
      await prisma.post.update({
        where: { id: b.postId },
        data: { github_product_relevance_score: value },
      });
      llmScored++;
    }
    console.log(
      `Scored batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toScore.length / BATCH_SIZE)} (${batch.length} repo(s))`
    );
  }

  console.log(`\nLLM-scored rows: ${llmScored}`);

  const finalScores = await prisma.post.findMany({
    where: {
      project_id: project.id,
      platform: GITHUB_POST_PLATFORM,
      isTest: false,
    },
    select: { github_product_relevance_score: true },
  });
  printDistribution(finalScores.map((r) => r.github_product_relevance_score ?? null));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
