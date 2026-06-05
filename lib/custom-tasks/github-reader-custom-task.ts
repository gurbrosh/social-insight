import type { SearchSourceTask } from "@prisma/client";
import { GITHUB_SIGNAL_KEYWORD_GLOBAL } from "@/lib/github/constants";
import { githubFetchJson, buildRepoDetailUrl } from "@/lib/github/github-client";
import { ingestGithubKeyword, type GithubIngestMode } from "@/lib/github/ingest-github-keyword";
import { buildGithubRepoStructuredSummary } from "@/lib/github/repo-structured-summary";
import type { GithubRepoDetailResponse } from "@/lib/github/types";
import { prisma } from "@/lib/prisma";
import { getSinceDate } from "@/lib/search-source-task-runner";
import type {
  CustomTask,
  CustomTaskRunOptions,
  CustomTaskRunTestOptions,
  CustomTaskTestResult,
} from "./types";
import { findProjectIdByName } from "./project-resolution";
import { loadProjectListeningTerms } from "./project-listening-terms";
import { isTaskTestCancelledError, throwIfAborted } from "./task-test-abort";

export const TARGET_GITHUB_READER = "GithubReader";

const GH_TEST_MAX_TERMS = 20;
const GH_TEST_PREVIEW_SAMPLE = 8;

function resolveGithubMaxSearchPages(isAdminTest: boolean): number {
  if (isAdminTest) {
    const n = parseInt(process.env.GH_TEST_MAX_SEARCH_PAGES || "2", 10);
    return Math.min(10, Math.max(1, Number.isNaN(n) ? 2 : n));
  }
  const n = parseInt(process.env.GH_MAX_SEARCH_PAGES || "10", 10);
  return Math.min(10, Math.max(1, Number.isNaN(n) ? 10 : n));
}

/** Admin tests: cap keywords so we do not run repo+code for dozens of terms. */
function resolveTestKeywordLimit(): number {
  const n = parseInt(process.env.GH_TEST_MAX_KEYWORDS || "5", 10);
  return Math.min(GH_TEST_MAX_TERMS, Math.max(1, Number.isNaN(n) ? 5 : n));
}

function truncatePreviewLine(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function parseKeywordCsv(csv: string): string[] {
  return [
    ...new Set(
      csv
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

function parseGhModesFromTaskConfig(task: SearchSourceTask): GithubIngestMode[] {
  const raw = task.config_json?.trim();
  if (!raw) return ["repo", "code"];
  try {
    const parsed = JSON.parse(raw) as { ghModes?: string };
    const m = typeof parsed.ghModes === "string" ? parsed.ghModes.trim() : "";
    if (!m) return ["repo", "code"];
    const parts = m
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out: GithubIngestMode[] = [];
    for (const p of parts) {
      if (p === "repo" || p === "code") out.push(p);
    }
    return out.length ? out : ["repo", "code"];
  } catch {
    return ["repo", "code"];
  }
}

async function formatGithubSamplePreview(
  floorUnix: number
): Promise<{ lines: string[]; totalInWindow: number }> {
  const baseWhere = {
    source: "github",
    keyword: GITHUB_SIGNAL_KEYWORD_GLOBAL,
    deleted_at: null,
    published_at_unix: { gte: floorUnix },
  };

  const total = await prisma.githubSignal.count({ where: baseWhere });
  const rows = await prisma.githubSignal.findMany({
    where: baseWhere,
    orderBy: { published_at_unix: "desc" },
    take: GH_TEST_PREVIEW_SAMPLE,
    select: {
      title: true,
      repo_url: true,
      signal_type: true,
      repo_full_name: true,
      file_path: true,
    },
  });

  const header =
    total === 0
      ? "  No signals in this lookback window (API returned nothing new, or all rows already up to date)."
      : `  ${total} signal(s) in window — showing up to ${Math.min(GH_TEST_PREVIEW_SAMPLE, total)} newest (deduped per repo/hit):`;

  const lines: string[] = [header];
  if (rows.length === 0) {
    return { lines, totalInWindow: total };
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = truncatePreviewLine(r.title ?? r.repo_full_name ?? "(no title)", 140);
    const url = (r.repo_url ?? "").trim();
    const meta = [r.signal_type, r.file_path ? r.file_path : null].filter(Boolean).join(" · ");
    lines.push(`  ${i + 1}. ${title}${meta ? ` (${meta})` : ""}`);
    if (url) lines.push(`     ${url}`);
  }
  return { lines, totalInWindow: total };
}

function parseOwnerRepo(fullName: string): { owner: string; repo: string } | null {
  const t = fullName.trim();
  const i = t.indexOf("/");
  if (i <= 0) return null;
  const owner = t.slice(0, i);
  const repo = t.slice(i + 1);
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** GET /repos + README + counts — same output as production `enrichRepoMetadataForFullNames` body text. */
async function fetchStructuredSummaryTextForRepo(
  repoFullName: string,
  ctxKeyword: string
): Promise<string> {
  const p = parseOwnerRepo(repoFullName);
  if (!p) {
    return `(invalid repo full name: ${repoFullName})`;
  }
  const path = buildRepoDetailUrl(p.owner, p.repo);
  const { data } = await githubFetchJson<GithubRepoDetailResponse>(path, {
    keyword: ctxKeyword,
    page: 0,
    endpoint: "repos",
  });
  return buildGithubRepoStructuredSummary({
    owner: p.owner,
    repo: p.repo,
    keyword: ctxKeyword,
    detail: data,
  });
}

/**
 * For admin test only: full structured parameters for each **unique** repo in the same preview window
 * as the catalog sample (deduped, same order as first occurrence).
 */
async function fetchStructuredDetailsForTestPreview(
  floorUnix: number,
  signal: AbortSignal | undefined
): Promise<string[]> {
  const baseWhere = {
    source: "github",
    keyword: GITHUB_SIGNAL_KEYWORD_GLOBAL,
    deleted_at: null,
    published_at_unix: { gte: floorUnix },
  };
  const rows = await prisma.githubSignal.findMany({
    where: baseWhere,
    orderBy: { published_at_unix: "desc" },
    take: GH_TEST_PREVIEW_SAMPLE,
    select: { repo_full_name: true },
  });
  const out: string[] = [];
  out.push("=== Per-repository parameters (full structured summary) ===");
  out.push(
    "Fields: project name, About, Title, Description (from README), Keywords (topics), Stars, forks, releases count, deployments count, contributors count, since (repo age)."
  );
  out.push(
    "Uses GET /repos/{owner}/{repo}, README, and paginated releases/deployments/contributors — same as production enrichment."
  );
  out.push("");
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const r of rows) {
    const full = (r.repo_full_name ?? "").trim();
    if (!full || seen.has(full)) continue;
    seen.add(full);
    uniqueNames.push(full);
  }
  const previewTotal = uniqueNames.length;
  const REPO_DELAY_MS = 350;
  for (let pi = 0; pi < uniqueNames.length; pi++) {
    throwIfAborted(signal);
    const full = uniqueNames[pi]!;
    console.log(`[GithubReader] admin structured preview ${pi + 1}/${previewTotal}: ${full}`);
    out.push(`--- ${full} ---`);
    try {
      const text = await fetchStructuredSummaryTextForRepo(full, full);
      out.push(text);
    } catch (e) {
      out.push(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    out.push("");
    await new Promise((res) => setTimeout(res, REPO_DELAY_MS));
  }
  return out;
}

/** Saved default terms from `SearchSourceTask.config_json` (set via admin Update). */
export function getGhKeywordCsvFromTaskConfig(task: SearchSourceTask): string | null {
  const raw = task.config_json?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ghKeywordCsv?: string };
    const v = typeof parsed.ghKeywordCsv === "string" ? parsed.ghKeywordCsv.trim() : "";
    return v || null;
  } catch {
    return null;
  }
}

/** Where GitHub test search terms came from (for result file transparency). */
export type GithubTestTermsSource = "override" | "saved" | "project";

async function resolveTermsForTest(
  projectId: string,
  task: SearchSourceTask,
  testOptions?: CustomTaskRunTestOptions
): Promise<{ terms: string[]; error?: string; termsSource?: GithubTestTermsSource }> {
  const explicit = testOptions?.ghKeywordCsv?.trim();
  const saved = getGhKeywordCsvFromTaskConfig(task);
  const csv = (explicit || saved || "").trim();
  if (csv) {
    const terms = parseKeywordCsv(csv);
    if (terms.length === 0) {
      return { terms: [], error: "No terms found in keyword list." };
    }
    return {
      terms: terms.slice(0, GH_TEST_MAX_TERMS),
      termsSource: explicit ? "override" : "saved",
    };
  }
  const terms = await loadProjectListeningTerms(projectId);
  if (terms.length === 0) {
    return {
      terms: [],
      error:
        "This project has no keywords or brand names. Add them on the project, or provide a CSV override.",
    };
  }
  return { terms: terms.slice(0, GH_TEST_MAX_TERMS), termsSource: "project" };
}

function buildGithubTestParameterBlock(input: {
  projectId: string;
  projectName: string;
  termsSource: GithubTestTermsSource;
  resolvedTerms: string[];
  effectiveTerms: string[];
  testKeywordCap: number;
  isAdminTest: boolean;
  since: Date;
  modes: GithubIngestMode[];
  maxSearchPages: number;
}): string {
  const srcLabel =
    input.termsSource === "override"
      ? "Test dialog CSV override (ghKeywordCsv)"
      : input.termsSource === "saved"
        ? "Saved task config (config_json.ghKeywordCsv)"
        : "Project keywords + brand names (ProjectKeyword + ProjectBrand)";
  const lines: string[] = [
    "=== Project & parameters (this test run) ===",
    `Project: ${input.projectName}`,
    `Project id: ${input.projectId}`,
    `Terms source: ${srcLabel}`,
    `Resolved terms (${input.resolvedTerms.length}): ${input.resolvedTerms.join(", ") || "(none)"}`,
  ];
  if (input.isAdminTest && input.resolvedTerms.length > input.effectiveTerms.length) {
    lines.push(
      `Effective terms after admin cap (${input.effectiveTerms.length} of ${input.resolvedTerms.length}; GH_TEST_MAX_KEYWORDS=${input.testKeywordCap}): ${input.effectiveTerms.join(", ")}`
    );
  } else {
    lines.push(`Effective terms run: ${input.effectiveTerms.join(", ") || "(none)"}`);
  }
  lines.push(`Modes: ${input.modes.join(", ")}`);
  lines.push(`Repo search lookback since: ${input.since.toISOString()} (UTC)`);
  lines.push(`GitHub search max pages per keyword/mode: ${input.maxSearchPages}`);
  lines.push("");
  return lines.join("\n");
}

async function runIngestForTerms(
  terms: string[],
  task: SearchSourceTask,
  testOptions?: CustomTaskRunTestOptions,
  testProjectMeta?: {
    projectId: string;
    projectName: string;
    termsSource: GithubTestTermsSource;
  },
  /** Non-test orchestration runs: create Post rows per enriched repo for this project. */
  productionPostContext?: { projectId: string; ingestedRunId?: string | null }
): Promise<CustomTaskTestResult> {
  const signal = testOptions?.signal;
  const since = getSinceDate(task);
  const floor = Math.floor(since.getTime() / 1000);
  const sinceIso = since.toISOString();
  const modes = parseGhModesFromTaskConfig(task);
  const isAdminTest = testOptions != null;
  const maxSearchPages = resolveGithubMaxSearchPages(isAdminTest);
  const testKeywordCap = isAdminTest ? resolveTestKeywordLimit() : terms.length;
  const effectiveTerms = isAdminTest && terms.length > 0 ? terms.slice(0, testKeywordCap) : terms;

  const testParameterHeader =
    testProjectMeta && isAdminTest
      ? buildGithubTestParameterBlock({
          projectId: testProjectMeta.projectId,
          projectName: testProjectMeta.projectName,
          termsSource: testProjectMeta.termsSource,
          resolvedTerms: terms,
          effectiveTerms,
          testKeywordCap,
          isAdminTest,
          since,
          modes,
          maxSearchPages,
        })
      : "";

  const lines: string[] = [];
  let signalsTotal = 0;
  const seenGithubRepoIdsInRun = new Set<string>();

  const termCount = effectiveTerms.length;
  const modeCount = modes.length;
  const totalIngestSteps = termCount * modeCount;

  try {
    throwIfAborted(signal);

    console.log(
      `[GithubReader] ingest plan: ${termCount} keyword(s) × ${modeCount} mode(s) = ${totalIngestSteps} step(s); max ${maxSearchPages} search page(s)/step; adminTest=${isAdminTest}`
    );

    let ingestStepIndex = 0;
    for (let ti = 0; ti < effectiveTerms.length; ti++) {
      const kw = effectiveTerms[ti]!;
      throwIfAborted(signal);
      console.log(`[GithubReader] keyword ${ti + 1}/${termCount}: ${JSON.stringify(kw)}`);
      try {
        for (let mi = 0; mi < modes.length; mi++) {
          const mode = modes[mi]!;
          throwIfAborted(signal);
          ingestStepIndex += 1;
          console.log(
            `[GithubReader] step ${ingestStepIndex}/${totalIngestSteps}: keyword ${ti + 1}/${termCount} mode ${mi + 1}/${modeCount} → ${mode}`
          );
          if (mode === "repo") {
            const postContext =
              !isAdminTest && productionPostContext?.projectId
                ? {
                    projectId: productionPostContext.projectId,
                    ingestedRunId: productionPostContext.ingestedRunId ?? null,
                  }
                : undefined;
            const { newCursor } = await ingestGithubKeyword({
              keyword: kw,
              mode: "repo",
              cursor: sinceIso,
              // Per-repo GET /repos/{owner}/{repo} + delays; skip on admin test (was very slow).
              enrichRepos: !isAdminTest,
              maxSearchPages,
              seenGithubRepoIdsInRun,
              postContext,
            });
            lines.push(`"${kw}" [repo]: cursor → ${newCursor}`);
          } else {
            const { newCursor } = await ingestGithubKeyword({
              keyword: kw,
              mode: "code",
              cursor: "",
              maxSearchPages,
              seenGithubRepoIdsInRun,
            });
            lines.push(`"${kw}" [code]: completed at ${newCursor}`);
          }
        }
        lines.push("");
      } catch (e) {
        if (isTaskTestCancelledError(e)) {
          throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        lines.push(`"${kw}": error — ${msg}`);
        lines.push("");
      }
    }

    throwIfAborted(signal);

    console.log(
      `[GithubReader] keyword ingest loop finished (${ingestStepIndex}/${totalIngestSteps} steps attempted)`
    );

    const { lines: sample, totalInWindow } = await formatGithubSamplePreview(floor);
    signalsTotal = totalInWindow;
    lines.push("Catalog sample (all keywords share one row per repo/code hit):");
    lines.push(...sample);
    lines.push("");

    if (isAdminTest) {
      try {
        console.log(
          `[GithubReader] building admin structured preview (sample repos, same as production enrichment API shape)`
        );
        const structuredLines = await fetchStructuredDetailsForTestPreview(floor, signal);
        lines.push(...structuredLines);
      } catch (e) {
        if (isTaskTestCancelledError(e)) throw e;
        lines.push("=== Per-repository parameters (full structured summary) ===");
        lines.push(
          `Error building structured blocks: ${e instanceof Error ? e.message : String(e)}`
        );
        lines.push("");
      }
    }

    const preview = [
      ...(testParameterHeader ? [testParameterHeader] : []),
      `Requires GITHUB_TOKEN in the server environment.`,
      ...(isAdminTest
        ? [
            `Admin test: ingest skips writing enriched metadata to the DB during search (speed). The result file still includes a full structured parameter block per unique repo in the catalog sample (GET /repos + README + counts).`,
            ...(testParameterHeader
              ? []
              : terms.length > effectiveTerms.length
                ? [
                    `Keywords: ${effectiveTerms.length} of ${terms.length} (admin cap ${testKeywordCap}; set GH_TEST_MAX_KEYWORDS).`,
                  ]
                : []),
          ]
        : []),
      `Lookback: repo search uses updates since ${since.toISOString()} (UTC). Code search has no date filter in the GitHub API (task timing applies to repo search only).`,
      `Modes: ${modes.join(", ")}.`,
      `GitHub pagination: ${maxSearchPages} page(s) max per repo/code search${
        isAdminTest
          ? ` (admin test; GH_TEST_MAX_SEARCH_PAGES=1–10).`
          : ` (set GH_MAX_SEARCH_PAGES=1–10 for full runs).`
      }`,
      `Terms run: ${effectiveTerms.length}.`,
      `Per run: each GitHub repository is ingested once — later keywords skip repos already returned earlier in this run.`,
      `Total signals in window (deduped catalog, after ingest): ${signalsTotal}.`,
      "",
      ...lines,
    ].join("\n");

    return {
      success: true,
      resultPreview: preview,
      errorMessage: null,
      rowCount: signalsTotal,
    };
  } catch (e) {
    if (isTaskTestCancelledError(e)) {
      const preview = [
        ...(testParameterHeader ? [testParameterHeader] : []),
        `Lookback since ${since.toISOString()} (UTC).`,
        `Terms planned: ${effectiveTerms.length}.`,
        "",
        ...lines,
        "",
        "---",
        "Test stopped (cancelled). Partial results above.",
      ].join("\n");
      return {
        success: false,
        resultPreview: preview,
        errorMessage: "Test stopped.",
        rowCount: signalsTotal,
      };
    }
    throw e;
  }
}

export class GithubReaderCustomTask implements CustomTask {
  readonly id: string;

  constructor(private readonly task: SearchSourceTask) {
    this.id = task.id;
  }

  get name(): string {
    return this.task.name;
  }

  get description(): string | null {
    return this.task.description;
  }

  get targetKey(): string | null {
    return TARGET_GITHUB_READER;
  }

  async run(projectId: string, options: CustomTaskRunOptions): Promise<CustomTaskTestResult> {
    const productionPostContext =
      options.testMode === true
        ? undefined
        : { projectId, ingestedRunId: options.ingestedRunId ?? null };
    const saved = getGhKeywordCsvFromTaskConfig(this.task);
    if (saved) {
      const terms = parseKeywordCsv(saved);
      if (terms.length === 0) {
        return {
          success: false,
          resultPreview: null,
          errorMessage: "Saved keyword list is empty or invalid.",
          rowCount: 0,
        };
      }
      return runIngestForTerms(
        terms.slice(0, GH_TEST_MAX_TERMS),
        this.task,
        undefined,
        undefined,
        productionPostContext
      );
    }
    const terms = await loadProjectListeningTerms(projectId);
    if (terms.length === 0) {
      return {
        success: false,
        resultPreview: null,
        errorMessage:
          "No saved CSV keywords and no keywords or brand names on this project. Add terms on the project or save a CSV on the task.",
        rowCount: 0,
      };
    }
    return runIngestForTerms(
      terms.slice(0, GH_TEST_MAX_TERMS),
      this.task,
      undefined,
      undefined,
      productionPostContext
    );
  }

  async runTest(
    projectName: string,
    testOptions?: CustomTaskRunTestOptions
  ): Promise<CustomTaskTestResult> {
    const projectId = await findProjectIdByName(projectName);
    if (!projectId) {
      return {
        success: false,
        resultPreview: null,
        errorMessage: `No active project found with name "${projectName.trim()}".`,
        rowCount: 0,
      };
    }
    const { terms, error, termsSource } = await resolveTermsForTest(
      projectId,
      this.task,
      testOptions
    );
    if (error || terms.length === 0) {
      return {
        success: false,
        resultPreview: null,
        errorMessage: error ?? "No terms to search.",
        rowCount: 0,
      };
    }
    return runIngestForTerms(terms, this.task, testOptions, {
      projectId,
      projectName: projectName.trim(),
      termsSource: termsSource ?? "project",
    });
  }
}

export function createGithubReaderCustomTask(task: SearchSourceTask): GithubReaderCustomTask {
  return new GithubReaderCustomTask(task);
}
